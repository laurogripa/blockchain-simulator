import { useEffect, useRef } from 'react';
import { SimEngine, engine as engineSingleton, initEngine } from '../engine/engine';

/** Lazily creates the one SimEngine instance (module-level singleton) and starts its rAF loop. */
export function useEngine(): SimEngine {
  const ref = useRef<SimEngine>(null!);
  if (!engineSingleton) {
    ref.current = initEngine();
  } else {
    ref.current = engineSingleton;
  }

  useEffect(() => {
    ref.current.start();
  }, []);

  return ref.current;
}
