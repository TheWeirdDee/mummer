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
 * Every plaintext is padded to ONE fixed size (ISO/IEC 7816-4 via sodium.pad), so every sealed profile and every sealed assignment
 * bundle has exactly the same length no matter what it contains. Padding to a coarse bucket (256 bytes, as before) is not enough: a
 * bundle carries the recipient's nickname, wishlist and address, so its length tracks the recipient's profile length, and anyone who
 * sees stored lengths (the database, the operator) can match givers to recipients. The fixed size is larger than the worst-case
 * payload the schemas allow (see crypto.test.ts), and anything bigger is rejected rather than falling into a larger bucket.
 */

export const SEAL_OVERHEAD_BYTES = 48; // crypto_box_SEALBYTES
/** Every sealed payload's plaintext is padded to exactly this many bytes. */
export const PAD_BLOCK = 4_096;
/** One byte of the block is the 0x80 padding marker, so the payload itself must be shorter than the block. */
export const MAX_PLAINTEXT_BYTES = PAD_BLOCK - 1;
/** The only ciphertext length that is ever produced or accepted. */
export const SEALED_BYTES = PAD_BLOCK + SEAL_OVERHEAD_BYTES;

export function sealBytes(plaintext: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
  if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new CryptoError('too_large');
  const padded = sodium().pad(plaintext, PAD_BLOCK);
  return sodium().crypto_box_seal(padded, recipientPublicKey);
}

export function openBytes(sealed: Uint8Array, publicKey: Uint8Array, secretKey: Uint8Array): Uint8Array {
  if (sealed.length !== SEALED_BYTES) throw new CryptoError('malformed_payload');
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
  if (typeof sealedB64 !== 'string' || !/^[A-Za-z0-9_-]+$/.test(sealedB64) || sealedB64.length > 8_192) throw new CryptoError('bad_encoding');
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
