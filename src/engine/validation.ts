import type { Outpoint, Transaction, UtxoEntry } from './types';

// Signatures are deliberately out of scope (no ECDSA) — a stated simplification.
// Validation checks UTXO existence, no double-spend, and value conservation.

export function isTxValidAgainstUtxo(
  tx: Transaction,
  utxo: Map<Outpoint, UtxoEntry>,
): boolean {
  if (tx.isCoinbase) return true;
  let inSum = 0;
  const seen = new Set<Outpoint>();
  for (const input of tx.inputs) {
    const op = `${input.txid}:${input.vout}`;
    if (seen.has(op)) return false; // double-spend within the tx itself
    seen.add(op);
    const entry = utxo.get(op);
    if (!entry) return false; // no such UTXO, or already spent
    inSum += entry.value;
  }
  const outSum = tx.outputs.reduce((s, o) => s + o.value, 0);
  if (outSum > inSum) return false; // can't create value
  return true;
}
