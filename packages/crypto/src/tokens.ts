import { base16, base64urlnopad } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { CRYPTO_SIZES } from '@mummer/shared';
import { randomBytes } from './sodium.js';

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
 * Commitment to a gift reference, filed under the RECIPIENT's id. With an
 * 80-bit random reference an offline attacker holding a database dump cannot
 * recover it, so a plain domain-separated SHA-256 suffices (no server secret).
 * Length-prefixed fields make the encoding unambiguous.
 */
export function ackCommitment(groupId: string, recipientId: string, canonicalReference: string): string {
  const fields = ['mummer/ack-commitment/v1', groupId, recipientId, canonicalReference].map((f) => enc.encode(f));
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
