// The whole vocabulary in one file.

export type Hash = string; // 64 hex chars
export type Txid = Hash;
export type Address = string; // 'A'..'F', one color each
export type Outpoint = string; // `${txid}:${vout}`
export type NodeId = string;
export type MinerId = NodeId;
export type SimTime = number; // ms, sim clock

/** Consensus ruleset a node enforces. 'legacy' is the original rules; 'big' is a hard-forked
 *  ruleset (bigger blocks + a mandatory version bit) that legacy nodes consider invalid, and
 *  which in turn rejects legacy blocks from its fork height on — a Bitcoin/Bitcoin-Cash-style
 *  permanent chain split. */
export type Ruleset = 'legacy' | 'big';

export interface NodeRules {
  name: Ruleset;
  forkHeight: number; // for 'big': first height at which the big-block bit is mandatory
}

export interface TxOutput {
  address: Address;
  value: number; // sats
}

export interface TxInput {
  txid: Txid;
  vout: number;
}

export interface Transaction {
  txid: Txid;
  inputs: TxInput[]; // empty => coinbase
  outputs: TxOutput[];
  fee: number;
  size: number; // synthetic vbytes
  isCoinbase: boolean;
  createdAt: SimTime;
  message?: string; // coinbase scriptSig-style embedded text (genesis's headline, e.g.)
}

export interface BlockHeader {
  version: number;
  prevHash: Hash;
  merkleRoot: Hash;
  timestamp: SimTime;
  bits: number; // leading-zero-bit target width
  nonce: number;
}

export interface Block {
  hash: Hash;
  header: BlockHeader;
  txs: Transaction[]; // txs[0] is coinbase
  height: number;
  cumulativeWork: number;
  minedBy: MinerId;
  hashesTried: number;
  undo: UtxoEntry[]; // per-block undo journal for revertBlock (populated on first connect)
}

export interface UtxoEntry {
  outpoint: Outpoint;
  address: Address;
  value: number;
  height: number;
}

export interface PeerNode {
  id: NodeId;
  kind: 'full' | 'miner';
  x: number;
  y: number;
  peers: NodeId[];
  known: Set<Hash>;
  tip: Hash;
  clientVersion: string; // e.g. "Bitcoin Core 26.0" — cosmetic: every node runs identical consensus rules regardless
  firstSeen: Map<Hash, SimTime>;
  mempool: Map<Txid, Transaction>;
  utxo: Map<Outpoint, UtxoEntry>;
  advertisedTip: Map<NodeId, Hash>;
  reorgFlashUntil: SimTime;
  partitioned: boolean;
  partitionGroup: number; // 0 = none
  rules: NodeRules;
  rejected: Map<Hash, string>; // blocks this node refused, and why (consensus-rule violations)
}

export interface MinerAttempt {
  id: string;
  height: number;
  startedAt: SimTime;
  endedAt: SimTime | null; // null while still grinding
  hashesTried: number;
  solvedBlockHash: Hash | null; // set once this attempt finds a valid nonce
}

export interface Miner extends PeerNode {
  kind: 'miner';
  hashPower: number;
  template: Block | null;
  hashesDone: number;
  status: 'idle' | 'grinding' | 'paused';
  attempts: MinerAttempt[]; // most recent last, capped — for the miner inspector modal
}

export type PacketKind = 'inv' | 'getdata' | 'block' | 'tx';

export interface Packet {
  id: string;
  from: NodeId;
  to: NodeId;
  kind: PacketKind;
  payloadHash: Hash;
  sentAt: SimTime;
  arrivesAt: SimTime;
}

export interface ReorgEvent {
  node: NodeId;
  depth: number;
  disconnected: Hash[];
  connected: Hash[];
  at: SimTime;
}

export interface LogEvent {
  id: string;
  at: SimTime;
  kind: 'block' | 'tx' | 'reorg' | 'fork' | 'heal' | 'partition' | 'tie' | 'reject' | 'split' | 'resolve';
  text: string;
}

/** One competing branch at a fork point, with the live stats the fork panel explains. */
export interface BranchStat {
  root: Hash; // the first block of this branch (a child of the fork's parent)
  minedBy: MinerId;
  ruleset: Ruleset;
  tipHeight: number; // highest block on this branch
  length: number; // blocks on the branch, counting the root
  maxWork: number;
  supporters: NodeId[]; // nodes whose current tip sits on this branch
}

export interface ForkRecord {
  id: string;
  parentHash: Hash;
  height: number; // height of the competing blocks
  kind: 'accidental' | 'hardfork';
  status: 'open' | 'resolved';
  openedAt: SimTime;
  resolvedAt: SimTime | null;
  branches: BranchStat[];
  winner: Hash | null; // branch root that the whole network converged on
  narrative: string[]; // human-readable "why", appended as the fork evolves
}

export type SimMode = 'manual' | 'auto';
