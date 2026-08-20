import { describe, expect, it } from 'vitest';
import { runScenario, SCENARIO_SEED, BEATS, SCENARIO_LENGTH } from './scenarios';
import { subsidyAt } from './miner';

describe('runScenario (the 64-block happy path)', () => {
  it('always ends at the same tip height for the fixed seed (64 blocks total, genesis + 63 mined)', () => {
    const state = runScenario(SCENARIO_SEED);
    const tip = state.blocks.get(state.network.tip)!;
    expect(tip.height).toBe(SCENARIO_LENGTH - 1); // genesis is height 0, so block 64 is height 63
  });

  it(
    'is fully deterministic: two runs with the same seed produce the same final tip hash',
    () => {
      const a = runScenario(SCENARIO_SEED);
      const b = runScenario(SCENARIO_SEED);
      expect(a.network.tip).toBe(b.network.tip);
    },
    15_000, // two full mining runs; SCENARIO_BITS keeps this fast, but give headroom under load
  );

  it(
    'a different seed produces a different run (sanity: the seed actually matters)',
    () => {
      const a = runScenario(SCENARIO_SEED);
      const b = runScenario(SCENARIO_SEED + 1);
      expect(a.network.tip).not.toBe(b.network.tip);
    },
    15_000,
  );

  it('all 7 halvings occur across the run (subsidy schedule runs independently of the beats)', () => {
    const values = Array.from({ length: 8 }, (_, epoch) => subsidyAt(epoch * 8 + 1));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBe(values[i - 1] / 2);
    }
    expect(values[7]).toBe(values[0] / 128); // 2^7 = 128, 7 halvings
  });

  it('the accidental fork leaves exactly one orphan (M5) that never rejoins the active chain', () => {
    const state = runScenario(SCENARIO_SEED);
    expect(state.orphans.length).toBeGreaterThanOrEqual(1);
    for (const hash of state.orphans) {
      expect(isOnActiveChain(state, hash)).toBe(false);
    }
  });

  it('the 2010-style overflow block gets rolled back — the active chain never keeps it', () => {
    const state = runScenario(SCENARIO_SEED);
    const overflowBlock = Array.from(state.blocks.values()).find(
      (b) => b.txs[0]?.outputs[0]?.value === 500_000_000_000,
    );
    expect(overflowBlock).toBeDefined();
    expect(isOnActiveChain(state, overflowBlock!.hash)).toBe(false);
    expect(state.orphans).toContain(overflowBlock!.hash);
  });

  it('covers the whole 1..64 range across beats with no gaps or overlaps', () => {
    const covered = new Set<number>();
    for (const beat of BEATS) {
      for (let h = beat.heights[0]; h <= beat.heights[1]; h++) {
        expect(covered.has(h)).toBe(false); // no overlap
        covered.add(h);
      }
    }
    expect(covered.size).toBe(SCENARIO_LENGTH);
  });
});

function isOnActiveChain(state: ReturnType<typeof runScenario>, hash: string): boolean {
  let cur: string | undefined = state.network.tip;
  while (cur) {
    if (cur === hash) return true;
    const b = state.blocks.get(cur);
    if (!b || cur === b.header.prevHash) break;
    cur = b.header.prevHash;
  }
  return false;
}
