import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { encodeKey, generateKeyPair, generateToken, hashToken } from '@mummer/crypto';
import { createWorld, createGroup, drawGroup, groupConfig, setupGroup, type World } from './harness.js';
import { parseUsdPrice } from '../src/services.js';
import { purgeExpired } from '../src/purge.js';

let w: World;
beforeAll(async () => {
  w = await createWorld();
}, 60_000);
beforeEach(() => w.clock.set('2026-11-01T12:00:00.000Z'));
afterAll(async () => {
  await w.dispose();
});

async function config(patch: Record<string, unknown> = {}) {
  const kp = await generateKeyPair();
  return groupConfig(encodeKey(kp.publicKey), hashToken(generateToken()), patch);
}

describe('POST /api/groups: creation', () => {
  it('creates a group, stores only the token HASH, and computes UTC instants in the group timezone', async () => {
    const c = w.client();
    const keys = await generateKeyPair();
    const token = generateToken();
    const r = await c.post('/api/groups', groupConfig(encodeKey(keys.publicKey), hashToken(token), { timezone: 'America/New_York', revealDate: '2026-12-24' }));
    expect(r.status).toBe(201);
    const row = await w.db.prepare('SELECT * FROM groups WHERE id = ?1').bind(r.body.groupId).first<Record<string, unknown>>();
    expect(row!.admin_token_hash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row!.state).toBe('open');
    expect(row!.reveal_at).toBe('2026-12-24T05:00:00.000Z');
    expect(row!.join_closes_at).toBe('2026-11-21T05:00:00.000Z');
    expect(row!.expires_at).toBe('2027-01-23T05:00:00.000Z'); // reveal + 30 days
  });

  it('is idempotent on identical resubmission and refuses a conflicting reuse of credentials', async () => {
    const c = w.client();
    const cfg = await config();
    const a = await c.post('/api/groups', cfg);
    const b = await c.post('/api/groups', cfg);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.groupId).toBe(a.body.groupId);
    const clash = await c.post('/api/groups', { ...cfg, title: 'A different group' });
    expect(clash.status).toBe(409);
    const count = await w.db.prepare('SELECT count(*) AS n FROM groups WHERE admin_token_hash = ?1').bind(cfg.adminTokenHash).first<{ n: number }>();
    expect(count!.n).toBe(1);
  });

  it.each([
    ['short title', { title: 'ab' }],
    ['title with control character', { title: 'x' + String.fromCharCode(1) + 'yz' }],
    ['budget too low', { budgetCents: 100 }],
    ['budget over the $250 cap', { budgetCents: 30_000 }],
    ['member cap 3', { memberCap: 3 }],
    ['member cap 51', { memberCap: 51 }],
    ['reveal not after deadline', { revealDate: '2026-11-20' }],
    ['bad timezone', { timezone: 'Moon/Base' }],
    ['non-boolean hostPlays', { hostPlays: 'yes' }],
    ['short public key', { hostPublicKey: 'abc' }],
    ['non-hex token hash', { adminTokenHash: 'z'.repeat(64) }],
    ['extra unknown field', { isAdmin: true }],
    ['join deadline in the past', { joinDeadline: '2026-10-01', revealDate: '2026-12-24' }],
    ['join deadline too far away', { joinDeadline: '2027-06-01', revealDate: '2027-06-10' }],
    ['reveal date too far away', { revealDate: '2027-09-01' }],
  ])('rejects: %s', async (_n, patch) => {
    const r = await w.client().post('/api/groups', await config(patch));
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('validation_failed');
  });

  it('rejects malformed JSON, non-JSON, empty and oversized bodies without leaking internals', async () => {
    const c = w.client();
    expect((await c.call('POST', '/api/groups', { raw: '{not json' })).status).toBe(400);
    expect((await c.call('POST', '/api/groups', { raw: '' })).status).toBe(400);
    expect((await c.call('POST', '/api/groups', { raw: '[]' })).status).toBe(422);
    expect((await c.call('POST', '/api/groups', { raw: JSON.stringify({ pad: 'x'.repeat(200_000) }) })).status).toBe(413);
    const bad = await c.call('POST', '/api/groups', { raw: '{"title":' });
    expect(JSON.stringify(bad.body)).not.toMatch(/stack|at \w+\.|SQLITE|\.ts/i);
  });

  it('rate-limits creation per client address (10 per hour) and recovers after the window', async () => {
    const c = w.client('198.51.100.77');
    for (let i = 0; i < 10; i++) expect((await c.post('/api/groups', await config())).status).toBe(201);
    const blocked = await c.post('/api/groups', await config());
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('rate_limited');
    // A different client is unaffected.
    expect((await w.client('198.51.100.78').post('/api/groups', await config())).status).toBe(201);
    w.clock.advanceMs(3601_000);
    expect((await c.post('/api/groups', await config())).status).toBe(201);
    w.clock.set('2026-11-01T12:00:00.000Z');
  });

  it('never stores a raw client address (only salted hashes in rate_limits)', async () => {
    const c = w.client('192.0.2.200');
    await c.post('/api/groups', await config());
    const rows = await w.db.prepare('SELECT * FROM rate_limits').all();
    expect(JSON.stringify(rows.results)).not.toContain('192.0.2.200');
  });
});

describe('human check (Turnstile) tickets', () => {
  it('in production, creation requires a single-use ticket obtained by passing the check', async () => {
    const prod = await createWorld({ ENVIRONMENT: 'production', TURNSTILE_SECRET: 'secret' });
    try {
      const c = prod.client();
      const cfg = await config();
      expect((await c.post('/api/groups', cfg)).status).toBe(403);
      expect((await c.post('/api/human/verify', { token: 'wrong' })).status).toBe(403);
      const v = await c.post('/api/human/verify', { token: 'turnstile-ok' });
      expect(v.status).toBe(200);
      expect(v.body.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const ok = await c.post('/api/groups', { ...cfg, humanTicket: v.body.ticket });
      expect(ok.status).toBe(201);
      // Single use: a second group with the same ticket is refused.
      const again = await c.post('/api/groups', { ...(await config()), humanTicket: v.body.ticket });
      expect(again.status).toBe(403);
      // Tickets are stored hashed.
      const stored = await prod.db.prepare('SELECT hash FROM human_tickets').all<{ hash: string }>();
      expect(JSON.stringify(stored.results)).not.toContain(v.body.ticket);
    } finally {
      await prod.dispose();
    }
  }, 60_000);

  it('tickets expire after ten minutes', async () => {
    const prod = await createWorld({ ENVIRONMENT: 'production', TURNSTILE_SECRET: 'secret' });
    try {
      const c = prod.client();
      const v = await c.post('/api/human/verify', { token: 'turnstile-ok' });
      prod.clock.advanceMs(601_000);
      const r = await c.post('/api/groups', { ...(await config()), humanTicket: v.body.ticket });
      expect(r.status).toBe(403);
    } finally {
      await prod.dispose();
    }
  }, 60_000);

  it('production fails CLOSED when no Turnstile secret is configured', async () => {
    const prod = await createWorld({ ENVIRONMENT: 'production' });
    try {
      const c = prod.client();
      expect((await c.post('/api/groups', await config())).status).toBe(403);
      expect((await c.post('/api/human/verify', { token: 'turnstile-ok' })).status).toBe(403);
      expect((await c.get('/api/config')).body.humanCheckRequired).toBe(true);
    } finally {
      await prod.dispose();
    }
  }, 60_000);

  it('a ticket is not consumed by an invalid request (validation runs first)', async () => {
    const prod = await createWorld({ ENVIRONMENT: 'production', TURNSTILE_SECRET: 'secret' });
    try {
      const c = prod.client();
      const v = await c.post('/api/human/verify', { token: 'turnstile-ok' });
      expect((await c.post('/api/groups', { ...(await config({ title: 'x' })), humanTicket: v.body.ticket })).status).toBe(422);
      expect((await c.post('/api/groups', { ...(await config()), humanTicket: v.body.ticket })).status).toBe(201);
    } finally {
      await prod.dispose();
    }
  }, 60_000);

  it('development without a secret does not require the check', async () => {
    expect((await w.client().get('/api/config')).body.humanCheckRequired).toBe(false);
    expect((await w.client().post('/api/human/verify', { token: 'x' })).body).toEqual({ required: false, ticket: null, expiresInSeconds: 0 });
  });
});

describe('GET /api/groups/:id/invite (public)', () => {
  it('shows configuration and the host public key, and nothing about members', async () => {
    const { c, host } = await setupGroup(w, 4);
    const r = await c.get(`/api/groups/${host.groupId}/invite`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ groupId: host.groupId, title: 'Winter Santa', budgetCents: 2500, memberCap: 20, state: 'open', joinOpen: true, spotsLeft: 16, hostPublicKey: encodeKey(host.keys.publicKey) });
    expect(JSON.stringify(r.body)).not.toMatch(/Ada|Grace|pseudonym|roster/);
  });

  it('reports joinOpen=false once the deadline passes, and 404 for unknown ids', async () => {
    const { c, host } = await setupGroup(w, 4);
    w.clock.set('2026-11-21T00:00:00.000Z');
    expect((await c.get(`/api/groups/${host.groupId}/invite`)).body.joinOpen).toBe(false);
    w.clock.set('2026-11-01T12:00:00.000Z');
    expect((await c.get(`/api/groups/${'b'.repeat(32)}/invite`)).status).toBe(404);
  });

  it('is rate limited per client', async () => {
    const { host } = await setupGroup(w, 4);
    const c = w.client('198.51.100.9');
    let last = 200;
    for (let i = 0; i < 61; i++) last = (await c.get(`/api/groups/${host.groupId}/invite`)).status;
    expect(last).toBe(429);
  });
});

describe('transitions', () => {
  it('lock / reopen / close', async () => {
    const { c, host } = await setupGroup(w, 4);
    const t = (action: string) => c.post(`/api/groups/${host.groupId}/transition`, { action }, host.token);
    expect((await t('lock')).body.state).toBe('locked');
    expect((await t('lock')).status).toBe(409);
    expect((await t('reopen')).body.state).toBe('open');
    expect((await t('reopen')).status).toBe(409);
    expect((await t('reset_draw')).status).toBe(409);
    expect((await t('flag_resolution')).status).toBe(409);
    expect((await t('close')).body.state).toBe('closed');
    expect((await t('close')).status).toBe(409);
    expect((await t('reopen')).status).toBe(409);
  });

  it('cannot reopen after the join deadline', async () => {
    const { c, host } = await setupGroup(w, 4);
    const t = (action: string) => c.post(`/api/groups/${host.groupId}/transition`, { action }, host.token);
    await t('lock');
    w.clock.set('2026-11-22T00:00:00.000Z');
    expect((await t('reopen')).status).toBe(409);
    w.clock.set('2026-11-01T12:00:00.000Z');
  });

  it('redraw reset is allowed only before payment activity, and wipes the draw', async () => {
    const { c, host, members } = await setupGroup(w, 4);
    await drawGroup(w, c, host, members);
    const t = (action: string) => c.post(`/api/groups/${host.groupId}/transition`, { action }, host.token);
    expect((await t('reset_draw')).body.state).toBe('locked');
    const n = async (table: string) => (await w.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE group_id = ?1`).bind(host.groupId).first<{ n: number }>())!.n;
    expect(await n('assignments')).toBe(0);
    expect(await n('ack_commitments')).toBe(0);
    const gv = await c.get(`/api/groups/${host.groupId}`, host.token);
    expect(gv.body.group.state).toBe('locked');
    expect(gv.body.group.drawVersion).toBe(1);
    // A second draw must use the next version.
    const bad = await drawGroup(w, c, host, members, { version: 1 });
    expect(bad.res.status).toBe(409);
    const good = await drawGroup(w, c, host, members, { version: 2 });
    expect(good.res.status).toBe(201);
    // After the first self-reported send, redraw is no longer possible.
    await c.post(`/api/groups/${host.groupId}/members/${members[0]!.id}/sent`, { drawVersion: 2 }, members[0]!.token);
    expect((await t('reset_draw')).status).toBe(409);
    expect((await t('flag_resolution')).body.state).toBe('needs_resolution');
    expect((await t('clear_resolution')).body.state).toBe('active');
  }, 60_000);

  it('rejects unknown actions and extra fields', async () => {
    const { c, host } = await setupGroup(w, 4);
    expect((await c.post(`/api/groups/${host.groupId}/transition`, { action: 'explode' }, host.token)).status).toBe(422);
    expect((await c.post(`/api/groups/${host.groupId}/transition`, { action: 'lock', extra: 1 }, host.token)).status).toBe(422);
  });
});

describe('retention and deletion', () => {
  it('an expired group is gone and its rows are purged', async () => {
    const { c, host, members } = await setupGroup(w, 4);
    await drawGroup(w, c, host, members);
    w.clock.set('2027-01-24T00:00:00.000Z'); // reveal 2026-12-24 + 30 days
    expect((await c.get(`/api/groups/${host.groupId}`, host.token)).status).toBe(401);
    for (const t of ['members', 'assignments', 'ack_commitments']) {
      const n = await w.db.prepare(`SELECT count(*) AS n FROM ${t} WHERE group_id = ?1`).bind(host.groupId).first<{ n: number }>();
      expect(n!.n).toBe(0);
    }
    w.clock.set('2026-11-01T12:00:00.000Z');
  }, 60_000);

  it('the scheduled purge deletes expired groups and old rate-limit rows, leaving live groups alone', async () => {
    const live = await setupGroup(w, 4);
    const dying = await setupGroup(w, 4);
    await w.db.prepare("UPDATE groups SET expires_at = '2026-11-02T00:00:00.000Z' WHERE id = ?1").bind(dying.host.groupId).run();
    w.clock.set('2026-11-03T00:00:00.000Z');
    const r = await purgeExpired(w.env, w.deps);
    expect(r.groupsDeleted).toBeGreaterThanOrEqual(1);
    expect(await w.db.prepare('SELECT 1 AS x FROM groups WHERE id = ?1').bind(dying.host.groupId).first()).toBeNull();
    expect(await w.db.prepare('SELECT 1 AS x FROM groups WHERE id = ?1').bind(live.host.groupId).first()).not.toBeNull();
    expect(await w.db.prepare('SELECT 1 AS x FROM members WHERE group_id = ?1').bind(dying.host.groupId).first()).toBeNull();
    w.clock.set('2026-11-01T12:00:00.000Z');
  }, 60_000);
});

describe('public endpoints', () => {
  it('health and config expose no secrets', async () => {
    const prod = await createWorld({ ENVIRONMENT: 'production', TURNSTILE_SECRET: 'super-secret-value', RATE_LIMIT_SALT: 'salty-secret', TURNSTILE_SITE_KEY: 'site-key-public' });
    try {
      const c = prod.client();
      const h = await c.get('/api/health');
      const cfg = await c.get('/api/config');
      expect(h.body).toMatchObject({ ok: true, environment: 'production', commit: 'test-commit' });
      expect(cfg.body).toEqual({ humanCheckRequired: true, turnstileSiteKey: 'site-key-public', environment: 'production', commit: 'test-commit' });
      for (const r of [h, cfg]) {
        expect(JSON.stringify(r.body)).not.toContain('super-secret-value');
        expect(JSON.stringify(r.body)).not.toContain('salty-secret');
      }
    } finally {
      await prod.dispose();
    }
  }, 60_000);

  it('price: exact decimal, timestamped, with an expiry; fails closed when the provider is down', async () => {
    const c = w.client();
    const r = await c.get('/api/price');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ usdPerZec: '31.54000000', asOf: '2026-11-01T12:00:00.000Z', validUntil: '2026-11-01T12:10:00.000Z', source: 'test' });
    w.priceFails.value = true;
    const down = await w.client().get('/api/price');
    expect(down.status).toBe(500); // injected failure is not an HttpError; production failures map to 503 quote_unavailable
    w.priceFails.value = false;
  });

  it('parseUsdPrice extracts an exact decimal and rejects junk', () => {
    expect(parseUsdPrice('{"zcash":{"usd":31.54}}')).toBe('31.54000000');
    expect(parseUsdPrice('{"zcash": {"usd": 1234}}')).toBe('1234.00000000');
    expect(parseUsdPrice('{"zcash":{"usd":1.123456789123}}')).toBe('1.12345678');
    // Sanity bounds: an absurd upstream value must not become an absurd payment amount.
    expect(parseUsdPrice('{"zcash":{"usd":0.5}}')).toBeUndefined();
    expect(parseUsdPrice('{"zcash":{"usd":10001}}')).toBeUndefined();
    expect(parseUsdPrice('{"zcash":{"usd":10000}}')).toBe('10000.00000000');
    expect(parseUsdPrice('{"zcash":{"usd":0}}')).toBeUndefined();
    expect(parseUsdPrice('{"zcash":{"usd":"31.5"}}')).toBeUndefined();
    expect(parseUsdPrice('{"zcash":{"usd":1e3}}')).toBeUndefined();
    expect(parseUsdPrice('{"bitcoin":{"usd":5}}')).toBeUndefined();
    expect(parseUsdPrice('<html>')).toBeUndefined();
    expect(parseUsdPrice('{"zcash":{"usd":99999999}}')).toBeUndefined();
  });

  it('stats are withheld until 5 groups exist, then rounded down to multiples of 5, and survive deletion', async () => {
    const fresh = await createWorld();
    try {
      const c = fresh.client();
      expect((await c.get('/api/stats')).body.available).toBe(false);
      const hosts = [];
      for (let i = 0; i < 7; i++) hosts.push(await createGroup(c));
      const s = await c.get('/api/stats');
      expect(s.body).toMatchObject({ available: true, roundedDownTo: 5, groups: 5, members: 0, giftsAcknowledged: 0 });
      await c.del(`/api/groups/${hosts[0]!.groupId}`, hosts[0]!.token);
      expect((await c.get('/api/stats')).body.groups).toBe(5);
      expect(JSON.stringify(s.body)).not.toMatch(/[0-9a-f]{32}/);
    } finally {
      await fresh.dispose();
    }
  }, 60_000);
});

describe('security headers and routing', () => {
  it('every API response (success and error) carries the full header set', async () => {
    const { c, host } = await setupGroup(w, 4);
    const responses = [await c.get('/api/health'), await c.get(`/api/groups/${host.groupId}`, host.token), await c.get(`/api/groups/${host.groupId}`), await c.get('/api/nope'), await c.post('/api/groups', {})];
    for (const r of responses) {
      expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
      expect(r.headers.get('content-security-policy')).not.toMatch(/'unsafe-inline'|'unsafe-eval'|https?:\/\//);
      expect(r.headers.get('content-security-policy')).toContain("script-src 'self' 'wasm-unsafe-eval'");
      expect(r.headers.get('referrer-policy')).toBe('no-referrer');
      expect(r.headers.get('strict-transport-security')).toContain('max-age=63072000');
      expect(r.headers.get('x-content-type-options')).toBe('nosniff');
      expect(r.headers.get('x-frame-options')).toBe('DENY');
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(r.headers.get('permissions-policy')).toContain('camera=()');
      expect(r.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    }
  });

  it('unknown API routes return a JSON 404; non-GET to non-API paths 404; no CORS headers are ever emitted', async () => {
    const c = w.client();
    const r = await c.get('/api/does-not-exist');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('not_found');
    expect((await c.post('/somewhere', {})).status).toBe(404);
    const withOrigin = await c.call('GET', '/api/health', { headers: { origin: 'https://evil.example' } });
    expect(withOrigin.headers.get('access-control-allow-origin')).toBeNull();
    const preflight = await c.call('OPTIONS', '/api/groups', { headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('server errors are generic and never echo request data', async () => {
    const c = w.client();
    w.priceFails.value = true;
    const r = await c.get('/api/price');
    expect(r.body.error.code).toBe('internal');
    expect(JSON.stringify(r.body)).not.toContain('down');
    w.priceFails.value = false;
  });
});

describe('glass-box (host only, redacted)', () => {
  it('shows every stored row with sealed values as sizes and fingerprints only', async () => {
    const { c, host, members } = await setupGroup(w, 4);
    await drawGroup(w, c, host, members);
    const r = await c.get(`/api/groups/${host.groupId}/glassbox`, host.token);
    expect(r.status).toBe(200);
    expect(r.body.members).toHaveLength(4);
    expect(r.body.members[0].sealed_profile).toMatchObject({ sealed: true });
    expect(r.body.assignments).toHaveLength(4);
    const text = JSON.stringify(r.body);
    for (const m of members) {
      expect(text).not.toContain(m.address);
      expect(text).not.toContain(m.wishlist);
      expect(text).not.toContain(m.token);
      expect(text).not.toContain(hashToken(m.token));
    }
    expect(text).not.toContain(host.token);
    expect(text).not.toContain(hashToken(host.token));
    expect(r.body.neverStored.length).toBeGreaterThan(3);
    expect((await c.get(`/api/groups/${host.groupId}/glassbox`, members[0]!.token)).status).toBe(401);
  }, 60_000);
});
