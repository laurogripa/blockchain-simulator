import { useMemo, useState } from 'react';
import { useSimStore } from '../../store/useSimStore';
import { engine } from '../../engine/engine';
import { buildMerkleLevels, merkleProof } from '../../engine/crypto/merkle';
import { layoutMerkle, LEAF_W, ROW_H } from '../../layout/merkleLayout';
import { MerkleNode } from './MerkleNode';

interface MerkleTreeProps {
  /** Render without its own panel chrome (title/border) — used when embedded in a tab. */
  bare?: boolean;
}

export function MerkleTree({ bare = false }: MerkleTreeProps) {
  const selectedBlock = useSimStore((s) => s.selectedBlock);
  const activeChain = useSimStore((s) => s.activeChain);
  const [hoveredLeaf, setHoveredLeaf] = useState<number | null>(null);

  const blockHash = selectedBlock ?? activeChain[activeChain.length - 1];
  const block = blockHash ? engine.blocks.get(blockHash) : undefined;

  const merkle = useMemo(() => buildMerkleLevels(block?.txs.map((t) => t.txid) ?? []), [block]);
  const { nodes, edges } = useMemo(() => layoutMerkle(merkle), [merkle]);

  const proofHashes = useMemo(() => {
    if (hoveredLeaf === null || !block) return new Set<string>();
    const proof = merkleProof(block.txs.map((t) => t.txid), hoveredLeaf);
    const set = new Set<string>();
    set.add(block.txs[hoveredLeaf].txid);
    let idx = hoveredLeaf;
    let level = 0;
    for (const step of proof) {
      set.add(step.sibling);
      idx = Math.floor(idx / 2);
      level += 1;
      set.add(merkle.levels[level][idx]);
    }
    return set;
  }, [hoveredLeaf, block, merkle]);

  const hasHighlight = proofHashes.size > 0;
  const scale = bare ? 1.8 : 1;
  const width = merkle.levels[0].length * LEAF_W * scale + 20;
  const height = merkle.levels.length * ROW_H * scale + 20;

  const body = !block ? null : (
    <svg width={Math.max(width, 200)} height={Math.max(height, 100)} style={{ display: 'block', margin: bare ? '0 auto' : undefined }}>
      <g transform={`translate(10,10) scale(${scale})`}>
        {edges.map((e, i) => (
          <line key={i} x1={e.fromX} y1={e.fromY} x2={e.toX} y2={e.toY} stroke="var(--border)" strokeWidth={1 / scale} />
        ))}
        {nodes.map((n) => (
          <MerkleNode
            key={`${n.level}:${n.index}`}
            node={n}
            highlighted={hasHighlight && proofHashes.has(n.hash)}
            dimmed={hasHighlight && !proofHashes.has(n.hash)}
            onHover={(h) => {
              if (n.level !== 0) return;
              setHoveredLeaf(h ? n.index : null);
            }}
          />
        ))}
      </g>
    </svg>
  );

  if (bare) {
    return (
      <div style={{ height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {block && (
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
            {block.hash.slice(0, 8)} · {block.txs.length} tx
          </div>
        )}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {body ?? <span style={{ color: 'var(--text-dim)' }}>—</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="panel" style={{ height: '100%', overflow: 'auto' }}>
      <div className="panel-title">
        {block ? `merkle · ${block.hash.slice(0, 8)} (${block.txs.length} tx)` : 'merkle'}
      </div>
      {body}
    </div>
  );
}
