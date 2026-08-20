export const ADDRESSES = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

export const ADDRESS_COLORS: Record<string, string> = {
  A: '#ff6b6b',
  B: '#4dabf7',
  C: '#69db7c',
  D: '#ffd43b',
  E: '#da77f2',
  F: '#ff922b',
};

export const MINER_COLORS: Record<string, string> = {
  M1: '#e64980',
  M2: '#22b8cf',
  M3: '#94d82d',
  M4: '#f76707',
  M5: '#7950f2',
};

// Difficulty: ~20 leading zero bits => expected 2^20 hashes per block.
export const DIFFICULTY_BITS = 20;
export const EXPECTED_HASHES = 2 ** DIFFICULTY_BITS;

// Sim-ms for one block at speed=1 (i.e. "real" pace baseline used for hashrate budget math).
export const TARGET_BLOCK_TIME_SIM_MS = 600_000; // 600s, like Bitcoin's 10 min scaled down 1:1 at speed 1

export const MAX_TXS_PER_BLOCK = 8; // including coinbase
export const COINBASE_VALUE = 5_000_000_000; // sats, arbitrary

export const PROPAGATION_STRETCH = 20; // deviation from real timing, keeps packets watchable at 100x

export const MAX_EVENTS_PER_FRAME = 500;
export const MAX_DT_REAL_MS = 100;

export const LOG_RING_SIZE = 200;

export function targetHexForBits(bits: number): string {
  // A 256-bit target with `bits` leading zero bits, expressed as 64 hex chars.
  const totalHexChars = 64;
  const zeroHexChars = Math.floor(bits / 4);
  const remainderBits = bits % 4;
  // first non-zero hex digit encodes the remaining <4 bits of zero-ness
  const firstDigitMax = 0xf >> remainderBits;
  const firstDigit = firstDigitMax.toString(16);
  const rest = 'f'.repeat(totalHexChars - zeroHexChars - 1);
  return '0'.repeat(zeroHexChars) + firstDigit + rest;
}

export function workOfBits(bits: number): number {
  // Relative work ~ 2^bits (difficulty proxy).
  return 2 ** bits;
}
