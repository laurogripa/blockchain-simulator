import { useMemo, useRef, useEffect } from 'react';
import { useSimStore } from '../../store/useSimStore';
import { layoutDag, CARD_W, CARD_GAP, LANE_H } from '../../layout/dagLayout';
import { ForkEdges } from './ForkEdges';
import { BlockCard } from './BlockCard';
import { TipMarkers } from './TipMarkers';

const laneMemo = new Map<string, number>();
const STEP_BLOCKS = 5; // how many blocks < > nudge by

export function ChainDag() {
  const blockIndex = useSimStore((s) => s.blockIndex);
  const activeChain = useSimStore((s) => s.activeChain);
  const containerRef = useRef<HTMLDivElement>(null);

  const nodes = useMemo(() => layoutDag(blockIndex, activeChain, laneMemo), [blockIndex, activeChain]);
  const byHash = useMemo(() => Object.fromEntries(nodes.map((n) => [n.hash, n])), [nodes]);

  const maxHeight = nodes.reduce((m, n) => Math.max(m, n.height), 0);
  const maxLane = nodes.reduce((m, n) => Math.max(m, n.lane), 0);
  const width = (maxHeight + 1) * (CARD_W + CARD_GAP) + 40;
  const height = (maxLane + 1) * LANE_H + 40;
  const step = STEP_BLOCKS * (CARD_W + CARD_GAP);

  // auto-follow the tip
  useEffect(() => {
    if (containerRef.current) containerRef.current.scrollLeft = width;
  }, [width]);

  const scrollTo = (left: number) => containerRef.current?.scrollTo({ left, behavior: 'smooth' });
  const scrollBy = (delta: number) => containerRef.current?.scrollBy({ left: delta, behavior: 'smooth' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <div className="panel-title" style={{ margin: 0 }}>
          chain
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button title="jump to genesis" style={skipButtonStyle} onClick={() => scrollTo(0)}>
            ⏮
          </button>
          <button title={`back ${STEP_BLOCKS} blocks`} style={skipButtonStyle} onClick={() => scrollBy(-step)}>
            ‹
          </button>
          <button title={`forward ${STEP_BLOCKS} blocks`} style={skipButtonStyle} onClick={() => scrollBy(step)}>
            ›
          </button>
          <button title="jump to tip" style={skipButtonStyle} onClick={() => scrollTo(width)}>
            ⏭
          </button>
        </div>
      </div>
      <div ref={containerRef} style={{ overflowX: 'auto', width: '100%', flex: 1, minHeight: 0 }}>
        <svg width={width} height={Math.max(height, 140)} viewBox={`0 0 ${width} ${Math.max(height, 140)}`}>
          <ForkEdges nodes={nodes} byHash={byHash} />
          {nodes.map((n) => (
            <g key={n.hash}>
              <BlockCard node={n} />
              <TipMarkers node={n} />
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

const skipButtonStyle = { padding: '2px 7px', fontSize: 11 };
