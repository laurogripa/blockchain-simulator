import type { MerkleLayoutNode } from '../../layout/merkleLayout';
import { Tooltip } from '../common/Tooltip';

interface MerkleNodeProps {
  node: MerkleLayoutNode;
  highlighted: boolean;
  dimmed: boolean;
  onHover: (hash: string | null) => void;
}

export function MerkleNode({ node, highlighted, dimmed, onHover }: MerkleNodeProps) {
  return (
    <Tooltip text={node.hash}>
      <g
        transform={`translate(${node.x},${node.y})`}
        onMouseEnter={() => onHover(node.hash)}
        onMouseLeave={() => onHover(null)}
        opacity={dimmed ? 0.3 : 1}
      >
        <circle
          r={node.level === 0 ? 8 : 6}
          fill={highlighted ? 'var(--accent)' : 'var(--panel-2)'}
          stroke={highlighted ? '#fff' : 'var(--border)'}
          strokeWidth={highlighted ? 2 : 1}
          strokeDasharray={node.isDuplicate ? '2 2' : undefined}
        />
      </g>
    </Tooltip>
  );
}
