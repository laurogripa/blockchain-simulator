import { engine } from '../../engine/engine';
import { useState } from 'react';

const SPEEDS = [1, 10, 100];

export function SpeedDial() {
  const [speed, setSpeed] = useState(engine.speed);
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {SPEEDS.map((s) => (
        <button
          key={s}
          className={speed === s ? 'active' : ''}
          onClick={() => {
            engine.setSpeed(s);
            setSpeed(s);
          }}
        >
          {s}×
        </button>
      ))}
    </div>
  );
}
