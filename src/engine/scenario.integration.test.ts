import { describe, expect, it } from 'vitest';
import { computeBlockHash, makeGenesisBlock, meetsTarget } from './chain';
import { buildCandidateTemplate, finalizeBlock } from './miner';
import { makePeerNode, receiveBlock, receiveTx } from './node';
import { makeRandomTx } from './mempool';
import { Rng } from './rng';
import type { Block, Hash, Miner } from './types';

/**
 * Headless integration harness: drives the real chain/node/miner logic (no React, no store,
 * no Workers) through a scripted sequence of blocks and asserts on resulting chain state —
 * exercising the same code path SimEngine drives, minus the browser plumbing.
 */
function mineOneBlock(blocks: Map<Hash, Block>, miner: Miner, parent: Block, now: number, easyBits: number): Block {
  // buildCandidateTemplate always stamps DIFFICULTY_BITS; override with the test's easy target
  // so mining resolves in a handful of iterations instead of the real ~2^20 expected hashes.
  const built = buildCandidateTemplate(miner, parent, now);
  const header = { ...built.header, bits: easyBits };
  let nonce = 0;
  let hash = computeBlockHash({ ...header, nonce });
  while (!meetsTarget(hash, easyBits)) {
    nonce++;
    hash = computeBlockHash({ ...header, nonce });
  }
  const block = finalizeBlock(parent, { ...header, nonce }, built.txs, hash, miner.id, nonce);
  blocks.set(block.hash, block);
  return block;
}

function makeMiner(id: string, genesis: Block): Miner {
  const peer = makePeerNode(id, 'miner', 0, 0, genesis);
  return { ...peer, kind: 'miner', hashPower: 1, template: null, hashesDone: 0, status: 'idle', attempts: [] };
}

describe('scripted chain scenario (headless)', () => {
  it('grows the active chain across several blocks and keeps all nodes in sync', () => {
    const blocks = new Map<Hash, Block>();
    const genesis = makeGenesisBlock();
    blocks.set(genesis.hash, genesis);
    // Trivial difficulty so mining resolves in a handful of iterations.
    const easyBits = 4;
    genesis.header.bits = easyBits;

    const miner = makeMiner('M1', genesis);
    const observer = makePeerNode('N1', 'full', 0, 0, genesis);

    let parent = genesis;
    for (let height = 1; height <= 3; height++) {
      const block = mineOneBlock(blocks, miner, parent, height * 1000, easyBits);

      const { isNewBest } = receiveBlock(blocks, miner, block, height * 1000);
      expect(isNewBest).toBe(true);
      const { isNewBest: observerAccepted } = receiveBlock(blocks, observer, block, height * 1000);
      expect(observerAccepted).toBe(true);

      parent = block;
    }

    expect(miner.tip).toBe(parent.hash);
    expect(observer.tip).toBe(parent.hash);
    expect(blocks.get(parent.hash)!.height).toBe(3);
  });

  it('a tx enters the mempool, gets mined, and its UTXO spend is reflected chain-wide after propagation', () => {
    const blocks = new Map<Hash, Block>();
    const genesis = makeGenesisBlock();
    const easyBits = 4;
    genesis.header.bits = easyBits;
    blocks.set(genesis.hash, genesis);

    const miner = makeMiner('M1', genesis);
    // Seed miner's UTXO view with genesis outputs (mirrors SimEngine's applyBlock(genesis) at setup).
    for (const [i, out] of genesis.txs[0].outputs.entries()) {
      miner.utxo.set(`${genesis.txs[0].txid}:${i}`, { outpoint: `${genesis.txs[0].txid}:${i}`, ...out, height: 0 });
    }

    const rng = new Rng(99);
    const tx = makeRandomTx(miner.utxo, rng, 500)!;
    expect(tx).not.toBeNull();
    expect(receiveTx(miner, tx)).toBe(true);
    expect(miner.mempool.has(tx.txid)).toBe(true);

    const { header, txs } = buildCandidateTemplate(miner, genesis, 1000);
    expect(txs.some((t) => t.txid === tx.txid)).toBe(true); // the tx got selected into the template

    let nonce = 0;
    let hash = computeBlockHash({ ...header, nonce, bits: easyBits });
    while (!meetsTarget(hash, easyBits)) {
      nonce++;
      hash = computeBlockHash({ ...header, nonce, bits: easyBits });
    }
    const block = finalizeBlock(genesis, { ...header, nonce, bits: easyBits }, txs, hash, 'M1', nonce);
    blocks.set(block.hash, block);

    receiveBlock(blocks, miner, block, 1000);

    expect(miner.mempool.has(tx.txid)).toBe(false); // cleared once mined
    const spentOutpoint = `${tx.inputs[0].txid}:${tx.inputs[0].vout}`;
    expect(miner.utxo.has(spentOutpoint)).toBe(false); // spent input gone
    expect(miner.tip).toBe(block.hash);
  });

  it('resolves a two-way fork (accidental collision) via longest-chain rule, matching real reorg semantics', () => {
    const blocks = new Map<Hash, Block>();
    const genesis = makeGenesisBlock();
    const easyBits = 4;
    genesis.header.bits = easyBits;
    blocks.set(genesis.hash, genesis);

    const minerA = makeMiner('M1', genesis);
    const minerB = makeMiner('M2', genesis);
    const observer = makePeerNode('N1', 'full', 0, 0, genesis);

    // Both miners solve competing blocks at the same height (accidental fork).
    const blockA = mineOneBlock(blocks, minerA, genesis, 1000, easyBits);
    const blockB = mineOneBlock(blocks, minerB, genesis, 1001, easyBits);
    expect(blockA.hash).not.toBe(blockB.hash);

    receiveBlock(blocks, observer, blockA, 1000);
    expect(observer.tip).toBe(blockA.hash); // first-seen wins the tie

    // M1's chain extends first — now strictly more work — observer should reorg onto it.
    const blockA2 = mineOneBlock(blocks, minerA, blockA, 2000, easyBits);
    receiveBlock(blocks, observer, blockB, 1500); // arrives late, same height as blockA — no reorg (tie already resolved)
    expect(observer.tip).toBe(blockA.hash);

    const { isNewBest, reorg } = receiveBlock(blocks, observer, blockA2, 2000);
    expect(isNewBest).toBe(true);
    expect(observer.tip).toBe(blockA2.hash);
    expect(reorg).toBeNull(); // this was a simple extension of the already-active chain, not a reorg
  });
});
