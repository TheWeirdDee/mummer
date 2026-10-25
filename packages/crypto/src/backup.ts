import { base64urlnopad } from '@scure/base';
import { argon2id } from '@noble/hashes/argon2.js';
import { z } from 'zod';
import { CryptoError } from './errors.js';
import { decodeKey, encodeKey } from './keys.js';
import { isToken } from './tokens.js';
import { randomBytes, sodium, wipe } from './sodium.js';

/**
 * Passphrase-sealed backup of a private link's secrets (key + token), so a lost
 * link can be restored. argon2id (audited @noble/hashes) derives a 256-bit key
 * from the passphrase; libsodium secretbox (XSalsa20-Poly1305) encrypts.
 *
 * Format: "MUMBK1." + base64url( salt(16) || nonce(24) || ciphertext ).
 * Parameters are fixed by the format version. The passphrase never leaves the
 * browser; if it is forgotten the backup cannot be recovered.
 */

export const BACKUP_PREFIX = 'MUMBK1.';
export const MIN_PASSPHRASE_CHARS = 10;

/** argon2id: 32 MiB, 3 passes, 1 lane (about 1 s on a mid-range phone in JavaScript). */
const ARGON = { t: 3, m: 32 * 1024, p: 1, dkLen: 32 } as const;

export const backupContents = z
  .object({
    v: z.literal(1),
    kind: z.literal('mummer-backup'),
    role: z.enum(['admin', 'member']),
    groupId: z.string().regex(/^[0-9a-f]{32}$/),
    memberId: z.string().regex(/^[0-9a-f]{32}$/).optional(),
    secretKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict()
  .refine((v) => (v.role === 'member') === (v.memberId !== undefined), { message: 'member backups need a member id' });
export type BackupContents = z.infer<typeof backupContents>;

function deriveKey(passphrase: string, salt: Uint8Array): Uint8Array {
  return argon2id(new TextEncoder().encode(passphrase.normalize('NFKC')), salt, ARGON);
}

export function checkPassphrase(passphrase: string): void {
  if ([...passphrase.normalize('NFKC')].length < MIN_PASSPHRASE_CHARS) throw new CryptoError('weak_passphrase');
}

export function sealBackup(contents: BackupContents, passphrase: string): string {
  checkPassphrase(passphrase);
  const parsed = backupContents.parse(contents);
  decodeKey(parsed.secretKey);
  if (!isToken(parsed.token)) throw new CryptoError('bad_backup');
  const s = sodium();
  const salt = randomBytes(16);
  const nonce = randomBytes(s.crypto_secretbox_NONCEBYTES);
  const key = deriveKey(passphrase, salt);
  try {
    const box = s.crypto_secretbox_easy(new TextEncoder().encode(JSON.stringify(parsed)), nonce, key);
    const out = new Uint8Array(salt.length + nonce.length + box.length);
    out.set(salt, 0);
    out.set(nonce, salt.length);
    out.set(box, salt.length + nonce.length);
    return BACKUP_PREFIX + base64urlnopad.encode(out);
  } finally {
    wipe(key);
  }
}

export function openBackup(backup: string, passphrase: string): BackupContents {
  if (typeof backup !== 'string' || !backup.startsWith(BACKUP_PREFIX) || backup.length > 4096) throw new CryptoError('bad_backup');
  let raw: Uint8Array;
  try {
    raw = base64urlnopad.decode(backup.slice(BACKUP_PREFIX.length).trim());
  } catch {
    throw new CryptoError('bad_backup');
  }
  const s = sodium();
  if (raw.length < 16 + s.crypto_secretbox_NONCEBYTES + s.crypto_secretbox_MACBYTES + 1) throw new CryptoError('bad_backup');
  const salt = raw.subarray(0, 16);
  const nonce = raw.subarray(16, 16 + s.crypto_secretbox_NONCEBYTES);
  const box = raw.subarray(16 + s.crypto_secretbox_NONCEBYTES);
  const key = deriveKey(passphrase, salt);
  try {
    let plain: Uint8Array;
    try {
      plain = s.crypto_secretbox_open_easy(box, nonce, key);
    } catch {
      // Wrong passphrase and tampering are indistinguishable by design.
      throw new CryptoError('decrypt_failed');
    }
    try {
      return backupContents.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(plain)));
    } catch {
      throw new CryptoError('bad_backup');
    }
  } finally {
    wipe(key);
  }
}

export { encodeKey };
