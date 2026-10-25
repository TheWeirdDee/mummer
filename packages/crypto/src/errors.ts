export type CryptoErrorCode =
  | 'bad_key'
  | 'bad_encoding'
  | 'decrypt_failed'
  | 'malformed_payload'
  | 'context_mismatch'
  | 'too_large'
  | 'bad_reference'
  | 'bad_backup'
  | 'weak_passphrase';

/**
 * All failures surface as CryptoError with a stable code. Messages never
 * include key material, plaintext or ciphertext.
 */
export class CryptoError extends Error {
  constructor(
    readonly code: CryptoErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'CryptoError';
  }
}
