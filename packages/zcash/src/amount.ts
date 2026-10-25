/**
 * Exact monetary arithmetic for ZEC. All amounts are bigint zatoshis
 * (1 ZEC = 100,000,000 zatoshis). Floating-point is never used for value.
 */

export const ZAT_PER_ZEC = 100_000_000n;
export const MAX_ZAT = 21_000_000n * ZAT_PER_ZEC;

export class AmountError extends Error {}

/** Format zatoshis as a ZIP 321 decimal ZEC string with no trailing zeros ("1", "0.0001", "12.5"). */
export function formatZec(zat: bigint): string {
  if (zat < 0n) throw new AmountError('Amount cannot be negative');
  if (zat > MAX_ZAT) throw new AmountError('Amount exceeds the maximum ZEC supply');
  const whole = zat / ZAT_PER_ZEC;
  const frac = (zat % ZAT_PER_ZEC).toString().padStart(8, '0').replace(/0+$/, '');
  return frac.length > 0 ? `${whole}.${frac}` : whole.toString();
}

/** Parse a ZIP 321 `amount` value (1*DIGIT ["." 1*8DIGIT]) to zatoshis. */
export function parseZec(s: string): bigint {
  const m = /^([0-9]+)(?:\.([0-9]{1,8}))?$/.exec(s);
  if (!m) throw new AmountError('Amount is not a valid ZEC decimal with at most 8 decimal places');
  const zat = BigInt(m[1]!) * ZAT_PER_ZEC + BigInt((m[2] ?? '').padEnd(8, '0') || '0');
  if (zat > MAX_ZAT) throw new AmountError('Amount exceeds the maximum ZEC supply');
  return zat;
}

/** Parse a decimal price string (e.g. "31.54") into integer units of 1e-8 USD per ZEC. */
export function parsePrice8(s: string): bigint {
  const m = /^([0-9]{1,9})(?:\.([0-9]{1,8}))?$/.exec(s);
  if (!m) throw new AmountError('Price is not a valid decimal');
  const p = BigInt(m[1]!) * 100_000_000n + BigInt((m[2] ?? '').padEnd(8, '0') || '0');
  if (p <= 0n) throw new AmountError('Price must be positive');
  return p;
}

/** Granularity used when quoting a gift: 4 decimal places of ZEC. */
export const QUOTE_STEP_ZAT = 10_000n;

/**
 * Convert a USD budget in integer cents to zatoshis at a given USD-per-ZEC price,
 * rounded half-up to 4 decimal places of ZEC (the PRD quote granularity), with a
 * floor of one quote step so a gift is never zero.
 *
 *   zat = cents / 100 / price * 1e8 = cents * 1e14 / price8   (price8 = price * 1e8)
 */
export function usdCentsToZat(cents: number, priceUsdPerZec: string): bigint {
  if (!Number.isInteger(cents) || cents <= 0) throw new AmountError('Budget must be a positive whole number of cents');
  const price8 = parsePrice8(priceUsdPerZec);
  const num = BigInt(cents) * 100_000_000_000_000n;
  const raw = (num * 2n + price8) / (price8 * 2n); // round half up
  const stepped = ((raw + QUOTE_STEP_ZAT / 2n) / QUOTE_STEP_ZAT) * QUOTE_STEP_ZAT;
  const out = stepped < QUOTE_STEP_ZAT ? QUOTE_STEP_ZAT : stepped;
  if (out > MAX_ZAT) throw new AmountError('Amount exceeds the maximum ZEC supply');
  return out;
}
