import { useEffect, useRef } from 'react';
import { useSimStore } from '../../store/useSimStore';
import type { LogEvent } from '../../engine/types';

const KIND_COLOR: Record<LogEvent['kind'], string> = {
  block: 'var(--text-dim)',
  tx: 'var(--text-dim)',
  reorg: 'var(--danger)',
  fork: 'var(--warn)',
  tie: 'var(--warn)',
  resolve: 'var(--good)',
  reject: 'var(--danger)',
  split: 'var(--danger)',
  heal: 'var(--good)',
  partition: 'var(--danger)',
};

const QUIET: LogEvent['kind'][] = ['block', 'tx'];

/** The engine's narration, newest at the bottom: every fork, tie-break, reorg, rejection and
 *  resolution says which node did what and why. Block/tx lines are dimmed as background. */
export function EventLog() {
  const events = useSimStore((s) => s.events);
  const ref = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [events]);

  return (
    <div
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 12;
      }}
      className="mono"
      style={{ overflowY: 'auto', flex: 1, minHeight: 0, fontSize: 10, lineHeight: 1.45 }}
    >
      {events.length === 0 && <div style={{ color: 'var(--text-dim)' }}>nothing yet</div>}
      {events.map((e) => (
        <div
          key={e.id}
          style={{
            display: 'grid',
            gridTemplateColumns: '38px 46px 1fr',
            gap: 6,
            padding: '2px 0',
            color: KIND_COLOR[e.kind],
            opacity: QUIET.includes(e.kind) ? 0.7 : 1,
            borderBottom: '1px solid var(--panel-2)',
          }}
        >
          <span style={{ color: 'var(--text-dim)' }}>{(e.at / 1000).toFixed(0)}s</span>
          <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 9 }}>{e.kind}</span>
          <span style={{ color: QUIET.includes(e.kind) ? 'var(--text-dim)' : 'var(--text)' }}>{e.text}</span>
        </div>
      ))}
    </div>
  );
}
