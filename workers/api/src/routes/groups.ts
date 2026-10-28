import { Hono } from 'hono';
import { sha256 } from '@noble/hashes/sha2.js';
import { base16 } from '@scure/base';
import { generateId, hashToken } from '@mummer/crypto/light';
import {
  LIMITS,
  canTransitionGroup,
  createGroupBody,
  dayBucket,
  drawBody,
  extendBody,
  hasDraw,
  joinClosesAt,
  revealEligible,
  revealOpensAt,
  todayIn,
  transitionBody,
  daysBetween,
  type GroupView,
  type InviteView,
} from '@mummer/shared';
import { authAdmin, authAdminOrMember, audit, bumpStat, loadGroup, type GroupRow, type MemberRow } from '../db.js';
import { HttpError, type AppBindings, type Env } from '../env.js';
import { isConstraintError } from '../keys.js';
import { bearerToken, json, pathId, readBody } from '../http.js';
import { hit } from '../ratelimit.js';
import { consumeHumanTicket } from '../human.js';
import { removeMember } from './members.js';

export const groups = new Hono<AppBindings>();

/* ---------- POST /api/groups ---------- */

groups.post('/', async (c) => {
  const { env } = c;
  const deps = c.get('deps');
  const body = await readBody(c, createGroupBody);
  const now = deps.now();

  // Date sanity relative to "today" in the group's own timezone.
  const today = todayIn(body.timezone, now);
  const untilJoin = daysBetween(today, body.joinDeadline);
  const untilReveal = daysBetween(today, body.revealDate);
  if (untilJoin < 0) throw new HttpError(422, 'validation_failed', 'joinDeadline: The join deadline cannot be in the past');
  if (untilJoin > LIMITS.joinDeadlineMaxDays) throw new HttpError(422, 'validation_failed', `joinDeadline: The join deadline must be within ${LIMITS.joinDeadlineMaxDays} days`);
  if (untilReveal > LIMITS.revealMaxDays) throw new HttpError(422, 'validation_failed', `revealDate: The reveal date must be within ${LIMITS.revealMaxDays} days`);

  // Idempotent on the admin token hash: a repeated submission of the same request returns the same group.
  const existing = await env.DB.prepare('SELECT * FROM groups WHERE admin_token_hash = ?1').bind(body.adminTokenHash).first<GroupRow>();
  if (existing) {
    const same =
      existing.title === body.title &&
      existing.budget_cents === body.budgetCents &&
      existing.join_deadline === body.joinDeadline &&
      existing.reveal_date === body.revealDate &&
      existing.timezone === body.timezone &&
      existing.member_cap === body.memberCap &&
      existing.host_plays === (body.hostPlays ? 1 : 0) &&
      existing.host_public_key === body.hostPublicKey;
    if (!same) throw new HttpError(409, 'conflict', 'These credentials were already used for a different group');
    return json(c, { groupId: existing.id }, 200);
  }

  await hit(env, now.getTime(), { scope: 'create-group', limit: 10, windowSeconds: 3600 }, c.get('ip'));
  await consumeHumanTicket(env, deps, body.humanTicket);

  const id = generateId();
  const revealAt = revealOpensAt(body.revealDate, body.timezone);
  const expiresAt = new Date(revealAt.getTime() + LIMITS.retentionDaysAfterReveal * 86_400_000);
  const closesAt = joinClosesAt(body.joinDeadline, body.timezone);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO groups (id, title, budget_cents, join_deadline, reveal_date, timezone, join_closes_at, reveal_at,
         member_cap, host_plays, host_public_key, admin_token_hash, state, draw_version, created_day, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'open', 0, ?13, ?14)`,
    ).bind(
      id,
      body.title,
      body.budgetCents,
      body.joinDeadline,
      body.revealDate,
      body.timezone,
      closesAt.toISOString(),
      revealAt.toISOString(),
      body.memberCap,
      body.hostPlays ? 1 : 0,
      body.hostPublicKey,
      body.adminTokenHash,
      dayBucket(now),
      expiresAt.toISOString(),
    ),
    audit(env, deps, id, 'group_created'),
    bumpStat(env, 'groups_created'),
  ]);
  return json(c, { groupId: id }, 201);
});

/* ---------- GET /api/groups/:gid/invite (public) ---------- */

groups.get('/:gid/invite', async (c) => {
  const { env } = c;
  const deps = c.get('deps');
  const now = deps.now();
  await hit(env, now.getTime(), { scope: 'invite', limit: 60, windowSeconds: 60 }, c.get('ip'));
  const g = await loadGroup(env, deps, pathId(c, 'gid'));
  if (!g) throw new HttpError(404, 'not_found', 'This invitation was not found. It may have expired or been deleted.');
  const count = await env.DB.prepare("SELECT count(*) AS n FROM members WHERE group_id = ?1 AND status IN ('ready', 'assigned')").bind(g.id).first<{ n: number }>();
  const spotsLeft = Math.max(0, g.member_cap - (count?.n ?? 0));
  const view: InviteView = {
    groupId: g.id,
    title: g.title,
    budgetCents: g.budget_cents,
    joinDeadline: g.join_deadline,
    revealDate: g.reveal_date,
    timezone: g.timezone,
    memberCap: g.member_cap,
    hostPlays: g.host_plays === 1,
    hostPublicKey: g.host_public_key,
    state: g.state,
    joinOpen: g.state === 'open' && Date.parse(g.join_closes_at) > now.getTime() && spotsLeft > 0,
    spotsLeft,
    joinClosesAt: g.join_closes_at,
  };
  return json(c, view);
});

/* ---------- GET /api/groups/:gid (host or member) ---------- */

export async function buildGroupView(env: Env, now: Date, g: GroupRow, role: 'admin' | 'member', member?: MemberRow): Promise<GroupView> {
  const [roster, counts, acks, mine] = await Promise.all([
    env.DB.prepare("SELECT id, pseudonym, status, address_commitment AS addressCommitment FROM members WHERE group_id = ?1 AND status IN ('ready', 'assigned', 'revoked') ORDER BY pseudonym_key").bind(g.id).all<{ id: string; pseudonym: string; status: string; addressCommitment: string }>(),
    env.DB.prepare(
      `SELECT COALESCE(SUM(status IN ('ready', 'assigned')), 0) AS ready,
              COALESCE(SUM(status = 'assigned'), 0) AS assigned,
              COALESCE(SUM(status = 'assigned' AND sender_state = 'user_reports_sent'), 0) AS sent
       FROM members WHERE group_id = ?1`,
    ).bind(g.id).first<{ ready: number; assigned: number; sent: number }>(),
    env.DB.prepare(
      `SELECT COALESCE(SUM(a.state = 'recipient_acknowledged'), 0) AS acknowledged,
              COALESCE(SUM(a.state = 'disputed'), 0) AS disputed
       FROM ack_commitments a JOIN members m ON m.group_id = a.group_id AND m.id = a.recipient_member_id
       WHERE a.group_id = ?1 AND m.status = 'assigned'`,
    ).bind(g.id).first<{ acknowledged: number; disputed: number }>(),
    member
      ? env.DB.prepare(
          `SELECT (SELECT state FROM ack_commitments WHERE group_id = ?1 AND recipient_member_id = ?2) AS recipient_state,
                  EXISTS (SELECT 1 FROM assignments WHERE group_id = ?1 AND giver_member_id = ?2) AS has_assignment`,
        ).bind(g.id, member.id).first<{ recipient_state: string | null; has_assignment: number }>()
      : Promise.resolve(null),
  ]);
  return {
    group: {
      id: g.id,
      title: g.title,
      budgetCents: g.budget_cents,
      joinDeadline: g.join_deadline,
      revealDate: g.reveal_date,
      timezone: g.timezone,
      memberCap: g.member_cap,
      hostPlays: g.host_plays === 1,
      hostPublicKey: g.host_public_key,
      state: g.state,
      drawVersion: g.draw_version,
      revealOpensAt: g.reveal_at,
      revealOpen: revealEligible(g.state, g.reveal_at, now),
      joinClosesAt: g.join_closes_at,
      expiresAt: g.expires_at,
    },
    role,
    roster: roster.results,
    progress: {
      ready: counts?.ready ?? 0,
      assigned: counts?.assigned ?? 0,
      reportedSent: counts?.sent ?? 0,
      acknowledged: acks?.acknowledged ?? 0,
      needsAttention: acks?.disputed ?? 0,
    },
    ...(member && mine
      ? {
          me: {
            id: member.id,
            pseudonym: member.pseudonym,
            status: member.status,
            senderState: member.sender_state,
            recipientState: mine.recipient_state ?? 'not_acknowledged',
            hasAssignment: mine.has_assignment === 1,
          },
        }
      : {}),
  };
}

groups.get('/:gid', async (c) => {
  const deps = c.get('deps');
  const auth = await authAdminOrMember(c.env, deps, pathId(c, 'gid'), bearerToken(c));
  return json(c, await buildGroupView(c.env, deps.now(), auth.group, auth.role, auth.member));
});

/* ---------- GET /api/groups/:gid/profiles (host only; sealed) ---------- */

groups.get('/:gid/profiles', async (c) => {
  const deps = c.get('deps');
  const g = await authAdmin(c.env, deps, pathId(c, 'gid'), bearerToken(c));
  if (g.state !== 'open' && g.state !== 'locked') throw new HttpError(409, 'invalid_state', 'Profiles are only available before the draw');
  const rows = await c.env.DB.prepare("SELECT id, pseudonym, public_key, sealed_profile, address_commitment FROM members WHERE group_id = ?1 AND status = 'ready' ORDER BY id").bind(g.id).all<{
    id: string;
    pseudonym: string;
    public_key: string;
    sealed_profile: string;
    address_commitment: string;
  }>();
  return json(c, {
    // The draw must present this version: if anyone joins, leaves or replaces their key in the meantime, it is refused.
    membersVersion: g.members_version,
    members: rows.results.map((r) => ({ memberId: r.id, pseudonym: r.pseudonym, publicKey: r.public_key, sealedProfile: r.sealed_profile, addressCommitment: r.address_commitment })),
  });
});

/* ---------- DELETE /api/groups/:gid/members/:mid (host) ---------- */

groups.delete('/:gid/members/:mid', async (c) => {
  const deps = c.get('deps');
  const g = await authAdmin(c.env, deps, pathId(c, 'gid'), bearerToken(c));
  const mid = pathId(c, 'mid');
  const m = await c.env.DB.prepare('SELECT 1 AS x FROM members WHERE group_id = ?1 AND id = ?2').bind(g.id, mid).first();
  if (!m) throw new HttpError(404, 'not_found', 'Member not found');
  const r = await removeMember(c.env, deps, g, mid);
  return json(c, { removed: true, exception: r.exception });
});

/* ---------- POST /api/groups/:gid/draw (host, atomic, idempotent) ---------- */

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,64}$/;
/** 50 sealed bundles with long non-ASCII wishlists exceed the default cap, so the draw has its own. */
const DRAW_BODY_BYTES = 256 * 1024;

groups.post('/:gid/draw', async (c) => {
  const { env } = c;
  const deps = c.get('deps');
  const g = await authAdmin(env, deps, pathId(c, 'gid'), bearerToken(c));
  const key = c.req.header('idempotency-key') ?? '';
  if (!IDEMPOTENCY_KEY.test(key)) throw new HttpError(400, 'bad_request', 'An Idempotency-Key header (16-64 URL-safe characters) is required');
  const body = await readBody(c, drawBody, DRAW_BODY_BYTES);

  // Replay of a draw that already succeeded with this key: same answer, no second draw.
  if (g.draw_idempotency_key === key && hasDraw(g.state)) return json(c, { drawVersion: g.draw_version, replay: true });

  if (g.state === 'drawn' || g.state === 'active' || g.state === 'needs_resolution' || g.state === 'closed') {
    throw new HttpError(409, 'draw_already_done', 'The draw has already been made for this exchange');
  }
  if (g.state === 'open' && body.closeEarly !== true) {
    throw new HttpError(409, 'invalid_state', 'The join window is still open. Close it first, or confirm closing early.');
  }
  if (body.drawVersion !== g.draw_version + 1) throw new HttpError(409, 'draw_mismatch', 'The draw version is out of date. Reload and try again.');
  if (body.membersVersion !== g.members_version) throw new HttpError(409, 'draw_mismatch', 'The people in this exchange changed while you were drawing. Reload and draw again.');

  const ready = await env.DB.prepare("SELECT id FROM members WHERE group_id = ?1 AND status = 'ready' ORDER BY id").bind(g.id).all<{ id: string }>();
  const readyIds = ready.results.map((r) => r.id);
  if (readyIds.length < LIMITS.minMembersToDraw) throw new HttpError(422, 'draw_mismatch', `At least ${LIMITS.minMembersToDraw} ready members are needed`);

  const bundleIds = body.bundles.map((b) => b.memberId).sort();
  const commitIds = body.commitments.map((b) => b.memberId).sort();
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
  if (new Set(bundleIds).size !== bundleIds.length || new Set(commitIds).size !== commitIds.length) {
    throw new HttpError(422, 'draw_mismatch', 'Duplicate members in the draw');
  }
  if (!same(bundleIds, readyIds) || !same(commitIds, readyIds)) {
    throw new HttpError(409, 'draw_mismatch', 'The member list changed while you were drawing. Reload and draw again.');
  }

  const n = readyIds.length;
  const version = body.drawVersion;
  // Every statement after the first is conditional on the first having won: ?1 = group, ?2 = idempotency key, ?3 = new draw version.
  const won = `EXISTS (SELECT 1 FROM groups WHERE id = ?1 AND draw_idempotency_key = ?2 AND draw_version = ?3 AND state = 'drawn')`;
  const statements: D1PreparedStatement[] = [
    // Compare-and-swap: only the first writer wins, and only if the member list (and every member's public key) is
    // exactly what the host's browser read: members_version moves on join, leave, removal and credential rotation.
    env.DB.prepare(
      `UPDATE groups SET state = 'drawn', draw_version = ?3, draw_idempotency_key = ?2
       WHERE id = ?1 AND state IN ('open', 'locked') AND draw_version = ?4 AND members_version = ?6
         AND (SELECT count(*) FROM members WHERE group_id = ?1 AND status = 'ready') = ?5`,
    ).bind(g.id, key, version, g.draw_version, n, body.membersVersion),
    env.DB.prepare(`UPDATE members SET status = 'assigned' WHERE group_id = ?1 AND status = 'ready' AND ${won}`).bind(g.id, key, version),
  ];
  // Each table is written in sorted member-id order, independently of the other and of the draw cycle.
  const byId = (x: { memberId: string }, y: { memberId: string }) => (x.memberId < y.memberId ? -1 : x.memberId > y.memberId ? 1 : 0);
  for (const b of [...body.bundles].sort(byId)) {
    statements.push(
      env.DB.prepare(`INSERT INTO assignments (group_id, giver_member_id, draw_version, sealed_bundle) SELECT ?1, ?4, ?3, ?5 WHERE ${won}`).bind(g.id, key, version, b.memberId, b.sealedBundle),
    );
  }
  for (const k of [...body.commitments].sort(byId)) {
    statements.push(
      env.DB.prepare(`INSERT INTO ack_commitments (group_id, recipient_member_id, draw_version, commitment) SELECT ?1, ?4, ?3, ?5 WHERE ${won}`).bind(g.id, key, version, k.memberId, k.commitment),
    );
  }
  statements.push(audit(env, deps, g.id, 'draw_committed', version, true));

  const replayIfAlreadyDone = async (): Promise<Response | undefined> => {
    const latest = await loadGroup(env, deps, g.id);
    if (latest && latest.draw_idempotency_key === key && hasDraw(latest.state)) return json(c, { drawVersion: latest.draw_version, replay: true });
    return undefined;
  };

  let results: D1Result[];
  try {
    results = await env.DB.batch(statements);
  } catch (e) {
    // A uniqueness or foreign-key violation rolls the whole batch back: nothing was written. A simultaneous duplicate of
    // the same request lands here too; if the draw is in fact complete under this key, answer as a replay.
    if (!isConstraintError(e)) throw e;
    const replay = await replayIfAlreadyDone();
    if (replay) return replay;
    throw new HttpError(409, 'draw_already_done', 'The draw could not be saved. Reload and try again.');
  }
  if (results[0]!.meta.changes !== 1) {
    // Lost the race (or the member list changed): the other writer's state stands and nothing of ours was inserted.
    const replay = await replayIfAlreadyDone();
    if (replay) return replay;
    throw new HttpError(409, 'draw_already_done', 'Another draw was saved first, or the people in this exchange changed. Reload and try again.');
  }
  return json(c, { drawVersion: version, replay: false }, 201);
});

/* ---------- POST /api/groups/:gid/extend (host): change the dates before the draw ---------- */

groups.post('/:gid/extend', async (c) => {
  const { env } = c;
  const deps = c.get('deps');
  const g = await authAdmin(env, deps, pathId(c, 'gid'), bearerToken(c));
  const body = await readBody(c, extendBody);
  if (g.state !== 'open' && g.state !== 'locked') throw new HttpError(409, 'invalid_state', 'Dates can only be changed before the names are drawn');
  const now = deps.now();
  const today = todayIn(g.timezone, now);
  const bad = (field: string, msg: string) => new HttpError(422, 'validation_failed', `${field}: ${msg}`);
  if (body.joinDeadline < today) throw bad('joinDeadline', 'The join deadline cannot be in the past');
  if (daysBetween(today, body.joinDeadline) > LIMITS.joinDeadlineMaxDays) throw bad('joinDeadline', `The join deadline must be within ${LIMITS.joinDeadlineMaxDays} days`);
  if (daysBetween(body.joinDeadline, body.revealDate) < LIMITS.revealMinGapDays) throw bad('revealDate', 'The reveal date must be at least a day after the join deadline');
  if (daysBetween(today, body.revealDate) > LIMITS.revealMaxDays) throw bad('revealDate', `The reveal date must be within ${LIMITS.revealMaxDays} days`);

  const closesAt = joinClosesAt(body.joinDeadline, g.timezone);
  const revealAt = revealOpensAt(body.revealDate, g.timezone);
  const expiresAt = new Date(revealAt.getTime() + LIMITS.retentionDaysAfterReveal * 86_400_000);
  const results = await env.DB.batch([
    // Extending the deadline reopens a group that had only been locked (by the host or by the old deadline).
    env.DB.prepare(
      `UPDATE groups SET join_deadline = ?2, reveal_date = ?3, join_closes_at = ?4, reveal_at = ?5, expires_at = ?6,
         state = CASE WHEN state = 'locked' THEN 'open' ELSE state END
       WHERE id = ?1 AND state IN ('open', 'locked')`,
    ).bind(g.id, body.joinDeadline, body.revealDate, closesAt.toISOString(), revealAt.toISOString(), expiresAt.toISOString()),
    audit(env, deps, g.id, 'dates_changed', 0, true),
  ]);
  if (results[0]!.meta.changes !== 1) throw new HttpError(409, 'invalid_state', 'Dates can only be changed before the names are drawn');
  const fresh = await loadGroup(env, deps, g.id);
  return json(c, { joinDeadline: body.joinDeadline, revealDate: body.revealDate, state: fresh?.state ?? 'open' });
});

/* ---------- POST /api/groups/:gid/transition (host) ---------- */

groups.post('/:gid/transition', async (c) => {
  const { env } = c;
  const deps = c.get('deps');
  const g = await authAdmin(env, deps, pathId(c, 'gid'), bearerToken(c));
  const { action } = await readBody(c, transitionBody);
  const now = deps.now();

  const refuse = () => new HttpError(409, 'invalid_state', `That action is not available while the exchange is ${g.state.replace('_', ' ')}`);
  const run = async (stmts: D1PreparedStatement[], expectChange = true) => {
    const results = await env.DB.batch(stmts);
    if (expectChange && results[0]!.meta.changes !== 1) throw refuse();
  };

  switch (action) {
    case 'lock':
      if (!canTransitionGroup(g.state, 'locked') || g.state !== 'open') throw refuse();
      await run([env.DB.prepare("UPDATE groups SET state = 'locked' WHERE id = ?1 AND state = 'open'").bind(g.id), audit(env, deps, g.id, 'group_locked', 0, true)]);
      break;
    case 'reopen':
      if (g.state !== 'locked') throw refuse();
      if (Date.parse(g.join_closes_at) <= now.getTime()) throw new HttpError(409, 'join_closed', 'The join deadline has passed');
      await run([env.DB.prepare("UPDATE groups SET state = 'open' WHERE id = ?1 AND state = 'locked'").bind(g.id), audit(env, deps, g.id, 'group_reopened', 0, true)]);
      break;
    case 'reset_draw':
      // Only valid before any payment activity (state 'drawn'); after that, resolution is manual.
      if (g.state !== 'drawn') throw refuse();
      await run([
        env.DB.prepare("UPDATE groups SET state = 'locked', draw_idempotency_key = NULL WHERE id = ?1 AND state = 'drawn'").bind(g.id),
        env.DB.prepare("DELETE FROM assignments WHERE group_id = ?1 AND EXISTS (SELECT 1 FROM groups WHERE id = ?1 AND state = 'locked')").bind(g.id),
        env.DB.prepare("DELETE FROM ack_commitments WHERE group_id = ?1 AND EXISTS (SELECT 1 FROM groups WHERE id = ?1 AND state = 'locked')").bind(g.id),
        env.DB.prepare("DELETE FROM reveals WHERE group_id = ?1 AND EXISTS (SELECT 1 FROM groups WHERE id = ?1 AND state = 'locked')").bind(g.id),
        env.DB.prepare("UPDATE members SET status = 'ready', sender_state = 'not_started' WHERE group_id = ?1 AND status = 'assigned' AND EXISTS (SELECT 1 FROM groups WHERE id = ?1 AND state = 'locked')").bind(g.id),
        audit(env, deps, g.id, 'draw_reset', g.draw_version, true),
      ]);
      break;
    case 'flag_resolution':
      if (g.state !== 'drawn' && g.state !== 'active') throw refuse();
      await run([env.DB.prepare("UPDATE groups SET state = 'needs_resolution' WHERE id = ?1 AND state IN ('drawn', 'active')").bind(g.id), audit(env, deps, g.id, 'resolution_flagged', g.draw_version, true)]);
      break;
    case 'clear_resolution':
      if (g.state !== 'needs_resolution') throw refuse();
      await run([env.DB.prepare("UPDATE groups SET state = 'active' WHERE id = ?1 AND state = 'needs_resolution'").bind(g.id), audit(env, deps, g.id, 'resolution_cleared', g.draw_version, true)]);
      break;
    case 'close':
      if (g.state === 'closed') throw refuse();
      await run([env.DB.prepare("UPDATE groups SET state = 'closed' WHERE id = ?1 AND state != 'closed'").bind(g.id), audit(env, deps, g.id, 'group_closed', g.draw_version, true)]);
      break;
  }
  const fresh = await loadGroup(env, deps, g.id);
  return json(c, { state: fresh?.state ?? 'closed' });
});

/* ---------- DELETE /api/groups/:gid (host) ---------- */

groups.delete('/:gid', async (c) => {
  const g = await authAdmin(c.env, c.get('deps'), pathId(c, 'gid'), bearerToken(c));
  // Foreign keys cascade to members, assignments, commitments, reveals and audit events.
  await c.env.DB.prepare('DELETE FROM groups WHERE id = ?1').bind(g.id).run();
  return json(c, { deleted: true });
});

/* ---------- GET /api/groups/:gid/glassbox (host): what the server stores, redacted ---------- */

groups.get('/:gid/glassbox', async (c) => {
  const { env } = c;
  const g = await authAdmin(env, c.get('deps'), pathId(c, 'gid'), bearerToken(c));
  const digest = (s: string) => base16.encode(sha256(new TextEncoder().encode(s))).slice(0, 8);
  const blob = (s: string) => ({ sealed: true as const, bytes: Math.floor((s.length * 3) / 4), fingerprint: digest(s) });
  const [members, assignments, commitments, reveals, privateReveals, events, acks, sent] = await Promise.all([
    env.DB.prepare('SELECT * FROM members WHERE group_id = ?1 ORDER BY id').bind(g.id).all<MemberRow>(),
    env.DB.prepare('SELECT giver_member_id, draw_version, sealed_bundle FROM assignments WHERE group_id = ?1').bind(g.id).all<{ giver_member_id: string; draw_version: number; sealed_bundle: string }>(),
    env.DB.prepare('SELECT recipient_member_id, draw_version, commitment FROM ack_commitments WHERE group_id = ?1').bind(g.id).all<{ recipient_member_id: string; draw_version: number; commitment: string }>(),
    // Same visibility rule as GET /reveals for a host: only reveals the giver chose to show the whole group. A private
    // ("recipient") reveal is between two people; the host sees that one exists, never who.
    env.DB.prepare('SELECT giver_member_id, recipient_member_id, audience, declared_day, recipient_confirmed_day FROM reveals WHERE group_id = ?1 AND audience = ?2').bind(g.id, 'group').all(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM reveals WHERE group_id = ?1 AND audience = 'recipient'").bind(g.id).first<{ n: number }>(),
    env.DB.prepare('SELECT type, day, version FROM audit_events WHERE group_id = ?1 ORDER BY id').bind(g.id).all(),
    env.DB.prepare("SELECT COALESCE(SUM(state = 'recipient_acknowledged'), 0) AS acknowledged, COALESCE(SUM(state = 'disputed'), 0) AS disputed FROM ack_commitments WHERE group_id = ?1").bind(g.id).first<{ acknowledged: number; disputed: number }>(),
    env.DB.prepare("SELECT COALESCE(SUM(sender_state = 'user_reports_sent'), 0) AS n FROM members WHERE group_id = ?1").bind(g.id).first<{ n: number }>(),
  ]);
  return json(c, {
    note: 'A redacted view of what the server holds for this group. Sealed values are shown as sizes and short fingerprints only. Per-person sent and confirmed states exist on the server but are deliberately not shown to you: only totals are.',
    groups: [
      {
        id: g.id,
        title: g.title,
        budget_cents: g.budget_cents,
        join_deadline: g.join_deadline,
        reveal_date: g.reveal_date,
        timezone: g.timezone,
        member_cap: g.member_cap,
        host_plays: g.host_plays,
        host_public_key: '(public key)',
        admin_token_hash: '(hash, not shown)',
        state: g.state,
        draw_version: g.draw_version,
        members_version: g.members_version,
        created_day: g.created_day,
        expires_at: g.expires_at,
      },
    ],
    members: members.results.map((m) => ({
      id: m.id,
      pseudonym: m.pseudonym,
      public_key: '(public key)',
      sealed_profile: blob(m.sealed_profile),
      address_commitment: m.address_commitment ? `${m.address_commitment.slice(0, 8)}…` : '',
      token_hash: '(hash, not shown)',
      status: m.status,
      joined_day: m.joined_day,
    })),
    assignments: assignments.results.map((a) => ({ giver_member_id: a.giver_member_id, draw_version: a.draw_version, sealed_bundle: blob(a.sealed_bundle) })),
    ack_commitments: commitments.results.map((k) => ({ recipient_member_id: k.recipient_member_id, draw_version: k.draw_version, commitment: `${k.commitment.slice(0, 8)}…` })),
    totals: { reportedSent: sent?.n ?? 0, acknowledged: acks?.acknowledged ?? 0, reportedProblem: acks?.disputed ?? 0 },
    reveals: reveals.results,
    privateRevealCount: privateReveals?.n ?? 0,
    audit_events: events.results,
    neverStored: ['wallet addresses in plain text', 'wishlists in plain text', 'memos or gift references in plain text', 'secret keys', 'seed phrases or viewing keys', 'IP addresses', 'which member is assigned to which (only after a consented reveal)'],
  });
});
