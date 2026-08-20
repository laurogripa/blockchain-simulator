import type { NodeId } from './types';
import { Rng } from './rng';

export interface Edge {
  a: NodeId;
  b: NodeId;
  baseLatencyMs: number; // sim-ms, drawn once
}

export function buildTopology(nodeIds: NodeId[], rng: Rng): { peers: Map<NodeId, NodeId[]>; edges: Edge[] } {
  const peers = new Map<NodeId, NodeId[]>();
  nodeIds.forEach((id) => peers.set(id, []));
  const edges: Edge[] = [];

  function connect(a: NodeId, b: NodeId) {
    if (a === b) return;
    const existing = peers.get(a)!;
    if (existing.includes(b)) return;
    existing.push(b);
    peers.get(b)!.push(a);
    edges.push({ a, b, baseLatencyMs: rng.range(40, 250) });
  }

  // Ring for guaranteed connectivity, then a few random chords for realism.
  for (let i = 0; i < nodeIds.length; i++) {
    connect(nodeIds[i], nodeIds[(i + 1) % nodeIds.length]);
  }
  const extraChords = Math.max(1, Math.floor(nodeIds.length / 2));
  for (let i = 0; i < extraChords; i++) {
    const a = rng.pick(nodeIds);
    const b = rng.pick(nodeIds);
    connect(a, b);
  }

  return { peers, edges };
}

export function edgeLatency(edges: Edge[], a: NodeId, b: NodeId, rng: Rng, stretch: number): number {
  const edge = edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
  const base = edge ? edge.baseLatencyMs : 150;
  const jitter = rng.range(-10, 30);
  return Math.max(5, (base + jitter) * stretch);
}
