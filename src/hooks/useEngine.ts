import { useRef } from 'react';
import { SimEngine, engine as engineSingleton, initEngine } from '../engine/engine';

/**
 * Lazily creates the one SimEngine instance (module-level singleton). Does NOT start its rAF
 * loop — that's deferred until the user picks a start mode (random vs the scripted 64-block
 * scenario) in <ScenarioPicker>, so no mining happens before that choice is made.
 */
export function useEngine(): SimEngine {
  const ref = useRef<SimEngine>(null!);
  if (!engineSingleton) {
    ref.current = initEngine();
  } else {
    ref.current = engineSingleton;
  }
  return ref.current;
}
