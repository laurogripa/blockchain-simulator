import { useSimStore } from '../../store/useSimStore';
import { NodeGlyph } from './NodeGlyph';
import { EdgeLine } from './EdgeLine';
import { PacketLayer } from './PacketLayer';
import { GRAPH_VIEWBOX } from '../../layout/graphLayout';

export function NetworkGraph() {
  const nodes = useSimStore((s) => s.nodes);
  const miners = useSimStore((s) => s.miners);
  const edges = useSimStore((s) => s.networkEdges);

  const allNodes = { ...nodes, ...miners };

  return (
    <svg viewBox={`0 0 ${GRAPH_VIEWBOX.w} ${GRAPH_VIEWBOX.h}`} width="100%" height="100%">
      <g>
        {edges.map((e, i) => {
          const a = allNodes[e.a];
          const b = allNodes[e.b];
          if (!a || !b) return null;
          return <EdgeLine key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
        })}
      </g>
      <PacketLayer nodes={allNodes} />
      <g>
        {Object.values(allNodes).map((n) => (
          <NodeGlyph key={n.id} node={n} />
        ))}
      </g>
    </svg>
  );
}
