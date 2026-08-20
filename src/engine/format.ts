export const SATS_PER_BTC = 100_000_000;

/** "5,000,000,000 sats (50 BTC)" — pairs the raw unit with the human one so a value like the
 *  coinbase subsidy (or subsidy+fees) doesn't read as an arbitrary number. */
export function formatSats(value: number): string {
  const btc = (value / SATS_PER_BTC).toFixed(8).replace(/\.?0+$/, '') || '0';
  return `${value.toLocaleString()} sats (${btc} BTC)`;
}
