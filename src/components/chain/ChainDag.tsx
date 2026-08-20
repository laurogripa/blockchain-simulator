import { useMemo, useRef, useEffect } from 'react';
import { useSimStore } from '../../store/useSimStore';
import { layoutDag, CARD_W, CARD_GAP, LANE_H } from '../../layout/dagLayout';
import { ForkEdges } from './ForkEdges';
import { BlockCard } from './BlockCard';
import { TipMarkers } from './TipMarkers';

const laneMemo = new Map<string, number>();

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

  // auto-follow the tip
  useEffect(() => {
    if (containerRef.current) containerRef.current.scrollLeft = width;
  }, [width]);

  return (
    <div ref={containerRef} style={{ overflowX: 'auto', width: '100%', height: '100%' }}>
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
  );
}
