import { Hono } from 'hono';
import { HttpError, type AppBindings, type Deps } from './env.js';
import { clientAddress } from './http.js';
import { applySecurityHeaders, securityHeaders } from './security.js';
import { defaultDeps } from './services.js';
import { groups } from './routes/groups.js';
import { members } from './routes/members.js';
import { publicRoutes } from './routes/public.js';

/**
 * Build the Hono application. Collaborators (clock, human check, price feed) are
 * injected so the same code runs deterministically under test and with real
 * services in production.
 *
 * Logging policy: request bodies, tokens, addresses and IPs are NEVER logged.
 * Server errors log only a route label and a stable error code.
 */
export function createApp(deps: Deps = defaultDeps): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.use('*', securityHeaders);
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
    return c.env.ASSETS.fetch(c.req.raw);
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      const res = c.json({ error: { code: err.code, message: err.message } }, err.status);
      return applySecurityHeaders(res, new URL(c.req.url).pathname);
    }
    console.error('api_error', { route: new URL(c.req.url).pathname.replace(/[0-9a-f]{32}/g, ':id'), name: (err as Error).name });
    const res = c.json({ error: { code: 'internal', message: 'Something went wrong on our side. Please try again.' } }, 500);
    return applySecurityHeaders(res, new URL(c.req.url).pathname);
  });

  return app;
}
