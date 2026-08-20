import type { BlockView } from '../store/useSimStore';

export const CARD_W = 90;
export const CARD_GAP = 30;
export const LANE_H = 90;

export interface DagNode extends BlockView {
  lane: number;
  x: number;
  y: number;
}

/**
 * Assigns lane 0 to the heaviest chain; each fork branch keeps a memoized lane keyed by its
 * branch-root hash so lanes never reshuffle mid-animation.
 */
export function layoutDag(
  blocks: Record<string, BlockView>,
  activeChain: string[],
  laneMemo: Map<string, number>,
): DagNode[] {
  const byHeight = new Map<number, BlockView[]>();
  for (const b of Object.values(blocks)) {
    if (!byHeight.has(b.height)) byHeight.set(b.height, []);
    byHeight.get(b.height)!.push(b);
  }
  const activeSet = new Set(activeChain);
  const usedLanes = new Set<number>([0]);

  function laneFor(b: BlockView): number {
    if (activeSet.has(b.hash)) return 0;
    if (laneMemo.has(b.hash)) return laneMemo.get(b.hash)!;
    // inherit parent's lane if parent is off-chain too, else pick a new lane
    const parent = blocks[b.prevHash];
    let lane: number;
    if (parent && !activeSet.has(parent.hash) && laneMemo.has(parent.hash)) {
      lane = laneMemo.get(parent.hash)!;
    } else {
      lane = 1;
      while (usedLanes.has(lane)) lane++;
    }
    usedLanes.add(lane);
    laneMemo.set(b.hash, lane);
    return lane;
  }

  const nodes: DagNode[] = [];
  const heights = Array.from(byHeight.keys()).sort((a, b) => a - b);
  for (const h of heights) {
    for (const b of byHeight.get(h)!) {
      const lane = laneFor(b);
      nodes.push({
        ...b,
        lane,
        x: h * (CARD_W + CARD_GAP) + CARD_W / 2,
        y: lane * LANE_H + LANE_H / 2,
      });
    }
  }
  return nodes;
}
