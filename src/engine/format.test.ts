import { describe, expect, it } from 'vitest';
import { formatSats } from './format';

describe('formatSats', () => {
  it('formats the base coinbase subsidy as 50 BTC', () => {
    expect(formatSats(5_000_000_000)).toBe('5,000,000,000 sats (50 BTC)');
  });

  it('formats a halved subsidy cleanly', () => {
    expect(formatSats(2_500_000_000)).toBe('2,500,000,000 sats (25 BTC)');
  });

  it('shows fractional BTC for subsidy + fees without trailing zero noise', () => {
    expect(formatSats(5_000_012_345)).toBe('5,000,012,345 sats (50.00012345 BTC)');
  });

  it('formats zero as 0 BTC', () => {
    expect(formatSats(0)).toBe('0 sats (0 BTC)');
  });
});
