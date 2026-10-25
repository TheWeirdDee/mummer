import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fetchPriceFromProvider, resetPriceCacheForTests } from '../src/services.js';
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
