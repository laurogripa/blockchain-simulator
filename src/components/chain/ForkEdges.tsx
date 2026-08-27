import type { DagNode } from '../../layout/dagLayout';

interface ForkEdgesProps {
  nodes: DagNode[];
  byHash: Record<string, DagNode>;
}

export function ForkEdges({ nodes, byHash }: ForkEdgesProps) {
  return (
    <g>
      {nodes.map((n) => {
        const parent = byHash[n.prevHash];
        if (!parent) return null;
        const midX = (parent.x + n.x) / 2;
        return (
          <path
            key={n.hash}
            d={`M ${parent.x} ${parent.y} C ${midX} ${parent.y}, ${midX} ${n.y}, ${n.x} ${n.y}`}
            fill="none"
            stroke={n.isOrphan ? 'var(--border)' : n.chain === 'alt' ? 'var(--danger)' : '#3a4258'}
            strokeWidth={1.5}
            opacity={n.isOrphan ? 0.35 : n.chain === 'alt' ? 0.5 : 0.8}
          />
        );
      })}
    </g>
  );
}
