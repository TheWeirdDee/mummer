import type { ApiErrorCode } from '@mummer/shared';

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  /** 'production' enables every protection unconditionally; 'development' and 'test' may relax the human check. */
  ENVIRONMENT: string;
  /** Secret. Cloudflare Turnstile server secret. */
  TURNSTILE_SECRET?: string;
  /** Public. Turnstile site key served to the browser through /api/config. */
  TURNSTILE_SITE_KEY?: string;
  /** Public. Origin of the separate human-check host (the `mummer-check` Worker), for example https://mummer-check.example.workers.dev. Required in production. */
  HUMAN_CHECK_ORIGIN?: string;
  /** Secret. Salt for hashing client addresses in rate-limit buckets. */
  RATE_LIMIT_SALT?: string;
  /** Public. Git commit of the deployed build, exposed by /api/health. */
  BUILD_COMMIT?: string;
  /** Optional override of the public price endpoint (tests, alternative providers). */
  PRICE_URL?: string;
}

export interface PriceQuote {
  /** Exact decimal string, USD per 1 ZEC. */
  usdPerZec: string;
  asOf: string;
  source: string;
}

/** Injectable collaborators so behaviour is deterministic under test. */
export interface Deps {
  now(): Date;
  /** Verify a human-check (Turnstile) token. Returns false on any failure. */
  verifyHuman(token: string, ip: string | undefined, env: Env): Promise<boolean>;
  fetchPrice(env: Env): Promise<PriceQuote>;
}

export type AppBindings = {
  Bindings: Env;
  Variables: { deps: Deps; ip: string };
};

export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 422 | 429 | 500 | 503,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}
