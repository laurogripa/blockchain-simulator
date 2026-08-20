// Node positions are computed once in engine.ts (fixed circular layout) and carried in NodeView.
// This module just exposes shared sizing constants so components agree on geometry.
export const NODE_RADIUS_FULL = 13;
export const NODE_RADIUS_MINER = 17;
export const GRAPH_VIEWBOX = { w: 680, h: 500 };
