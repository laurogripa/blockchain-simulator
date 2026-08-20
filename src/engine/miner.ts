import type { Block, BlockHeader, Miner, Transaction } from './types';
import { COINBASE_VALUE, MAX_TXS_PER_BLOCK, DIFFICULTY_BITS } from './constants';
import { selectMempoolTxs } from './mempool';
import { buildMerkleLevels } from './crypto/merkle';
import { sha256Hex } from './crypto/sha256';
import { serializeTx } from './serialize';
import { cumulativeWorkOf } from './chain';

let coinbaseCounter = 0;

/** Test/scenario-only: makes coinbase txid generation reproducible across repeated runs. */
export function resetCoinbaseCounter(): void {
  coinbaseCounter = 0;
}

export function buildCandidateTemplate(
  miner: Miner,
  parent: Block,
  now: number,
): { header: BlockHeader; txs: Transaction[] } {
  const selected = selectMempoolTxs(miner.mempool, MAX_TXS_PER_BLOCK - 1, miner.utxo);
  const height = parent.height + 1;
  const subsidy = subsidyAt(height);
  const coinbaseBase = {
    inputs: [],
    outputs: [{ address: pickMinerAddress(miner.id), value: subsidy + selected.reduce((s, t) => s + t.fee, 0) }],
    fee: 0,
    size: 100,
    isCoinbase: true,
    createdAt: now,
  };
  const coinbase: Transaction = {
    ...coinbaseBase,
    txid: sha256Hex(serializeTx(coinbaseBase) + '#cb' + coinbaseCounter++),
  };
  const txs = [coinbase, ...selected];
  const { root } = buildMerkleLevels(txs.map((t) => t.txid));
  const header: BlockHeader = {
    version: 1,
    prevHash: parent.hash,
    merkleRoot: root,
    timestamp: now,
    bits: DIFFICULTY_BITS,
    nonce: 0,
  };
  return { header, txs };
}

/**
 * Halvings are ambient, not a scripted beat: subsidy halves every 8 blocks (compressed from
 * Bitcoin's real 210,000 so all 7 halvings fit in one 64-block run), computed here rather than
 * as a fixed constant so the schedule runs independently of whatever else is happening in a
 * given block — exactly like real Bitcoin.
 */
export function subsidyAt(height: number): number {
  const epoch = Math.floor((height - 1) / 8);
  return COINBASE_VALUE >> epoch;
}

function pickMinerAddress(minerId: string): string {
  // Each miner pays out to its own dedicated address (the same M1..M5 palette block cards
  // already color-code by minedBy), so a coinbase output reads as "this coin came from mining"
  // rather than being indistinguishable from a random user's change output.
  return minerId;
}

export function finalizeBlock(
  parent: Block,
  header: BlockHeader,
  txs: Transaction[],
  hash: string,
  minerId: string,
  hashesTried: number,
): Block {
  return {
    hash,
    header,
    txs,
    height: parent.height + 1,
    cumulativeWork: cumulativeWorkOf(parent, header.bits),
    minedBy: minerId,
    hashesTried,
    undo: [],
  };
}
