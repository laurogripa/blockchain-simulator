import type {
  Block,
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
import { makePeerNode, receiveBlock, receiveTx } from './node';
import { makeGenesisBlock, GENESIS_HASH } from './chain';
import { applyBlock } from './utxo';
import { buildCandidateTemplate, finalizeBlock } from './miner';
import { makeRandomTx } from './mempool';
import {
  EXPECTED_HASHES,
  TARGET_BLOCK_TIME_SIM_MS,
  PROPAGATION_STRETCH,
  MAX_EVENTS_PER_FRAME,
  MAX_DT_REAL_MS,
  LOG_RING_SIZE,
} from './constants';
import { targetHexForBits } from './constants';

const FULL_NODE_IDS = Array.from({ length: 10 }, (_, i) => `N${i + 1}`);
const MINER_IDS = ['M1', 'M2', 'M3', 'M4', 'M5'];
const MINER_HASHPOWER: Record<string, number> = { M1: 0.3, M2: 0.25, M3: 0.2, M4: 0.15, M5: 0.1 };
const MAX_ATTEMPTS_PER_MINER = 25;

let seq = 0;
const nextId = (p: string) => `${p}${seq++}`;

interface PendingSolution {
  minerId: NodeId;
  block: Block;
}

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

  lastReal = 0;
  lastTxGenAt = 0;
  nextTxGap = 0;
  lastStoreFlush = 0;
  rafHandle = 0;

  // scenario state
  gatedAnnouncements: PendingSolution[] | null = null; // when set, solutions accumulate here
  gateMiners = new Set<NodeId>();
  lastMinedBy: NodeId | null = null;

  constructor() {
    this.setup();
  }

  private setup() {
    const genesis = makeGenesisBlock();
    this.blocks.set(genesis.hash, genesis);

    const allIds = [...FULL_NODE_IDS, ...MINER_IDS];
    const positions = layoutPositions(allIds);

    FULL_NODE_IDS.forEach((id) => {
      const node = makePeerNode(id, 'full', positions[id].x, positions[id].y, genesis);
      applyBlock(node.utxo, genesis);
      this.nodes.set(id, node);
    });
    MINER_IDS.forEach((id) => {
      const node = makePeerNode(id, 'miner', positions[id].x, positions[id].y, genesis) as Miner;
      node.hashPower = MINER_HASHPOWER[id];
      node.template = null;
      node.hashesDone = 0;
      node.status = 'idle';
      node.attempts = [];
      applyBlock(node.utxo, genesis);
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
        if (m.status === 'idle') this.ensureMinerTemplate(id);
      }
    }
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
    if (this.isCut(from, to)) return;
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

  private isCut(a: NodeId, b: NodeId): boolean {
    const na = this.nodes.get(a);
    const nb = this.nodes.get(b);
    if (!na || !nb) return true;
    if (!na.partitioned || !nb.partitioned) return false;
    return na.partitionGroup !== nb.partitionGroup;
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
    const before = node.known.has(block.hash);
    const { isNewBest, reorg } = receiveBlock(this.blocks, node, block, this.simNow);
    if (!before) {
      node.advertisedTip.set(fromId, block.hash);
      this.floodBlock(nodeId, block, fromId);
    }
    if (reorg) {
      this.logEvent('reorg', `${nodeId} reorg depth ${reorg.depth}`);
    }
    if (isNewBest) this.dirty = true;
  }

  // ---- mining ----
  private updateHashrateBudgets() {
    const denomSeconds = (TARGET_BLOCK_TIME_SIM_MS / 1000) / Math.max(this.speed, 0.01);
    const networkHps = denomSeconds > 0 ? EXPECTED_HASHES / denomSeconds : 0;
    for (const id of MINER_IDS) {
      const m = this.nodes.get(id) as Miner;
      if (m.status !== 'grinding') continue;
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
    // lift throttle: ~1M h/s
    this.workers.get(minerId)!.postMessage({ type: 'setHps', hps: 1_000_000 });
  }

  private onWorkerMessage(minerId: NodeId, msg: { type: string; nonce?: number; hash?: string; hashesTried: number }) {
    const miner = this.nodes.get(minerId) as Miner;
    if (!miner || !miner.template) return;
    const currentAttempt = miner.attempts[miner.attempts.length - 1];
    if (msg.type === 'progress') {
      miner.hashesDone = msg.hashesTried;
      if (currentAttempt) currentAttempt.hashesTried = msg.hashesTried;
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
      this.onBlockSolved(minerId, block);
    }
  }

  private onBlockSolved(minerId: NodeId, block: Block) {
    if (this.gateMiners.has(minerId) && this.gatedAnnouncements) {
      this.gatedAnnouncements.push({ minerId, block });
      this.logEvent('fork', `${minerId} solved block (held) height ${block.height}`);
      if (this.gatedAnnouncements.length >= this.gateMiners.size) {
        this.releaseGatedAnnouncements();
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
    this.logEvent('block', `${minerId} mined height ${block.height} (${block.txs.length} txs)`);
    if (reorg) this.logEvent('reorg', `${minerId} reorg depth ${reorg.depth}`);
    this.dirty = true;
  }

  private releaseGatedAnnouncements() {
    const pending = this.gatedAnnouncements!;
    this.gatedAnnouncements = null;
    this.gateMiners.clear();
    for (const { minerId, block } of pending) {
      this.announceBlock(minerId, block);
    }
  }

  // ---- scenarios ----
  runAccidentalFork() {
    this.gateMiners = new Set(['M1', 'M2']);
    this.gatedAnnouncements = [];
    for (const id of ['M1', 'M2']) {
      const m = this.nodes.get(id) as Miner;
      if (m.status !== 'grinding') this.ensureMinerTemplate(id);
      this.mineNow(id);
    }
    this.logEvent('fork', 'accidental fork triggered: M1 & M2 racing');
  }

  partition() {
    const half = Math.ceil(this.nodes.size / 2);
    let i = 0;
    for (const node of this.nodes.values()) {
      node.partitioned = true;
      node.partitionGroup = i < half ? 1 : 2;
      i++;
    }
    this.logEvent('partition', 'network partitioned into two groups');
    this.dirty = true;
  }

  heal() {
    for (const node of this.nodes.values()) {
      node.partitioned = false;
      node.partitionGroup = 0;
    }
    this.logEvent('heal', 'partition healed — flooding tips');
    // flood each node's known tip to all peers to trigger reconciliation
    for (const node of this.nodes.values()) {
      const tipBlock = this.blocks.get(node.tip);
      if (tipBlock) this.floodBlock(node.id, tipBlock);
    }
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

  private logEvent(kind: LogEvent['kind'], text: string) {
    this.events.push({ id: nextId('ev'), at: this.simNow, kind, text });
    if (this.events.length > LOG_RING_SIZE) this.events.shift();
  }

  // ---- store sync ----
  private flushDirtyToStore(nowReal: number) {
    const shouldFlushClock = nowReal - this.lastStoreFlush > 1000;
    if (!this.dirty && !shouldFlushClock) return;
    this.dirty = false;
    if (shouldFlushClock) this.lastStoreFlush = nowReal;

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
        partitioned: n.partitioned,
        partitionGroup: n.partitionGroup,
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
    const activeTip = this.nodes.get(FULL_NODE_IDS[0])?.tip ?? GENESIS_HASH;
    const activeChain: Hash[] = [];
    let cur: Hash | undefined = activeTip;
    while (cur) {
      const b = this.blocks.get(cur);
      if (!b) break;
      activeChain.unshift(cur);
      cur = b.header.prevHash === cur ? undefined : b.header.prevHash;
      if (cur === GENESIS_HASH) {
        activeChain.unshift(GENESIS_HASH);
        break;
      }
    }
    const activeSet = new Set(activeChain);
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
        isOrphan: !activeSet.has(hash) && hash !== GENESIS_HASH,
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
      partitionActive: Array.from(this.nodes.values()).some((n) => n.partitioned),
      lastMinedBy: this.lastMinedBy,
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
