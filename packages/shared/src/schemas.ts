import { z } from 'zod';
import { LIMITS } from './constants.js';
import { addDays, daysBetween, isValidDate, isValidTimezone } from './time.js';

/**
 * Request and sealed-payload schemas. These are the validation boundary for
 * the API (all untrusted input) and for opened ciphertexts in the browser.
 */

function hasControlCharacter(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f) || c === 0x2028 || c === 0x2029) return true;
    // Zero-width and bidirectional-override characters can make one name look like another (or reorder text): refuse them.
    if ((c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2060 && c <= 0x2064) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff) return true;
  }
  return false;
}

const codepointLength = (s: string) => [...s].length;

/** Text field: NFC-normalized, trimmed, length counted in code points, no control characters. */
export const cleanText = (min: number, max: number, label: string) =>
  z
    .string()
    .max(max * 8, `${label} is too long`)
    .transform((s) => s.normalize('NFC').trim())
    .pipe(
      z
        .string()
        .refine((s) => codepointLength(s) >= min, `${label} must be at least ${min} characters`)
        .refine((s) => codepointLength(s) <= max, `${label} must be at most ${max} characters`)
        .refine((s) => !hasControlCharacter(s), `${label} contains characters that are not allowed`),
    );

/** Optional multi-line text (wishlists): newlines allowed, other control characters not. */
export const cleanMultiline = (max: number, label: string) =>
  z
    .string()
    .max(max * 8, `${label} is too long`)
    .transform((s) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim())
    .pipe(
      z
        .string()
        .refine((s) => codepointLength(s) <= max, `${label} must be at most ${max} characters`)
        .refine((s) => ![...s].some((ch) => ch !== '\n' && hasControlCharacter(ch)), `${label} contains characters that are not allowed`),
    );

/** A sealed profile or bundle: base64url of exactly one fixed ciphertext length (see LIMITS.sealedChars). */
export const sealedB64 = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, 'must be base64url')
  .length(LIMITS.sealedChars, 'Your copy of Mummer is out of date. Reload the page and try again.');

export const b64url = (minChars: number, maxChars: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/, 'must be base64url')
    .min(minChars)
    .max(maxChars);

/** 32-byte value, unpadded base64url = 43 characters. */
export const key32 = b64url(43, 43);
export const hex64 = z.string().regex(/^[0-9a-f]{64}$/, 'must be 64 lowercase hex characters');
export const id32 = z.string().regex(/^[0-9a-f]{32}$/, 'must be a 32-character id');
export const isoDate = z.string().refine(isValidDate, 'must be a valid YYYY-MM-DD date');
export const timezone = z.string().refine(isValidTimezone, 'must be a valid IANA timezone');

/** Gift reference as typed or pasted by a person: tolerant of case and missing dashes. Canonicalized by @mummer/crypto. */
export const referenceInput = z.string().min(8).max(64);

const humanTicket = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/).optional();

export const createGroupBody = z
  .object({
    title: cleanText(LIMITS.titleMin, LIMITS.titleMax, 'Group name'),
    budgetCents: z.number().int().min(LIMITS.budgetMinCents).max(LIMITS.budgetMaxCents),
    joinDeadline: isoDate,
    revealDate: isoDate,
    timezone,
    memberCap: z.number().int().min(LIMITS.memberCapMin).max(LIMITS.memberCapMax),
    hostPlays: z.boolean(),
    hostPublicKey: key32,
    adminTokenHash: hex64,
    humanTicket,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!isValidDate(v.joinDeadline) || !isValidDate(v.revealDate)) return;
    const gap = daysBetween(v.joinDeadline, v.revealDate);
    if (gap < LIMITS.revealMinGapDays) {
      ctx.addIssue({ code: 'custom', path: ['revealDate'], message: `Reveal date must be at least ${LIMITS.revealMinGapDays} day after the join deadline` });
    }
    if (addDays(v.joinDeadline, 0) !== v.joinDeadline) ctx.addIssue({ code: 'custom', path: ['joinDeadline'], message: 'Invalid date' });
  });
export type CreateGroupBody = z.infer<typeof createGroupBody>;

export const joinBody = z
  .object({
    pseudonym: cleanText(LIMITS.pseudonymMin, LIMITS.pseudonymMax, 'Display name'),
    publicKey: key32,
    tokenHash: hex64,
    sealedProfile: sealedB64,
    /** SHA-256 fingerprint of the registered address; givers check their assignment against it (see addressCommitment). */
    addressCommitment: hex64,
    humanTicket,
  })
  .strict();
export type JoinBody = z.infer<typeof joinBody>;

export const drawBody = z
  .object({
    drawVersion: z.number().int().min(1).max(1000),
    /** The member-list version the host's browser read with the profiles; the draw is refused if it has moved. */
    membersVersion: z.number().int().min(0).max(1_000_000),
    closeEarly: z.boolean().optional(),
    bundles: z
      .array(z.object({ memberId: id32, sealedBundle: sealedB64 }).strict())
      .min(LIMITS.minMembersToDraw)
      .max(LIMITS.memberCapMax),
    commitments: z
      .array(z.object({ memberId: id32, commitment: hex64 }).strict())
      .min(LIMITS.minMembersToDraw)
      .max(LIMITS.memberCapMax),
  })
  .strict();
export type DrawBody = z.infer<typeof drawBody>;

export const sentBody = z.object({ drawVersion: z.number().int().min(1).max(1000) }).strict();
export type SentBody = z.infer<typeof sentBody>;

export const ackBody = z
  .object({
    drawVersion: z.number().int().min(1).max(1000),
    outcome: z.enum(['received', 'problem']),
    reference: referenceInput.optional(),
  })
  .strict()
  .refine((v) => v.outcome === 'received' || v.reference === undefined, { message: 'A reference can only accompany a receipt', path: ['reference'] });
export type AckBody = z.infer<typeof ackBody>;

export const revealBody = z
  .object({
    drawVersion: z.number().int().min(1).max(1000),
    recipientId: id32,
    reference: referenceInput,
    audience: z.enum(['recipient', 'group']),
  })
  .strict();
export type RevealBody = z.infer<typeof revealBody>;

export const rotateBody = z
  .object({
    newTokenHash: hex64,
    newPublicKey: key32,
    newSealedBundle: sealedB64.optional(),
    /** The draw version of the bundle that was re-sealed. Required with newSealedBundle so an old bundle can never overwrite a newer draw's. */
    drawVersion: z.number().int().min(1).max(1000).optional(),
  })
  .strict();
export type RotateBody = z.infer<typeof rotateBody>;

export const TRANSITION_ACTIONS = ['lock', 'reopen', 'reset_draw', 'flag_resolution', 'clear_resolution', 'close'] as const;
export const transitionBody = z.object({ action: z.enum(TRANSITION_ACTIONS) }).strict();
export type TransitionBody = z.infer<typeof transitionBody>;

/** Host changes the dates before the draw (for example to give a small group more time). */
export const extendBody = z.object({ joinDeadline: isoDate, revealDate: isoDate }).strict();
export type ExtendBody = z.infer<typeof extendBody>;

export const humanVerifyBody = z.object({ token: z.string().min(1).max(4096) }).strict();

/* ---------- Sealed payloads (opened only in browsers) ---------- */

/** Address is validated separately by @mummer/zcash; here it is only bounded. */
const addressField = z.string().min(20).max(1000);

export const profilePlain = z
  .object({
    v: z.literal(1),
    kind: z.literal('profile'),
    groupId: id32,
    pseudonym: cleanText(LIMITS.pseudonymMin, LIMITS.pseudonymMax, 'Display name'),
    wishlist: cleanMultiline(LIMITS.wishlistMax, 'Wishlist'),
    address: addressField,
  })
  .strict();
export type ProfilePlain = z.infer<typeof profilePlain>;

export const bundlePlain = z
  .object({
    v: z.literal(1),
    kind: z.literal('assignment'),
    groupId: id32,
    drawVersion: z.number().int().min(1).max(1000),
    giverId: id32,
    recipient: z
      .object({
        memberId: id32,
        pseudonym: cleanText(LIMITS.pseudonymMin, LIMITS.pseudonymMax, 'Display name'),
        wishlist: cleanMultiline(LIMITS.wishlistMax, 'Wishlist'),
        address: addressField,
      })
      .strict(),
    /** Canonical gift reference to place in the payment memo. */
    reference: z.string().min(20).max(40),
    budgetCents: z.number().int().min(LIMITS.budgetMinCents).max(LIMITS.budgetMaxCents),
  })
  .strict();
export type BundlePlain = z.infer<typeof bundlePlain>;

/* ---------- Response shapes (documented contract; used by the web client) ---------- */

export interface InviteView {
  groupId: string;
  title: string;
  budgetCents: number;
  joinDeadline: string;
  revealDate: string;
  timezone: string;
  memberCap: number;
  hostPlays: boolean;
  hostPublicKey: string;
  state: string;
  joinOpen: boolean;
  spotsLeft: number;
  joinClosesAt: string;
}

export interface RosterEntry {
  id: string;
  pseudonym: string;
  status: string;
  /** Fingerprint of the address this member registered (see addressCommitment). Empty for members who joined before it existed. */
  addressCommitment: string;
}

/** Aggregate-only progress: never per-member, so counts cannot reveal who gave to whom. */
export interface ProgressView {
  ready: number;
  assigned: number;
  reportedSent: number;
  acknowledged: number;
  needsAttention: number;
}

export interface MeView {
  id: string;
  pseudonym: string;
  status: string;
  senderState: string;
  recipientState: string;
  hasAssignment: boolean;
}

export interface GroupView {
  group: {
    id: string;
    title: string;
    budgetCents: number;
    joinDeadline: string;
    revealDate: string;
    timezone: string;
    memberCap: number;
    hostPlays: boolean;
    hostPublicKey: string;
    state: string;
    drawVersion: number;
    revealOpensAt: string;
    revealOpen: boolean;
    joinClosesAt: string;
    expiresAt: string;
  };
  role: 'admin' | 'member';
  roster: RosterEntry[];
  progress: ProgressView;
  me?: MeView;
}

export interface RevealView {
  giverId: string;
  recipientId: string;
  audience: string;
  confirmedByRecipient: boolean;
  declaredDay: string;
}
