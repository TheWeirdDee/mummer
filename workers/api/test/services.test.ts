import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPriceFromProvider, parseKrakenPrice, parseUsdPrice, resetPriceCacheForTests, verifyTurnstile } from '../src/services.js';
import { HttpError, type Env } from '../src/env.js';
import { usdCentsToZat } from '@mummer/zcash';

let server: Server;
let url: string;
let mode: 'ok' | 'error' | 'junk' | 'huge' | 'hang' = 'ok';
let hits = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    hits++;
    if (mode === 'error') {
      res.writeHead(503).end('down');
    } else if (mode === 'junk') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"zcash":{"usd":"free"}}');
    } else if (mode === 'huge') {
      res.writeHead(200).end('x'.repeat(10_000));
    } else if (mode === 'hang') {
      /* never respond */
    } else {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"zcash":{"usd":31.54}}');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/price`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});
beforeEach(() => {
  resetPriceCacheForTests();
  mode = 'ok';
  hits = 0;
});

const env = () => ({ PRICE_URL: url }) as unknown as Env;

describe('price provider (real fetch path)', () => {
  it('returns an exact decimal quote with its timestamp and source', async () => {
    const q = await fetchPriceFromProvider(env(), Date.parse('2026-11-01T12:00:00Z'));
    expect(q).toEqual({ usdPerZec: '31.54000000', asOf: '2026-11-01T12:00:00.000Z', source: '127.0.0.1' });
  });

  it('caches for 60 seconds, then refreshes', async () => {
    const t0 = Date.parse('2026-11-01T12:00:00Z');
    await fetchPriceFromProvider(env(), t0);
    await fetchPriceFromProvider(env(), t0 + 59_000);
    expect(hits).toBe(1);
    await fetchPriceFromProvider(env(), t0 + 61_000);
    expect(hits).toBe(2);
  });

  it('serves a recent cached quote if the upstream fails, but never one older than five minutes', async () => {
    const t0 = Date.parse('2026-11-01T12:00:00Z');
    await fetchPriceFromProvider(env(), t0);
    mode = 'error';
    const stale = await fetchPriceFromProvider(env(), t0 + 120_000);
    expect(stale.asOf).toBe('2026-11-01T12:00:00.000Z');
    await expect(fetchPriceFromProvider(env(), t0 + 301_000)).rejects.toMatchObject({ status: 503, code: 'quote_unavailable' });
  });

  it.each(['error', 'junk', 'huge'] as const)('fails CLOSED with 503 when the upstream is %s and nothing is cached', async (m) => {
    mode = m;
    const e = await fetchPriceFromProvider(env(), Date.now()).catch((x) => x);
    expect(e).toBeInstanceOf(HttpError);
    expect(e.status).toBe(503);
    expect(e.code).toBe('quote_unavailable');
  });

  it('fails closed on a hung upstream within the timeout', async () => {
    mode = 'hang';
    const t = Date.now();
    const e = await fetchPriceFromProvider(env(), Date.now()).catch((x) => x);
    expect(e.status).toBe(503);
    expect(Date.now() - t).toBeLessThan(6000);
  }, 10_000);

  it('the quote converts to the budget in exact integer zatoshis (end to end with the zcash package)', async () => {
    const q = await fetchPriceFromProvider(env(), Date.now());
    expect(usdCentsToZat(2500, q.usdPerZec)).toBe(79_260_000n); // $25 / $31.54 = 0.792644...; rounded to 4 decimals = 0.7926 ZEC
  });
});

describe('Turnstile verification', () => {
  const env = (extra: Record<string, string> = {}) => ({ ENVIRONMENT: 'production', TURNSTILE_SECRET: 'test-secret-not-real', ...extra }) as unknown as import('../src/env.js').Env;
  const stub = (body: unknown, ok = true) => vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body), { status: ok ? 200 : 500 }));
  afterEach(() => vi.unstubAllGlobals());

  it('accepts a successful verification and refuses a failed or malformed one', async () => {
    stub({ success: true, hostname: 'mummer-check.example.workers.dev' });
    expect(await verifyTurnstile('tok', undefined, env())).toBe(true);
    stub({ success: false });
    expect(await verifyTurnstile('tok', undefined, env())).toBe(false);
    stub({ success: true }, false);
    expect(await verifyTurnstile('tok', undefined, env())).toBe(false);
    vi.stubGlobal('fetch', async () => {
      throw new Error('network');
    });
    expect(await verifyTurnstile('tok', undefined, env())).toBe(false);
    expect(await verifyTurnstile('tok', undefined, { ENVIRONMENT: 'production' } as never)).toBe(false); // no secret: fails closed
  });

  it('when the check host is configured, a token solved on any other hostname is refused', async () => {
    const e = env({ HUMAN_CHECK_ORIGIN: 'https://mummer-check.example.workers.dev' });
    stub({ success: true, hostname: 'mummer-check.example.workers.dev' });
    expect(await verifyTurnstile('tok', undefined, e)).toBe(true);
    stub({ success: true, hostname: 'evil.example.com' });
    expect(await verifyTurnstile('tok', undefined, e)).toBe(false);
    stub({ success: true });
    expect(await verifyTurnstile('tok', undefined, e)).toBe(false);
  });

  it('the public Cloudflare test keys answer with a placeholder hostname and say so: that is accepted, and only that', async () => {
    const e = env({ HUMAN_CHECK_ORIGIN: 'https://mummer-check.example.workers.dev' });
    stub({ success: true, hostname: 'example.com', metadata: { result_with_testing_key: true } });
    expect(await verifyTurnstile('tok', undefined, e)).toBe(true);
    // The marker must be exactly true, and a failure is still a failure.
    stub({ success: true, hostname: 'example.com', metadata: { result_with_testing_key: false } });
    expect(await verifyTurnstile('tok', undefined, e)).toBe(false);
    stub({ success: false, hostname: 'example.com', metadata: { result_with_testing_key: true } });
    expect(await verifyTurnstile('tok', undefined, e)).toBe(false);
  });
});

describe('price sources', () => {
  const KRAKEN = '{"error":[],"result":{"XZECZUSD":{"a":["1296.69000","1","1.000"],"b":["1296.00000","1","1.000"],"c":["1296.44000","0.05572753"],"v":["1","2"]}}}';
  const env = {} as unknown as Env; // no PRICE_URL: the real provider list
  const stubByUrl = (handlers: Record<string, () => Response>) =>
    vi.stubGlobal('fetch', async (u: string) => {
      const h = Object.entries(handlers).find(([k]) => String(u).includes(k));
      if (!h) throw new Error('unexpected url ' + u);
      return h[1]();
    });
  beforeEach(() => resetPriceCacheForTests());
  afterEach(() => vi.unstubAllGlobals());

  it('parses Kraken\'s last trade exactly, with the same sanity bounds', () => {
    expect(parseKrakenPrice(KRAKEN)).toBe('1296.44000000');
    expect(parseKrakenPrice(KRAKEN.replace('1296.44000', '0.5'))).toBeUndefined(); // below the minimum
    expect(parseKrakenPrice(KRAKEN.replace('1296.44000', '99999'))).toBeUndefined(); // above the maximum
    expect(parseKrakenPrice('{"error":["EQuery:Unknown asset pair"],"result":{}}')).toBeUndefined();
    expect(parseKrakenPrice('nonsense')).toBeUndefined();
    expect(parseUsdPrice('{"zcash":{"usd":1296.29}}')).toBe('1296.29000000');
  });

  it('uses CoinGecko first, and falls back to Kraken when CoinGecko refuses the request', async () => {
    stubByUrl({ coingecko: () => new Response('{"zcash":{"usd":1301.45}}') });
    expect((await fetchPriceFromProvider(env, Date.now())).source).toBe('api.coingecko.com');
    resetPriceCacheForTests();
    stubByUrl({ coingecko: () => new Response('forbidden', { status: 403 }), kraken: () => new Response(KRAKEN) });
    const q = await fetchPriceFromProvider(env, Date.now());
    expect(q.source).toBe('api.kraken.com');
    expect(q.usdPerZec).toBe('1296.44000000');
  });

  it('fails closed when every source fails or returns something unusable', async () => {
    stubByUrl({ coingecko: () => new Response('forbidden', { status: 403 }), kraken: () => new Response('{"error":[],"result":{}}') });
    await expect(fetchPriceFromProvider(env, Date.now())).rejects.toMatchObject({ code: 'quote_unavailable' });
  });
});
