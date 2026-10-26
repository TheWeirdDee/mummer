/**
 * END-TO-END TEST ENTRY POINT. NOT USED IN PRODUCTION.
 *
 * `wrangler.toml` (production) points at src/index.ts. This file is referenced only by
 * wrangler.e2e.toml and exists so Playwright can move the server's clock forward to
 * exercise reveal day and expiry in a real browser. Nothing in src/ reads a test clock.
 */
import { createApp } from '../src/app.js';
import type { Env } from '../src/env.js';
import { defaultDeps } from '../src/services.js';

let offsetMs = 0;
const now = () => new Date(Date.now() + offsetMs);
// A fixed price so browser tests never depend on a live price feed (test double: E2E entry only).
const app = createApp({ ...defaultDeps, now, fetchPrice: async () => ({ usdPerZec: '31.54000000', asOf: now().toISOString(), source: 'e2e-fixture' }) });

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (env.ENVIRONMENT !== 'development' && env.ENVIRONMENT !== 'test') return new Response('not available', { status: 404 });
    if (url.pathname === '/__test/clock' && request.method === 'POST') {
      const body = (await request.json()) as { offsetSeconds?: number };
      offsetMs = Math.trunc(Number(body.offsetSeconds ?? 0)) * 1000;
      return Response.json({ offsetSeconds: offsetMs / 1000, now: new Date(Date.now() + offsetMs).toISOString() });
    }
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
