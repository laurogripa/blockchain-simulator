import { useEngine } from './hooks/useEngine';
import { Dashboard } from './components/layout/Dashboard';

export default function App() {
  useEngine();
  return <Dashboard />;
}
