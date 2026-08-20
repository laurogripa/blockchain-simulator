import { useEffect } from 'react';
import { useSimStore } from '../../store/useSimStore';
import { engine } from '../../engine/engine';
import type { Miner } from '../../engine/types';

/** Click-a-miner inspector: current status plus a log of its recent mining attempts. */
export function MinerModal() {
  const inspectedMiner = useSimStore((s) => s.inspectedMiner);
  const closeMinerModal = useSimStore((s) => s.closeMinerModal);
  // re-render as the miner grinds/solves — hashesDone and status live in the store view
  const minerView = useSimStore((s) => (inspectedMiner ? s.miners[inspectedMiner] : undefined));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMinerModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeMinerModal]);

  if (!inspectedMiner || !minerView) return null;
  const miner = engine.nodes.get(inspectedMiner) as Miner;
  if (!miner) return null;

  const attempts = miner.attempts.slice().reverse();

  return (
    <div
      onClick={closeMinerModal}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="panel"
        style={{ width: 480, maxHeight: '80vh', overflow: 'auto', padding: 16 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div className="display" style={{ fontSize: 20, color: `var(--miner-${miner.id})` }}>miner {miner.id}</div>
          <button onClick={closeMinerModal}>×</button>
        </div>

        <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10, display: 'flex', gap: 16 }}>
          <span>hashPower {(miner.hashPower * 100).toFixed(0)}%</span>
          <span>status {minerView.status}</span>
          <span>mempool {miner.mempool.size}</span>
          <span>utxo {miner.utxo.size}</span>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button onClick={() => engine.mineNow(miner.id)} className={minerView.status === 'grinding' ? '' : 'active'}>
            ⛏ mine now
          </button>
        </div>

        <div className="panel-title">recent attempts ({attempts.length})</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {attempts.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>no attempts yet</div>
          )}
          {attempts.map((a) => {
            const solved = a.solvedBlockHash !== null;
            const ongoing = a.endedAt === null;
            const durationMs = ongoing ? null : a.endedAt! - a.startedAt;
            return (
              <div
                key={a.id}
                className="mono"
                style={{
                  fontSize: 10,
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '4px 6px',
                  borderRadius: 4,
                  background: 'var(--panel-2)',
                  color: ongoing ? 'var(--warn)' : solved ? 'var(--good)' : 'var(--text-dim)',
                }}
              >
                <span>h{a.height}</span>
                <span>{a.hashesTried.toLocaleString()} hashes</span>
                <span>{ongoing ? 'grinding…' : `${(durationMs! / 1000).toFixed(1)}s sim`}</span>
                <span>{solved ? `solved ${a.solvedBlockHash!.slice(0, 8)}` : ongoing ? '' : 'superseded'}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
