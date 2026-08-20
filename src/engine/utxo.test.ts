import { describe, expect, it } from 'vitest';
import { applyBlock, revertBlock } from './utxo';
import type { Block, Outpoint, UtxoEntry } from './types';

function makeBlock(overrides: Partial<Block> = {}): Block {
  return {
    hash: 'h1',
    header: { version: 1, prevHash: '0'.repeat(64), merkleRoot: '0'.repeat(64), timestamp: 0, bits: 20, nonce: 0 },
    txs: [],
    height: 1,
    cumulativeWork: 0,
    minedBy: 'M1',
    hashesTried: 0,
    undo: [],
    ...overrides,
  };
}

describe('applyBlock / revertBlock', () => {
  it('creates coinbase outputs as new UTXOs', () => {
    const utxo = new Map<Outpoint, UtxoEntry>();
    const block = makeBlock({
      txs: [
        {
          txid: 'cb',
          inputs: [],
          outputs: [{ address: 'A', value: 5_000_000_000 }],
          fee: 0,
          size: 100,
          isCoinbase: true,
          createdAt: 0,
        },
      ],
    });
    applyBlock(utxo, block);
    expect(utxo.get('cb:0')).toEqual({ outpoint: 'cb:0', address: 'A', value: 5_000_000_000, height: 1 });
  });

  it('spends inputs and records them in the undo journal (first call only)', () => {
    const utxo = new Map<Outpoint, UtxoEntry>([
      ['prev:0', { outpoint: 'prev:0', address: 'A', value: 100, height: 0 }],
    ]);
    const block = makeBlock({
      txs: [
        {
          txid: 'tx1',
          inputs: [{ txid: 'prev', vout: 0 }],
          outputs: [{ address: 'B', value: 90 }],
          fee: 10,
          size: 150,
          isCoinbase: false,
          createdAt: 0,
        },
      ],
    });
    applyBlock(utxo, block);
    expect(utxo.has('prev:0')).toBe(false);
    expect(utxo.get('tx1:0')).toEqual({ outpoint: 'tx1:0', address: 'B', value: 90, height: 1 });
    expect(block.undo).toEqual([{ outpoint: 'prev:0', address: 'A', value: 100, height: 0 }]);
  });

  it('revertBlock restores spent inputs and removes created outputs, returning to the prior state', () => {
    const original: UtxoEntry = { outpoint: 'prev:0', address: 'A', value: 100, height: 0 };
    const utxo = new Map<Outpoint, UtxoEntry>([['prev:0', original]]);
    const block = makeBlock({
      txs: [
        {
          txid: 'tx1',
          inputs: [{ txid: 'prev', vout: 0 }],
          outputs: [{ address: 'B', value: 90 }],
          fee: 10,
          size: 150,
          isCoinbase: false,
          createdAt: 0,
        },
      ],
    });
    applyBlock(utxo, block);
    revertBlock(utxo, block);
    expect(utxo.get('prev:0')).toEqual(original);
    expect(utxo.has('tx1:0')).toBe(false);
  });

  it('does not overwrite an existing undo journal on repeated applyBlock calls', () => {
    const utxo = new Map<Outpoint, UtxoEntry>([
      ['prev:0', { outpoint: 'prev:0', address: 'A', value: 100, height: 0 }],
    ]);
    const block = makeBlock({
      txs: [
        {
          txid: 'tx1',
          inputs: [{ txid: 'prev', vout: 0 }],
          outputs: [{ address: 'B', value: 90 }],
          fee: 10,
          size: 150,
          isCoinbase: false,
          createdAt: 0,
        },
      ],
    });
    applyBlock(utxo, block);
    const firstUndo = block.undo;
    applyBlock(utxo, block); // reapply (e.g. reconnect during a reorg)
    expect(block.undo).toBe(firstUndo);
  });
});
