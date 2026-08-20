import { useSimStore } from '../../store/useSimStore';

export function StatStrip() {
  const activeChain = useSimStore((s) => s.activeChain);
  const tips = useSimStore((s) => s.tips);
  const nodes = useSimStore((s) => s.nodes);
  const miners = useSimStore((s) => s.miners);
  const simNow = useSimStore((s) => s.simNow);

  const mempoolTotal = Object.values(nodes).reduce((sum, n) => sum + n.mempoolSize, 0);
  const height = Math.max(0, activeChain.length - 1);
  const hashesDone = Object.values(miners).reduce((sum, m) => sum + m.hashesDone, 0);

  return (
    <div className="mono" style={{ display: 'flex', gap: 18, alignItems: 'baseline', color: 'var(--text-dim)' }}>
      <span className="display" style={{ fontSize: 17, color: 'var(--text)' }}>h{height}</span>
      <span style={{ color: tips.length > 1 ? 'var(--danger)' : 'var(--text-dim)' }}>tips {tips.length}</span>
      <span>mem {mempoolTotal}</span>
      <span>hash {hashesDone.toLocaleString()}</span>
      <span>{(simNow / 1000).toFixed(0)}s</span>
    </div>
  );
}
