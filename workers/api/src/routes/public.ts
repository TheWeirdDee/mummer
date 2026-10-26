import { Hono } from 'hono';
import { generateToken } from '@mummer/crypto/light';
import { humanVerifyBody } from '@mummer/shared';
import { HttpError, type AppBindings } from '../env.js';
import { json, readBody } from '../http.js';
import { issueTicket, TICKET_TTL_SECONDS } from '../human.js';
import { hit } from '../ratelimit.js';
import { humanCheckRequired } from '../services.js';

export const publicRoutes = new Hono<AppBindings>();

publicRoutes.get('/health', (c) =>
  json(c, { ok: true, environment: c.env.ENVIRONMENT, commit: c.env.BUILD_COMMIT ?? 'unknown', time: c.get('deps').now().toISOString() }),
);

/** Public client configuration: no secrets, only what the browser needs. */
publicRoutes.get('/config', (c) =>
  json(c, {
    humanCheckRequired: humanCheckRequired(c.env),
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY ?? null,
    environment: c.env.ENVIRONMENT,
    commit: c.env.BUILD_COMMIT ?? 'unknown',
  }),
);

publicRoutes.post('/human/verify', async (c) => {
  const deps = c.get('deps');
  if (!humanCheckRequired(c.env)) return json(c, { required: false, ticket: null, expiresInSeconds: 0 });
  // Fail closed independently of the verifier: a required check with no configured secret can never pass.
  if (!c.env.TURNSTILE_SECRET) throw new HttpError(403, 'human_check_failed', 'The human check is not available right now.');
  await hit(c.env, deps.now().getTime(), { scope: 'human-verify', limit: 30, windowSeconds: 3600 }, c.get('ip'));
  const { token } = await readBody(c, humanVerifyBody);
  const ok = await deps.verifyHuman(token, c.get('ip'), c.env);
  if (!ok) throw new HttpError(403, 'human_check_failed', 'The human check did not pass. Please try again.');
  const ticket = generateToken();
  await issueTicket(c.env, deps, ticket);
  return json(c, { required: true, ticket, expiresInSeconds: TICKET_TTL_SECONDS });
});

/** USD per ZEC from a first-party proxy, so participants' browsers never call a third party. Fails closed. */
publicRoutes.get('/price', async (c) => {
  const deps = c.get('deps');
  await hit(c.env, deps.now().getTime(), { scope: 'price', limit: 60, windowSeconds: 60 }, c.get('ip'));
  const q = await deps.fetchPrice(c.env);
  const validUntil = new Date(Date.parse(q.asOf) + 10 * 60_000).toISOString();
  return json(c, { usdPerZec: q.usdPerZec, asOf: q.asOf, validUntil, source: q.source });
});

const STATS_MIN_GROUPS = 5;
const ROUND_TO = 5;

/**
 * Aggregate counters only, published only once enough groups exist and rounded
 * down to a multiple of five, so a single small group's activity cannot be
 * read off the numbers.
 */
publicRoutes.get('/stats', async (c) => {
  const rows = await c.env.DB.prepare('SELECT key, value FROM stats').all<{ key: string; value: number }>();
  const v = Object.fromEntries(rows.results.map((r) => [r.key, r.value]));
  if ((v.groups_created ?? 0) < STATS_MIN_GROUPS) {
    return json(c, { available: false, reason: `Counts are published once at least ${STATS_MIN_GROUPS} exchanges have been created.` });
  }
  const floor = (n: number | undefined) => Math.floor((n ?? 0) / ROUND_TO) * ROUND_TO;
  return json(c, { available: true, roundedDownTo: ROUND_TO, groups: floor(v.groups_created), members: floor(v.members_joined), giftsAcknowledged: floor(v.gifts_acknowledged) });
});
