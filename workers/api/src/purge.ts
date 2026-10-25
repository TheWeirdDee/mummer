import type { Deps, Env } from './env.js';
import { purgeRateLimits } from './ratelimit.js';

/**
 * Scheduled retention enforcement: delete groups past their expiry (30 days
 * after the reveal date) and prune rate-limit buckets and human tickets.
 * Foreign keys cascade to every table holding group data.
 */
export async function purgeExpired(env: Env, deps: Deps): Promise<{ groupsDeleted: number }> {
  const now = deps.now();
  const r = await env.DB.prepare('DELETE FROM groups WHERE expires_at <= ?1').bind(now.toISOString()).run();
  await purgeRateLimits(env, now.getTime());
  return { groupsDeleted: r.meta.changes ?? 0 };
}
