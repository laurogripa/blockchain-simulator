// Pure fork analysis over the global block map + every node's current tip. No engine state,
// no React — SimEngine calls this on every dirty flush to keep ForkRecords current, and the
// tests drive it headless. A "fork" here is any block with two or more children.
import type { Block, BranchStat, Hash, NodeId } from './types';
import { blockRuleset } from './node';

export interface ForkPoint {
  parentHash: Hash;
  height: number; // height of the competing children
  branches: BranchStat[];
}

export function analyzeForks(blocks: Map<Hash, Block>, tips: Map<NodeId, Hash>): ForkPoint[] {
  const children = new Map<Hash, Block[]>();
  for (const b of blocks.values()) {
    const list = children.get(b.header.prevHash);
    if (list) list.push(b);
    else children.set(b.header.prevHash, [b]);
  }

  const points: ForkPoint[] = [];
  for (const [parentHash, kids] of children) {
    if (kids.length < 2 || !blocks.has(parentHash)) continue;
    const branches = kids
      .slice()
      .sort((a, b) => a.hash.localeCompare(b.hash))
      .map((root) => describeBranch(root, children, tips));
    points.push({ parentHash, height: kids[0].height, branches });
  }
  return points.sort((a, b) => a.height - b.height);
}

function describeBranch(root: Block, children: Map<Hash, Block[]>, tips: Map<NodeId, Hash>): BranchStat {
  const members = new Set<Hash>([root.hash]);
  let tipHeight = root.height;
  let maxWork = root.cumulativeWork;
  const queue: Block[] = [root];
  while (queue.length) {
    const cur = queue.pop()!;
    for (const child of children.get(cur.hash) ?? []) {
      members.add(child.hash);
      tipHeight = Math.max(tipHeight, child.height);
      maxWork = Math.max(maxWork, child.cumulativeWork);
      queue.push(child);
    }
  }
  const supporters: NodeId[] = [];
  for (const [id, tip] of tips) if (members.has(tip)) supporters.push(id);
  return {
    root: root.hash,
    minedBy: root.minedBy,
    ruleset: blockRuleset(root),
    tipHeight,
    length: tipHeight - root.height + 1,
    maxWork,
    supporters,
  };
}

/** The block on `winner`'s branch that first out-worked the losing branch — the "deciding" block. */
export function decidingBlock(blocks: Map<Hash, Block>, winnerRoot: Hash, loser: BranchStat): Block | null {
  const targetHeight = loser.tipHeight + 1;
  for (const b of blocks.values()) {
    if (b.height !== targetHeight) continue;
    // walk back to see whether this block descends from winnerRoot
    let cur: Block | undefined = b;
    while (cur && cur.height >= blocks.get(winnerRoot)!.height) {
      if (cur.hash === winnerRoot) return b;
      cur = blocks.get(cur.header.prevHash);
    }
  }
  return null;
}
