import { MempoolPanel } from '../mempool/MempoolPanel';
import { ForkPanel } from '../chain/ForkPanel';
import { EventLog } from '../log/EventLog';
import { useSimStore } from '../../store/useSimStore';

/** Right-hand column: mempool on top, then the fork ledger and the engine's running narration. */
export function SidePanels() {
  const openForks = useSimStore((s) => s.forks.filter((f) => f.status === 'open').length);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%', minHeight: 0 }}>
      <div style={{ flex: '0 1 22%', minHeight: 80 }}>
        <MempoolPanel />
      </div>
      <div className="panel" style={{ flex: '1 1 42%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="panel-title" style={{ color: openForks ? 'var(--warn)' : undefined }}>
          forks{openForks ? ` · ${openForks} open` : ''}
        </div>
        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          <ForkPanel />
        </div>
      </div>
      <div className="panel" style={{ flex: '1 1 35%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="panel-title">log</div>
        <EventLog />
      </div>
    </div>
  );
}
