import { describe, expect, it } from 'vitest';
import { isTxValidAgainstUtxo } from './validation';
import type { Outpoint, Transaction, UtxoEntry } from './types';

function utxoMap(entries: UtxoEntry[]): Map<Outpoint, UtxoEntry> {
  return new Map(entries.map((e) => [e.outpoint, e]));
}

const spendable: UtxoEntry = { outpoint: 'tx1:0', address: 'A', value: 100, height: 1 };

describe('isTxValidAgainstUtxo', () => {
  it('accepts coinbase unconditionally', () => {
    const tx: Transaction = {
      txid: 'cb',
      inputs: [],
      outputs: [{ address: 'A', value: 1_000_000 }],
      fee: 0,
      size: 100,
      isCoinbase: true,
      createdAt: 0,
    };
    expect(isTxValidAgainstUtxo(tx, new Map())).toBe(true);
  });

  it('accepts a tx that spends an existing UTXO without overspending', () => {
    const tx: Transaction = {
      txid: 'tx2',
      inputs: [{ txid: 'tx1', vout: 0 }],
      outputs: [{ address: 'B', value: 90 }],
      fee: 10,
      size: 150,
      isCoinbase: false,
      createdAt: 0,
    };
    expect(isTxValidAgainstUtxo(tx, utxoMap([spendable]))).toBe(true);
  });

  it('rejects spending a UTXO that does not exist (already spent or unknown)', () => {
    const tx: Transaction = {
      txid: 'tx2',
      inputs: [{ txid: 'ghost', vout: 0 }],
      outputs: [{ address: 'B', value: 1 }],
      fee: 0,
      size: 150,
      isCoinbase: false,
      createdAt: 0,
    };
    expect(isTxValidAgainstUtxo(tx, utxoMap([spendable]))).toBe(false);
  });

  it('rejects a double-spend of the same outpoint within one tx', () => {
    const tx: Transaction = {
      txid: 'tx2',
      inputs: [
        { txid: 'tx1', vout: 0 },
        { txid: 'tx1', vout: 0 },
      ],
      outputs: [{ address: 'B', value: 1 }],
      fee: 0,
      size: 150,
      isCoinbase: false,
      createdAt: 0,
    };
    expect(isTxValidAgainstUtxo(tx, utxoMap([spendable]))).toBe(false);
  });

  it('rejects a tx whose outputs exceed its inputs (value creation)', () => {
    const tx: Transaction = {
      txid: 'tx2',
      inputs: [{ txid: 'tx1', vout: 0 }],
      outputs: [{ address: 'B', value: 101 }],
      fee: 0,
      size: 150,
      isCoinbase: false,
      createdAt: 0,
    };
    expect(isTxValidAgainstUtxo(tx, utxoMap([spendable]))).toBe(false);
  });

  it('accepts a tx that spends its input exactly (zero fee)', () => {
    const tx: Transaction = {
      txid: 'tx2',
      inputs: [{ txid: 'tx1', vout: 0 }],
      outputs: [{ address: 'B', value: 100 }],
      fee: 0,
      size: 150,
      isCoinbase: false,
      createdAt: 0,
    };
    expect(isTxValidAgainstUtxo(tx, utxoMap([spendable]))).toBe(true);
  });
});
