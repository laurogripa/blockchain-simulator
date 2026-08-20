import { describe, expect, it } from 'vitest';
import { feeRate, makeRandomTx, selectMempoolTxs } from './mempool';
import { Rng } from './rng';
import type { Outpoint, Transaction, UtxoEntry } from './types';

describe('makeRandomTx', () => {
  it('returns null when the UTXO set is empty', () => {
    expect(makeRandomTx(new Map(), new Rng(1), 0)).toBeNull();
  });

  it('produces a tx that spends an existing UTXO without overspending it', () => {
    const utxo = new Map<Outpoint, UtxoEntry>([
      ['tx1:0', { outpoint: 'tx1:0', address: 'A', value: 1000, height: 0 }],
    ]);
    const tx = makeRandomTx(utxo, new Rng(42), 100);
    expect(tx).not.toBeNull();
    const spent = tx!.inputs[0];
    expect(`${spent.txid}:${spent.vout}`).toBe('tx1:0');
    const outSum = tx!.outputs.reduce((s, o) => s + o.value, 0);
    expect(outSum + tx!.fee).toBeLessThanOrEqual(1000);
  });

  it('is deterministic for a given seed (aside from the module-global txid counter)', () => {
    const utxo = () =>
      new Map<Outpoint, UtxoEntry>([['tx1:0', { outpoint: 'tx1:0', address: 'A', value: 1000, height: 0 }]]);
    const a = makeRandomTx(utxo(), new Rng(7), 0);
    const b = makeRandomTx(utxo(), new Rng(7), 0);
    expect({ ...a, txid: undefined }).toEqual({ ...b, txid: undefined });
  });
});

describe('feeRate', () => {
  it('is fee divided by size', () => {
    const tx: Transaction = {
      txid: 't',
      inputs: [],
      outputs: [],
      fee: 100,
      size: 200,
      isCoinbase: false,
      createdAt: 0,
    };
    expect(feeRate(tx)).toBe(0.5);
  });

  it('never divides by zero for a zero-size tx', () => {
    const tx: Transaction = { txid: 't', inputs: [], outputs: [], fee: 10, size: 0, isCoinbase: false, createdAt: 0 };
    expect(Number.isFinite(feeRate(tx))).toBe(true);
  });
});

describe('selectMempoolTxs', () => {
  function tx(id: string, fee: number, size: number, spendOutpoint: string): Transaction {
    const [txid, vout] = spendOutpoint.split(':');
    return {
      txid: id,
      inputs: [{ txid, vout: Number(vout) }],
      outputs: [{ address: 'A', value: 1 }],
      fee,
      size,
      isCoinbase: false,
      createdAt: 0,
    };
  }

  it('sorts candidates by fee rate, highest first', () => {
    const utxo = new Map<Outpoint, UtxoEntry>([
      ['a:0', { outpoint: 'a:0', address: 'A', value: 1000, height: 0 }],
      ['b:0', { outpoint: 'b:0', address: 'A', value: 1000, height: 0 }],
    ]);
    const mempool = new Map([
      ['low', tx('low', 10, 100, 'a:0')], // rate 0.1
      ['high', tx('high', 100, 100, 'b:0')], // rate 1.0
    ]);
    const selected = selectMempoolTxs(mempool, 10, utxo);
    expect(selected.map((t) => t.txid)).toEqual(['high', 'low']);
  });

  it('excludes txs whose inputs are no longer in the UTXO set', () => {
    const utxo = new Map<Outpoint, UtxoEntry>([['a:0', { outpoint: 'a:0', address: 'A', value: 1000, height: 0 }]]);
    const mempool = new Map([
      ['valid', tx('valid', 10, 100, 'a:0')],
      ['stale', tx('stale', 100, 100, 'ghost:0')],
    ]);
    const selected = selectMempoolTxs(mempool, 10, utxo);
    expect(selected.map((t) => t.txid)).toEqual(['valid']);
  });

  it('caps the result at maxCount', () => {
    const utxo = new Map<Outpoint, UtxoEntry>([
      ['a:0', { outpoint: 'a:0', address: 'A', value: 1000, height: 0 }],
      ['b:0', { outpoint: 'b:0', address: 'A', value: 1000, height: 0 }],
    ]);
    const mempool = new Map([
      ['x', tx('x', 10, 100, 'a:0')],
      ['y', tx('y', 20, 100, 'b:0')],
    ]);
    expect(selectMempoolTxs(mempool, 1, utxo)).toHaveLength(1);
  });
});
