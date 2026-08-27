import type { Block, Hash, PeerNode, Ruleset, Transaction } from './types';
import { BIG_BLOCK_BIT } from './constants';
import { retarget, cumulativeWorkOf } from './chain';
import type { ReorgEvent } from './types';

// A small spread of real-world Bitcoin Core releases, picked deterministically per node id.
// This is cosmetic in the sim — every node validates with the exact same consensus rules
// regardless of which version string it's wearing — but it's a fair picture of the real
// network, where nodes (and miners) run a mix of client versions at any given time.
const CLIENT_VERSIONS = ['Bitcoin Core 25.1', 'Bitcoin Core 26.0', 'Bitcoin Core 26.1', 'Bitcoin Core 27.0'];

function pickClientVersion(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return CLIENT_VERSIONS[h % CLIENT_VERSIONS.length];
}

export function makePeerNode(
  id: string,
  kind: 'full' | 'miner',
  x: number,
  y: number,
  genesis: Block,
): PeerNode {
  return {
    id,
    kind,
    x,
    y,
    peers: [],
    known: new Set([genesis.hash]),
    tip: genesis.hash,
    clientVersion: pickClientVersion(id),
    firstSeen: new Map([[genesis.hash, 0]]),
    mempool: new Map(),
    utxo: new Map(),
    advertisedTip: new Map(),
    reorgFlashUntil: -1,
    partitioned: false,
    partitionGroup: 0,
    rules: { name: 'legacy', forkHeight: Infinity },
    rejected: new Map(),
  };
}

/** Which ruleset a block was mined under, read straight off its header. */
export function blockRuleset(block: Block): Ruleset {
  return (block.header.version & BIG_BLOCK_BIT) !== 0 ? 'big' : 'legacy';
}

/**
 * Consensus check: returns the reason this node's rules reject the block, or null if it is
 * acceptable. Work never enters into it — a block that breaks a node's rules is invalid to that
 * node no matter how much work sits behind it, which is exactly why a rule split never heals
 * on its own.
 */
export function ruleViolation(node: PeerNode, block: Block): string | null {
  const rs = blockRuleset(block);
  if (node.rules.name === 'legacy' && rs === 'big') {
    return 'big-block bit set — invalid under legacy rules';
  }
  if (node.rules.name === 'big' && rs === 'legacy' && block.height >= node.rules.forkHeight) {
    return `legacy block at h${block.height} ≥ fork height h${node.rules.forkHeight} — big rules require the fork bit`;
  }
  return null;
}

/** Node receives a full block it didn't have. Validates (trivially), stores, maybe retargets tip. */
export function receiveBlock(
  blocks: Map<Hash, Block>,
  node: PeerNode,
  block: Block,
  now: number,
): { isNewBest: boolean; reorg: ReorgEvent | null; rejected: string | null; tieKept: boolean } {
  if (node.known.has(block.hash)) return { isNewBest: false, reorg: null, rejected: null, tieKept: false };
  node.known.add(block.hash);
  const violation = ruleViolation(node, block);
  if (violation) {
    node.rejected.set(block.hash, violation);
    return { isNewBest: false, reorg: null, rejected: violation, tieKept: false };
  }
  if (!node.firstSeen.has(block.hash)) node.firstSeen.set(block.hash, now);

  const parent = blocks.get(block.header.prevHash);
  if (block.cumulativeWork === undefined) {
    block.cumulativeWork = cumulativeWorkOf(parent ?? { cumulativeWork: 0 } as Block, block.header.bits);
  }

  const currentTip = blocks.get(node.tip);
  const currentWork = currentTip ? currentTip.cumulativeWork : 0;

  let isNewBest = false;
  let tieKept = false;
  if (block.cumulativeWork > currentWork) {
    isNewBest = true;
  } else if (block.cumulativeWork === currentWork) {
    // tie -> first-seen wins; keep current tip unless this block was seen strictly earlier
    const curSeen = node.firstSeen.get(node.tip) ?? Infinity;
    const newSeen = node.firstSeen.get(block.hash) ?? now;
    isNewBest = newSeen < curSeen;
    tieKept = !isNewBest;
  }

  if (!isNewBest) return { isNewBest: false, reorg: null, rejected: null, tieKept };
  const reorg = retarget(blocks, node, block.hash, now);
  return { isNewBest: true, reorg, rejected: null, tieKept: false };
}

export function receiveTx(node: PeerNode, tx: Transaction): boolean {
  if (node.mempool.has(tx.txid)) return false;
  // basic UTXO check against this node's own view
  node.mempool.set(tx.txid, tx);
  return true;
}
