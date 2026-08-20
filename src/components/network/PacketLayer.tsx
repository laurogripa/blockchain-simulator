import { useAnimatedPackets } from '../../hooks/useAnimatedPackets';
import type { NodeView } from '../../store/useSimStore';

const KIND_COLOR: Record<string, string> = {
  inv: '#8a91a8',
  getdata: '#ffd43b',
  block: '#ff6b6b',
  tx: '#4dabf7',
};

interface PacketLayerProps {
  nodes: Record<string, NodeView>;
}

export function PacketLayer({ nodes }: PacketLayerProps) {
  const positions = Object.fromEntries(Object.values(nodes).map((n) => [n.id, { x: n.x, y: n.y }]));
  const packets = useAnimatedPackets(positions);

  return (
    <g>
      {packets.map((p) => (
        <circle key={p.id} cx={p.x} cy={p.y} r={p.kind === 'block' ? 5 : 3.5} fill={KIND_COLOR[p.kind] ?? '#fff'} />
      ))}
    </g>
  );
}
