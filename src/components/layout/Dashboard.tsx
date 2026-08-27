import { useState } from 'react';
import { ControlBar } from '../controls/ControlBar';
import { NetworkGraph } from '../network/NetworkGraph';
import { SidePanels } from './SidePanels';
import { ChainDag } from '../chain/ChainDag';
import { BlockModal } from '../chain/BlockModal';
import { MinerModal } from '../network/MinerModal';
import { NodeModal } from '../network/NodeModal';
import { MerkleTree } from '../merkle/MerkleTree';

type MainTab = 'network' | 'merkle';

export function Dashboard() {
  const [tab, setTab] = useState<MainTab>('network');

  return (
    <div
      style={{
        display: 'grid',
        height: '100vh',
        width: '100vw',
        gap: 10,
        padding: 10,
        gridTemplateAreas: `
          "control control"
          "main side"
          "chain chain"
        `,
        gridTemplateRows: 'auto minmax(300px, 1fr) minmax(180px, 260px)',
        gridTemplateColumns: '1fr 400px',
      }}
    >
      <ControlBar />

      <div className="panel" style={{ gridArea: 'main', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <button className={tab === 'network' ? 'active' : ''} onClick={() => setTab('network')}>
            network
          </button>
          <button className={tab === 'merkle' ? 'active' : ''} onClick={() => setTab('merkle')}>
            merkle
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          {tab === 'network' ? <NetworkGraph /> : <MerkleTree bare />}
        </div>
      </div>

      <div style={{ gridArea: 'side', minHeight: 0 }}>
        <SidePanels />
      </div>

      <div className="panel" style={{ gridArea: 'chain', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <ChainDag />
      </div>

      <BlockModal />
      <MinerModal />
      <NodeModal />
    </div>
  );
}
