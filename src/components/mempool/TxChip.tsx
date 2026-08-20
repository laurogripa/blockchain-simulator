import type { Transaction } from '../../engine/types';
import { feeRate } from '../../engine/mempool';
import { useSimStore } from '../../store/useSimStore';
import { Tooltip } from '../common/Tooltip';

interface TxChipProps {
  tx: Transaction;
  belowCut: boolean;
}

export function TxChip({ tx, belowCut }: TxChipProps) {
  const selectedTx = useSimStore((s) => s.selectedTx);
  const setSelectedTx = useSimStore((s) => s.setSelectedTx);
  const isSelected = selectedTx === tx.txid;
  const addr = tx.outputs[0]?.address ?? 'A';

  return (
    <Tooltip text={`${tx.txid} fee-rate ${feeRate(tx).toFixed(3)}`}>
      <div
        onMouseEnter={() => setSelectedTx(tx.txid)}
        onMouseLeave={() => setSelectedTx(null)}
        style={{
          width: 34,
          height: 34,
          borderRadius: 6,
          background: `var(--addr-${addr})`,
          opacity: belowCut ? 0.35 : 1,
          border: isSelected ? '2px solid #fff' : '2px solid transparent',
          cursor: 'default',
        }}
      />
    </Tooltip>
  );
}
