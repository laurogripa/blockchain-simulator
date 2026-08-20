import type { MerkleResult } from '../engine/crypto/merkle';

export const LEAF_W = 70;
export const ROW_H = 60;

export interface MerkleLayoutNode {
  hash: string;
  x: number;
  y: number;
  level: number;
  index: number;
  isDuplicate: boolean;
}

export interface MerkleEdge {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export function layoutMerkle(result: MerkleResult): { nodes: MerkleLayoutNode[]; edges: MerkleEdge[] } {
  const { levels, duplicated } = result;
  const nodes: MerkleLayoutNode[] = [];
  const positions: Map<string, { x: number; y: number }> = new Map();
  const bottomRow = levels.length - 1;

  levels[0].forEach((hash, i) => {
    const x = i * LEAF_W + LEAF_W / 2;
    const y = bottomRow * ROW_H;
    positions.set(`0:${i}`, { x, y });
    nodes.push({ hash, x, y, level: 0, index: i, isDuplicate: false });
  });

  for (let lvl = 1; lvl < levels.length; lvl++) {
    levels[lvl].forEach((hash, i) => {
      const leftKey = `${lvl - 1}:${i * 2}`;
      const rightIdx = i * 2 + 1 < levels[lvl - 1].length ? i * 2 + 1 : i * 2;
      const rightKey = `${lvl - 1}:${rightIdx}`;
      const left = positions.get(leftKey)!;
      const right = positions.get(rightKey)!;
      const x = (left.x + right.x) / 2;
      const y = (bottomRow - lvl) * ROW_H;
      positions.set(`${lvl}:${i}`, { x, y });
      const isDup = duplicated.has(`${levels[lvl - 1][i * 2]}@${lvl - 1}`) && rightIdx === i * 2;
      nodes.push({ hash, x, y, level: lvl, index: i, isDuplicate: isDup });
    });
  }

  const edges: MerkleEdge[] = [];
  for (let lvl = 1; lvl < levels.length; lvl++) {
    levels[lvl].forEach((_, i) => {
      const parent = positions.get(`${lvl}:${i}`)!;
      const leftIdx = i * 2;
      const rightIdx = i * 2 + 1 < levels[lvl - 1].length ? i * 2 + 1 : i * 2;
      const left = positions.get(`${lvl - 1}:${leftIdx}`)!;
      const right = positions.get(`${lvl - 1}:${rightIdx}`)!;
      edges.push({ fromX: parent.x, fromY: parent.y, toX: left.x, toY: left.y });
      if (rightIdx !== leftIdx) edges.push({ fromX: parent.x, fromY: parent.y, toX: right.x, toY: right.y });
    });
  }

  return { nodes, edges };
}
