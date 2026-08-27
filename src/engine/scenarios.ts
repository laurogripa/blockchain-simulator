// The "happy path" educational scenario: a scripted, deterministic 64-block run of Bitcoin's
// own history in miniature, so playing it back *is* the lesson. Headless by design (no React,
// no store, no Workers) — the same chain/node/miner primitives SimEngine drives in the browser,
// which is also what makes this trivial to snapshot-test (see scenario64.test.ts).
//
// Halvings are ambient (see subsidyAt in miner.ts), not a scripted beat — the subsidy schedule
// runs on its own clock regardless of whatever drama a given block is telling.
import { GENESIS_HASH, computeBlockHash, makeGenesisBlock, meetsTarget } from './chain';
import { buildCandidateTemplate, finalizeBlock, resetCoinbaseCounter } from './miner';
import { makePeerNode, receiveBlock, receiveTx } from './node';
import { makeRandomTx, resetTxCounter } from './mempool';
import { Rng } from './rng';
import { serializeTx } from './serialize';
import { sha256Hex } from './crypto/sha256';
import type { Block, Hash, Miner, PeerNode, Transaction } from './types';

export type ScenarioKind = 'accidentalFork' | 'doubleSpend';

// Mining at the real DIFFICULTY_BITS (2^20 expected hashes/block) is fine for the throttled,
// worker-driven live sim but far too slow to brute-force synchronously 64 times over — this is
// a separate, deliberately easy target just for generating the scripted run quickly. Kept low
// (2^8 = 256 expected hashes/block) so the run stays fast and consistent rather than occasionally
// hitting an unlucky long tail on some seed and blowing a test timeout.
const SCENARIO_BITS = 8;

const MINER_IDS = ['M1', 'M2', 'M3', 'M4', 'M5'] as const;
type MinerId = (typeof MINER_IDS)[number];
const MINER_HASHPOWER: Record<MinerId, number> = { M1: 0.3, M2: 0.25, M3: 0.2, M4: 0.15, M5: 0.1 };

// Signal bits packed into header.version — a stand-in for real BIP9 version-bits signalling,
// simplified to "this block's miner currently supports proposal X" with no activation-height
// bookkeeping. Good enough to teach the shape of the mechanic without implementing the whole
// state machine.
const SIGNAL = { BIP101: 1 << 1, SEGWIT: 1 << 2, TAPROOT: 1 << 3, BIP110: 1 << 4 } as const;

export interface Beat {
  heights: [number, number]; // inclusive
  label: string;
  teaches: string;
}

export const BEATS: Beat[] = [
  { heights: [1, 1], label: 'Genesis', teaches: 'Chain starts from one hardcoded block, no parent' },
  {
    heights: [2, 5],
    label: 'Block 2 + a few txs',
    teaches: 'Txs enter mempool → get mined → UTXOs spend (M1→M2→M3→M4, round robin)',
  },
  {
    heights: [6, 17],
    label: '12 healthy blocks',
    teaches: 'Baseline "boring" rhythm the drama below breaks; halving epochs tick over at 9 and 17',
  },
  {
    heights: [18, 20],
    label: 'Accidental fork',
    teaches: 'M2 and M5 collide at 18 with different nonces — simultaneous solves always differ',
  },
  {
    heights: [21, 23],
    label: '2010 overflow rollback',
    teaches: 'Consensus-rule bugs get rolled back via reorg, even after "confirmation"',
  },
  {
    heights: [24, 26],
    label: 'BIP101 rejected',
    teaches: 'Not every proposed rule change activates (needed 75% signal, never got there)',
  },
  {
    heights: [27, 40],
    label: 'SegWit fork',
    teaches: 'Soft forks activate via signalling + holdout pressure (M5 holds out until 38)',
  },
  {
    heights: [41, 50],
    label: 'Taproot',
    teaches: 'A clean, uncontroversial soft fork — all five signal within the first few blocks',
  },
  {
    heights: [51, 64],
    label: 'Live signalling (BIP110)',
    teaches: 'Ends on a fork in progress, not resolved — 3/5 miners signalling, unresolved',
  },
];

export const SCENARIO_LENGTH = 64;

export interface ScenarioState {
  blocks: Map<Hash, Block>;
  network: PeerNode; // canonical, authoritative view — every miner reads/writes the same maps
  rng: Rng;
  now: number;
  orphans: Hash[]; // blocks that were mined but never stayed on the active chain
  log: string[];
}

function wrapAsMiner(id: MinerId, network: PeerNode): Miner {
  return { ...network, id, kind: 'miner', hashPower: MINER_HASHPOWER[id], template: null, hashesDone: 0, status: 'idle', attempts: [] };
}

function weightedMiner(rng: Rng): MinerId {
  const total = Object.values(MINER_HASHPOWER).reduce((s, w) => s + w, 0);
  let x = rng.float() * total;
  for (const id of MINER_IDS) {
    x -= MINER_HASHPOWER[id];
    if (x <= 0) return id;
  }
  return MINER_IDS[MINER_IDS.length - 1];
}

/** Mines one block for `minerId` off the given parent (defaults to the network's current tip). */
function mineBlock(
  state: ScenarioState,
  minerId: MinerId,
  opts: { parent?: Block; signalBits?: number } = {},
): Block {
  const parent = opts.parent ?? state.blocks.get(state.network.tip)!;
  const miner = wrapAsMiner(minerId, state.network);
  const built = buildCandidateTemplate(miner, parent, state.now);
  const header = { ...built.header, bits: SCENARIO_BITS, version: 1 | (opts.signalBits ?? 0) };
  let nonce = 0;
  let hash = computeBlockHash({ ...header, nonce });
  while (!meetsTarget(hash, SCENARIO_BITS)) {
    nonce++;
    hash = computeBlockHash({ ...header, nonce });
  }
  const block = finalizeBlock(parent, { ...header, nonce }, built.txs, hash, minerId, nonce);
  state.blocks.set(block.hash, block);
  state.now += 60_000; // advance the sim clock a notional minute per block
  return block;
}

/** Mines a block, then immediately makes it the network's accepted tip (the common case). */
function mineAndConnect(state: ScenarioState, minerId: MinerId, signalBits?: number): Block {
  const block = mineBlock(state, minerId, { signalBits });
  const { reorg } = receiveBlock(state.blocks, state.network, block, state.now);
  if (reorg) state.log.push(`reorg depth ${reorg.depth} at height ${block.height}`);
  return block;
}

function makeTx(
  utxo: PeerNode['utxo'],
  spendOutpoint: string,
  toAddr: string,
  feeRate: number,
  size: number,
  now: number,
): Transaction | null {
  const entry = utxo.get(spendOutpoint);
  if (!entry) return null;
  const fee = Math.max(1, Math.floor(entry.value * feeRate));
  const sendAmount = entry.value - fee;
  const [txid, vout] = spendOutpoint.split(':');
  const base = {
    inputs: [{ txid, vout: Number(vout) }],
    outputs: [{ address: toAddr, value: sendAmount }],
    fee,
    size,
    isCoinbase: false,
    createdAt: now,
  };
  return { ...base, txid: sha256Hex(serializeTx(base) + '#scenario' + spendOutpoint) };
}

/** Beat: heights 2–5, one tx into the mempool ahead of each block, miners round-robin. */
function beatFirstBlocks(state: ScenarioState) {
  const roundRobin: MinerId[] = ['M1', 'M2', 'M3', 'M4'];
  for (const minerId of roundRobin) {
    const tx = makeRandomTx(state.network.utxo, state.rng, state.now);
    if (tx) receiveTx(state.network, tx);
    mineAndConnect(state, minerId);
  }
}

/** Beat: heights 6–17, ambient hash-power-weighted mining with occasional ambient txs. */
function beatHealthyBlocks(state: ScenarioState) {
  for (let i = 0; i < 12; i++) {
    if (state.rng.bool(0.6)) {
      const tx = makeRandomTx(state.network.utxo, state.rng, state.now);
      if (tx) receiveTx(state.network, tx);
    }
    mineAndConnect(state, weightedMiner(state.rng));
  }
}

/** Beat: heights 18–20, accidental fork. M2 and M5 both solve off the same parent; whichever is
 *  received first wins the tie, then M2 extends twice, permanently burying M5's orphan. */
function beatAccidentalFork(state: ScenarioState) {
  const parent = state.blocks.get(state.network.tip)!;
  const winnerBlock = mineBlock(state, 'M2', { parent });
  const loserBlock = mineBlock(state, 'M5', { parent });
  state.log.push(`accidental fork at height ${parent.height + 1}: M2 vs M5, different nonces`);

  receiveBlock(state.blocks, state.network, winnerBlock, state.now); // first-seen
  receiveBlock(state.blocks, state.network, loserBlock, state.now); // same work, loses the tie
  state.orphans.push(loserBlock.hash);

  mineAndConnect(state, 'M2'); // 19
  mineAndConnect(state, 'M2'); // 20 — buries M5's orphan under two confirmations
}

/** Beat: heights 21–23, the 2010-overflow-style rollback. M3 mines a "bad" block whose coinbase
 *  wildly overpays itself (this engine deliberately doesn't validate value conservation on
 *  connect — see validation.ts's header comment — so it's accepted, exactly like the real bug
 *  slipping past 2010's client). M1 and M4 then mine a competing, honest two-block chain off the
 *  block *before* the bad one; once it has more cumulative work the network reorgs onto it. */
function beatOverflowRollback(state: ScenarioState) {
  const goodParent = state.blocks.get(state.network.tip)!;

  const badMiner = wrapAsMiner('M3', state.network);
  const built = buildCandidateTemplate(badMiner, goodParent, state.now);
  const inflatedCoinbase: Transaction = {
    ...built.txs[0],
    outputs: [{ address: 'M3', value: 500_000_000_000 }], // absurdly overpaid — the "overflow"
  };
  const header = { ...built.header, bits: SCENARIO_BITS, version: 1 };
  let nonce = 0;
  let hash = computeBlockHash({ ...header, nonce });
  while (!meetsTarget(hash, SCENARIO_BITS)) {
    nonce++;
    hash = computeBlockHash({ ...header, nonce });
  }
  const badBlock = finalizeBlock(goodParent, { ...header, nonce }, [inflatedCoinbase, ...built.txs.slice(1)], hash, 'M3', nonce);
  state.blocks.set(badBlock.hash, badBlock);
  state.now += 60_000;
  receiveBlock(state.blocks, state.network, badBlock, state.now); // more work than goodParent — briefly becomes tip
  state.log.push(`M3 mined a value-overflow block at height ${badBlock.height} — briefly "confirmed"`);

  // The honest chain forks from goodParent (NOT from the bad block) and needs to out-work it:
  // one honest block ties badBlock's height (first-seen keeps the bad block as tip), so it takes
  // a second to actually overtake — three honest blocks total keeps this beat's net contribution
  // to the active chain at 3, same as every other beat, regardless of which branch wins.
  let parent = goodParent;
  let finalBlock = badBlock;
  for (const minerId of ['M1', 'M4', 'M1'] as const) {
    finalBlock = mineBlock(state, minerId, { parent });
    receiveBlock(state.blocks, state.network, finalBlock, state.now);
    parent = finalBlock;
  }

  if (state.network.tip === finalBlock.hash) {
    state.orphans.push(badBlock.hash);
    state.log.push(`reorg: rolled back the overflow block at height ${badBlock.height}`);
  }
}

/** Beat: heights 24–26, a proposed rule change that never gets enough miner support to matter. */
function beatBip101(state: ScenarioState) {
  mineAndConnect(state, 'M1'); // no signal
  mineAndConnect(state, 'M4', SIGNAL.BIP101); // only signaller
  mineAndConnect(state, 'M2'); // no signal
  state.log.push('BIP101 signalling: 1/3 in this window — nowhere near the 75% threshold');
}

/** Beat: heights 27–40, SegWit. M1–M4 signal from the start; M5 holds out until 38 (a stand-in
 *  for UASF pressure forcing a holdout over the line). Also seeds mempool congestion with a
 *  visible fee-rate gap between small "witness-shaped" and larger "legacy-shaped" txs. */
function beatSegwit(state: ScenarioState) {
  for (let height = 27; height <= 40; height++) {
    // Purpose-built congestion: more candidates than fit in one block, with a fee-rate gap.
    for (const entry of Array.from(state.network.utxo.values()).slice(0, 2)) {
      const witnessTx = makeTx(state.network.utxo, entry.outpoint, 'A', 0.05, 90, state.now);
      if (witnessTx && !state.network.mempool.has(witnessTx.txid)) receiveTx(state.network, witnessTx);
    }
    const legacyTx = makeRandomTx(state.network.utxo, state.rng, state.now);
    if (legacyTx) receiveTx(state.network, { ...legacyTx, size: legacyTx.size + 150, fee: Math.max(1, Math.floor(legacyTx.fee * 0.2)) });

    const minerId = height === 38 ? 'M5' : weightedMiner(state.rng);
    const signals = minerId === 'M5' ? height >= 38 : true; // M1–M4 always signal; M5 only from 38 on
    mineAndConnect(state, minerId, signals ? SIGNAL.SEGWIT : 0);
  }
  state.log.push('SegWit: M5 held out until height 38, then signalled under UASF-style pressure');
}

/** Beat: heights 41–50, Taproot — a clean, uncontroversial soft fork; everyone signals early. */
function beatTaproot(state: ScenarioState) {
  for (let i = 0; i < 10; i++) {
    mineAndConnect(state, weightedMiner(state.rng), SIGNAL.TAPROOT);
  }
  state.log.push('Taproot: all five miners signalled within the first few blocks of the window');
}

/** Beat: heights 51–64, a hypothetical soft fork ("BIP110") mid-signal when the run ends —
 *  deliberately unresolved, on real BIP8/9 version-bits mechanics. */
function beatLiveSignalling(state: ScenarioState) {
  const signalling = new Set<MinerId>(['M1', 'M2', 'M3']); // 3/5 — mid-threshold, unresolved
  for (let i = 0; i < 14; i++) {
    const minerId = weightedMiner(state.rng);
    mineAndConnect(state, minerId, signalling.has(minerId) ? SIGNAL.BIP110 : 0);
  }
  state.log.push('BIP110: run ends with 3/5 miners signalling — a fork in progress, not resolved');
}

/** Deterministic seed: the same run always ends on the same block height/state — the whole
 *  point of scripting it, and what makes it a trivial snapshot test target. */
export const SCENARIO_SEED = 20260819;

export function runScenario(seed: number = SCENARIO_SEED): ScenarioState {
  // Reset the shared txid counters so repeated runs (e.g. two calls in one test process) are
  // byte-for-byte identical, not just structurally similar — see resetTxCounter's doc comment.
  resetTxCounter();
  resetCoinbaseCounter();

  const genesis = makeGenesisBlock();
  const blocks = new Map<Hash, Block>([[genesis.hash, genesis]]);
  const network = makePeerNode('network', 'full', 0, 0, genesis);
  // Genesis's coinbase is deliberately never added to the UTXO set — see makeGenesisBlock's
  // doc comment. Its 50 BTC output is permanently unspendable, same as the real chain.

  const state: ScenarioState = { blocks, network, rng: new Rng(seed), now: 0, orphans: [], log: [] };

  beatFirstBlocks(state); // 2–5
  beatHealthyBlocks(state); // 6–17
  beatAccidentalFork(state); // 18–20
  beatOverflowRollback(state); // 21–23
  beatBip101(state); // 24–26
  beatSegwit(state); // 27–40
  beatTaproot(state); // 41–50
  beatLiveSignalling(state); // 51–64

  return state;
}

export { GENESIS_HASH, MINER_HASHPOWER, SIGNAL };
