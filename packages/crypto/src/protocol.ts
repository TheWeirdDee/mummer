import { bundlePlain, profilePlain, type BundlePlain, type ProfilePlain } from '@mummer/shared';
import { CryptoError } from './errors.js';
import { openPayload, sealPayload } from './seal.js';
import { ackCommitment } from './tokens.js';
import { generateReference } from './reference.js';

/**
 * Protocol helpers that bind sealed payloads to their context (kind, group,
 * draw version, member), since sealed boxes themselves are anonymous.
 */

/* ---------- Profiles (member -> host) ---------- */

export function sealProfile(profile: ProfilePlain, hostPublicKeyB64: string): string {
  return sealPayload(profilePlain.parse(profile), hostPublicKeyB64);
}

export function openProfile(sealed: string, hostPublicKey: Uint8Array, hostSecretKey: Uint8Array, expect: { groupId: string; pseudonym?: string }): ProfilePlain {
  const p = openPayload(sealed, hostPublicKey, hostSecretKey, profilePlain);
  if (p.groupId !== expect.groupId) throw new CryptoError('context_mismatch', 'Profile belongs to a different group');
  if (expect.pseudonym !== undefined && p.pseudonym !== expect.pseudonym) throw new CryptoError('context_mismatch', 'Profile name does not match its member');
  return p;
}

/* ---------- Draw packaging (host) ---------- */

export interface DrawMemberInput {
  id: string;
  publicKey: string;
  profile: ProfilePlain;
}

export interface DrawPayload {
  bundles: { memberId: string; sealedBundle: string }[];
  commitments: { memberId: string; commitment: string }[];
}

/**
 * Seal one bundle per giver (to the giver's public key) and compute one
 * commitment per recipient. Both arrays are sorted by member id, a canonical
 * order independent of the draw cycle, so neither list's order (nor database
 * insertion order) correlates a giver with a recipient.
 */
export function buildDrawPayload(input: {
  groupId: string;
  drawVersion: number;
  budgetCents: number;
  members: readonly DrawMemberInput[];
  /** giver id -> recipient id */
  assignments: Readonly<Record<string, string>>;
}): DrawPayload {
  const byId = new Map(input.members.map((m) => [m.id, m]));
  if (byId.size !== input.members.length) throw new CryptoError('malformed_payload', 'Duplicate member ids');
  const bundles: DrawPayload['bundles'] = [];
  const commitments: DrawPayload['commitments'] = [];

  for (const giver of input.members) {
    const recipientId = input.assignments[giver.id];
    const recipient = recipientId === undefined ? undefined : byId.get(recipientId);
    if (!recipient || recipient.id === giver.id) throw new CryptoError('malformed_payload', 'Invalid assignment');
    const reference = generateReference();
    const bundle: BundlePlain = {
      v: 1,
      kind: 'assignment',
      groupId: input.groupId,
      drawVersion: input.drawVersion,
      giverId: giver.id,
      recipient: {
        memberId: recipient.id,
        pseudonym: recipient.profile.pseudonym,
        wishlist: recipient.profile.wishlist,
        address: recipient.profile.address,
      },
      reference,
      budgetCents: input.budgetCents,
    };
    bundles.push({ memberId: giver.id, sealedBundle: sealPayload(bundlePlain.parse(bundle), giver.publicKey) });
    commitments.push({ memberId: recipient.id, commitment: ackCommitment(input.groupId, recipient.id, reference) });
  }
  const byMemberId = (a: { memberId: string }, b: { memberId: string }) => (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0);
  bundles.sort(byMemberId);
  commitments.sort(byMemberId);
  return { bundles, commitments };
}

/* ---------- Assignment (giver) ---------- */

export function openAssignment(
  sealed: string,
  publicKey: Uint8Array,
  secretKey: Uint8Array,
  expect: { groupId: string; memberId: string; drawVersion: number },
): BundlePlain {
  const b = openPayload(sealed, publicKey, secretKey, bundlePlain);
  if (b.groupId !== expect.groupId) throw new CryptoError('context_mismatch', 'Assignment belongs to a different group');
  if (b.giverId !== expect.memberId) throw new CryptoError('context_mismatch', 'Assignment belongs to a different member');
  if (b.drawVersion !== expect.drawVersion) throw new CryptoError('context_mismatch', 'Assignment is from a different draw');
  return b;
}

/** Re-seal an assignment to a new public key (used when a member rotates a compromised link). */
export function resealAssignment(bundle: BundlePlain, newPublicKeyB64: string): string {
  return sealPayload(bundlePlain.parse(bundle), newPublicKeyB64);
}
