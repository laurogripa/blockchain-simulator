import { useEffect } from 'react';
import { useSimStore } from '../../store/useSimStore';
import { engine } from '../../engine/engine';
import type { PeerNode } from '../../engine/types';
import { formatSats } from '../../engine/format';

/** Click-a-node inspector: identity, peers, mempool contents, and UTXO set of a full node. */
export function NodeModal() {
  const inspectedNode = useSimStore((s) => s.inspectedNode);
  const closeNodeModal = useSimStore((s) => s.closeNodeModal);
  // re-render as mempool/utxo/tip change under this node
  const nodeView = useSimStore((s) => (inspectedNode ? s.nodes[inspectedNode] : undefined));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeNodeModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeNodeModal]);

  if (!inspectedNode || !nodeView) return null;
  const node = engine.nodes.get(inspectedNode) as PeerNode;
  if (!node) return null;

  const mempoolTxs = Array.from(node.mempool.values());
  const utxoEntries = Array.from(node.utxo.values());

  return (
    <div
      onClick={closeNodeModal}
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
          <div className="display" style={{ fontSize: 20 }}>node {node.id}</div>
          <button onClick={closeNodeModal}>×</button>
        </div>

        <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span>{node.clientVersion}</span>
          <span>mempool {mempoolTxs.length}</span>
          <span>utxo {utxoEntries.length}</span>
          {nodeView.partitioned && <span style={{ color: 'var(--danger)' }}>partitioned (group {nodeView.partitionGroup})</span>}
        </div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 10, fontStyle: 'italic' }}>
          same consensus rules as every other node — the version string doesn't change what it accepts
        </div>

        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
            tip
          </div>
          <div className="mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{node.tip}</div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
            peers ({node.peers.length})
          </div>
          <div className="mono" style={{ fontSize: 11, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {node.peers.length === 0 && <span style={{ color: 'var(--text-dim)' }}>none</span>}
            {node.peers.map((p) => (
              <span key={p}>{p}</span>
            ))}
          </div>
        </div>

        <div className="panel-title">mempool ({mempoolTxs.length})</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
          {mempoolTxs.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>empty</div>
          )}
          {mempoolTxs.map((tx) => (
            <div
              key={tx.txid}
              className="mono"
              style={{
                fontSize: 10,
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
                padding: '4px 6px',
                borderRadius: 4,
                background: 'var(--panel-2)',
                color: 'var(--text-dim)',
              }}
            >
              <span>{tx.txid.slice(0, 10)}</span>
              <span>{formatSats(tx.outputs.reduce((sum, o) => sum + o.value, 0))}</span>
              <span>fee {tx.fee}</span>
            </div>
          ))}
        </div>

        <div className="panel-title">utxo set ({utxoEntries.length})</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {utxoEntries.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>empty</div>
          )}
          {utxoEntries.map((u) => (
            <div
              key={u.outpoint}
              className="mono"
              style={{
                fontSize: 10,
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
                padding: '4px 6px',
                borderRadius: 4,
                background: 'var(--panel-2)',
                color: 'var(--text-dim)',
              }}
            >
              <span>{u.outpoint.slice(0, 10)}</span>
              <span style={{ color: `var(--addr-${u.address})` }}>{u.address}</span>
              <span>{formatSats(u.value)}</span>
              <span>h{u.height}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
