import type { DagNode } from '../../layout/dagLayout';
import { useSimStore } from '../../store/useSimStore';

interface ForkLabelsProps {
  byHash: Record<string, DagNode>;
}

/**
 * Draws the "why" directly on the DAG: a marker at every fork point naming the rivals, and on
 * each branch's first block a live count of the nodes currently following it. When a fork
 * resolves, the losing branch is marked stale with the block count that beat it.
 */
export function ForkLabels({ byHash }: ForkLabelsProps) {
  const forks = useSimStore((s) => s.forks);
  const nodeCount = useSimStore((s) => Object.keys(s.nodes).length);

  return (
    <g>
      {forks.map((f) => {
        const parent = byHash[f.parentHash];
        if (!parent) return null;
        const open = f.status === 'open';
        const color = f.kind === 'hardfork' ? 'var(--danger)' : open ? 'var(--warn)' : 'var(--good)';
        const title = f.kind === 'hardfork' ? 'HARD FORK' : open ? 'FORK' : 'FORK · resolved';
        return (
          <g key={f.id}>
            {/* marker on the parent block everyone forked from */}
            <g transform={`translate(${parent.x},${parent.y - 34})`}>
              <text textAnchor="middle" fontSize={8} fill={color} className="mono" fontWeight={700} letterSpacing="0.08em">
                {title}
              </text>
            </g>
            {f.branches.map((b) => {
              const root = byHash[b.root];
              if (!root) return null;
              const lost = !open && f.winner !== b.root;
              const won = !open && f.winner === b.root;
              const label = lost
                ? `stale · ${b.length} vs ${f.branches.find((o) => o.root === f.winner)?.length ?? '?'}`
                : `${b.supporters.length}/${nodeCount} nodes · ${b.length} blk`;
              return (
                <g key={b.root} transform={`translate(${root.x},${root.y - 31})`}>
                  <text
                    textAnchor="middle"
                    fontSize={8}
                    fill={lost ? 'var(--danger)' : won ? 'var(--good)' : `var(--miner-${b.minedBy})`}
                    className="mono"
                    opacity={lost ? 0.8 : 1}
                  >
                    {label}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}
