import { useSimStore } from '../../store/useSimStore';
import type { NodeView, MinerView } from '../../store/useSimStore';
import { NODE_RADIUS_FULL, NODE_RADIUS_MINER } from '../../layout/graphLayout';
import { Tooltip } from '../common/Tooltip';

const ADDR_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function tipColor(hash: string): string {
  // Deterministic pseudo-color per hash so different tips are visually distinct — clamped to
  // muted ledger-ink saturation/lightness so a fork reads as "two different inks", not a
  // rainbow sampler.
  const h = hash.slice(0, 6);
  const hue = parseInt(h, 16) % 360;
  return `hsl(${hue}, 38%, 42%)`;
}

interface NodeGlyphProps {
  node: NodeView | MinerView;
}

export function NodeGlyph({ node }: NodeGlyphProps) {
  const focusedNode = useSimStore((s) => s.focusedNode);
  const setFocusedNode = useSimStore((s) => s.setFocusedNode);
  const openMinerModal = useSimStore((s) => s.openMinerModal);
  const openNodeModal = useSimStore((s) => s.openNodeModal);
  const simNow = useSimStore((s) => s.simNow);
  const lastMinedBy = useSimStore((s) => s.lastMinedBy);
  const isMiner = node.kind === 'miner';
  const r = isMiner ? NODE_RADIUS_MINER : NODE_RADIUS_FULL;
  const isFocused = focusedNode === node.id;
  const isReorging = node.reorgFlashUntil > simNow;
  const isLastWinner = isMiner && lastMinedBy === node.id;
  // Winner glow takes over the fill instead of a progress ring — mining is memoryless (each
  // hash is an independent trial), so there's no honest way to show "distance to a solve";
  // marking who most recently *found* one is the truthful signal instead.
  const fill = isLastWinner ? `var(--miner-${node.id})` : tipColor(node.tip);

  const shape = (
    <g
      transform={`translate(${node.x},${node.y})`}
      onClick={() => {
        setFocusedNode(node.id);
        if (isMiner) openMinerModal(node.id);
        else openNodeModal(node.id);
      }}
      style={{ cursor: 'pointer' }}
    >
      {isReorging && <circle r={r + 8} fill="none" stroke="var(--danger)" strokeWidth={2} opacity={0.7} />}
      {isLastWinner && <circle r={r + 6} fill="none" stroke={`var(--miner-${node.id})`} strokeWidth={2} opacity={0.9} />}
      {isMiner ? (
        <polygon
          points={hexPoints(r)}
          fill={fill}
          stroke={isFocused ? '#fff' : 'var(--border)'}
          strokeWidth={isFocused ? 2.5 : 1}
          opacity={node.partitioned ? 0.5 : 1}
        />
      ) : (
        <circle
          r={r}
          fill={fill}
          stroke={isFocused ? '#fff' : 'var(--border)'}
          strokeWidth={isFocused ? 2.5 : 1}
          opacity={node.partitioned ? 0.5 : 1}
        />
      )}
      {node.mempoolSize > 0 && (
        <circle cx={r * 0.7} cy={-r * 0.7} r={4} fill="var(--warn)" stroke="var(--bg)" strokeWidth={1} />
      )}
      <text y={r + 12} textAnchor="middle" fontSize={9} fill="var(--text-dim)">
        {node.id}
      </text>
      {node.rules === 'big' && (
        <g transform={`translate(${-r * 0.8},${-r * 0.9})`}>
          <rect x={-10} y={-6} width={20} height={11} rx={2} fill="var(--danger)" />
          <text textAnchor="middle" dominantBaseline="central" fontSize={7} fill="#fff" fontWeight={700} className="mono">
            BIG
          </text>
        </g>
      )}
    </g>
  );

  // Full nodes keep a hover tooltip with their tip hash (useful for spotting a fork); miners
  // don't — hovering a miner mid-fork was reading as "this hash means something about mining
  // progress", which it doesn't. Click either kind to open its inspector modal.
  return isMiner ? shape : <Tooltip text={`${node.id} (${node.rules} rules) tip:${node.tip}`}>{shape}</Tooltip>;
}

function hexPoints(r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    pts.push(`${r * Math.cos(angle)},${r * Math.sin(angle)}`);
  }
  return pts.join(' ');
}

export { ADDR_LETTERS };
