import { base64urlnopad } from '@scure/base';
import type { ZodType } from 'zod';
import { CryptoError } from './errors.js';
import { decodeKey, encodeKey } from './keys.js';
import { sodium } from './sodium.js';

/**
 * Anonymous public-key encryption with libsodium sealed boxes
 * (crypto_box_seal: X25519 + XSalsa20-Poly1305, ephemeral sender key).
 *
 * A sealed box authenticates the ciphertext to the ciphertext's own
 * ephemeral key only; ANYONE who knows the recipient's public key can create
 * one. Integrity of "who sealed this" therefore comes from context fields
 * inside the plaintext (kind, group id, draw version, member id), which every
 * opener checks. See docs/CRYPTOGRAPHIC_DESIGN.md.
 *
 * Plaintexts are padded (ISO/IEC 7816-4 via sodium.pad) to a block size so
 * the stored blob length reveals less about the profile or address.
 */

export const SEAL_OVERHEAD_BYTES = 48; // crypto_box_SEALBYTES
export const PAD_BLOCK = 256;
const MAX_PLAINTEXT_BYTES = 8_192;

export function sealBytes(plaintext: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
  if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new CryptoError('too_large');
  const padded = sodium().pad(plaintext, PAD_BLOCK);
  return sodium().crypto_box_seal(padded, recipientPublicKey);
}

export function openBytes(sealed: Uint8Array, publicKey: Uint8Array, secretKey: Uint8Array): Uint8Array {
  if (sealed.length < SEAL_OVERHEAD_BYTES + PAD_BLOCK || sealed.length > MAX_PLAINTEXT_BYTES + SEAL_OVERHEAD_BYTES + PAD_BLOCK) {
    throw new CryptoError('malformed_payload');
  }
  let padded: Uint8Array;
  try {
    padded = sodium().crypto_box_seal_open(sealed, publicKey, secretKey);
  } catch {
    throw new CryptoError('decrypt_failed');
  }
  try {
    return sodium().unpad(padded, PAD_BLOCK);
  } catch {
    throw new CryptoError('malformed_payload');
  }
}

/** Seal a JSON-serialisable payload to a recipient public key (base64url in, base64url out). */
export function sealPayload(payload: unknown, recipientPublicKeyB64: string): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  return base64urlnopad.encode(sealBytes(bytes, decodeKey(recipientPublicKeyB64)));
}

/**
 * Open and validate a sealed payload. Any malformed, truncated, tampered or
 * wrong-key input fails with a CryptoError; the schema is applied to the
 * decrypted JSON so a well-formed ciphertext with unexpected content is
 * rejected too.
 */
export function openPayload<T>(sealedB64: string, publicKey: Uint8Array, secretKey: Uint8Array, schema: ZodType<T>): T {
  if (typeof sealedB64 !== 'string' || !/^[A-Za-z0-9_-]+$/.test(sealedB64) || sealedB64.length > 16_384) throw new CryptoError('bad_encoding');
  let sealed: Uint8Array;
  try {
    sealed = base64urlnopad.decode(sealedB64);
  } catch {
    throw new CryptoError('bad_encoding');
  }
  const plain = openBytes(sealed, publicKey, secretKey);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(plain));
  } catch {
    throw new CryptoError('malformed_payload');
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new CryptoError('malformed_payload');
  return result.data;
}

export { encodeKey };
