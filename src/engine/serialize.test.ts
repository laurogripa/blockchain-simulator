import { describe, expect, it } from 'vitest';
import { serializeHeader, serializeTx } from './serialize';
import type { BlockHeader, Transaction } from './types';

describe('serializeTx', () => {
  const base: Omit<Transaction, 'txid'> = {
    inputs: [{ txid: 'a'.repeat(64), vout: 0 }],
    outputs: [{ address: 'A', value: 100 }],
    fee: 5,
    size: 150,
    isCoinbase: false,
    createdAt: 1000,
  };

  it('is deterministic for identical input', () => {
    expect(serializeTx(base)).toBe(serializeTx({ ...base }));
  });

  it('changes when any field changes', () => {
    const s0 = serializeTx(base);
    expect(serializeTx({ ...base, fee: 6 })).not.toBe(s0);
    expect(serializeTx({ ...base, size: 151 })).not.toBe(s0);
    expect(serializeTx({ ...base, createdAt: 1001 })).not.toBe(s0);
    expect(serializeTx({ ...base, isCoinbase: true })).not.toBe(s0);
    expect(serializeTx({ ...base, outputs: [{ address: 'B', value: 100 }] })).not.toBe(s0);
    expect(
      serializeTx({ ...base, inputs: [{ txid: 'b'.repeat(64), vout: 0 }] }),
    ).not.toBe(s0);
  });
});

describe('serializeHeader', () => {
  const base: BlockHeader = {
    version: 1,
    prevHash: '0'.repeat(64),
    merkleRoot: 'f'.repeat(64),
    timestamp: 0,
    bits: 20,
    nonce: 0,
  };

  it('is deterministic for identical input', () => {
    expect(serializeHeader(base)).toBe(serializeHeader({ ...base }));
  });

  it('changes when nonce changes (mining depends on this)', () => {
    expect(serializeHeader({ ...base, nonce: 1 })).not.toBe(serializeHeader(base));
  });

  it('changes when any header field changes', () => {
    const s0 = serializeHeader(base);
    expect(serializeHeader({ ...base, version: 2 })).not.toBe(s0);
    expect(serializeHeader({ ...base, prevHash: '1'.repeat(64) })).not.toBe(s0);
    expect(serializeHeader({ ...base, merkleRoot: '2'.repeat(64) })).not.toBe(s0);
    expect(serializeHeader({ ...base, timestamp: 1 })).not.toBe(s0);
    expect(serializeHeader({ ...base, bits: 21 })).not.toBe(s0);
  });
});
