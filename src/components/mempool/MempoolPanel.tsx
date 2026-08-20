import { useSimStore } from '../../store/useSimStore';
import { engine } from '../../engine/engine';
import { feeRate, selectMempoolTxs } from '../../engine/mempool';
import { MAX_TXS_PER_BLOCK } from '../../engine/constants';
import { TxChip } from './TxChip';

export function MempoolPanel() {
  const focusedNode = useSimStore((s) => s.focusedNode);
  // re-render whenever this node's mempool size (or any dirty flush) changes
  useSimStore((s) => s.nodes[focusedNode]?.mempoolSize ?? s.miners[focusedNode]?.mempoolSize);

  const node = engine.nodes.get(focusedNode);
  if (!node) return <div className="panel"><div className="panel-title">mempool</div></div>;

  const sorted = Array.from(node.mempool.values()).sort((a, b) => feeRate(b) - feeRate(a));
  const included = new Set(selectMempoolTxs(node.mempool, MAX_TXS_PER_BLOCK - 1, node.utxo).map((t) => t.txid));

  return (
    <div className="panel" style={{ height: '100%' }}>
      <div className="panel-title">mempool · {node.id}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {sorted.map((tx) => (
          <TxChip key={tx.txid} tx={tx} belowCut={!included.has(tx.txid)} />
        ))}
      </div>
    </div>
  );
}
