import { timingSafeEqual, hashToken } from '@mummer/crypto/light';
import { dayBucket, type GroupState } from '@mummer/shared';
import { HttpError, type Deps, type Env } from './env.js';

export interface GroupRow {
  id: string;
  title: string;
  budget_cents: number;
  join_deadline: string;
  reveal_date: string;
  timezone: string;
  join_closes_at: string;
  reveal_at: string;
  member_cap: number;
  host_plays: number;
  host_public_key: string;
  admin_token_hash: string;
  state: GroupState;
  draw_version: number;
  draw_idempotency_key: string | null;
  created_day: string;
  expires_at: string;
  members_version: number;
}

export interface MemberRow {
  group_id: string;
  id: string;
  pseudonym: string;
  pseudonym_key: string;
  public_key: string;
  sealed_profile: string;
  token_hash: string;
  status: 'ready' | 'assigned' | 'removed' | 'revoked';
  sender_state: 'not_started' | 'user_reports_sent';
  joined_day: string;
  address_commitment: string;
}

/** A hash no token can produce, used to equalise timing when a lookup misses. */
const DUMMY_HASH = '0'.repeat(64);

/**
 * Load a group, applying lazy time-based transitions:
 *  - an expired group is purged and reported as not found;
 *  - an `open` group whose join window has ended becomes `locked`.
 * Returns undefined if the group does not exist (or has just been purged).
 */
export async function loadGroup(env: Env, deps: Deps, id: string): Promise<GroupRow | undefined> {
  const now = deps.now();
  let g = await env.DB.prepare('SELECT * FROM groups WHERE id = ?1').bind(id).first<GroupRow>();
  if (!g) return undefined;
  if (Date.parse(g.expires_at) <= now.getTime()) {
    await env.DB.prepare('DELETE FROM groups WHERE id = ?1').bind(id).run();
    return undefined;
  }
  if (g.state === 'open' && Date.parse(g.join_closes_at) <= now.getTime()) {
    await env.DB.prepare("UPDATE groups SET state = 'locked' WHERE id = ?1 AND state = 'open'").bind(id).run();
    g = { ...g, state: 'locked' };
  }
  return g;
}

/** Authenticate the host. Unknown group and wrong token are indistinguishable (401). */
export async function authAdmin(env: Env, deps: Deps, groupId: string, token: string | undefined): Promise<GroupRow> {
  const g = await loadGroup(env, deps, groupId);
  const presented = token ? hashToken(token) : DUMMY_HASH;
  const ok = timingSafeEqual(presented, g?.admin_token_hash ?? DUMMY_HASH);
  if (!g || !token || !ok) throw new HttpError(401, 'unauthorized', 'Missing or invalid credentials');
  return g;
}

/** Authenticate a specific member of a group. Revoked/removed members are rejected. */
export async function authMember(
  env: Env,
  deps: Deps,
  groupId: string,
  memberId: string,
  token: string | undefined,
): Promise<{ group: GroupRow; member: MemberRow }> {
  const group = await loadGroup(env, deps, groupId);
  const member = group
    ? await env.DB.prepare('SELECT * FROM members WHERE group_id = ?1 AND id = ?2').bind(groupId, memberId).first<MemberRow>()
    : null;
  const presented = token ? hashToken(token) : DUMMY_HASH;
  const ok = timingSafeEqual(presented, member?.token_hash ?? DUMMY_HASH);
  if (!group || !member || !token || !ok || member.status === 'revoked' || member.status === 'removed') {
    throw new HttpError(401, 'unauthorized', 'Missing or invalid credentials');
  }
  return { group, member };
}

/** Authenticate as host OR any member of the group, by token alone (used by the group overview). */
export async function authAdminOrMember(
  env: Env,
  deps: Deps,
  groupId: string,
  token: string | undefined,
): Promise<{ group: GroupRow; role: 'admin' | 'member'; member?: MemberRow }> {
  const group = await loadGroup(env, deps, groupId);
  const presented = token ? hashToken(token) : DUMMY_HASH;
  if (group && token && timingSafeEqual(presented, group.admin_token_hash)) return { group, role: 'admin' };
  const member = group && token
    ? await env.DB.prepare('SELECT * FROM members WHERE group_id = ?1 AND token_hash = ?2').bind(groupId, presented).first<MemberRow>()
    : null;
  if (!group || !member || member.status === 'revoked' || member.status === 'removed') {
    throw new HttpError(401, 'unauthorized', 'Missing or invalid credentials');
  }
  return { group, role: 'member', member };
}

export function bumpStat(env: Env, key: 'groups_created' | 'members_joined' | 'gifts_acknowledged'): D1PreparedStatement {
  return env.DB.prepare('INSERT INTO stats (key, value) VALUES (?1, 1) ON CONFLICT (key) DO UPDATE SET value = value + 1').bind(key);
}

/**
 * Insert a group-level audit event. With `onlyIfChanged`, the event is recorded only if the statement immediately
 * before it in the batch changed a row (SQLite changes()), so a lost compare-and-swap leaves no false event.
 */
export function audit(env: Env, deps: Deps, groupId: string, type: string, version = 0, onlyIfChanged = false): D1PreparedStatement {
  if (onlyIfChanged) {
    return env.DB.prepare('INSERT INTO audit_events (group_id, type, day, version) SELECT ?1, ?2, ?3, ?4 WHERE changes() > 0').bind(groupId, type, dayBucket(deps.now()), version);
  }
  return env.DB.prepare('INSERT INTO audit_events (group_id, type, day, version) VALUES (?1, ?2, ?3, ?4)').bind(groupId, type, dayBucket(deps.now()), version);
}

/** Normalise a display name for case/width-insensitive uniqueness. */
export function pseudonymKey(name: string): string {
  return name.normalize('NFKC').toLowerCase();
}
