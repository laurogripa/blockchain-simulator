import { sha256dHex } from './sha256';
import type { Hash, Txid } from '../types';

export interface MerkleResult {
  levels: Hash[][]; // levels[0] = leaves (txids), last = [root]
  root: Hash;
  duplicated: Set<Hash>; // hashes that exist only because a level was padded (odd count)
}

/** Bitcoin rule: hash pairs with sha256d(a||b); duplicate the last element when a level is odd. */
export function buildMerkleLevels(txids: Txid[]): MerkleResult {
  if (txids.length === 0) {
    const root = sha256dHex('');
    return { levels: [[root]], root, duplicated: new Set() };
  }
  const levels: Hash[][] = [txids.slice()];
  const duplicated = new Set<Hash>();
  let current = txids.slice();
  while (current.length > 1) {
    const next: Hash[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i];
      const right = i + 1 < current.length ? current[i + 1] : current[i];
      if (i + 1 >= current.length) duplicated.add(`${left}@${levels.length}`);
      next.push(sha256dHex(left + right));
    }
    levels.push(next);
    current = next;
  }
  return { levels, root: current[0], duplicated };
}

export interface ProofStep {
  sibling: Hash;
  side: 'L' | 'R';
}

export function merkleProof(txids: Txid[], index: number): ProofStep[] {
  const { levels } = buildMerkleLevels(txids);
  const steps: ProofStep[] = [];
  let idx = index;
  for (let lvl = 0; lvl < levels.length - 1; lvl++) {
    const level = levels[lvl];
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;
    const sibling = siblingIdx < level.length ? level[siblingIdx] : level[idx]; // duplicated last
    steps.push({ sibling, side: isRight ? 'L' : 'R' });
    idx = Math.floor(idx / 2);
  }
  return steps;
}

export function verifyProof(leaf: Hash, proof: ProofStep[], root: Hash): boolean {
  let h = leaf;
  for (const step of proof) {
    h = step.side === 'L' ? sha256dHex(step.sibling + h) : sha256dHex(h + step.sibling);
  }
  return h === root;
}
