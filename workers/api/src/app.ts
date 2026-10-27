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
    // Social previews need absolute image URLs, and the deployed origin is not known at build time: complete them here.
    if (isHtml && res.status === 200 && typeof HTMLRewriter !== 'undefined') return absoluteSocialImages(res, new URL(c.req.url).origin);
    return res;
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: { code: err.code, message: err.message } }, err.status);
    console.error('api_error', describeError(err, c.req.method, new URL(c.req.url).pathname));
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
/** Rewrites root-relative og:image and twitter:image URLs in an HTML response to absolute ones for the given origin. */
export function absoluteSocialImages(res: Response, origin: string): Response {
  const fix = {
    element(el: { getAttribute(n: string): string | null; setAttribute(n: string, v: string): void }) {
      const v = el.getAttribute('content');
      if (v && v.startsWith('/') && !v.startsWith('//')) el.setAttribute('content', origin + v);
    },
  };
  return new HTMLRewriter().on('meta[property="og:image"]', fix).on('meta[name="twitter:image"]', fix).transform(res);
}

/**
 * Diagnostics for an UNEXPECTED error (never an HttpError). Deliberately limited: method, the route with ids masked, the
 * error name, a truncated message, and the first stack frames reduced to "function (file:line)". No request body, header,
 * token, query string or id is ever included, and 32-hex ids or long base64url runs inside the message are masked.
 */
export function describeError(err: unknown, method: string, pathname: string) {
  const e = err instanceof Error ? err : new Error(String(err));
  const mask = (t: string) => t.replace(/[0-9a-f]{32}/g, ':id').replace(/[A-Za-z0-9_-]{40,}/g, ':blob');
  const frames = (e.stack ?? '')
    .split('\n')
    .slice(1, 5)
    .map((l) => mask(l.trim().replace(/^at /, '').replace(/\(?(?:file:\/\/)?[^)\s]*[\\/]([^\\/)\s]+:\d+):\d+\)?/, '($1)')));
  // Node's fetch reports every network failure as the same "fetch failed"; the real reason is on `cause` (for example ECONNRESET).
  const c = e.cause as { name?: string; code?: string; message?: string } | undefined;
  const cause = c && typeof c === 'object' ? { name: String(c.name ?? ''), code: String(c.code ?? ''), message: mask(String(c.message ?? '')).slice(0, 200) } : undefined;
  return { method, route: mask(pathname), name: e.name, message: mask(e.message).slice(0, 200), ...(cause ? { cause } : {}), frames };
}

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
    const url = new URL(c.req.url);
    return applySecurityHeaders(res, url.pathname, url.protocol === 'https:');
  });
  return outer;
}
