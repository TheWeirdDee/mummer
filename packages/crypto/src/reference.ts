import { CryptoError } from './errors.js';
import { randomBytes } from './random.js';

/**
 * Gift reference: 80 random bits as 16 Crockford base32 characters plus one
 * check character, shown as MUM-XXXX-XXXX-XXXX-XXXX-C. It goes in the payment
 * memo and is optionally entered by the recipient. It is a LABEL linking a
 * memo to a draw assignment, never proof of payment.
 *
 * The check character is a simple position-weighted sum (odd weights, mod 32):
 * it detects every single-character error and most adjacent transpositions.
 * It is a typo guard, not a cryptographic MAC.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const REFERENCE_DATA_CHARS = 16;

function checkChar(data: string): string {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += ALPHABET.indexOf(data[i]!) * (2 * i + 3);
  return ALPHABET[sum % 32]!;
}

function format(data: string): string {
  const groups = [0, 4, 8, 12].map((i) => data.slice(i, i + 4));
  return `MUM-${groups.join('-')}-${checkChar(data)}`;
}

export function generateReference(): string {
  const bytes = randomBytes(10); // 80 bits
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let data = '';
  for (let i = 0; i < REFERENCE_DATA_CHARS; i++) {
    data = ALPHABET[Number(bits & 31n)]! + data;
    bits >>= 5n;
  }
  return format(data);
}

/**
 * Normalise human input (any case, with or without dashes/spaces/"MUM" prefix,
 * Crockford substitutions I/L->1 and O->0) to the canonical form, verifying
 * the check character. Returns undefined if the input is not a valid reference.
 */
export function normalizeReference(input: string): string | undefined {
  if (typeof input !== 'string' || input.length > 64) return undefined;
  let s = input.toUpperCase().replace(/[\s-]/g, '');
  if (s.startsWith('MUM')) s = s.slice(3);
  s = s.replace(/[IL]/g, '1').replace(/O/g, '0');
  if (s.length !== REFERENCE_DATA_CHARS + 1) return undefined;
  for (const ch of s) if (!ALPHABET.includes(ch)) return undefined;
  const data = s.slice(0, REFERENCE_DATA_CHARS);
  if (checkChar(data) !== s[REFERENCE_DATA_CHARS]) return undefined;
  return format(data);
}

export function requireReference(input: string): string {
  const r = normalizeReference(input);
  if (!r) throw new CryptoError('bad_reference');
  return r;
}
