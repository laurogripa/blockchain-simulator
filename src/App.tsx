import { useState } from 'react';
import { useEngine } from './hooks/useEngine';
import { Dashboard } from './components/layout/Dashboard';
import { ScenarioPicker } from './components/layout/ScenarioPicker';

export default function App() {
  const engine = useEngine();
  const [started, setStarted] = useState(false);

  return (
    <>
      <Dashboard />
      {!started && <ScenarioPicker engine={engine} onPick={() => setStarted(true)} />}
    </>
  );
}
