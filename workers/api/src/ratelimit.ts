import { base16 } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { HttpError, type Env } from './env.js';

/**
 * Fixed-window rate limiting in D1. Buckets are salted SHA-256 hashes of
 * (scope, client key): the client address is never stored in clear. Hashing an
 * IP does not make it invisible at the network edge (see docs/PRIVACY.md); the
 * hash exists only so a database dump does not contain raw addresses.
 */

const enc = new TextEncoder();

export function bucketKey(env: Env, scope: string, client: string): string {
  const salt = env.RATE_LIMIT_SALT ?? 'mummer-dev-salt';
  return base16.encode(sha256(enc.encode(`${salt}\u{1f}${scope}\u{1f}${client}`))).toLowerCase();
}

export interface LimitSpec {
  scope: string;
  limit: number;
  windowSeconds: number;
}

/** Count one hit and throw 429 if over the limit. */
export async function hit(env: Env, nowMs: number, spec: LimitSpec, client: string): Promise<void> {
  const bucket = bucketKey(env, spec.scope, client);
  const now = Math.floor(nowMs / 1000);
  const cutoff = now - spec.windowSeconds;
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (bucket, window_start, count) VALUES (?1, ?2, 1)
     ON CONFLICT (bucket) DO UPDATE SET
       count = CASE WHEN window_start <= ?3 THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN window_start <= ?3 THEN ?2 ELSE window_start END
     RETURNING count`,
  )
    .bind(bucket, now, cutoff)
    .first<{ count: number }>();
  if (!row || row.count > spec.limit) throw new HttpError(429, 'rate_limited', 'Too many requests. Please wait a while and try again.');
}

/** Read the current count without incrementing (used to gate expensive checks before consuming an attempt). */
export async function peek(env: Env, nowMs: number, spec: LimitSpec, client: string): Promise<number> {
  const bucket = bucketKey(env, spec.scope, client);
  const cutoff = Math.floor(nowMs / 1000) - spec.windowSeconds;
  const row = await env.DB.prepare('SELECT count FROM rate_limits WHERE bucket = ?1 AND window_start > ?2').bind(bucket, cutoff).first<{ count: number }>();
  return row?.count ?? 0;
}

export async function purgeRateLimits(env: Env, nowMs: number): Promise<void> {
  const cutoff = Math.floor(nowMs / 1000) - 2 * 3600;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?1').bind(cutoff),
    env.DB.prepare('DELETE FROM human_tickets WHERE expires_at < ?1').bind(Math.floor(nowMs / 1000)),
  ]);
}
