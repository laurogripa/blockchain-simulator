import { useState } from 'react';
import { engine } from '../../engine/engine';
import { SpeedDial } from './SpeedDial';
import { StatStrip } from './StatStrip';
import { useSimStore } from '../../store/useSimStore';

export function ControlBar() {
  const [running, setRunning] = useState(engine.running);
  const [mode, setMode] = useState(engine.mode);
  const partitionActive = useSimStore((s) => s.partitionActive);
  const focusedNode = useSimStore((s) => s.focusedNode);

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

      <button onClick={() => engine.runAccidentalFork()}>fork</button>
      <button
        className={partitionActive ? 'active' : ''}
        onClick={() => (partitionActive ? engine.heal() : engine.partition())}
      >
        {partitionActive ? 'heal' : 'partition'}
      </button>

      <div style={{ flex: 1 }} />
      <StatStrip />
    </div>
  );
}
