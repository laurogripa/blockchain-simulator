import { describe, expect, it } from 'vitest';
import { computeBlockHash, makeGenesisBlock, meetsTarget } from './chain';
import { buildCandidateTemplate, finalizeBlock } from './miner';
import { makePeerNode, receiveBlock, ruleViolation, blockRuleset } from './node';
import { analyzeForks, decidingBlock } from './forks';
import { BIG_BLOCK_BIT } from './constants';
import type { Block, Hash, Miner, PeerNode } from './types';

const EASY = 4;

function makeMiner(id: string, genesis: Block, rules: PeerNode['rules'] = { name: 'legacy', forkHeight: Infinity }): Miner {
  const peer = makePeerNode(id, 'miner', 0, 0, genesis);
  return { ...peer, kind: 'miner', rules, hashPower: 1, template: null, hashesDone: 0, status: 'idle', attempts: [] };
}

function mine(blocks: Map<Hash, Block>, miner: Miner, parent: Block, now: number): Block {
  const built = buildCandidateTemplate(miner, parent, now);
  const header = { ...built.header, bits: EASY };
  let nonce = 0;
  let hash = computeBlockHash({ ...header, nonce });
  while (!meetsTarget(hash, EASY)) {
    nonce++;
    hash = computeBlockHash({ ...header, nonce });
  }
  const block = finalizeBlock(parent, { ...header, nonce }, built.txs, hash, miner.id, nonce);
  blocks.set(block.hash, block);
  return block;
}

function setup() {
  const blocks = new Map<Hash, Block>();
  const genesis = makeGenesisBlock();
  genesis.header.bits = EASY;
  blocks.set(genesis.hash, genesis);
  return { blocks, genesis };
}

describe('accidental fork: two valid blocks at the same height', () => {
  it('produces two different hashes off the same parent, and analyzeForks sees one fork with two branches', () => {
    const { blocks, genesis } = setup();
    const m1 = makeMiner('M1', genesis);
    const m2 = makeMiner('M2', genesis);
    const a = mine(blocks, m1, genesis, 1000);
    const b = mine(blocks, m2, genesis, 1000);
    expect(a.hash).not.toBe(b.hash); // "same hash" never happens — different coinbase ⇒ different merkle root
    expect(a.cumulativeWork).toBe(b.cumulativeWork);

    const n1 = makePeerNode('N1', 'full', 0, 0, genesis);
    const n2 = makePeerNode('N2', 'full', 0, 0, genesis);
    receiveBlock(blocks, n1, a, 1000);
    receiveBlock(blocks, n2, b, 1000);
    // late arrivals lose the tie
    expect(receiveBlock(blocks, n1, b, 1200).tieKept).toBe(true);
    expect(receiveBlock(blocks, n2, a, 1200).tieKept).toBe(true);

    const tips = new Map([['N1', n1.tip], ['N2', n2.tip]]);
    const forks = analyzeForks(blocks, tips);
    expect(forks).toHaveLength(1);
    expect(forks[0].height).toBe(1);
    const supporters = forks[0].branches.map((br) => br.supporters.length);
    expect(supporters).toEqual([1, 1]);
  });

  it('is settled by the very next block: the extended branch wins, the other side reorgs', () => {
    const { blocks, genesis } = setup();
    const m1 = makeMiner('M1', genesis);
    const m2 = makeMiner('M2', genesis);
    const a = mine(blocks, m1, genesis, 1000);
    const b = mine(blocks, m2, genesis, 1000);
    const n1 = makePeerNode('N1', 'full', 0, 0, genesis);
    const n2 = makePeerNode('N2', 'full', 0, 0, genesis);
    receiveBlock(blocks, n1, a, 1000);
    receiveBlock(blocks, n2, b, 1000);
    receiveBlock(blocks, n1, b, 1200);
    receiveBlock(blocks, n2, a, 1200);

    receiveBlock(blocks, m2, b, 1000);
    const b2 = mine(blocks, m2, b, 2000);
    expect(receiveBlock(blocks, n2, b2, 2000).reorg).toBeNull(); // simple extension for N2
    const { reorg } = receiveBlock(blocks, n1, b2, 2100); // N1 must abandon a
    expect(reorg?.depth).toBe(1);
    expect(reorg?.disconnected).toEqual([a.hash]);

    const tips = new Map([['N1', n1.tip], ['N2', n2.tip]]);
    const [fork] = analyzeForks(blocks, tips);
    const winner = fork.branches.find((br) => br.root === b.hash)!;
    const loser = fork.branches.find((br) => br.root === a.hash)!;
    expect(winner.supporters).toEqual(['N1', 'N2']);
    expect(loser.supporters).toEqual([]);
    expect(winner.length).toBe(2);
    expect(decidingBlock(blocks, winner.root, loser)?.hash).toBe(b2.hash);
  });

  it('can stay tied for two rounds when both branches are extended simultaneously', () => {
    const { blocks, genesis } = setup();
    const m1 = makeMiner('M1', genesis);
    const m2 = makeMiner('M2', genesis);
    const a = mine(blocks, m1, genesis, 1000);
    const b = mine(blocks, m2, genesis, 1000);
    receiveBlock(blocks, m1, a, 1000);
    receiveBlock(blocks, m2, b, 1000);
    const a2 = mine(blocks, m1, a, 2000);
    const b2 = mine(blocks, m2, b, 2000);
    receiveBlock(blocks, m1, a2, 2000);
    receiveBlock(blocks, m2, b2, 2000);
    expect(receiveBlock(blocks, m1, b2, 2100).tieKept).toBe(true);
    expect(receiveBlock(blocks, m2, a2, 2100).tieKept).toBe(true);
    const [fork] = analyzeForks(blocks, new Map([['M1', m1.tip], ['M2', m2.tip]]));
    expect(fork.branches.map((br) => br.length)).toEqual([2, 2]);
    expect(fork.branches.every((br) => br.supporters.length === 1)).toBe(true);
  });
});

describe('hard fork: incompatible rules split the chain permanently', () => {
  it('legacy nodes reject big-rule blocks and big nodes reject legacy blocks past the fork height, regardless of work', () => {
    const { blocks, genesis } = setup();
    const legacyMiner = makeMiner('M1', genesis);
    const bigMiner = makeMiner('M4', genesis, { name: 'big', forkHeight: 1 });
    const legacyNode = makePeerNode('N1', 'full', 0, 0, genesis);
    const bigNode = { ...makePeerNode('N9', 'full', 0, 0, genesis), rules: { name: 'big', forkHeight: 1 } as const };

    const l1 = mine(blocks, legacyMiner, genesis, 1000);
    const b1 = mine(blocks, bigMiner, genesis, 1000);
    expect(blockRuleset(l1)).toBe('legacy');
    expect(blockRuleset(b1)).toBe('big');
    expect(b1.header.version & BIG_BLOCK_BIT).toBe(BIG_BLOCK_BIT);

    expect(ruleViolation(legacyNode, b1)).toMatch(/big-block bit/);
    expect(ruleViolation(bigNode, l1)).toMatch(/fork height/);
    expect(ruleViolation(legacyNode, l1)).toBeNull();
    expect(ruleViolation(bigNode, b1)).toBeNull();

    // a legacy chain three blocks long is still worthless to a big-rules node
    receiveBlock(blocks, legacyMiner, l1, 1000);
    const l2 = mine(blocks, legacyMiner, l1, 2000);
    receiveBlock(blocks, legacyMiner, l2, 2000);
    const l3 = mine(blocks, legacyMiner, l2, 3000);
    receiveBlock(blocks, bigNode, b1, 1000);
    for (const blk of [l1, l2, l3]) {
      const r = receiveBlock(blocks, bigNode, blk, 3000);
      expect(r.rejected).not.toBeNull();
      expect(r.isNewBest).toBe(false);
    }
    expect(bigNode.tip).toBe(b1.hash);
    expect(bigNode.rejected.size).toBe(3);

    receiveBlock(blocks, legacyNode, l1, 1000);
    expect(receiveBlock(blocks, legacyNode, b1, 1000).rejected).not.toBeNull();
    expect(legacyNode.tip).toBe(l1.hash);

    const [fork] = analyzeForks(blocks, new Map([['N1', legacyNode.tip], ['N9', bigNode.tip]]));
    expect(fork.branches.map((br) => br.ruleset).sort()).toEqual(['big', 'legacy']);
    expect(fork.branches.every((br) => br.supporters.length === 1)).toBe(true);
  });
});
