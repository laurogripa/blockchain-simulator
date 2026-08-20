import type { DagNode } from '../../layout/dagLayout';
import { useSimStore } from '../../store/useSimStore';
import { Tooltip } from '../common/Tooltip';

interface TipMarkersProps {
  node: DagNode;
}

/** How many nodes currently treat this block as the head of their best chain, and which ones. */
export function TipMarkers({ node }: TipMarkersProps) {
  const nodes = useSimStore((s) => s.nodes);
  const miners = useSimStore((s) => s.miners);
  const pointingHere = Object.values({ ...nodes, ...miners }).filter((n) => n.tip === node.hash);
  if (pointingHere.length === 0) return null;

  const label = pointingHere.map((n) => n.id).join(', ');

  return (
    <Tooltip text={`tip for: ${label}`}>
      <g transform={`translate(${node.x},${node.y + 30})`} style={{ cursor: 'default' }}>
        <rect x={-16} y={-7} width={32} height={14} rx={7} fill="var(--panel-2)" stroke="var(--accent)" strokeWidth={1} opacity={0.9} />
        <circle cx={-7} cy={0} r={2.5} fill="var(--accent)" />
        <text x={4} y={0.5} textAnchor="middle" dominantBaseline="central" fontSize={8} fill="var(--accent)" className="mono" fontWeight={600}>
          {pointingHere.length}
        </text>
      </g>
    </Tooltip>
  );
}
