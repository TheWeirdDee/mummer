import { HttpError, type Deps, type Env, type PriceQuote } from './env.js';

/* ---------------- Price quote (first-party proxy, fail closed) ---------------- */

const DEFAULT_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=zcash&vs_currencies=usd';
const CACHE_MS = 60_000;
/** A quote older than this is never served, even if the upstream is down. */
const MAX_STALE_MS = 5 * 60_000;

let cached: { quote: PriceQuote; at: number } | undefined;

/** Exact decimal extraction from the raw JSON text, so no binary floating point touches the value. */
const MIN_USD_PER_ZEC = 1;
const MAX_USD_PER_ZEC = 10_000;

export function parseUsdPrice(text: string): string | undefined {
  const m = /"zcash"\s*:\s*\{\s*"usd"\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*\}/.exec(text);
  if (!m) return undefined;
  const [whole, frac = ''] = m[1]!.split('.');
  if (whole!.length > 7) return undefined;
  const rounded = frac.padEnd(8, '0').slice(0, 8);
  const price = `${whole}.${rounded}`;
  const n = Number(price);
  // Sanity bounds: a wildly wrong upstream value (or a tampered price URL) must not turn into a wildly wrong payment amount.
  return n >= MIN_USD_PER_ZEC && n <= MAX_USD_PER_ZEC ? price : undefined;
}

export async function fetchPriceFromProvider(env: Env, nowMs: number): Promise<PriceQuote> {
  if (cached && nowMs - cached.at < CACHE_MS) return cached.quote;
  const url = env.PRICE_URL ?? DEFAULT_PRICE_URL;
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const text = await res.text();
    if (text.length > 4096) throw new Error('unexpected response size');
    const usdPerZec = parseUsdPrice(text);
    if (!usdPerZec) throw new Error('unparseable price');
    const quote: PriceQuote = { usdPerZec, asOf: new Date(nowMs).toISOString(), source: new URL(url).hostname };
    cached = { quote, at: nowMs };
    return quote;
  } catch {
    if (cached && nowMs - cached.at < MAX_STALE_MS) return cached.quote;
    throw new HttpError(503, 'quote_unavailable', 'A ZEC price is not available right now. Try again in a minute, or copy the details and set the amount in your wallet.');
  }
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
