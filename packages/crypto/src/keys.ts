import { base64urlnopad } from '@scure/base';
import { CRYPTO_SIZES } from '@mummer/shared';
import { CryptoError } from './errors.js';
import { ready, sodium } from './sodium.js';

export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/** Generate an X25519 key pair (libsodium crypto_box_keypair) from the platform CSPRNG. */
export async function generateKeyPair(): Promise<KeyPair> {
  await ready();
  const kp = sodium().crypto_box_keypair();
  return { publicKey: kp.publicKey, secretKey: kp.privateKey };
}

/** Derive the public key from a secret key, so a link only needs to carry the secret half. */
export function publicKeyFromSecret(secretKey: Uint8Array): Uint8Array {
  assertKey32(secretKey);
  return sodium().crypto_scalarmult_base(secretKey);
}

export function encodeKey(key: Uint8Array): string {
  assertKey32(key);
  return base64urlnopad.encode(key);
}

/** Decode a 32-byte key from unpadded base64url. Rejects any other length or alphabet. */
export function decodeKey(s: string): Uint8Array {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(s)) throw new CryptoError('bad_key', 'Key is not 43 base64url characters');
  let bytes: Uint8Array;
  try {
    bytes = base64urlnopad.decode(s);
  } catch {
    throw new CryptoError('bad_key', 'Key is not valid base64url');
  }
  assertKey32(bytes);
  return bytes;
}

function assertKey32(key: Uint8Array): void {
  if (!(key instanceof Uint8Array) || key.length !== CRYPTO_SIZES.publicKey) throw new CryptoError('bad_key', 'Key must be 32 bytes');
}
