import { useSimStore } from '../../store/useSimStore';
import type { BranchStat, ForkRecord } from '../../engine/types';

/**
 * Every fork the network has seen, newest first: who forked from whom, how many nodes sit on
 * each branch right now, and — once it settles — which block decided it and why. Open forks
 * update live; a hard fork is shown as permanently unresolvable.
 */
export function ForkPanel() {
  const forks = useSimStore((s) => s.forks);
  const nodeCount = useSimStore((s) => Object.keys(s.nodes).length);
  const setSelectedBlock = useSimStore((s) => s.setSelectedBlock);
  const ordered = forks.slice().sort((a, b) => b.height - a.height);

  if (ordered.length === 0) {
    return <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>no forks yet — every node agrees on one tip</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {ordered.map((f) => (
        <ForkCard key={f.id} fork={f} nodeCount={nodeCount} onPickBlock={setSelectedBlock} />
      ))}
    </div>
  );
}

function ForkCard({ fork, nodeCount, onPickBlock }: { fork: ForkRecord; nodeCount: number; onPickBlock: (h: string) => void }) {
  const open = fork.status === 'open';
  const statusColor = fork.kind === 'hardfork' ? 'var(--danger)' : open ? 'var(--warn)' : 'var(--good)';
  const statusText = fork.kind === 'hardfork' ? 'permanent split' : open ? 'unresolved' : 'resolved';

  return (
    <div className="mono" style={{ fontSize: 10, background: 'var(--panel-2)', border: `1px solid ${open ? statusColor : 'var(--border)'}`, borderRadius: 'var(--radius)', padding: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span className="display" style={{ fontSize: 12 }}>fork at h{fork.height}</span>
        <span style={{ color: statusColor, textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 9 }}>{statusText}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
        {fork.branches.map((b) => (
          <BranchRow key={b.root} branch={b} nodeCount={nodeCount} isWinner={fork.winner === b.root} resolved={!open} onPick={() => onPickBlock(b.root)} />
        ))}
      </div>

      {fork.narrative.map((line, i) => (
        <div key={i} style={{ color: i === fork.narrative.length - 1 ? 'var(--text)' : 'var(--text-dim)', marginTop: 3, lineHeight: 1.4 }}>
          {line}
        </div>
      ))}
    </div>
  );
}

function BranchRow({ branch, nodeCount, isWinner, resolved, onPick }: { branch: BranchStat; nodeCount: number; isWinner: boolean; resolved: boolean; onPick: () => void }) {
  const share = nodeCount ? branch.supporters.length / nodeCount : 0;
  const color = `var(--miner-${branch.minedBy})`;
  const lost = resolved && !isWinner;
  return (
    <div onClick={onPick} style={{ cursor: 'pointer', opacity: lost ? 0.55 : 1 }} title={branch.supporters.join(', ') || 'no nodes'}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
        <span style={{ color, fontWeight: 600, width: 22 }}>{branch.minedBy}</span>
        <span style={{ color: 'var(--text-dim)' }}>{branch.root.slice(0, 8)}…</span>
        {branch.ruleset === 'big' && <span style={{ color: 'var(--danger)', fontSize: 9 }}>BIG</span>}
        <span style={{ flex: 1 }} />
        <span>{branch.length} block{branch.length === 1 ? '' : 's'}</span>
        <span style={{ color: 'var(--text-dim)' }}>{branch.supporters.length}/{nodeCount} nodes</span>
        {isWinner && <span style={{ color: 'var(--good)' }}>won</span>}
        {lost && <span style={{ color: 'var(--danger)' }}>stale</span>}
      </div>
      <div style={{ height: 3, background: 'var(--border)', marginTop: 3, borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${share * 100}%`, height: '100%', background: color, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}
