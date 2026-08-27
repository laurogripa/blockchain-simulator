import { SCENARIO_LENGTH } from '../../engine/scenarios';
import type { SimEngine } from '../../engine/engine';

/**
 * Temporarily hidden: the scripted scenario currently seeds its history instantly rather than
 * replaying it. Flip this back on once the genesis→64 reconstruction lands (see GOALS.md).
 * While off, the picker collapses to a single "start" button.
 */
export const SHOW_SCRIPTED_SCENARIO = false;

interface ScenarioPickerProps {
  engine: SimEngine;
  onPick: () => void;
}

/**
 * The first thing you see. With SHOW_SCRIPTED_SCENARIO off it's just a start button for the
 * open-ended random sim; with it on, a choice between that and the scripted 64-block "happy
 * path" that plays back Bitcoin's own history in miniature. Blocks the rAF loop until a choice
 * is made, so nothing mines before that.
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
      <div className="panel" style={{ width: SHOW_SCRIPTED_SCENARIO ? 560 : 480, padding: 24, textAlign: 'center' }}>
        <div className="display" style={{ fontSize: 22, marginBottom: 6 }}>
          blockchain simulator
        </div>
        {SHOW_SCRIPTED_SCENARIO ? (
          <div className="mono" style={{ color: 'var(--text-dim)', fontSize: 12, marginBottom: 24 }}>
            choose how the network starts
          </div>
        ) : (
          <div
            className="mono"
            style={{ color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.6, marginBottom: 24, textAlign: 'left' }}
          >
            <p style={{ margin: '0 0 10px' }}>
              A small Bitcoin-style network runs live in your browser: 15 nodes relay
              transactions, miners race to solve real proof-of-work, and every block they find
              is broadcast, validated, and chained — or orphaned when two miners tie.
            </p>
            <p style={{ margin: '0 0 10px' }}>
              Built to teach how a blockchain actually works. Watch the mempool fill, click a
              block to inspect its Merkle tree and transactions, follow a fork as the network
              picks a winner, or trigger a fork and hard-fork split yourself to see consensus
              hold — and break.
            </p>
            <p style={{ margin: 0 }}>
              Nothing is scripted: forks and reorgs happen (or don’t) by chance, every run.
            </p>
          </div>
        )}

        {!SHOW_SCRIPTED_SCENARIO && (
          <button
            onClick={() => pick('random')}
            className="active"
            style={{ padding: '14px 40px', fontSize: 14, letterSpacing: '0.08em' }}
          >
            start
          </button>
        )}

        {SHOW_SCRIPTED_SCENARIO && (
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
        )}

        {SHOW_SCRIPTED_SCENARIO && (
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 18 }}>
            {SCENARIO_LENGTH - 1} scripted blocks are seeded instantly; mining continues live from
            there either way.
          </div>
        )}
      </div>
    </div>
  );
}
