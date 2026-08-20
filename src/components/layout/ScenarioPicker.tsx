import { SCENARIO_LENGTH } from '../../engine/scenarios';
import type { SimEngine } from '../../engine/engine';

interface ScenarioPickerProps {
  engine: SimEngine;
  onPick: () => void;
}

/**
 * The first thing you see: pick between an open-ended random sim, or the scripted 64-block
 * "happy path" that plays back Bitcoin's own history in miniature (forks, a rollback, rejected
 * and accepted soft forks, one left unresolved). Blocks the rAF loop until a choice is made, so
 * nothing mines before that.
 */
export function ScenarioPicker({ engine, onPick }: ScenarioPickerProps) {
  function pick(mode: 'random' | 'scripted') {
    engine.start();
    if (mode === 'scripted') {
      engine.loadScenario();
      // Paused on purpose for now: the scenario seeds its full 63-block history instantly
      // rather than replaying it block-by-block. A proper genesis→64 reconstruction with
      // rewind/fast-forward is next-steps work (see GOALS.md) — until then, land on a frozen
      // final frame instead of immediately racing off into live/random mining past block 64.
      engine.setRunning(false);
    }
    onPick();
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 3000,
      }}
    >
      <div className="panel" style={{ width: 560, padding: 24, textAlign: 'center' }}>
        <div className="display" style={{ fontSize: 22, marginBottom: 6 }}>
          blockchain sim
        </div>
        <div className="mono" style={{ color: 'var(--text-dim)', fontSize: 12, marginBottom: 24 }}>
          choose how the network starts
        </div>

        <div style={{ display: 'flex', gap: 14, justifyContent: 'center' }}>
          <button
            onClick={() => pick('random')}
            style={{ flex: 1, padding: '18px 12px', textAlign: 'left', textTransform: 'none' }}
          >
            <div className="display" style={{ fontSize: 14, marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              random
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 400 }}>
              open-ended live sim — miners race from genesis, forks and reorgs happen (or don't)
              purely by chance.
            </div>
          </button>

          <button
            onClick={() => pick('scripted')}
            className="active"
            style={{ flex: 1, padding: '18px 12px', textAlign: 'left', textTransform: 'none' }}
          >
            <div className="display" style={{ fontSize: 14, marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              64-block scenario
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 400 }}>
              deterministic tour through Bitcoin's own history in miniature — an accidental fork,
              a 2010-style rollback, a rejected proposal, SegWit's holdout, Taproot, and a fork
              still in progress.
            </div>
          </button>
        </div>

        <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 18 }}>
          {SCENARIO_LENGTH - 1} scripted blocks are seeded instantly; mining continues live from
          there either way.
        </div>
      </div>
    </div>
  );
}
