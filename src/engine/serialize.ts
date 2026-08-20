import type { BlockHeader, Transaction } from './types';

export function serializeTx(tx: Omit<Transaction, 'txid'>): string {
  const inputs = tx.inputs.map((i) => `${i.txid}:${i.vout}`).join(',');
  const outputs = tx.outputs.map((o) => `${o.address}:${o.value}`).join(',');
  return `in[${inputs}]out[${outputs}]fee${tx.fee}sz${tx.size}cb${tx.isCoinbase ? 1 : 0}t${tx.createdAt}`;
}

export function serializeHeader(h: BlockHeader): string {
  return `v${h.version}|p${h.prevHash}|m${h.merkleRoot}|t${h.timestamp}|b${h.bits}|n${h.nonce}`;
}
