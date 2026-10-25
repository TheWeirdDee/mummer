/**
 * State machines. Every transition is validated here and again, atomically,
 * in SQL (compare-and-swap on the current state) at the API.
 *
 * Group:   open -> locked -> drawn -> active -> closed -> deleted
 *          plus needs_resolution (manual exception handling) and the
 *          redraw loop drawn -> locked. `reveal_eligible` is DERIVED from the
 *          clock (see revealEligible) rather than stored, so no cron job is
 *          needed for the reveal date to take effect.
 *
 * Sender state and recipient state are SEPARATE dimensions because every
 * member both gives and receives; one enum would conflate them.
 */

export const GROUP_STATES = ['open', 'locked', 'drawn', 'active', 'needs_resolution', 'closed'] as const;
export type GroupState = (typeof GROUP_STATES)[number];

export const MEMBER_STATUSES = ['ready', 'assigned', 'removed', 'revoked'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const SENDER_STATES = ['not_started', 'user_reports_sent'] as const;
export type SenderState = (typeof SENDER_STATES)[number];

/** `externally_verified` is intentionally absent: no verification scheme ships in this release. */
export const RECIPIENT_STATES = ['not_acknowledged', 'recipient_acknowledged', 'disputed'] as const;
export type RecipientState = (typeof RECIPIENT_STATES)[number];

export const REVEAL_AUDIENCES = ['recipient', 'group'] as const;
export type RevealAudience = (typeof REVEAL_AUDIENCES)[number];

const GROUP_TRANSITIONS: Record<GroupState, readonly GroupState[]> = {
  open: ['locked', 'closed'],
  locked: ['open', 'drawn', 'closed'],
  drawn: ['locked', 'active', 'needs_resolution', 'closed'],
  active: ['needs_resolution', 'closed'],
  needs_resolution: ['active', 'closed'],
  closed: [],
};

export function canTransitionGroup(from: GroupState, to: GroupState): boolean {
  return GROUP_TRANSITIONS[from].includes(to);
}

export function nextGroupStates(from: GroupState): readonly GroupState[] {
  return GROUP_TRANSITIONS[from];
}

const RECIPIENT_TRANSITIONS: Record<RecipientState, readonly RecipientState[]> = {
  not_acknowledged: ['recipient_acknowledged', 'disputed'],
  disputed: ['recipient_acknowledged'],
  recipient_acknowledged: [],
};

export function canTransitionRecipient(from: RecipientState, to: RecipientState): boolean {
  return RECIPIENT_TRANSITIONS[from].includes(to);
}

/** States in which a draw exists and payments may be in flight. */
export const POST_DRAW_STATES: readonly GroupState[] = ['drawn', 'active', 'needs_resolution'];

export function hasDraw(state: GroupState): boolean {
  return POST_DRAW_STATES.includes(state) || state === 'closed';
}

export function revealEligible(state: GroupState, revealAtIso: string, now: Date): boolean {
  return hasDraw(state) && now.getTime() >= Date.parse(revealAtIso);
}
