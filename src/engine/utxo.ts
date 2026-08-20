import type { Block, Outpoint, UtxoEntry } from './types';

/** Spend inputs, create outputs. Populates block.undo with the entries it removed (first call only). */
export function applyBlock(utxo: Map<Outpoint, UtxoEntry>, block: Block): void {
  const undo: UtxoEntry[] = [];
  for (const tx of block.txs) {
    if (!tx.isCoinbase) {
      for (const input of tx.inputs) {
        const op = `${input.txid}:${input.vout}`;
        const entry = utxo.get(op);
        if (entry) {
          undo.push(entry);
          utxo.delete(op);
        }
      }
    }
    tx.outputs.forEach((out, vout) => {
      const op = `${tx.txid}:${vout}`;
      utxo.set(op, { outpoint: op, address: out.address, value: out.value, height: block.height });
    });
  }
  if (block.undo.length === 0 && undo.length > 0) block.undo = undo;
}

/** Restore spent, remove created — using the block's undo journal. */
export function revertBlock(utxo: Map<Outpoint, UtxoEntry>, block: Block): void {
  for (const tx of block.txs) {
    tx.outputs.forEach((_, vout) => {
      utxo.delete(`${tx.txid}:${vout}`);
    });
  }
  for (const entry of block.undo) {
    utxo.set(entry.outpoint, entry);
  }
}
