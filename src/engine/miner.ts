import type { Block, BlockHeader, Miner, Transaction } from './types';
import { COINBASE_VALUE, MAX_TXS_PER_BLOCK, DIFFICULTY_BITS } from './constants';
import { selectMempoolTxs } from './mempool';
import { buildMerkleLevels } from './crypto/merkle';
import { sha256Hex } from './crypto/sha256';
import { serializeTx } from './serialize';
import { cumulativeWorkOf } from './chain';

let coinbaseCounter = 0;

export function buildCandidateTemplate(
  miner: Miner,
  parent: Block,
  now: number,
): { header: BlockHeader; txs: Transaction[] } {
  const selected = selectMempoolTxs(miner.mempool, MAX_TXS_PER_BLOCK - 1, miner.utxo);
  const coinbaseBase = {
    inputs: [],
    outputs: [{ address: pickMinerAddress(miner.id), value: COINBASE_VALUE + selected.reduce((s, t) => s + t.fee, 0) }],
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

function pickMinerAddress(minerId: string): string {
  // deterministic mapping from miner id to a payout address
  const addrs = ['A', 'B', 'C', 'D', 'E', 'F'];
  const idx = minerId.charCodeAt(minerId.length - 1) % addrs.length;
  return addrs[idx];
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
