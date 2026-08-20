import { useState } from 'react';
import { useEngine } from './hooks/useEngine';
import { Dashboard } from './components/layout/Dashboard';
import { ScenarioPicker } from './components/layout/ScenarioPicker';

export default function App() {
  const engine = useEngine();
  const [started, setStarted] = useState(false);

  // Dashboard (and ControlBar's play/pause button, which reads engine.running once at mount)
  // only mounts after a start mode is chosen, so its initial state is never stale.
  if (!started) return <ScenarioPicker engine={engine} onPick={() => setStarted(true)} />;
  return <Dashboard />;
}
