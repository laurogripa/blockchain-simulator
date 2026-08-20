import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BlockCard } from './BlockCard';
import { useSimStore } from '../../store/useSimStore';
import type { DagNode } from '../../layout/dagLayout';

function makeNode(overrides: Partial<DagNode> = {}): DagNode {
  return {
    hash: 'abc123'.padEnd(64, '0'),
    prevHash: '0'.repeat(64),
    height: 5,
    cumulativeWork: 100,
    txCount: 2,
    minedBy: 'M1',
    timestamp: 0,
    merkleRoot: '0'.repeat(64),
    nonce: 0,
    bits: 20,
    isOrphan: false,
    x: 0,
    y: 0,
    lane: 0,
    ...overrides,
  } as DagNode;
}

// BlockCard renders raw SVG elements (<g>, <rect>, <text>) — must be mounted inside an <svg>.
function renderInSvg(node: DagNode) {
  return render(
    <svg>
      <BlockCard node={node} />
    </svg>,
  );
}

beforeEach(() => {
  useSimStore.setState({ selectedBlock: null, selectedTx: null, inspectedBlock: null });
});

describe('BlockCard', () => {
  it("shows the good seal ('OK') for a valid, connected block", () => {
    renderInSvg(makeNode({ isOrphan: false }));
    expect(screen.getByText('OK')).toBeInTheDocument();
  });

  it("shows the void seal ('VOID') for an orphaned/tampered block", () => {
    renderInSvg(makeNode({ isOrphan: true }));
    expect(screen.getByText('VOID')).toBeInTheDocument();
  });

  it('opens the block modal (selects the block) when clicked', () => {
    const node = makeNode({ hash: 'deadbeef'.padEnd(64, '0') });
    renderInSvg(node);
    fireEvent.click(screen.getByText(`h${node.height}`).closest('g')!);
    expect(useSimStore.getState().selectedBlock).toBe(node.hash);
    expect(useSimStore.getState().inspectedBlock).toBe(node.hash);
  });
});
