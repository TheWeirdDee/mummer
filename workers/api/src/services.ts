import { HttpError, type Deps, type Env, type PriceQuote } from './env.js';

/* ---------------- Price quote (first-party proxy, fail closed) ---------------- */

const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=zcash&vs_currencies=usd';
const KRAKEN_URL = 'https://api.kraken.com/0/public/Ticker?pair=ZECUSD';
const CACHE_MS = 60_000;
/** A quote older than this is never served, even if the upstream is down. */
const MAX_STALE_MS = 5 * 60_000;

let cached: { quote: PriceQuote; at: number } | undefined;

/** Exact decimal extraction from the raw JSON text, so no binary floating point touches the value. */
const MIN_USD_PER_ZEC = 1;
const MAX_USD_PER_ZEC = 10_000;

function normalisePrice(decimal: string): string | undefined {
  const [whole, frac = ''] = decimal.split('.');
  if (whole!.length > 7) return undefined;
  const rounded = frac.padEnd(8, '0').slice(0, 8);
  const price = `${whole}.${rounded}`;
  const n = Number(price);
  // Sanity bounds: a wildly wrong upstream value (or a tampered price URL) must not turn into a wildly wrong payment amount.
  return n >= MIN_USD_PER_ZEC && n <= MAX_USD_PER_ZEC ? price : undefined;
}

/** CoinGecko: {"zcash":{"usd":123.45}}. */
export function parseUsdPrice(text: string): string | undefined {
  const m = /"zcash"\s*:\s*\{\s*"usd"\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*\}/.exec(text);
  return m ? normalisePrice(m[1]!) : undefined;
}

/** Kraken: {"error":[],"result":{"XZECZUSD":{...,"c":["123.45000","0.5"],...}}}; "c" is the last trade. */
export function parseKrakenPrice(text: string): string | undefined {
  const m = /"error"\s*:\s*\[\s*\][\s\S]*?"XZECZUSD"\s*:\s*\{[\s\S]*?"c"\s*:\s*\[\s*"([0-9]+(?:\.[0-9]+)?)"/.exec(text);
  return m ? normalisePrice(m[1]!) : undefined;
}

interface PriceProvider {
  url: string;
  parse(text: string): string | undefined;
}

export async function fetchPriceFromProvider(env: Env, nowMs: number): Promise<PriceQuote> {
  if (cached && nowMs - cached.at < CACHE_MS) return cached.quote;
  // CoinGecko answers 403 to requests that come from Cloudflare Workers, found on the first deployment, so a second public source
  // follows it. A configured PRICE_URL (tests, alternative providers) replaces both and is read as CoinGecko's format.
  const providers: PriceProvider[] = env.PRICE_URL
    ? [{ url: env.PRICE_URL, parse: parseUsdPrice }]
    : [
        { url: COINGECKO_URL, parse: parseUsdPrice },
        { url: KRAKEN_URL, parse: parseKrakenPrice },
      ];
  const reasons: string[] = [];
  for (const p of providers) {
    try {
      const res = await fetch(p.url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`upstream ${res.status}`);
      const text = await res.text();
      if (text.length > 4096) throw new Error('unexpected response size');
      const usdPerZec = p.parse(text);
      if (!usdPerZec) throw new Error('unparseable price');
      const quote: PriceQuote = { usdPerZec, asOf: new Date(nowMs).toISOString(), source: new URL(p.url).hostname };
      cached = { quote, at: nowMs };
      return quote;
    } catch (e) {
      // The reason only (an HTTP status, a size or parse problem, a timeout): never the response body, which could be anything.
      reasons.push(`${new URL(p.url).hostname}: ${String((e as Error)?.message ?? e).slice(0, 60)}`);
    }
  }
  console.error('price_unavailable', { reasons });
  if (cached && nowMs - cached.at < MAX_STALE_MS) return cached.quote;
  throw new HttpError(503, 'quote_unavailable', 'A ZEC price is not available right now. Try again in a minute, or copy the details and set the amount in your wallet.');
}

export function resetPriceCacheForTests(): void {
  cached = undefined;
}

/* ---------------- Cloudflare Turnstile ---------------- */

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile(token: string, ip: string | undefined, env: Env): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return false;
  try {
    const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
    if (ip && ip !== 'unknown') form.set('remoteip', ip);
    const res = await fetch(SITEVERIFY, { method: 'POST', body: form, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean; hostname?: string; metadata?: { result_with_testing_key?: boolean } };
    if (data.success !== true) return false;
    // Cloudflare's public TEST keys (used only by the staging deployment) answer with a placeholder hostname and say so. A test
    // secret accepts any token anyway, so the binding adds nothing there; with a real key it always applies.
    if (data.metadata?.result_with_testing_key === true) return true;
    // The token must have been solved on the human-check host, not on some other site that holds the same site key.
    const expected = hostOf(env.HUMAN_CHECK_ORIGIN);
    if (expected && data.hostname !== expected) return false;
    return true;
  } catch {
    return false;
  }
}

function hostOf(origin: string | undefined): string | undefined {
  if (!origin) return undefined;
  try {
    return new URL(origin).hostname;
  } catch {
    return undefined;
  }
}

export const defaultDeps: Deps = {
  now: () => new Date(),
  verifyHuman: verifyTurnstile,
  fetchPrice: (env) => fetchPriceFromProvider(env, Date.now()),
};

/** Human checks are enforced unless this is a non-production environment with no Turnstile secret configured. */
export function humanCheckRequired(env: Env): boolean {
  // Relaxed ONLY for the explicit development/test environments with no secret; any other value (or none) is treated as production.
  if (env.ENVIRONMENT !== 'development' && env.ENVIRONMENT !== 'test') return true;
  return Boolean(env.TURNSTILE_SECRET);
}
