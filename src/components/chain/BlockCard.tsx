import type { DagNode } from '../../layout/dagLayout';
import { CARD_W } from '../../layout/dagLayout';
import { useSimStore } from '../../store/useSimStore';
import { Tooltip } from '../common/Tooltip';

const MINER_COLOR: Record<string, string> = {
  M1: '#b8783e', // copper
  M2: '#4f8f7c', // verdigris
  M3: '#6d84a3', // slate steel
  M4: '#a85c3e', // rust iron
  M5: '#b09a4a', // ochre brass
  genesis: '#6b6a58',
};

interface BlockCardProps {
  node: DagNode;
}

export function BlockCard({ node }: BlockCardProps) {
  const selected = useSimStore((s) => s.selectedBlock);
  const openBlockModal = useSimStore((s) => s.openBlockModal);
  const isSelected = selected === node.hash;
  const color = MINER_COLOR[node.minedBy] ?? '#868e96';
  const sealColor = node.isOrphan ? 'var(--danger)' : 'var(--good)';
  const isBig = node.ruleset === 'big';

  return (
    <Tooltip text={node.hash}>
      <g
        transform={`translate(${node.x - CARD_W / 2},${node.y - 24})`}
        onClick={() => openBlockModal(node.hash)}
        style={{ cursor: 'pointer' }}
        opacity={node.isOrphan ? 0.45 : 1}
      >
        <rect
          width={CARD_W}
          height={48}
          rx={2}
          fill="var(--panel-2)"
          stroke={isSelected ? '#fff' : color}
          strokeWidth={isSelected ? 2.5 : 1.5}
        />
        <rect width={CARD_W} height={3} fill={color} />
        <text x={8} y={23} fontSize={12} fill="var(--text)" className="display">
          h{node.height}
        </text>
        <text x={8} y={37} fontSize={9} fill="var(--text-dim)" className="mono">
          {node.hash.slice(0, 6)}
        </text>
        <text x={CARD_W - 8} y={22} fontSize={9} fill="var(--text-dim)" textAnchor="end">
          {node.txCount}tx
        </text>
        {isBig && (
          <text x={50} y={37} fontSize={7} fill="var(--danger)" className="mono" fontWeight={600}>
            BIG
          </text>
        )}

        {/* the seal: proof-of-work as an ink stamp of authenticity, void if orphaned */}
        <g transform={`translate(${CARD_W - 10},34) rotate(-10)`}>
          <circle r={7} fill="none" stroke={sealColor} strokeWidth={1.3} opacity={0.85} />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={node.isOrphan ? 4.5 : 5.5}
            fill={sealColor}
            className="mono"
            fontWeight={600}
          >
            {node.isOrphan ? 'STALE' : 'OK'}
          </text>
        </g>
      </g>
    </Tooltip>
  );
}
