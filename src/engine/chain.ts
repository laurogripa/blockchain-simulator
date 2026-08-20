import type { Block, Hash, PeerNode, ReorgEvent } from './types';
import { applyBlock, revertBlock } from './utxo';
import { workOfBits, targetHexForBits, DIFFICULTY_BITS, COINBASE_VALUE } from './constants';
import { sha256dHex } from './crypto/sha256';
import { serializeHeader } from './serialize';

/** The zero/null-parent sentinel — genesis's own header.prevHash, exactly like real Bitcoin's
 *  (32 zero bytes). NOT genesis's own hash: genesis is a genuinely mined block (see below), so
 *  its hash is a real, PoW-valid value like any other block's. */
export const GENESIS_HASH: Hash = '0'.repeat(64);

// Genesis's coinbase, header, and the nonce that actually satisfies its own proof-of-work target
// — precomputed once (brute-forcing DIFFICULTY_BITS=20 synchronously at every app load would
// take ~24s in this JS sha256d implementation) and hardcoded here, exactly like every real
// Bitcoin client ships genesis's real bytes as constants rather than mining it at startup. Real
// Bitcoin genuinely mined its genesis (nonce 2083236893) — this sim does the equivalent, just
// once, offline, for its own header/hash function instead of pretending PoW doesn't apply.
const GENESIS_TXID = 'a0ee05652997523b2bd5e4c23336e0e68847781d1a77a2f73f52927f87b01b91';
const GENESIS_MERKLE_ROOT = GENESIS_TXID; // single-tx block: merkle root == that tx's id
const GENESIS_NONCE = 1_820_496;
const GENESIS_BLOCK_HASH = '0000020557acc392e94ed62cae12767836181477656ba3f1f079cacfb01dcc88';

/**
 * Matches the real genesis block as closely as this sim can: one 50 BTC coinbase output,
 * paid to a single (here: fictitious) address — same shape as the real one, which paid Satoshi's
 * pubkey. And like the real one, it's never added to any node's UTXO set (see engine.ts's setup
 * and scenarios.ts's runScenario, which both skip applyBlock-ing genesis for this reason) — the
 * real client's genesis handling never ran the usual "connect this block's coinbase" step, so
 * those 50 BTC have been permanently unspendable since January 2009. This sim reproduces that
 * quirk deliberately rather than inventing spendable seed money the real chain never had.
 */
export function makeGenesisBlock(): Block {
  const genesisTx = {
    txid: GENESIS_TXID,
    inputs: [],
    outputs: [{ address: 'satoshi', value: COINBASE_VALUE }],
    fee: 0,
    size: 100,
    isCoinbase: true,
    createdAt: 0,
    // The real embedded headline (Bitcoin's actual genesis coinbase scriptSig), Jan 3 2009 —
    // both a timestamp proof and Satoshi's own commentary on why this needed to exist.
    message: 'The Times 03/Jan/2009 Chancellor on brink of second bailout for banks',
  };
  return {
    hash: GENESIS_BLOCK_HASH,
    header: {
      version: 1,
      prevHash: GENESIS_HASH,
      merkleRoot: GENESIS_MERKLE_ROOT,
      timestamp: 0,
      bits: DIFFICULTY_BITS,
      nonce: GENESIS_NONCE,
    },
    txs: [genesisTx],
    height: 0,
    cumulativeWork: 0,
    minedBy: 'genesis',
    hashesTried: GENESIS_NONCE,
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
