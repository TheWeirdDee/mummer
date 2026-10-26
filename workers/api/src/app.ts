import { Hono } from 'hono';
import { HttpError, type AppBindings, type Deps } from './env.js';
import { clientAddress } from './http.js';
import { applySecurityHeaders } from './security.js';
import { defaultDeps } from './services.js';
import { groups } from './routes/groups.js';
import { members } from './routes/members.js';
import { publicRoutes } from './routes/public.js';

/**
 * Client-side routes of the single-page app. Anything else that is not a static
 * file gets the app shell (so the in-app "not found" page renders) but with a
 * real HTTP 404 status instead of a misleading 200.
 */
export const KNOWN_APP_ROUTES = /^\/(?:|how-it-works|privacy|faq|wallet-guide|evidence|stats|new|recover|g\/[0-9a-f]{32}(?:\/admin|\/m\/[0-9a-f]{32})?)\/?$/;

function buildInner(deps: Deps): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.use('*', async (c, next) => {
    c.set('deps', deps);
    c.set('ip', clientAddress(c));
    await next();
  });

  const api = new Hono<AppBindings>();
  api.route('/', publicRoutes);
  // `members` carries the /:gid/members and /:gid/reveals routes; `groups` the rest. Mounted at the same prefix.
  api.route('/groups', groups);
  api.route('/groups', members);
  api.all('*', () => {
    throw new HttpError(404, 'not_found', 'Not found');
  });
  app.route('/api', api);

  // Everything else is the single-page app, served from static assets (when bound).
  app.all('*', async (c) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
    if (!c.env.ASSETS) return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
    const res = await c.env.ASSETS.fetch(c.req.raw);
    const path = new URL(c.req.url).pathname;
    const isHtml = res.headers.get('content-type')?.includes('text/html') ?? false;
    if (res.status === 200 && isHtml && !KNOWN_APP_ROUTES.test(path) && path !== '/human-check') {
      return new Response(res.body, { status: 404, headers: res.headers });
    }
    return res;
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: { code: err.code, message: err.message } }, err.status);
    console.error('api_error', { route: new URL(c.req.url).pathname.replace(/[0-9a-f]{32}/g, ':id'), name: (err as Error).name });
    return c.json({ error: { code: 'internal', message: 'Something went wrong on our side. Please try again.' } }, 500);
  });

  return app;
}

/**
 * Build the application. Collaborators (clock, human check, price feed) are
 * injected so the same code runs deterministically under test and with real
 * services in production.
 *
 * Security headers are applied in an OUTER wrapper, after the inner app has
 * produced its response. (Hono merges the previous response's headers over a
 * replacement response set from middleware, which would let the static-asset
 * layer's own headers override ours.)
 *
 * Logging policy: request bodies, tokens, addresses and IPs are NEVER logged.
 * Server errors log only a route label and a stable error code.
 */
export function createApp(deps: Deps = defaultDeps): Hono<AppBindings> {
  const inner = buildInner(deps);
  const outer = new Hono<AppBindings>();
  outer.all('*', async (c) => {
    let ctx: Parameters<typeof inner.fetch>[2];
    try {
      ctx = c.executionCtx as Parameters<typeof inner.fetch>[2];
    } catch {
      ctx = undefined; // e.g. under test, where there is no ExecutionContext
    }
    const res = await inner.fetch(c.req.raw, c.env, ctx);
    return applySecurityHeaders(res, new URL(c.req.url).pathname);
  });
  return outer;
}
