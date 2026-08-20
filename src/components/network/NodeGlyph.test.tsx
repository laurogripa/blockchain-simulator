import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodeGlyph } from './NodeGlyph';
import { useSimStore } from '../../store/useSimStore';
import type { MinerView, NodeView } from '../../store/useSimStore';

function makeFullNode(overrides: Partial<NodeView> = {}): NodeView {
  return {
    id: 'N1',
    kind: 'full',
    x: 0,
    y: 0,
    tip: 'a'.repeat(64),
    mempoolSize: 0,
    utxoCount: 0,
    reorgFlashUntil: -1,
    partitioned: false,
    partitionGroup: 0,
    ...overrides,
  };
}

function makeMiner(overrides: Partial<MinerView> = {}): MinerView {
  return {
    ...makeFullNode({ id: 'M1', kind: 'miner' }),
    hashPower: 0.2,
    status: 'idle',
    hashesDone: 0,
    templateTxCount: 0,
    ...overrides,
  };
}

function renderInSvg(node: NodeView | MinerView) {
  return render(
    <svg>
      <NodeGlyph node={node} />
    </svg>,
  );
}

beforeEach(() => {
  useSimStore.setState({ focusedNode: '', inspectedMiner: null });
});

describe('NodeGlyph', () => {
  it('clicking a full node focuses it', () => {
    const node = makeFullNode();
    renderInSvg(node);
    fireEvent.click(screen.getByText('N1').closest('g')!);
    expect(useSimStore.getState().focusedNode).toBe('N1');
    expect(useSimStore.getState().inspectedMiner).toBeNull();
  });

  it('clicking a miner focuses it and opens the miner modal (updates selection)', () => {
    const node = makeMiner();
    renderInSvg(node);
    fireEvent.click(screen.getByText('M1').closest('g')!);
    expect(useSimStore.getState().focusedNode).toBe('M1');
    expect(useSimStore.getState().inspectedMiner).toBe('M1');
  });
});
