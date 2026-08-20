import type { Block, Hash, PeerNode, ReorgEvent } from './types';
import { applyBlock, revertBlock } from './utxo';
import { workOfBits, targetHexForBits, DIFFICULTY_BITS } from './constants';
import { sha256dHex } from './crypto/sha256';
import { serializeHeader } from './serialize';

export const GENESIS_HASH: Hash = '0'.repeat(64);

/** Genesis pre-mines one output per address so the network has spendable UTXOs from block 0. */
export function makeGenesisBlock(): Block {
  const addresses = ['A', 'B', 'C', 'D', 'E', 'F'];
  const genesisTx = {
    txid: 'genesis' + '0'.repeat(57),
    inputs: [],
    outputs: addresses.map((address) => ({ address, value: 10_000_000_000 })),
    fee: 0,
    size: 100,
    isCoinbase: true,
    createdAt: 0,
  };
  return {
    hash: GENESIS_HASH,
    header: {
      version: 1,
      prevHash: '0'.repeat(64),
      merkleRoot: '0'.repeat(64),
      timestamp: 0,
      bits: DIFFICULTY_BITS,
      nonce: 0,
    },
    txs: [genesisTx],
    height: 0,
    cumulativeWork: 0,
    minedBy: 'genesis',
    hashesTried: 0,
    undo: [],
  };
}

export function computeBlockHash(header: Block['header']): Hash {
  return sha256dHex(serializeHeader(header));
}

export function meetsTarget(hash: Hash, bits: number): boolean {
  return hash <= targetHexForBits(bits);
}

/** Walk both chains back by prevHash to find the lowest common ancestor. */
export function lowestCommonAncestor(
  blocks: Map<Hash, Block>,
  a: Hash,
  b: Hash,
): Hash {
  const ancestorsOfA = new Set<Hash>();
  let cur = a;
  ancestorsOfA.add(cur);
  while (cur !== GENESIS_HASH) {
    const block = blocks.get(cur);
    if (!block) break;
    cur = block.header.prevHash;
    ancestorsOfA.add(cur);
  }
  cur = b;
  while (!ancestorsOfA.has(cur)) {
    const block = blocks.get(cur);
    if (!block) return GENESIS_HASH;
    cur = block.header.prevHash;
  }
  return cur;
}

function pathToAncestor(blocks: Map<Hash, Block>, from: Hash, ancestor: Hash): Hash[] {
  const path: Hash[] = [];
  let cur = from;
  while (cur !== ancestor) {
    path.push(cur);
    const block = blocks.get(cur);
    if (!block) break;
    cur = block.header.prevHash;
  }
  return path; // descending order, tip-first
}

/**
 * Retarget a node's active chain from its current tip to `newTip`, mutating its UTXO set
 * and mempool. Returns a ReorgEvent if this was an actual reorg (not a simple extension).
 */
export function retarget(
  blocks: Map<Hash, Block>,
  node: PeerNode,
  newTip: Hash,
  now: number,
): ReorgEvent | null {
  const oldTip = node.tip;
  if (oldTip === newTip) return null;

  const ancestor = lowestCommonAncestor(blocks, oldTip, newTip);
  const disconnectPath = pathToAncestor(blocks, oldTip, ancestor); // tip..ancestor, descending
  const connectPath = pathToAncestor(blocks, newTip, ancestor).reverse(); // ancestor..tip, ascending

  const isSimpleExtension = disconnectPath.length === 0;

  for (const hash of disconnectPath) {
    const block = blocks.get(hash);
    if (!block) continue;
    revertBlock(node.utxo, block);
    for (const tx of block.txs) {
      if (!tx.isCoinbase) node.mempool.set(tx.txid, tx);
    }
  }

  for (const hash of connectPath) {
    const block = blocks.get(hash);
    if (!block) continue;
    applyBlock(node.utxo, block);
    for (const tx of block.txs) {
      node.mempool.delete(tx.txid);
    }
  }

  // Drop mempool txs that are no longer valid (inputs vanished from the new active chain).
  for (const [txid, tx] of node.mempool) {
    if (tx.isCoinbase) continue;
    const stillValid = tx.inputs.every((inp) => node.utxo.has(`${inp.txid}:${inp.vout}`));
    if (!stillValid) node.mempool.delete(txid);
  }

  node.tip = newTip;

  if (!isSimpleExtension) {
    node.reorgFlashUntil = now + 1500;
    return {
      node: node.id,
      depth: disconnectPath.length,
      disconnected: disconnectPath,
      connected: connectPath,
      at: now,
    };
  }
  return null;
}

export function cumulativeWorkOf(parent: Block, bits: number): number {
  return parent.cumulativeWork + workOfBits(bits);
}
