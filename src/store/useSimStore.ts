import { create } from 'zustand';
import type { ForkRecord, Hash, LogEvent, NodeId, Packet, Ruleset, SimMode, Txid } from '../engine/types';

export interface NodeView {
  id: NodeId;
  kind: 'full' | 'miner';
  x: number;
  y: number;
  tip: Hash;
  mempoolSize: number;
  utxoCount: number;
  reorgFlashUntil: number;
  clientVersion: string;
  peers: NodeId[];
  rules: Ruleset;
}

export interface MinerView extends NodeView {
  hashPower: number;
  status: 'idle' | 'grinding' | 'paused';
  hashesDone: number;
  templateTxCount: number;
}

export interface BlockView {
  hash: Hash;
  prevHash: Hash;
  height: number;
  cumulativeWork: number;
  txCount: number;
  minedBy: string;
  timestamp: number;
  merkleRoot: string;
  nonce: number;
  bits: number;
  ruleset: Ruleset;
  chain: 'main' | 'alt' | null; // main = N1's chain; alt = the hard-forked side's own chain
  isOrphan: boolean; // on neither live chain — a stale block nobody builds on
}

interface SimStoreState {
  simNow: number;
  speed: number;
  mode: SimMode;
  running: boolean;
  nodes: Record<NodeId, NodeView>;
  miners: Record<NodeId, MinerView>;
  blockIndex: Record<Hash, BlockView>;
  tips: Hash[];
  activeChain: Hash[];
  packets: Packet[];
  focusedNode: NodeId;
  selectedBlock: Hash | null;
  selectedTx: Txid | null;
  events: LogEvent[];
  networkEdges: { a: NodeId; b: NodeId }[];
  inspectedBlock: Hash | null; // drives BlockModal
  inspectedMiner: NodeId | null; // drives MinerModal
  inspectedNode: NodeId | null; // drives NodeModal (full nodes)
  lastMinedBy: NodeId | null; // most recent block's miner — highlighted on the graph
  forks: ForkRecord[];
  raceActive: boolean; // a scripted accidental-fork race is in progress
  hardForkHeight: number | null;

  setFocusedNode: (id: NodeId) => void;
  setSelectedBlock: (h: Hash | null) => void;
  setSelectedTx: (t: Txid | null) => void;
  openBlockModal: (h: Hash) => void;
  closeBlockModal: () => void;
  openMinerModal: (id: NodeId) => void;
  closeMinerModal: () => void;
  openNodeModal: (id: NodeId) => void;
  closeNodeModal: () => void;
}

export const useSimStore = create<SimStoreState>((set) => ({
  simNow: 0,
  speed: 100,
  mode: 'auto',
  running: true,
  nodes: {},
  miners: {},
  blockIndex: {},
  tips: [],
  activeChain: [],
  packets: [],
  focusedNode: '',
  selectedBlock: null,
  selectedTx: null,
  events: [],
  networkEdges: [],
  inspectedBlock: null,
  inspectedMiner: null,
  inspectedNode: null,
  lastMinedBy: null,
  forks: [],
  raceActive: false,
  hardForkHeight: null,

  setFocusedNode: (id) => set({ focusedNode: id, selectedBlock: null, selectedTx: null }),
  setSelectedBlock: (h) => set({ selectedBlock: h, selectedTx: null }),
  setSelectedTx: (t) => set({ selectedTx: t }),
  openBlockModal: (h) => set({ inspectedBlock: h, selectedBlock: h, selectedTx: null }),
  closeBlockModal: () => set({ inspectedBlock: null }),
  openMinerModal: (id) => set({ inspectedMiner: id }),
  closeMinerModal: () => set({ inspectedMiner: null }),
  openNodeModal: (id) => set({ inspectedNode: id }),
  closeNodeModal: () => set({ inspectedNode: null }),
}));

export type { SimStoreState };
