import { base16, base64urlnopad } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { CRYPTO_SIZES } from '@mummer/shared';
import { randomBytes } from './random.js';

const enc = new TextEncoder();

/** 256-bit random bearer token, unpadded base64url (43 characters). Distinct from any encryption key. */
export function generateToken(): string {
  return base64urlnopad.encode(randomBytes(CRYPTO_SIZES.token));
}

/** 128-bit random opaque id as 32 lowercase hex characters. */
export function generateId(): string {
  return base16.encode(randomBytes(CRYPTO_SIZES.idBytes)).toLowerCase();
}

export function isToken(s: unknown): s is string {
  return typeof s === 'string' && /^[A-Za-z0-9_-]{43}$/.test(s);
}

/** SHA-256 of the token string, lowercase hex. The server stores only this. */
export function hashToken(token: string): string {
  return base16.encode(sha256(enc.encode(token))).toLowerCase();
}

/** Constant-time comparison of two equal-length strings (no early exit on the first difference). */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

/**
 * Fingerprint of a member's registered receiving address, stored in the clear next to the member and checked by
 * the GIVER against the address inside their sealed assignment. Because the host authors assignments, this stops a
 * malicious host from silently swapping in a different address: the host cannot change what the server holds for
 * the member. (An operator who controls the server could change both: see docs/THREAT_MODEL.md.)
 * A fresh shielded address contains ~255 bits of key material, so the hash is not guessable; it can only confirm a
 * candidate address someone already has. Bound to the group and nickname so it cannot be replayed elsewhere.
 */
export function addressCommitment(groupId: string, pseudonym: string, address: string): string {
  return lengthPrefixedHash(['mummer/address-commitment/v1', groupId, pseudonym.normalize('NFC'), address]);
}

/**
 * Commitment to a gift reference, filed under the RECIPIENT's id. With an
 * 80-bit random reference an offline attacker holding a database dump cannot
 * recover it, so a plain domain-separated SHA-256 suffices (no server secret).
 * Length-prefixed fields make the encoding unambiguous.
 */
export function ackCommitment(groupId: string, recipientId: string, canonicalReference: string): string {
  return lengthPrefixedHash(['mummer/ack-commitment/v1', groupId, recipientId, canonicalReference]);
}

/** SHA-256 over 16-bit-length-prefixed UTF-8 fields: an unambiguous encoding. */
function lengthPrefixedHash(parts: string[]): string {
  const fields = parts.map((f) => enc.encode(f));
  const total = fields.reduce((n, f) => n + 2 + f.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const f of fields) {
    buf[o++] = (f.length >> 8) & 0xff;
    buf[o++] = f.length & 0xff;
    buf.set(f, o);
    o += f.length;
  }
  return base16.encode(sha256(buf)).toLowerCase();
}
