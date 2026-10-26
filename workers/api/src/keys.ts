import { x25519 } from '@noble/curves/ed25519.js';
import { base64urlnopad } from '@scure/base';

/**
 * A member's public key is used by the host's browser to seal their assignment. A malformed or low-order key
 * (all zeros, the order-4 and order-8 points, non-canonical encodings) makes sealing throw for the whole draw,
 * so one anonymous member could block it. Reject such keys at the door.
 *
 * A key is usable if an X25519 exchange with a fresh scalar does not produce an invalid or all-zero result
 * (the @noble/curves implementation rejects those inputs).
 */
export function isUsableX25519PublicKey(b64: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(b64)) return false;
  let pk: Uint8Array;
  try {
    pk = base64urlnopad.decode(b64);
  } catch {
    return false;
  }
  if (pk.length !== 32) return false;
  try {
    const scalar = new Uint8Array(32);
    scalar[0] = 9; // any fixed valid scalar: only the point is under test
    scalar[31] = 64;
    const shared = x25519.getSharedSecret(scalar, pk);
    return shared.some((b) => b !== 0);
  } catch {
    return false;
  }
}

/** True for D1 uniqueness / foreign-key / check failures; anything else is a real fault and must surface as a 500. */
export function isConstraintError(e: unknown): boolean {
  const m = String((e as { message?: string })?.message ?? '');
  return /UNIQUE|constraint|FOREIGN KEY/i.test(m);
}
