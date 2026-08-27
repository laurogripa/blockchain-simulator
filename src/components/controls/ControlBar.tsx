import { useState } from 'react';
import { engine } from '../../engine/engine';
import { SpeedDial } from './SpeedDial';
import { StatStrip } from './StatStrip';
import { useSimStore } from '../../store/useSimStore';

export function ControlBar() {
  const [running, setRunning] = useState(engine.running);
  const [mode, setMode] = useState(engine.mode);
  const focusedNode = useSimStore((s) => s.focusedNode);
  const raceActive = useSimStore((s) => s.raceActive);
  const hardForked = useSimStore((s) => s.hardForkHeight !== null);
  const scenarioBusy = raceActive || hardForked;

  return (
    <div
      className="panel"
      style={{ gridArea: 'control', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}
    >
      <button
        className={running ? 'active' : ''}
        onClick={() => {
          const next = !running;
          engine.setRunning(next);
          setRunning(next);
        }}
      >
        {running ? '⏸' : '▶'}
      </button>
      <SpeedDial />
      <button
        className={mode === 'manual' ? 'active' : ''}
        onClick={() => {
          const next = mode === 'auto' ? 'manual' : 'auto';
          engine.setMode(next);
          setMode(next);
        }}
      >
        {mode === 'auto' ? 'auto' : 'manual'}
      </button>

      <div style={{ width: 1, height: 20, background: 'var(--border)' }} />

      <button onClick={() => engine.createTxAt(focusedNode)}>+tx</button>

      <div style={{ width: 1, height: 20, background: 'var(--border)' }} />

      <button
        title="M1 and M2 each solve the same height before the other's block reaches them; the very next block settles it"
        className={raceActive ? 'active' : ''}
        disabled={scenarioBusy}
        onClick={() => engine.runAccidentalFork(1)}
      >
        fork
      </button>
      <button
        title="same, but both branches get extended once more before anyone breaks the tie (the rare case)"
        disabled={scenarioBusy}
        onClick={() => engine.runAccidentalFork(2)}
      >
        fork ×2
      </button>
      <button
        title="N9, N10, M4, M5 switch to incompatible big-block rules — a permanent chain split, Bitcoin / Bitcoin Cash style"
        className={hardForked ? 'active' : ''}
        disabled={scenarioBusy}
        onClick={() => engine.hardFork()}
      >
        {hardForked ? 'hard forked' : 'hard fork'}
      </button>

      <div style={{ flex: 1 }} />
      <StatStrip />
    </div>
  );
}
