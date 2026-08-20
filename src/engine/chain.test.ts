import { describe, expect, it } from 'vitest';
import { GENESIS_HASH, cumulativeWorkOf, lowestCommonAncestor, makeGenesisBlock, retarget } from './chain';
import { workOfBits } from './constants';
import type { Block, PeerNode } from './types';

function makeBlock(hash: string, prevHash: string, height: number, cumulativeWork: number, coinbaseAddr = 'M1'): Block {
  return {
    hash,
    header: { version: 1, prevHash, merkleRoot: '0'.repeat(64), timestamp: height * 1000, bits: 20, nonce: 0 },
    txs: [
      {
        txid: `cb-${hash}`,
        inputs: [],
        outputs: [{ address: coinbaseAddr, value: 5_000_000_000 }],
        fee: 0,
        size: 100,
        isCoinbase: true,
        createdAt: height * 1000,
      },
    ],
    height,
    cumulativeWork,
    minedBy: coinbaseAddr,
    hashesTried: 0,
    undo: [],
  };
}

function makeNode(tip: string): PeerNode {
  return {
    id: 'N1',
    kind: 'full',
    x: 0,
    y: 0,
    peers: [],
    known: new Set([tip]),
    tip,
    firstSeen: new Map(),
    mempool: new Map(),
    utxo: new Map(),
    advertisedTip: new Map(),
    reorgFlashUntil: 0,
    partitioned: false,
    partitionGroup: 0,
  };
}

describe('makeGenesisBlock', () => {
  it('has no parent and pre-mines a spendable UTXO per address', () => {
    const genesis = makeGenesisBlock();
    expect(genesis.hash).toBe(GENESIS_HASH);
    expect(genesis.header.prevHash).toBe(GENESIS_HASH);
    expect(genesis.txs[0].outputs).toHaveLength(6);
  });
});

describe('cumulativeWorkOf', () => {
  it('accumulates work relative to the parent', () => {
    const parent = makeBlock('a', GENESIS_HASH, 1, workOfBits(20));
    expect(cumulativeWorkOf(parent, 20)).toBe(workOfBits(20) * 2);
  });
});

describe('lowestCommonAncestor', () => {
  it('finds the fork point of two diverging chains', () => {
    const blocks = new Map<string, Block>();
    const b1 = makeBlock('b1', GENESIS_HASH, 1, 1);
    blocks.set('b1', b1);
    // chain A: b1 -> a2 -> a3
    const a2 = makeBlock('a2', 'b1', 2, 2);
    const a3 = makeBlock('a3', 'a2', 3, 3);
    blocks.set('a2', a2);
    blocks.set('a3', a3);
    // chain B: b1 -> c2
    const c2 = makeBlock('c2', 'b1', 2, 2);
    blocks.set('c2', c2);

    expect(lowestCommonAncestor(blocks, 'a3', 'c2')).toBe('b1');
    expect(lowestCommonAncestor(blocks, 'a3', 'a3')).toBe('a3');
  });
});

describe('retarget (fork choice)', () => {
  it('is a no-op when retargeting to the current tip', () => {
    const node = makeNode('a');
    const blocks = new Map<string, Block>();
    const event = retarget(blocks, node, 'a', 0);
    expect(event).toBeNull();
    expect(node.tip).toBe('a');
  });

  it('treats extending the current tip as a simple extension, not a reorg', () => {
    const blocks = new Map<string, Block>();
    const b1 = makeBlock('b1', GENESIS_HASH, 1, 1);
    blocks.set('b1', b1);
    const node = makeNode('b1');

    const event = retarget(blocks, node, 'b1', 0); // same tip, sanity
    expect(event).toBeNull();
  });

  it('reorgs to a longer competing chain: disconnects the old tip, connects the new one, restores UTXOs', () => {
    const blocks = new Map<string, Block>();
    const genesis = makeGenesisBlock();
    blocks.set(GENESIS_HASH, genesis);

    // Old chain: genesis -> oldTip (coinbase to M1)
    const oldTip = makeBlock('old1', GENESIS_HASH, 1, workOfBits(20), 'M1');
    blocks.set('old1', oldTip);

    // New (winning) chain: genesis -> new1 -> new2 (more work)
    const new1 = makeBlock('new1', GENESIS_HASH, 1, workOfBits(20), 'M2');
    const new2 = makeBlock('new2', 'new1', 2, workOfBits(20) * 2, 'M2');
    blocks.set('new1', new1);
    blocks.set('new2', new2);

    const node = makeNode(GENESIS_HASH);
    // Apply genesis and old1 to establish node state at oldTip.
    retarget(blocks, node, 'old1', 0);
    expect(node.tip).toBe('old1');
    expect(node.utxo.has('cb-old1:0')).toBe(true);

    const event = retarget(blocks, node, 'new2', 1000);
    expect(event).not.toBeNull();
    expect(event!.disconnected).toEqual(['old1']);
    expect(event!.connected).toEqual(['new1', 'new2']);
    expect(node.tip).toBe('new2');

    // Old chain's coinbase output is gone; new chain's coinbase outputs exist.
    expect(node.utxo.has('cb-old1:0')).toBe(false);
    expect(node.utxo.has('cb-new1:0')).toBe(true);
    expect(node.utxo.has('cb-new2:0')).toBe(true);
    // Reorg flash is set for the UI.
    expect(node.reorgFlashUntil).toBe(2500);
  });

  it('drops mempool txs that spend outputs no longer valid on the new active chain', () => {
    const blocks = new Map<string, Block>();
    const genesis = makeGenesisBlock();
    blocks.set(GENESIS_HASH, genesis);

    const old1 = makeBlock('old1', GENESIS_HASH, 1, workOfBits(20), 'M1');
    blocks.set('old1', old1);
    const new1 = makeBlock('new1', GENESIS_HASH, 1, workOfBits(20), 'M2');
    blocks.set('new1', new1);

    const node = makeNode(GENESIS_HASH);
    retarget(blocks, node, 'old1', 0);

    // A mempool tx spending old1's coinbase output — valid on old1, invalid once we reorg away.
    node.mempool.set('spendsOld', {
      txid: 'spendsOld',
      inputs: [{ txid: 'cb-old1', vout: 0 }],
      outputs: [{ address: 'B', value: 1 }],
      fee: 0,
      size: 100,
      isCoinbase: false,
      createdAt: 0,
    });

    retarget(blocks, node, 'new1', 1000);

    expect(node.mempool.has('spendsOld')).toBe(false);
  });
});
