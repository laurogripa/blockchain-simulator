import type { Address, Outpoint, Transaction, UtxoEntry } from './types';
import { sha256Hex } from './crypto/sha256';
import { serializeTx } from './serialize';
import { isTxValidAgainstUtxo } from './validation';
import { Rng } from './rng';

let txCounter = 0;

/** Builds a synthetic tx spending a random unspent output owned by an address the node knows about. */
export function makeRandomTx(
  utxo: Map<Outpoint, UtxoEntry>,
  rng: Rng,
  now: number,
): Transaction | null {
  const entries = Array.from(utxo.values());
  if (entries.length === 0) return null;
  const spend = rng.pick(entries);
  const total = spend.value;
  const fee = Math.floor(total * rng.range(0.001, 0.02));
  const sendAmount = Math.max(1, Math.floor((total - fee) * rng.range(0.3, 0.9)));
  const changeAmount = total - fee - sendAmount;
  const toAddr = rng.pick(['A', 'B', 'C', 'D', 'E', 'F'] as Address[]);

  const outputs = [{ address: toAddr, value: sendAmount }];
  if (changeAmount > 0) outputs.push({ address: spend.address, value: changeAmount });

  const base = {
    inputs: [{ txid: spend.outpoint.split(':')[0], vout: Number(spend.outpoint.split(':')[1]) }],
    outputs,
    fee,
    size: 150 + outputs.length * 30 + rng.int(-10, 10),
    isCoinbase: false,
    createdAt: now,
  };
  const txid = sha256Hex(serializeTx(base) + '#' + txCounter++);
  return { ...base, txid };
}

export function feeRate(tx: Transaction): number {
  return tx.fee / Math.max(1, tx.size);
}

/** Picks the highest fee-rate txs from a mempool, up to maxCount (leaves room for coinbase). */
export function selectMempoolTxs(
  mempool: Map<string, Transaction>,
  maxCount: number,
  utxo: Map<Outpoint, UtxoEntry>,
): Transaction[] {
  const candidates = Array.from(mempool.values())
    .filter((tx) => isTxValidAgainstUtxo(tx, utxo))
    .sort((a, b) => feeRate(b) - feeRate(a));
  return candidates.slice(0, maxCount);
}
