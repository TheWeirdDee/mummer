/** Product limits shared by the API (enforcement) and the web app (UX). */

export const LIMITS = {
  titleMin: 3,
  titleMax: 60,
  pseudonymMin: 2,
  pseudonymMax: 32,
  wishlistMax: 280,
  noteMaxBytes: 400,
  budgetMinCents: 500,
  budgetMaxCents: 25_000,
  budgetSuggestedMinCents: 500,
  budgetSuggestedMaxCents: 5_000,
  memberCapMin: 4,
  memberCapMax: 50,
  memberCapDefault: 20,
  minMembersToDraw: 4,
  recommendedMembers: 5,
  /** Maximum days between today and the join deadline. */
  joinDeadlineMaxDays: 90,
  /** Maximum days between today and the reveal date. */
  revealMaxDays: 180,
  /** Reveal date must be at least this many days after the join deadline. */
  revealMinGapDays: 1,
  /** Groups are purged this many days after the reveal date. */
  retentionDaysAfterReveal: 30,
  /** Encoded sizes (base64url characters). */
  sealedProfileMaxChars: 8_192,
  sealedBundleMaxChars: 12_288,
  /** Wrong-reference attempts allowed per recipient per hour. */
  ackAttemptsPerHour: 10,
} as const;

/** Byte lengths of cryptographic values. */
export const CRYPTO_SIZES = {
  publicKey: 32,
  secretKey: 32,
  token: 32,
  idBytes: 16,
  sha256: 32,
} as const;

export const API_ERROR_CODES = [
  'bad_request',
  'validation_failed',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'invalid_state',
  'rate_limited',
  'human_check_failed',
  'group_full',
  'join_closed',
  'duplicate_pseudonym',
  'draw_already_done',
  'draw_mismatch',
  'reveal_not_open',
  'reference_mismatch',
  'payload_too_large',
  'quote_unavailable',
  'internal',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
