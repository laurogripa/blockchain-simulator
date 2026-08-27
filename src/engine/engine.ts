import type {
  Block,
  ForkRecord,
  Hash,
  LogEvent,
  Miner,
  NodeId,
  Packet,
  PacketKind,
  PeerNode,
  Transaction,
} from './types';
import { useSimStore } from '../store/useSimStore';
import type { BlockView, MinerView, NodeView } from '../store/useSimStore';
import { Rng } from './rng';
import { EventQueue } from './eventQueue';
import { buildTopology, edgeLatency, type Edge } from './network';
import { blockRuleset, makePeerNode, receiveBlock, receiveTx } from './node';
import { analyzeForks, decidingBlock } from './forks';
import { makeGenesisBlock, GENESIS_HASH } from './chain';
import { buildCandidateTemplate, finalizeBlock } from './miner';
import { makeRandomTx } from './mempool';
import { runScenario, SCENARIO_LENGTH, type ScenarioState } from './scenarios';
import {
  EXPECTED_HASHES,
  TARGET_BLOCK_TIME_SIM_MS,
  PROPAGATION_STRETCH,
  MAX_EVENTS_PER_FRAME,
  MAX_DT_REAL_MS,
  LOG_RING_SIZE,
} from './constants';
import { targetHexForBits, workOfBits } from './constants';

const FULL_NODE_IDS = Array.from({ length: 10 }, (_, i) => `N${i + 1}`);
const MINER_IDS = ['M1', 'M2', 'M3', 'M4', 'M5'];
const MINER_HASHPOWER: Record<string, number> = { M1: 0.3, M2: 0.25, M3: 0.2, M4: 0.15, M5: 0.1 };
const MAX_ATTEMPTS_PER_MINER = 25;

let seq = 0;
const nextId = (p: string) => `${p}${seq++}`;

interface DeferredArrival {
  nodeId: NodeId;
  block: Block;
  fromId: NodeId;
}

/**
 * A scripted "simultaneous solve": two miners grind the same parent; the first to solve announces
 * right away, but its block is treated as still in flight to the rival, which keeps grinding
 * until it finds its own — so both really do solve the same height, each unaware of the other,
 * exactly as happens in Bitcoin when two blocks land within propagation latency. `roundsLeft` > 1
 * repeats it on top of the two fresh branches, producing the (rare in real life) fork that stays
 * tied for several blocks.
 */
interface ForkRace {
  miners: [NodeId, NodeId];
  roundsLeft: number;
  round: number;
  phase: 'arming' | 'racing' | 'settling'; // arming = waiting for both racers to share a tip
  solved: Hash[]; // this round's solutions, in the order they were found
  deferred: DeferredArrival[]; // rival blocks held "in flight" from a racer still grinding
  released: Hash[]; // blocks announced in the last round — round N+1 waits until every node has them
  pausedMiners: NodeId[];
}

/** Who goes to the hard-forked ruleset: a contiguous stretch of the peer ring so the minority
 *  side stays connected through its own relays (legacy nodes won't relay big-block blocks). */
const BIG_RULES_NODES: NodeId[] = ['N9', 'N10', 'M4', 'M5'];

const formatWork = (w: number) => `${(w / workOfBits(20)).toFixed(0)} blocks of work`;

export class SimEngine {
  blocks = new Map<Hash, Block>();
  nodes = new Map<NodeId, PeerNode | Miner>();
  edges: Edge[] = [];
  eventQueue = new EventQueue();
  rng = new Rng(1337);

  simNow = 0;
  speed = 100;
  mode: 'manual' | 'auto' = 'auto';
  running = true;
  propagationStretch = PROPAGATION_STRETCH;

  workers = new Map<NodeId, Worker>();
  dirty = true;
  packets: Packet[] = [];
  events: LogEvent[] = [];
  /** The live "M1 mining h5…" line per miner; rewritten in place when the attempt ends. */
  private miningLog = new Map<NodeId, LogEvent>();

  lastReal = 0;
  lastTxGenAt = 0;
  nextTxGap = 0;
  lastStoreFlush = 0;
  rafHandle = 0;

  // scenario state
  race: ForkRace | null = null;
  hardForkHeight: number | null = null;
  lastMinedBy: NodeId | null = null;
  forkRecords = new Map<Hash, ForkRecord>(); // keyed by the fork point's parent hash
  private boosted = new Set<NodeId>(); // miners whose throttle mineNow() lifted, until they solve
  private rejectionLogged = new Set<string>(); // `${ruleset}:${hash}` — one log line per side per block
  genesisHash: Hash = GENESIS_HASH; // overwritten in setup() with the real, mined genesis hash

  constructor() {
    this.setup();
  }

  private setup() {
    const genesis = makeGenesisBlock();
    this.blocks.set(genesis.hash, genesis);
    this.genesisHash = genesis.hash;

    const allIds = [...FULL_NODE_IDS, ...MINER_IDS];
    const positions = layoutPositions(allIds);

    // Note: genesis's coinbase is deliberately NOT applyBlock-ed into any node's UTXO set —
    // see makeGenesisBlock's doc comment. Every node starts with an empty UTXO set, same as the
    // real chain did.
    FULL_NODE_IDS.forEach((id) => {
      const node = makePeerNode(id, 'full', positions[id].x, positions[id].y, genesis);
      this.nodes.set(id, node);
    });
    MINER_IDS.forEach((id) => {
      const node = makePeerNode(id, 'miner', positions[id].x, positions[id].y, genesis) as Miner;
      node.hashPower = MINER_HASHPOWER[id];
      node.template = null;
      node.hashesDone = 0;
      node.status = 'idle';
      node.attempts = [];
      this.nodes.set(id, node);
    });

    const { peers, edges } = buildTopology(allIds, this.rng);
    this.edges = edges;
    for (const [id, list] of peers) this.nodes.get(id)!.peers = list;

    for (const id of MINER_IDS) {
      const w = new Worker(new URL('./workers/miner.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (ev) => this.onWorkerMessage(id, ev.data);
      this.workers.set(id, w);
    }

    this.nextTxGap = this.sampleTxGap();
    this.dirty = true;
  }

  private started = false;
  start() {
    if (this.started) return;
    this.started = true;
    this.lastReal = performance.now();
    const loop = (now: number) => {
      this.frame(now);
      this.rafHandle = requestAnimationFrame(loop);
    };
    this.rafHandle = requestAnimationFrame(loop);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.pauseWorkers();
      } else {
        this.lastReal = performance.now();
        this.resumeWorkers();
      }
    });
  }

  stop() {
    cancelAnimationFrame(this.rafHandle);
  }

  private pauseWorkers() {
    for (const [id, w] of this.workers) {
      const m = this.nodes.get(id) as Miner;
      if (m.status === 'grinding') w.postMessage({ type: 'stop' });
    }
  }
  private resumeWorkers() {
    for (const id of MINER_IDS) {
      const m = this.nodes.get(id) as Miner;
      if (m.status === 'grinding' && m.template) this.startGrinding(id);
    }
  }

  // ---- main loop ----
  private frame(now: number) {
    const dtReal = Math.min(now - this.lastReal, MAX_DT_REAL_MS);
    this.lastReal = now;
    if (this.running) {
      this.simNow += dtReal * (this.mode === 'auto' ? this.speed : 0);
    }
    this.eventQueue.drainUpTo(this.simNow, MAX_EVENTS_PER_FRAME);

    if (this.mode === 'auto' && this.running) {
      this.maybeGenerateTx();
      for (const id of MINER_IDS) {
        const m = this.nodes.get(id) as Miner;
        if (m.status !== 'idle') continue;
        // a racing miner must not run ahead of the scripted race: not once it has solved this
        // round (its rival is still grinding), and not while the network absorbs the last round
        if (this.race?.miners.includes(id) && (this.race.phase !== 'racing' || this.raceSolvedBy(id))) continue;
        this.ensureMinerTemplate(id);
      }
    }
    if (this.race && this.race.phase !== 'racing' && this.running) this.advanceRace();
    this.updateHashrateBudgets();
    this.flushDirtyToStore(now);
  }

  private sampleTxGap(): number {
    // Poisson-ish: ~1 per 120 sim-seconds
    const meanMs = 120_000;
    return -Math.log(1 - this.rng.float()) * meanMs;
  }

  private maybeGenerateTx() {
    if (this.simNow - this.lastTxGenAt < this.nextTxGap) return;
    this.lastTxGenAt = this.simNow;
    this.nextTxGap = this.sampleTxGap();
    this.createTxAt(this.rng.pick(FULL_NODE_IDS));
  }

  createTxAt(originId: NodeId) {
    const origin = this.nodes.get(originId);
    if (!origin) return;
    const tx = makeRandomTx(origin.utxo, this.rng, this.simNow);
    if (!tx) return;
    receiveTx(origin, tx);
    this.floodTx(originId, tx);
    this.logEvent('tx', `tx ${tx.txid.slice(0, 8)} created at ${originId}`);
    this.dirty = true;
  }

  // ---- networking / propagation ----
  private schedulePacket(from: NodeId, to: NodeId, kind: PacketKind, payloadHash: Hash, onArrive: () => void) {
    const latency = edgeLatency(this.edges, from, to, this.rng, this.propagationStretch);
    const packet: Packet = {
      id: nextId('pkt'),
      from,
      to,
      kind,
      payloadHash,
      sentAt: this.simNow,
      arrivesAt: this.simNow + latency,
    };
    this.packets.push(packet);
    this.dirty = true;
    this.eventQueue.push({
      at: packet.arrivesAt,
      run: () => {
        this.packets = this.packets.filter((p) => p.id !== packet.id);
        onArrive();
        this.dirty = true;
      },
    });
  }

  private floodBlock(fromId: NodeId, block: Block, excludeId?: NodeId) {
    const from = this.nodes.get(fromId);
    if (!from) return;
    for (const peerId of from.peers) {
      if (peerId === excludeId) continue;
      const peer = this.nodes.get(peerId);
      if (!peer || peer.known.has(block.hash)) continue;
      // inv -> getdata -> block handshake
      this.schedulePacket(fromId, peerId, 'inv', block.hash, () => {
        if (peer.known.has(block.hash)) return;
        this.schedulePacket(peerId, fromId, 'getdata', block.hash, () => {
          this.schedulePacket(fromId, peerId, 'block', block.hash, () => {
            this.handleBlockArrival(peerId, block, fromId);
          });
        });
      });
    }
  }

  private floodTx(fromId: NodeId, tx: Transaction, excludeId?: NodeId) {
    const from = this.nodes.get(fromId);
    if (!from) return;
    for (const peerId of from.peers) {
      if (peerId === excludeId) continue;
      const peer = this.nodes.get(peerId);
      if (!peer || peer.mempool.has(tx.txid)) continue;
      this.schedulePacket(fromId, peerId, 'inv', tx.txid, () => {
        if (peer.mempool.has(tx.txid)) return;
        this.schedulePacket(peerId, fromId, 'getdata', tx.txid, () => {
          this.schedulePacket(fromId, peerId, 'tx', tx.txid, () => {
            if (receiveTx(peer, tx)) {
              this.floodTx(peerId, tx, fromId);
              this.dirty = true;
            }
          });
        });
      });
    }
  }

  private handleBlockArrival(nodeId: NodeId, block: Block, fromId: NodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    // Mid-race, the first solution is still "in flight" to the rival racer: it keeps grinding
    // on the shared parent, none the wiser, until it finds its own block.
    const race = this.race;
    if (race?.phase === 'racing' && race.miners.includes(nodeId) && race.solved.includes(block.hash) && !this.raceSolvedBy(nodeId)) {
      race.deferred.push({ nodeId, block, fromId });
      return;
    }
    const before = node.known.has(block.hash);
    const prevTip = node.tip;
    const { isNewBest, reorg, rejected, tieKept } = receiveBlock(this.blocks, node, block, this.simNow);
    if (rejected) {
      // Refused blocks are neither adopted nor relayed — this is how a rule split stays split.
      const key = `${node.rules.name}:${block.hash}`;
      if (!this.rejectionLogged.has(key)) {
        this.rejectionLogged.add(key);
        this.logEvent('reject', `${nodeId} (${node.rules.name} rules) rejects h${block.height} by ${block.minedBy}: ${rejected} — ignored no matter its work`);
      }
      this.dirty = true;
      return;
    }
    if (!before) {
      node.advertisedTip.set(fromId, block.hash);
      this.floodBlock(nodeId, block, fromId);
    }
    if (tieKept) {
      const kept = this.blocks.get(node.tip)!;
      const seenGap = this.simNow - (node.firstSeen.get(kept.hash) ?? this.simNow);
      const when = seenGap < 50 ? 'arrived in the same instant' : `arrived ${(seenGap / 1000).toFixed(1)}s later`;
      this.logEvent('tie', `${nodeId} keeps h${kept.height} by ${kept.minedBy}: ${block.minedBy}'s h${block.height} ${when} with equal work — first seen wins`);
    }
    if (reorg) {
      const oldTip = this.blocks.get(prevTip)!;
      const droppedBy = reorg.disconnected.map((h) => this.blocks.get(h)?.minedBy ?? '?').join(',');
      this.logEvent('reorg', `${nodeId} reorg: switches to ${block.minedBy}'s h${block.height} (${formatWork(block.cumulativeWork)}) over h${oldTip.height} (${formatWork(oldTip.cumulativeWork)}) — drops ${reorg.depth} block${reorg.depth > 1 ? 's' : ''} by ${droppedBy}`);
    }
    if (isNewBest) {
      this.dirty = true;
      if (node.kind === 'miner') this.restartMinerIfStale(nodeId);
    }
  }

  /** A miner whose tip moved must abandon a template built on the old tip — real miners switch
   *  the instant a better chain shows up, otherwise their next block would be born stale. */
  private restartMinerIfStale(minerId: NodeId) {
    const miner = this.nodes.get(minerId) as Miner;
    if (miner.status !== 'grinding' || !miner.template) return;
    if (miner.template.header.prevHash === miner.tip) return;
    const attempt = miner.attempts[miner.attempts.length - 1];
    if (attempt && attempt.endedAt === null) attempt.endedAt = this.simNow; // superseded
    this.abandonMiningLog(minerId, 'tip moved');
    this.workers.get(minerId)!.postMessage({ type: 'stop' });
    this.boosted.delete(minerId);
    miner.template = null;
    miner.hashesDone = 0;
    miner.status = 'idle';
    if (this.mode === 'auto' && this.running) this.ensureMinerTemplate(minerId);
  }

  // ---- mining ----
  private updateHashrateBudgets() {
    const denomSeconds = (TARGET_BLOCK_TIME_SIM_MS / 1000) / Math.max(this.speed, 0.01);
    const networkHps = denomSeconds > 0 ? EXPECTED_HASHES / denomSeconds : 0;
    for (const id of MINER_IDS) {
      const m = this.nodes.get(id) as Miner;
      if (m.status !== 'grinding' || this.boosted.has(id)) continue;
      const hps = Math.max(50, networkHps * m.hashPower);
      this.workers.get(id)!.postMessage({ type: 'setHps', hps });
    }
  }

  ensureMinerTemplate(minerId: NodeId) {
    const miner = this.nodes.get(minerId) as Miner;
    if (!miner || miner.status === 'grinding') return;
    const parent = this.blocks.get(miner.tip)!;
    const { header, txs } = buildCandidateTemplate(miner, parent, this.simNow);
    miner.template = { hash: '', header, txs, height: parent.height + 1, cumulativeWork: 0, minedBy: minerId, hashesTried: 0, undo: [] };
    miner.status = 'grinding';
    miner.hashesDone = 0;
    miner.attempts.push({
      id: nextId('att'),
      height: parent.height + 1,
      startedAt: this.simNow,
      endedAt: null,
      hashesTried: 0,
      solvedBlockHash: null,
    });
    if (miner.attempts.length > MAX_ATTEMPTS_PER_MINER) miner.attempts.shift();
    this.miningLog.set(minerId, this.logEvent('mining', this.miningText(minerId, parent, txs.length, 0)));
    this.startGrinding(minerId);
    this.dirty = true;
  }

  private startGrinding(minerId: NodeId) {
    const miner = this.nodes.get(minerId) as Miner;
    if (!miner.template) return;
    const target = targetHexForBits(miner.template.header.bits);
    const denomSeconds = (TARGET_BLOCK_TIME_SIM_MS / 1000) / Math.max(this.speed, 0.01);
    const networkHps = denomSeconds > 0 ? EXPECTED_HASHES / denomSeconds : 0;
    const hps = Math.max(50, networkHps * miner.hashPower);
    this.workers.get(minerId)!.postMessage({ type: 'template', header: miner.template.header, target, hps });
  }

  mineNow(minerId: NodeId) {
    const miner = this.nodes.get(minerId) as Miner;
    if (!miner) return;
    if (!miner.template) this.ensureMinerTemplate(minerId);
    // lift throttle: ~1M h/s, held until this template is solved or abandoned
    this.boosted.add(minerId);
    this.workers.get(minerId)!.postMessage({ type: 'setHps', hps: 1_000_000 });
  }

  private onWorkerMessage(minerId: NodeId, msg: { type: string; nonce?: number; hash?: string; hashesTried: number }) {
    const miner = this.nodes.get(minerId) as Miner;
    if (!miner || !miner.template) return;
    const currentAttempt = miner.attempts[miner.attempts.length - 1];
    if (msg.type === 'progress') {
      miner.hashesDone = msg.hashesTried;
      if (currentAttempt) currentAttempt.hashesTried = msg.hashesTried;
      const live = this.miningLog.get(minerId);
      if (live) live.text = this.miningText(minerId, this.blocks.get(miner.template.header.prevHash)!, miner.template.txs.length, msg.hashesTried);
      this.dirty = true;
    } else if (msg.type === 'solved') {
      const parent = this.blocks.get(miner.template.header.prevHash)!;
      const header = { ...miner.template.header, nonce: msg.nonce! };
      const block = finalizeBlock(parent, header, miner.template.txs, msg.hash!, minerId, msg.hashesTried);
      this.blocks.set(block.hash, block);
      if (currentAttempt) {
        currentAttempt.hashesTried = msg.hashesTried;
        currentAttempt.endedAt = this.simNow;
        currentAttempt.solvedBlockHash = block.hash;
      }
      miner.status = 'idle';
      miner.template = null;
      miner.hashesDone = 0;
      this.boosted.delete(minerId);
      this.onBlockSolved(minerId, block);
    }
  }

  private raceSolvedBy(minerId: NodeId): boolean {
    return !!this.race?.solved.some((h) => this.blocks.get(h)?.minedBy === minerId);
  }

  private onBlockSolved(minerId: NodeId, block: Block) {
    const race = this.race;
    if (race?.phase === 'racing' && race.miners.includes(minerId)) {
      race.solved.push(block.hash);
      this.announceBlock(minerId, block);
      const rival = race.miners.find((id) => id !== minerId)!;
      if (race.solved.length < race.miners.length) {
        this.logEvent('fork', `${minerId} solves h${block.height} (${block.hash.slice(0, 8)}…, nonce ${block.header.nonce}) and announces it — ${rival} hasn't heard yet and keeps grinding the same parent`);
      } else {
        this.finishRaceRound(minerId, block);
      }
      return;
    }
    this.announceBlock(minerId, block);
  }

  private announceBlock(minerId: NodeId, block: Block) {
    const miner = this.nodes.get(minerId) as Miner;
    const before = miner.known.has(block.hash);
    const { reorg } = receiveBlock(this.blocks, miner, block, this.simNow);
    if (!before) this.floodBlock(minerId, block);
    this.lastMinedBy = minerId;
    const rules = blockRuleset(block) === 'big' ? ', big rules' : '';
    const text = `${minerId} mined h${block.height} on ${this.blocks.get(block.header.prevHash)?.minedBy ?? 'genesis'}'s h${block.height - 1} (${block.txs.length} txs, nonce ${block.header.nonce}${rules})`;
    const live = this.miningLog.get(minerId);
    if (live) {
      // the attempt line becomes the result line, so the log reads "mining… → mined"
      live.kind = 'block';
      live.at = this.simNow;
      live.text = text;
      this.miningLog.delete(minerId);
    } else {
      this.logEvent('block', text);
    }
    if (reorg) this.logEvent('reorg', `${minerId} reorg depth ${reorg.depth}`);
    this.dirty = true;
  }

  /** The rival has just found its own block: the first solution's delivery now "lands", and the
   *  network holds two equal-work blocks at the same height. */
  private finishRaceRound(minerId: NodeId, block: Block) {
    const race = this.race!;
    const first = this.blocks.get(race.solved[0])!;
    const sameParent = first.header.prevHash === block.header.prevHash;
    this.logEvent('fork', `${minerId} solves its own h${block.height} (${block.hash.slice(0, 8)}…, nonce ${block.header.nonce}) before ${first.minedBy}'s reaches it — ${sameParent ? 'same parent, ' : 'each on its own branch, '}same work, different nonces; every node keeps whichever reaches it first`);
    race.released = race.solved.slice();
    race.solved = [];
    race.roundsLeft--;
    race.phase = 'settling';
    const deferred = race.deferred;
    race.deferred = [];
    for (const d of deferred) this.handleBlockArrival(d.nodeId, d.block, d.fromId);
  }

  // ---- scenarios ----
  /**
   * Accidental fork: M1 and M2 solve the same height at the same instant. `depth` = how many
   * consecutive rounds of simultaneous solves to force. 1 is the realistic case (the very next
   * block settles it); 2+ reproduces the rare fork that stays tied for several blocks. The other
   * miners are paused during the race so it stays deterministic, then resumed to settle it.
   */
  runAccidentalFork(depth = 1) {
    if (this.race || this.hardForkHeight !== null) return;
    const miners: [NodeId, NodeId] = ['M1', 'M2'];
    const paused = MINER_IDS.filter((id) => !miners.includes(id));
    for (const id of paused) this.pauseMiner(id);
    this.race = { miners, roundsLeft: depth, round: 0, phase: 'arming', solved: [], deferred: [], released: [], pausedMiners: paused };
    const tip = this.blocks.get(this.nodes.get('M1')!.tip)!;
    this.logEvent('fork', `accidental fork staged at h${tip.height + 1}: M1 and M2 race on the same parent (${paused.join(',')} paused for the demo)${depth > 1 ? `, tied for ${depth} rounds` : ''}`);
    this.advanceRace();
  }

  private startRaceRound() {
    const race = this.race!;
    race.round++;
    race.phase = 'racing';
    race.solved = [];
    race.deferred = [];
    for (const id of race.miners) {
      const m = this.nodes.get(id) as Miner;
      if (m.status === 'grinding' && m.template?.header.prevHash !== m.tip) this.restartMinerIfStale(id);
      if (m.status !== 'grinding') this.ensureMinerTemplate(id);
      this.mineNow(id);
    }
  }

  private advanceRace() {
    const race = this.race!;
    if (race.phase === 'arming') {
      // both racers must build on the very same parent, else it isn't a fork at all
      const [a, b] = race.miners.map((id) => this.nodes.get(id)!.tip);
      if (a !== b) return;
      this.startRaceRound();
      return;
    }
    // wait until every node has seen both rival blocks — so the split is visible before it deepens
    const everyoneHasBoth = Array.from(this.nodes.values()).every((n) => race.released.every((h) => n.known.has(h)));
    if (!everyoneHasBoth) return;
    if (race.roundsLeft > 0) {
      const [a, b] = race.miners.map((id) => this.blocks.get(this.nodes.get(id)!.tip)!);
      if (a.hash === b.hash) {
        // they converged on one tip — nothing left to deepen
        this.logEvent('fork', `race cut short: M1 and M2 already agree on h${a.height}`);
        race.roundsLeft = 0;
      } else {
        this.logEvent('fork', `round ${race.round + 1}: the network is split — each miner extends its own h${a.height}; both branches still tie`);
        this.startRaceRound();
        return;
      }
    }
    this.logEvent('fork', `race over: ${race.pausedMiners.join(',')} resume — the next block mined on either branch breaks the tie`);
    for (const id of race.pausedMiners) this.resumeMiner(id);
    this.race = null;
  }

  private pauseMiner(id: NodeId) {
    const m = this.nodes.get(id) as Miner;
    if (m.status === 'grinding') this.workers.get(id)!.postMessage({ type: 'stop' });
    const attempt = m.attempts[m.attempts.length - 1];
    if (attempt && attempt.endedAt === null) attempt.endedAt = this.simNow;
    this.abandonMiningLog(id, 'paused');
    this.boosted.delete(id);
    m.template = null;
    m.hashesDone = 0;
    m.status = 'paused';
    this.dirty = true;
  }

  private resumeMiner(id: NodeId) {
    const m = this.nodes.get(id) as Miner;
    if (m.status === 'paused') m.status = 'idle';
    this.dirty = true;
  }

  /**
   * Bitcoin/Bitcoin-Cash-style chain split: a minority of nodes and miners switch to a new,
   * incompatible ruleset from the next height on. No network partition is involved — the two
   * sides stay connected and keep relaying, they simply refuse each other's blocks. Cumulative
   * work cannot settle this: each side's "heaviest valid chain" is its own, forever.
   */
  hardFork() {
    if (this.hardForkHeight !== null || this.race) return;
    const tip = this.blocks.get(this.nodes.get('N1')!.tip)!;
    const forkHeight = tip.height + 1;
    this.hardForkHeight = forkHeight;
    for (const id of BIG_RULES_NODES) {
      const n = this.nodes.get(id)!;
      n.rules = { name: 'big', forkHeight };
    }
    // keep the minority side connected to itself so its blocks can reach every big-rules node
    for (let i = 0; i + 1 < BIG_RULES_NODES.length; i++) this.ensurePeered(BIG_RULES_NODES[i], BIG_RULES_NODES[i + 1]);
    // miners on the new rules throw away any legacy template they were grinding
    for (const id of MINER_IDS) {
      const m = this.nodes.get(id) as Miner;
      if (m.rules.name !== 'big' || m.status !== 'grinding') continue;
      this.workers.get(id)!.postMessage({ type: 'stop' });
      const attempt = m.attempts[m.attempts.length - 1];
      if (attempt && attempt.endedAt === null) attempt.endedAt = this.simNow;
      this.abandonMiningLog(id, 'switching rules');
      m.template = null;
      m.status = 'idle';
    }
    const bigMiners = MINER_IDS.filter((id) => (this.nodes.get(id) as Miner).rules.name === 'big');
    const bigPower = bigMiners.reduce((s, id) => s + (this.nodes.get(id) as Miner).hashPower, 0);
    this.logEvent('split', `hard fork at h${forkHeight}: ${BIG_RULES_NODES.join(',')} switch to big-block rules (${(bigPower * 100).toFixed(0)}% of hashpower) — legacy nodes reject the fork bit, big nodes reject legacy blocks from h${forkHeight} on`);
    this.dirty = true;
  }

  private ensurePeered(a: NodeId, b: NodeId) {
    const na = this.nodes.get(a)!;
    const nb = this.nodes.get(b)!;
    if (na.peers.includes(b)) return;
    na.peers.push(b);
    nb.peers.push(a);
    this.edges.push({ a, b, baseLatencyMs: this.rng.range(40, 250) });
  }

  // ---- scripted 64-block scenario ----
  /**
   * Replaces the (still-genesis-only, since this must run before start()) chain with the
   * deterministic 64-block scenario's end state: every node/miner adopts its resulting chain,
   * UTXO set, and mempool, so the story is already "told" the instant the sim goes live. Mining
   * then continues forward from block 64 as normal — this seeds history, it doesn't freeze it.
   */
  loadScenario() {
    const state: ScenarioState = runScenario();
    this.blocks = new Map(state.blocks);
    const known = new Set(state.blocks.keys());
    for (const node of this.nodes.values()) {
      node.tip = state.network.tip;
      node.known = new Set(known);
      node.firstSeen = new Map(state.network.firstSeen);
      node.utxo = new Map(state.network.utxo);
      node.mempool = new Map(state.network.mempool);
    }
    this.simNow = state.now;
    this.lastMinedBy = null;
    for (const line of state.log) this.logEvent('block', line);
    this.logEvent('block', `scripted scenario loaded: ${SCENARIO_LENGTH - 1} blocks of Bitcoin's history in miniature`);
    this.dirty = true;
  }

  // ---- misc ----
  setSpeed(speed: number) {
    this.speed = speed;
  }
  setMode(mode: 'manual' | 'auto') {
    this.mode = mode;
  }
  setRunning(running: boolean) {
    this.running = running;
  }

  private logEvent(kind: LogEvent['kind'], text: string): LogEvent {
    const ev: LogEvent = { id: nextId('ev'), at: this.simNow, kind, text };
    this.events.push(ev);
    if (this.events.length > LOG_RING_SIZE) this.events.shift();
    return ev;
  }

  private miningText(minerId: NodeId, parent: Block, txCount: number, hashes: number): string {
    return `${minerId} mining h${parent.height + 1} on ${parent.minedBy}'s h${parent.height} (${txCount} txs) — ${hashes.toLocaleString()} hashes tried…`;
  }

  /** The attempt ended without a block: keep the line but say why, so the log never shows a
   *  miner "still mining" something it dropped. */
  private abandonMiningLog(minerId: NodeId, why: string) {
    const live = this.miningLog.get(minerId);
    if (!live) return;
    live.text = live.text.replace(/ — .*$/, ` — abandoned (${why})`);
    this.miningLog.delete(minerId);
  }

  // ---- fork bookkeeping ----
  /** Keeps ForkRecords in step with the block DAG and every node's tip; writes the "why". */
  updateForkRecords() {
    const tips = new Map<NodeId, Hash>();
    for (const n of this.nodes.values()) tips.set(n.id, n.tip);
    for (const point of analyzeForks(this.blocks, tips)) {
      let rec = this.forkRecords.get(point.parentHash);
      const isHard = point.branches.some((b) => b.ruleset === 'big') && point.branches.some((b) => b.ruleset === 'legacy');
      if (!rec) {
        rec = {
          id: nextId('fork'),
          parentHash: point.parentHash,
          height: point.height,
          kind: isHard ? 'hardfork' : 'accidental',
          status: 'open',
          openedAt: this.simNow,
          resolvedAt: null,
          branches: point.branches,
          winner: null,
          narrative: [],
        };
        const names = point.branches.map((b) => `${b.minedBy} (${b.root.slice(0, 8)}…${b.ruleset === 'big' ? ', big rules' : ''})`).join(' vs ');
        rec.narrative.push(
          isHard
            ? `h${point.height}: ${names} — same parent, incompatible rules. Neither side will ever accept the other's blocks, so work can't decide this.`
            : `h${point.height}: ${names} — same parent, equal work. Nodes keep whichever block reached them first and wait for more work.`,
        );
        this.forkRecords.set(point.parentHash, rec);
      }
      const prev = rec.branches;
      rec.branches = point.branches;
      if (rec.status === 'resolved' || rec.kind === 'hardfork') continue;
      const alive = point.branches.filter((b) => b.supporters.length > 0);
      const total = point.branches.reduce((s, b) => s + b.supporters.length, 0);
      if (alive.length === 1 && total === this.nodes.size) {
        const winner = alive[0];
        const loser = point.branches.filter((b) => b.root !== winner.root).sort((a, b) => b.maxWork - a.maxWork)[0];
        const decider = decidingBlock(this.blocks, winner.root, loser);
        const lostSupport = prev.find((b) => b.root === loser.root)?.supporters.length ?? 0;
        rec.status = 'resolved';
        rec.resolvedAt = this.simNow;
        rec.winner = winner.root;
        rec.narrative.push(
          decider
            ? `resolved: ${decider.minedBy} mined h${decider.height} on ${winner.minedBy}'s branch, making it ${winner.length} blocks vs ${loser.length} — more work, so the ${lostSupport} node${lostSupport === 1 ? '' : 's'} on ${loser.minedBy}'s branch reorged onto it. ${loser.minedBy}'s h${point.height} is now stale.`
            : `resolved: every node converged on ${winner.minedBy}'s branch (${winner.length} blocks vs ${loser.length}).`,
        );
        this.logEvent('resolve', `fork at h${point.height} resolved — ${winner.minedBy}'s branch wins with ${formatWork(winner.maxWork)} vs ${formatWork(loser.maxWork)}`);
      }
    }
  }

  private chainFromTip(tip: Hash): Hash[] {
    const chain: Hash[] = [];
    let cur: Hash | undefined = tip;
    while (cur) {
      const b = this.blocks.get(cur);
      if (!b) break;
      chain.unshift(cur);
      // Genesis's own hash is a real, mined value (not the GENESIS_HASH sentinel) — the walk
      // stops once it reaches a block with no real parent, i.e. whose prevHash IS that sentinel.
      if (b.header.prevHash === GENESIS_HASH) break;
      cur = b.header.prevHash;
    }
    return chain;
  }

  // ---- store sync ----
  private flushDirtyToStore(nowReal: number) {
    const shouldFlushClock = nowReal - this.lastStoreFlush > 1000;
    if (!this.dirty && !shouldFlushClock) return;
    this.dirty = false;
    if (shouldFlushClock) this.lastStoreFlush = nowReal;
    this.updateForkRecords();

    const nodes: Record<string, NodeView> = {};
    const miners: Record<string, MinerView> = {};
    for (const [id, n] of this.nodes) {
      const view: NodeView = {
        id,
        kind: n.kind,
        x: n.x,
        y: n.y,
        tip: n.tip,
        mempoolSize: n.mempool.size,
        utxoCount: n.utxo.size,
        reorgFlashUntil: n.reorgFlashUntil,
        clientVersion: n.clientVersion,
        peers: n.peers,
        rules: n.rules.name,
      };
      nodes[id] = view;
      if (n.kind === 'miner') {
        const m = n as Miner;
        miners[id] = {
          ...view,
          hashPower: m.hashPower,
          status: m.status,
          hashesDone: m.hashesDone,
          templateTxCount: m.template ? m.template.txs.length : 0,
        };
      }
    }

    const blockIndex: Record<string, BlockView> = {};
    const activeTip = this.nodes.get(FULL_NODE_IDS[0])?.tip ?? this.genesisHash;
    const activeChain = this.chainFromTip(activeTip);
    const activeSet = new Set(activeChain);
    // The hard-forked side's own best chain, as seen by its first full node — its blocks are
    // valid under *their* rules, so they're drawn as a live second chain, not as stale orphans.
    const bigNode = Array.from(this.nodes.values()).find((n) => n.rules.name === 'big' && n.kind === 'full');
    const altSet = new Set(bigNode ? this.chainFromTip(bigNode.tip) : []);
    for (const [hash, b] of this.blocks) {
      blockIndex[hash] = {
        hash,
        prevHash: b.header.prevHash,
        height: b.height,
        cumulativeWork: b.cumulativeWork,
        txCount: b.txs.length,
        minedBy: b.minedBy,
        timestamp: b.header.timestamp,
        merkleRoot: b.header.merkleRoot,
        nonce: b.header.nonce,
        bits: b.header.bits,
        ruleset: blockRuleset(b),
        chain: activeSet.has(hash) ? 'main' : altSet.has(hash) && !activeSet.has(hash) ? 'alt' : null,
        isOrphan: !activeSet.has(hash) && !altSet.has(hash),
      };
    }

    const tips = Array.from(new Set(Array.from(this.nodes.values()).map((n) => n.tip)));

    const state = useSimStore.getState();
    useSimStore.setState({
      simNow: this.simNow,
      nodes,
      miners,
      blockIndex,
      tips,
      activeChain,
      packets: this.packets.slice(),
      events: this.events.slice(-LOG_RING_SIZE),
      focusedNode: state.focusedNode || FULL_NODE_IDS[0],
      networkEdges: this.edges.map((e) => ({ a: e.a, b: e.b })),
      lastMinedBy: this.lastMinedBy,
      forks: Array.from(this.forkRecords.values()).map((f) => ({ ...f, branches: f.branches.map((b) => ({ ...b, supporters: b.supporters.slice() })), narrative: f.narrative.slice() })),
      raceActive: this.race !== null,
      hardForkHeight: this.hardForkHeight,
    });
  }
}

function layoutPositions(ids: string[]): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {};
  const cx = 340;
  const cy = 240;
  const r = 210;
  ids.forEach((id, i) => {
    const angle = (i / ids.length) * Math.PI * 2 - Math.PI / 2;
    pos[id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
  return pos;
}

export let engine: SimEngine;
export function initEngine(): SimEngine {
  engine = new SimEngine();
  if (import.meta.env.DEV) (window as unknown as { __engine: SimEngine }).__engine = engine;
  return engine;
}
