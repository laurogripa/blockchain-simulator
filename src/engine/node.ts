import type { Block, Hash, PeerNode, Transaction } from './types';
import { retarget, cumulativeWorkOf } from './chain';
import type { ReorgEvent } from './types';

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
    firstSeen: new Map([[genesis.hash, 0]]),
    mempool: new Map(),
    utxo: new Map(),
    advertisedTip: new Map(),
    reorgFlashUntil: -1,
    partitioned: false,
    partitionGroup: 0,
  };
}

/** Node receives a full block it didn't have. Validates (trivially), stores, maybe retargets tip. */
export function receiveBlock(
  blocks: Map<Hash, Block>,
  node: PeerNode,
  block: Block,
  now: number,
): { isNewBest: boolean; reorg: ReorgEvent | null } {
  if (node.known.has(block.hash)) return { isNewBest: false, reorg: null };
  node.known.add(block.hash);
  if (!node.firstSeen.has(block.hash)) node.firstSeen.set(block.hash, now);

  const parent = blocks.get(block.header.prevHash);
  if (block.cumulativeWork === undefined) {
    block.cumulativeWork = cumulativeWorkOf(parent ?? { cumulativeWork: 0 } as Block, block.header.bits);
  }

  const currentTip = blocks.get(node.tip);
  const currentWork = currentTip ? currentTip.cumulativeWork : 0;

  let isNewBest = false;
  if (block.cumulativeWork > currentWork) {
    isNewBest = true;
  } else if (block.cumulativeWork === currentWork) {
    // tie -> first-seen wins; keep current tip unless this block was seen strictly earlier
    const curSeen = node.firstSeen.get(node.tip) ?? Infinity;
    const newSeen = node.firstSeen.get(block.hash) ?? now;
    isNewBest = newSeen < curSeen;
  }

  if (!isNewBest) return { isNewBest: false, reorg: null };
  const reorg = retarget(blocks, node, block.hash, now);
  return { isNewBest: true, reorg };
}

export function receiveTx(node: PeerNode, tx: Transaction): boolean {
  if (node.mempool.has(tx.txid)) return false;
  // basic UTXO check against this node's own view
  node.mempool.set(tx.txid, tx);
  return true;
}
