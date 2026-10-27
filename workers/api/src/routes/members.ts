import { Hono } from 'hono';
import { ackCommitment, generateId, hashToken, normalizeReference, timingSafeEqual } from '@mummer/crypto/light';
import {
  LIMITS,
  ackBody,
  dayBucket,
  hasDraw,
  joinBody,
  revealBody,
  revealEligible,
  rotateBody,
  sentBody,
  type RevealView,
} from '@mummer/shared';
import { authAdminOrMember, authMember, loadGroup, pseudonymKey, type GroupRow } from '../db.js';
import { HttpError, type AppBindings, type Deps, type Env } from '../env.js';
import { isConstraintError, isUsableX25519PublicKey } from '../keys.js';
import { bearerToken, json, pathId, readBody } from '../http.js';
import { consumeHumanTicket } from '../human.js';
import { hit, peek } from '../ratelimit.js';

export const members = new Hono<AppBindings>();

/* ---------- POST /api/groups/:gid/members (join) ---------- */

members.post('/:gid/members', async (c) => {
  const { env } = c;
  const deps = c.get('deps');
  const gid = pathId(c, 'gid');
  const body = await readBody(c, joinBody);
  if (!isUsableX25519PublicKey(body.publicKey)) throw new HttpError(422, 'validation_failed', 'Your key could not be used. Reload the page and try again.');
  const g = await loadGroup(env, deps, gid);
  if (!g) throw new HttpError(404, 'not_found', 'This invitation was not found. It may have expired or been deleted.');

  // Idempotent replay: the same credentials joining again return the same member.
  const replay = await env.DB.prepare('SELECT id, public_key, pseudonym FROM members WHERE group_id = ?1 AND token_hash = ?2').bind(gid, body.tokenHash).first<{ id: string; public_key: string; pseudonym: string }>();
  if (replay) {
    if (replay.public_key !== body.publicKey || replay.pseudonym !== body.pseudonym) throw new HttpError(409, 'conflict', 'These credentials were already used to join with different details');
    return json(c, { memberId: replay.id }, 200);
  }

  await hit(env, deps.now().getTime(), { scope: 'join', limit: 20, windowSeconds: 3600 }, c.get('ip'));
  refuseIfJoinClosed(g, deps.now());

  const key = pseudonymKey(body.pseudonym);
  const dup = await env.DB.prepare('SELECT 1 AS x FROM members WHERE group_id = ?1 AND pseudonym_key = ?2').bind(gid, key).first();
  if (dup) throw new HttpError(409, 'duplicate_pseudonym', 'Someone in this group already uses that name. Please choose another.');

  await consumeHumanTicket(env, deps, body.humanTicket);

  const id = generateId();
  const day = dayBucket(deps.now());
  let results: D1Result[];
  try {
    results = await env.DB.batch([
      // Capacity and "still open" are enforced inside the INSERT so concurrent joins cannot exceed the cap.
      env.DB.prepare(
        `INSERT INTO members (group_id, id, pseudonym, pseudonym_key, public_key, sealed_profile, token_hash, status, sender_state, joined_day, address_commitment)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'ready', 'not_started', ?8, ?10
         WHERE EXISTS (SELECT 1 FROM groups WHERE id = ?1 AND state = 'open' AND join_closes_at > ?9)
           AND (SELECT count(*) FROM members WHERE group_id = ?1 AND status IN ('ready', 'assigned'))
               < (SELECT member_cap FROM groups WHERE id = ?1)`,
      ).bind(gid, id, body.pseudonym, key, body.publicKey, body.sealedProfile, body.tokenHash, day, deps.now().toISOString(), body.addressCommitment),
      env.DB.prepare(
        `INSERT INTO audit_events (group_id, type, day, version) SELECT ?1, 'member_joined', ?3, 0 WHERE EXISTS (SELECT 1 FROM members WHERE group_id = ?1 AND id = ?2)`,
      ).bind(gid, id, day),
      env.DB.prepare(`UPDATE stats SET value = value + 1 WHERE key = 'members_joined' AND EXISTS (SELECT 1 FROM members WHERE group_id = ?1 AND id = ?2)`).bind(gid, id),
      // The member list changed: a draw that read the previous list must be refused.
      env.DB.prepare(`UPDATE groups SET members_version = members_version + 1 WHERE id = ?1 AND EXISTS (SELECT 1 FROM members WHERE group_id = ?1 AND id = ?2)`).bind(gid, id),
    ]);
  } catch (e) {
    // Lost a race on the unique pseudonym or token. Anything else is a real fault and must not be disguised.
    if (!isConstraintError(e)) throw e;
    const again = await env.DB.prepare('SELECT id FROM members WHERE group_id = ?1 AND token_hash = ?2').bind(gid, body.tokenHash).first<{ id: string }>();
    if (again) return json(c, { memberId: again.id }, 200);
    throw new HttpError(409, 'duplicate_pseudonym', 'Someone in this group already uses that name. Please choose another.');
  }
  if (results[0]!.meta.changes !== 1) {
    const latest = await loadGroup(env, deps, gid);
    if (!latest) throw new HttpError(404, 'not_found', 'This invitation was not found.');
    refuseIfJoinClosed(latest, deps.now());
    throw new HttpError(409, 'group_full', 'This exchange is full.');
  }
  return json(c, { memberId: id }, 201);
});

function refuseIfJoinClosed(g: GroupRow, now: Date): void {
  if (g.state === 'open' && Date.parse(g.join_closes_at) > now.getTime()) return;
  // The clock decides the reason: an 'open' group past its deadline is locked lazily, so check the time first.
  if (Date.parse(g.join_closes_at) <= now.getTime() && (g.state === 'open' || g.state === 'locked')) {
    throw new HttpError(409, 'join_closed', 'The join deadline for this exchange has passed.');
  }
  if (g.state === 'locked') throw new HttpError(409, 'join_closed', 'The host has closed joining for this exchange.');
  throw new HttpError(409, 'join_closed', 'The names have already been drawn, so no one else can join.');
}

/* ---------- Remove / leave (shared by host removal and self-leave) ---------- */

export async function removeMember(env: Env, deps: Deps, g: GroupRow, mid: string, depth = 0): Promise<{ exception: boolean }> {
  if (g.state === 'open' || g.state === 'locked') {
    const removal = await env.DB.batch([
      env.DB.prepare("DELETE FROM members WHERE group_id = ?1 AND id = ?2 AND EXISTS (SELECT 1 FROM groups WHERE id = ?1 AND state IN ('open', 'locked'))").bind(g.id, mid),
      // Only when the row was really deleted (changes() is the DELETE's count).
      env.DB.prepare('INSERT INTO audit_events (group_id, type, day, version) SELECT ?1, ?2, ?3, 0 WHERE changes() > 0').bind(g.id, 'member_removed', dayBucket(deps.now())),
      // The member is gone exactly when the delete worked; if a draw won the race the member still exists and nothing moves.
      env.DB.prepare("UPDATE groups SET members_version = members_version + 1 WHERE id = ?1 AND state IN ('open', 'locked') AND NOT EXISTS (SELECT 1 FROM members WHERE group_id = ?1 AND id = ?2)").bind(g.id, mid),
    ]);
    if (removal[0]!.meta.changes === 1) return { exception: false };
    // Nothing was deleted: either the member was already gone (a repeated request) or a draw committed first. Decide from the real state.
    const fresh = await loadGroup(env, deps, g.id);
    if (fresh && fresh.state !== 'open' && fresh.state !== 'locked' && !depth) return removeMember(env, deps, fresh, mid, 1);
    return { exception: false };
  }
  if (g.state === 'closed') throw new HttpError(409, 'invalid_state', 'This exchange is closed');
  const dead = hashToken(generateId() + generateId());
  await env.DB.batch([
    env.DB.prepare("UPDATE members SET status = 'revoked', token_hash = ?3 WHERE group_id = ?1 AND id = ?2 AND status IN ('ready', 'assigned')").bind(g.id, mid, dead),
    // Directly after the members update so changes() is its count: a repeated request writes no second event.
    env.DB.prepare('INSERT INTO audit_events (group_id, type, day, version) SELECT ?1, ?2, ?3, ?4 WHERE changes() > 0').bind(g.id, 'member_revoked_after_draw', dayBucket(deps.now()), g.draw_version),
    env.DB.prepare('DELETE FROM assignments WHERE group_id = ?1 AND giver_member_id = ?2').bind(g.id, mid),
    env.DB.prepare("UPDATE groups SET state = 'needs_resolution' WHERE id = ?1 AND state IN ('drawn', 'active')").bind(g.id),
  ]);
  return { exception: true };
}

members.post('/:gid/members/:mid/leave', async (c) => {
  const deps = c.get('deps');
  const { group, member } = await authMember(c.env, deps, pathId(c, 'gid'), pathId(c, 'mid'), bearerToken(c));
  const r = await removeMember(c.env, deps, group, member.id);
  return json(c, { left: true, exception: r.exception });
});

/* ---------- GET assignment (the matching member only) ---------- */

members.get('/:gid/members/:mid/assignment', async (c) => {
  const { env } = c;
  const { group, member } = await authMember(env, c.get('deps'), pathId(c, 'gid'), pathId(c, 'mid'), bearerToken(c));
  const row = await env.DB.prepare('SELECT draw_version, sealed_bundle FROM assignments WHERE group_id = ?1 AND giver_member_id = ?2').bind(group.id, member.id).first<{ draw_version: number; sealed_bundle: string }>();
  if (!row) throw new HttpError(404, 'not_found', 'There is no assignment for you yet.');
  return json(c, { drawVersion: row.draw_version, sealedBundle: row.sealed_bundle });
});

/* ---------- POST sent (giver self-report; not verification) ---------- */

function requirePaymentPhase(g: GroupRow, drawVersion: number): void {
  if (g.state === 'closed') throw new HttpError(409, 'invalid_state', 'This exchange is closed');
  if (!hasDraw(g.state)) throw new HttpError(409, 'invalid_state', 'The names have not been drawn yet');
  if (drawVersion !== g.draw_version) throw new HttpError(409, 'draw_mismatch', 'The draw changed. Reload to see your current assignment.');
}

members.post('/:gid/members/:mid/sent', async (c) => {
  const { env } = c;
  const deps = c.get('deps');
  const { group, member } = await authMember(env, deps, pathId(c, 'gid'), pathId(c, 'mid'), bearerToken(c));
  const body = await readBody(c, sentBody);
  requirePaymentPhase(group, body.drawVersion);
  if (member.status !== 'assigned') throw new HttpError(409, 'invalid_state', 'You have no assignment in this exchange');
  // Every write below is pinned to the draw version and phase that were just validated, so a request that paused across a
  // reset, a redraw or a close cannot touch the newer state.
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE members SET sender_state = 'user_reports_sent'
       WHERE group_id = ?1 AND id = ?2 AND status = 'assigned' AND sender_state = 'not_started'
         AND EXISTS (SELECT 1 FROM groups WHERE id = ?1 AND draw_version = ?3 AND state IN ('drawn', 'active', 'needs_resolution'))`,
    ).bind(group.id, member.id, body.drawVersion),
    // First payment activity ends the window in which a clean redraw is possible.
    env.DB.prepare("UPDATE groups SET state = 'active' WHERE id = ?1 AND state = 'drawn' AND draw_version = ?2 AND EXISTS (SELECT 1 FROM members WHERE group_id = ?1 AND id = ?3 AND sender_state = 'user_reports_sent')").bind(group.id, body.drawVersion, member.id),
  ]);
  if (results[0]!.meta.changes !== 1) {
    // Either a repeat of an earlier report (fine) or the exchange moved on underneath this request (not fine).
    const latest = await loadGroup(env, deps, group.id);
    const mine = await env.DB.prepare('SELECT sender_state, status FROM members WHERE group_id = ?1 AND id = ?2').bind(group.id, member.id).first<{ sender_state: string; status: string }>();
    const repeat = latest && latest.draw_version === body.drawVersion && latest.state !== 'closed' && mine?.status === 'assigned' && mine.sender_state === 'user_reports_sent';
    if (!repeat) throw new HttpError(409, 'draw_mismatch', 'The exchange changed while you were sending that. Reload to see where things stand.');
  }
  return json(c, { senderState: 'user_reports_sent' });
});

/**
 * A pinned acknowledgment write changed nothing. That is fine only if this recipient is ALREADY in the requested state for the
 * same draw (a repeated request). Otherwise the draw, the phase or the membership moved on underneath this request: refuse it.
 */
async function requireUnchangedOrSettled(env: Env, deps: Deps, gid: string, mid: string, drawVersion: number, wanted: 'disputed' | 'recipient_acknowledged'): Promise<void> {
  const latest = await loadGroup(env, deps, gid);
  const row = await env.DB.prepare('SELECT state, draw_version FROM ack_commitments WHERE group_id = ?1 AND recipient_member_id = ?2').bind(gid, mid).first<{ state: string; draw_version: number }>();
  const settled = latest && latest.state !== 'closed' && latest.draw_version === drawVersion && row?.draw_version === drawVersion && (row.state === wanted || (wanted === 'disputed' && row.state === 'recipient_acknowledged'));
  if (!settled) throw new HttpError(409, 'draw_mismatch', 'The exchange changed while you were confirming. Reload to see where things stand.');
}

/* ---------- POST ack (recipient acknowledgment; NOT cryptographic proof of payment) ---------- */

const ACK_ATTEMPTS = { scope: 'ack-reference', limit: LIMITS.ackAttemptsPerHour, windowSeconds: 3600 };

members.post('/:gid/members/:mid/ack', async (c) => {
  const { env } = c;
  const deps = c.get('deps');
  const { group, member } = await authMember(env, deps, pathId(c, 'gid'), pathId(c, 'mid'), bearerToken(c));
  const body = await readBody(c, ackBody);
  requirePaymentPhase(group, body.drawVersion);
  const now = deps.now();

  const row = await env.DB.prepare('SELECT commitment, state, reference_matched FROM ack_commitments WHERE group_id = ?1 AND recipient_member_id = ?2').bind(group.id, member.id).first<{
    commitment: string;
    state: string;
    reference_matched: number;
  }>();
  if (!row || member.status !== 'assigned') throw new HttpError(409, 'invalid_state', 'You are not expecting a gift in this exchange');

  const activate = env.DB.prepare("UPDATE groups SET state = 'active' WHERE id = ?1 AND state = 'drawn' AND draw_version = ?2").bind(group.id, body.drawVersion);
  const day = dayBucket(now);

  if (body.outcome === 'problem') {
    if (row.state === 'recipient_acknowledged') throw new HttpError(409, 'invalid_state', 'You already confirmed this gift.');
    if (row.state === 'disputed') return json(c, { recipientState: 'disputed', referenceMatched: false });
    const disputed = await env.DB.batch([
      env.DB.prepare(
        `UPDATE ack_commitments SET state = 'disputed', state_day = ?3
         WHERE group_id = ?1 AND recipient_member_id = ?2 AND state = 'not_acknowledged' AND commitment = ?4 AND draw_version = ?5
           AND EXISTS (SELECT 1 FROM groups WHERE id = ?1 AND draw_version = ?5 AND state IN ('drawn', 'active', 'needs_resolution'))
           AND EXISTS (SELECT 1 FROM members WHERE group_id = ?1 AND id = ?2 AND status = 'assigned')`,
      ).bind(group.id, member.id, day, row.commitment, body.drawVersion),
      activate,
    ]);
    if (disputed[0]!.meta.changes !== 1) await requireUnchangedOrSettled(env, deps, group.id, member.id, body.drawVersion, 'disputed');
    return json(c, { recipientState: 'disputed', referenceMatched: false });
  }

  if (row.state === 'recipient_acknowledged') return json(c, { recipientState: 'recipient_acknowledged', referenceMatched: row.reference_matched === 1 });

  let matched = false;
  if (body.reference !== undefined) {
    const canonical = normalizeReference(body.reference);
    if (!canonical) throw new HttpError(422, 'validation_failed', 'That reference has a typo. Check it against the memo in your wallet.');
    const attemptKey = `${group.id}:${member.id}`;
    if ((await peek(env, now.getTime(), ACK_ATTEMPTS, attemptKey)) >= ACK_ATTEMPTS.limit) {
      throw new HttpError(429, 'rate_limited', 'Too many incorrect references. Please try again in an hour, or confirm without a reference.');
    }
    if (!timingSafeEqual(ackCommitment(group.id, member.id, canonical), row.commitment)) {
      await hit(env, now.getTime(), ACK_ATTEMPTS, attemptKey).catch(() => undefined);
      throw new HttpError(422, 'reference_mismatch', 'That reference does not match a gift for you. Check the memo in your wallet.');
    }
    matched = true;
  }

  // Pinned to the commitment that the reference was just checked against, to the draw version and to an open payment phase.
  const acked = await env.DB.batch([
    env.DB.prepare(
      `UPDATE ack_commitments SET state = 'recipient_acknowledged', reference_matched = ?4, state_day = ?3
       WHERE group_id = ?1 AND recipient_member_id = ?2 AND state IN ('not_acknowledged', 'disputed') AND commitment = ?5 AND draw_version = ?6
         AND EXISTS (SELECT 1 FROM groups WHERE id = ?1 AND draw_version = ?6 AND state IN ('drawn', 'active', 'needs_resolution'))
         AND EXISTS (SELECT 1 FROM members WHERE group_id = ?1 AND id = ?2 AND status = 'assigned')`,
    ).bind(group.id, member.id, day, matched ? 1 : 0, row.commitment, body.drawVersion),
    // changes() is the row count of the statement above, so a concurrent duplicate request cannot double-count.
    env.DB.prepare("UPDATE stats SET value = value + 1 WHERE key = 'gifts_acknowledged' AND changes() = 1"),
    activate,
  ]);
  if (acked[0]!.meta.changes !== 1) await requireUnchangedOrSettled(env, deps, group.id, member.id, body.drawVersion, 'recipient_acknowledged');
  const after = await env.DB.prepare('SELECT state, reference_matched FROM ack_commitments WHERE group_id = ?1 AND recipient_member_id = ?2').bind(group.id, member.id).first<{ state: string; reference_matched: number }>();
  return json(c, { recipientState: after?.state ?? 'recipient_acknowledged', referenceMatched: after?.reference_matched === 1 });
});

/* ---------- POST rotate (member replaces a possibly compromised link) ---------- */

members.post('/:gid/members/:mid/rotate', async (c) => {
  const { env } = c;
  const deps = c.get('deps');
  const { group, member } = await authMember(env, deps, pathId(c, 'gid'), pathId(c, 'mid'), bearerToken(c));
  if (group.state === 'closed') throw new HttpError(409, 'invalid_state', 'This exchange is closed');
  const body = await readBody(c, rotateBody);
  if (!isUsableX25519PublicKey(body.newPublicKey)) throw new HttpError(422, 'validation_failed', 'Your new key could not be used. Reload the page and try again.');
  const bundleRow = await env.DB.prepare('SELECT draw_version FROM assignments WHERE group_id = ?1 AND giver_member_id = ?2').bind(group.id, member.id).first<{ draw_version: number }>();
  const hasBundle = bundleRow !== null;
  if (hasBundle && !body.newSealedBundle) throw new HttpError(422, 'validation_failed', 'Your assignment must be re-sealed to your new key');
  if (!hasBundle && body.newSealedBundle) throw new HttpError(422, 'validation_failed', 'You have no assignment to re-seal');
  if (body.newTokenHash === member.token_hash) throw new HttpError(422, 'validation_failed', 'Choose a different link');
  if (hasBundle && body.drawVersion !== bundleRow.draw_version) throw new HttpError(409, 'draw_mismatch', 'The draw changed while you were replacing your link. Reload, open your assignment and try again.');
  const observedDraw = bundleRow?.draw_version ?? 0;

  const stmts: D1PreparedStatement[] = [
    // Compare-and-swap on the current token hash: two concurrent rotations cannot both succeed. It also requires that the
    // assignment situation is exactly what this request was built for: with a bundle, the one for the same draw version;
    // without one, still none. A draw (or reset) that committed in between makes this change nothing, so a new key can
    // never be installed while the assignment stays sealed to the old one.
    env.DB.prepare(
      `UPDATE members SET token_hash = ?3, public_key = ?4
       WHERE group_id = ?1 AND id = ?2 AND token_hash = ?5
         AND ((?6 = 1 AND EXISTS (SELECT 1 FROM assignments WHERE group_id = ?1 AND giver_member_id = ?2 AND draw_version = ?7))
           OR (?6 = 0 AND NOT EXISTS (SELECT 1 FROM assignments WHERE group_id = ?1 AND giver_member_id = ?2)))`,
    ).bind(group.id, member.id, body.newTokenHash, body.newPublicKey, member.token_hash, hasBundle ? 1 : 0, observedDraw),
  ];
  if (body.newSealedBundle) {
    stmts.push(
      env.DB.prepare('UPDATE assignments SET sealed_bundle = ?3 WHERE group_id = ?1 AND giver_member_id = ?2 AND draw_version = ?5 AND EXISTS (SELECT 1 FROM members WHERE group_id = ?1 AND id = ?2 AND token_hash = ?4)').bind(group.id, member.id, body.newSealedBundle, body.newTokenHash, observedDraw),
    );
  }
  // A new public key changes what a draw in progress would seal to: move the member-list version so that draw is refused.
  // Only when this rotation actually took effect.
  stmts.push(env.DB.prepare('UPDATE groups SET members_version = members_version + 1 WHERE id = ?1 AND EXISTS (SELECT 1 FROM members WHERE group_id = ?1 AND id = ?2 AND token_hash = ?3)').bind(group.id, member.id, body.newTokenHash));
  let results: D1Result[];
  try {
    results = await env.DB.batch(stmts);
  } catch (e) {
    if (!isConstraintError(e)) throw e;
    throw new HttpError(409, 'conflict', 'Those credentials are already in use. Generate new ones.');
  }
  if (results[0]!.meta.changes !== 1) throw new HttpError(409, 'conflict', 'Your link or the draw changed while you were replacing it, so nothing was changed. Reload and try again.');
  return json(c, { rotated: true });
});

/* ---------- Reveals ---------- */

const REVEAL_ATTEMPTS = { scope: 'reveal-reference', limit: LIMITS.ackAttemptsPerHour, windowSeconds: 3600 };

members.post('/:gid/reveals', async (c) => {
  const { env } = c;
  const deps = c.get('deps');
  const auth = await authAdminOrMember(env, deps, pathId(c, 'gid'), bearerToken(c));
  if (auth.role !== 'member' || !auth.member) throw new HttpError(403, 'forbidden', 'Only a participant can reveal their own assignment');
  const { group, member } = auth;
  const body = await readBody(c, revealBody);
  const now = deps.now();
  requirePaymentPhase(group, body.drawVersion);
  if (!revealEligible(group.state, group.reveal_at, now)) throw new HttpError(403, 'reveal_not_open', 'Reveals open on the reveal date.');
  if (member.status !== 'assigned') throw new HttpError(409, 'invalid_state', 'You have no assignment in this exchange');
  if (body.recipientId === member.id) throw new HttpError(422, 'validation_failed', 'recipientId: You cannot be your own recipient');

  const existing = await env.DB.prepare('SELECT recipient_member_id, audience FROM reveals WHERE group_id = ?1 AND giver_member_id = ?2').bind(group.id, member.id).first<{ recipient_member_id: string; audience: string }>();
  if (existing) {
    if (existing.recipient_member_id === body.recipientId && existing.audience === body.audience) return json(c, { revealed: true, replay: true });
    throw new HttpError(409, 'conflict', 'You have already revealed your assignment.');
  }

  const canonical = normalizeReference(body.reference);
  if (!canonical) throw new HttpError(422, 'validation_failed', 'reference: That reference has a typo.');
  const attemptKey = `${group.id}:${member.id}`;
  if ((await peek(env, now.getTime(), REVEAL_ATTEMPTS, attemptKey)) >= REVEAL_ATTEMPTS.limit) throw new HttpError(429, 'rate_limited', 'Too many attempts. Please try again later.');

  const target = await env.DB.prepare(
    `SELECT a.commitment FROM ack_commitments a JOIN members m ON m.group_id = a.group_id AND m.id = a.recipient_member_id
     WHERE a.group_id = ?1 AND a.recipient_member_id = ?2 AND m.status = 'assigned'`,
  ).bind(group.id, body.recipientId).first<{ commitment: string }>();
  // Same response whether the recipient is unknown or the reference is wrong, and both consume an attempt.
  if (!target || !timingSafeEqual(ackCommitment(group.id, body.recipientId, canonical), target.commitment)) {
    await hit(env, now.getTime(), REVEAL_ATTEMPTS, attemptKey).catch(() => undefined);
    throw new HttpError(422, 'reference_mismatch', 'We could not match that reference to the person you named.');
  }
  try {
    const inserted = await env.DB.batch([
      // Only if this is still the draw the reference was checked against (a reset and redraw in between would change who gives to whom).
      env.DB.prepare(
        `INSERT INTO reveals (group_id, giver_member_id, recipient_member_id, audience, declared_day)
         SELECT ?1, ?2, ?3, ?4, ?5 WHERE EXISTS (SELECT 1 FROM groups WHERE id = ?1 AND draw_version = ?6 AND state IN ('drawn', 'active', 'needs_resolution'))`,
      ).bind(group.id, member.id, body.recipientId, body.audience, dayBucket(now), body.drawVersion),
      env.DB.prepare('INSERT INTO audit_events (group_id, type, day, version) SELECT ?1, ?2, ?3, ?4 WHERE changes() > 0').bind(group.id, 'reveal_declared', dayBucket(now), group.draw_version),
    ]);
    if (inserted[0]!.meta.changes !== 1) throw new HttpError(409, 'draw_mismatch', 'The exchange changed while you were revealing. Reload and try again.');
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (!isConstraintError(e)) throw e;
    throw new HttpError(409, 'conflict', 'That gift has already been revealed.');
  }
  return json(c, { revealed: true, replay: false }, 201);
});

members.post('/:gid/reveals/:giverId/confirm', async (c) => {
  const { env } = c;
  const deps = c.get('deps');
  const auth = await authAdminOrMember(env, deps, pathId(c, 'gid'), bearerToken(c));
  if (auth.role !== 'member' || !auth.member) throw new HttpError(403, 'forbidden', 'Only the recipient can confirm a reveal');
  const giverId = pathId(c, 'giverId');
  if (auth.group.state === 'closed') throw new HttpError(409, 'invalid_state', 'This exchange is closed, so reveals can no longer be confirmed.');
  const r = await env.DB.prepare("UPDATE reveals SET recipient_confirmed_day = COALESCE(recipient_confirmed_day, ?4) WHERE group_id = ?1 AND giver_member_id = ?2 AND recipient_member_id = ?3 AND EXISTS (SELECT 1 FROM groups WHERE id = ?1 AND state != 'closed')").bind(auth.group.id, giverId, auth.member.id, dayBucket(deps.now())).run();
  if (r.meta.changes !== 1) {
    const latest = await loadGroup(env, deps, auth.group.id);
    if (latest?.state === 'closed') throw new HttpError(409, 'invalid_state', 'This exchange is closed, so reveals can no longer be confirmed.');
  }
  // Not the named recipient (or no such reveal): indistinguishable.
  if (r.meta.changes !== 1) throw new HttpError(404, 'not_found', 'No reveal to confirm');
  return json(c, { confirmed: true });
});

members.get('/:gid/reveals', async (c) => {
  const { env } = c;
  const auth = await authAdminOrMember(env, c.get('deps'), pathId(c, 'gid'), bearerToken(c));
  const rows = await env.DB.prepare('SELECT giver_member_id, recipient_member_id, audience, declared_day, recipient_confirmed_day FROM reveals WHERE group_id = ?1 ORDER BY declared_day').bind(auth.group.id).all<{
    giver_member_id: string;
    recipient_member_id: string;
    audience: string;
    declared_day: string;
    recipient_confirmed_day: string | null;
  }>();
  const me = auth.member?.id;
  const visible: RevealView[] = rows.results
    .filter((r) => r.audience === 'group' || (me !== undefined && (r.giver_member_id === me || r.recipient_member_id === me)))
    .map((r) => ({
      giverId: r.giver_member_id,
      recipientId: r.recipient_member_id,
      audience: r.audience,
      confirmedByRecipient: r.recipient_confirmed_day !== null,
      declaredDay: r.declared_day,
    }));
  return json(c, { reveals: visible });
});
