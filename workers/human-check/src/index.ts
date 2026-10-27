/**
 * The human-check host: serves one page and one script on its own origin, with a strict CSP that allows Cloudflare's Turnstile and
 * allows only the configured parent to frame it. It has no state, no database and no secrets.
 */
export interface Env {
  ASSETS: Fetcher;
  /** Origin of the Mummer app that may embed this page, for example https://mummer.example.workers.dev (no trailing slash). */
  PARENT_ORIGIN: string;
}

export const csp = (parentOrigin: string): string =>
  [
    "default-src 'none'",
    "script-src 'self' https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://challenges.cloudflare.com",
    "connect-src 'self' https://challenges.cloudflare.com",
    'frame-src https://challenges.cloudflare.com',
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    `frame-ancestors ${parentOrigin}`,
  ].join('; ');

/** A valid origin is scheme://host[:port] with nothing else. Anything else means no parent may embed the page. */
export function validOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const u = new URL(value);
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.origin !== value) return undefined;
    return u.origin;
  } catch {
    return undefined;
  }
}

export function secure(res: Response, parentOrigin: string | undefined): Response {
  const headers = new Headers(res.headers);
  headers.set('Content-Security-Policy', csp(parentOrigin ?? "'none'"));
  headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  headers.set('Cache-Control', 'no-store');
  // Deliberately no X-Frame-Options (it cannot name a different origin); frame-ancestors above is the control.
  headers.delete('X-Frame-Options');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') return secure(new Response('Method not allowed', { status: 405 }), undefined);
    const parent = validOrigin(env.PARENT_ORIGIN);
    const url = new URL(request.url);
    // The page and its script only; everything else is a plain 404.
    const path = url.pathname === '/' || url.pathname === '/index.html' ? '/index.html' : url.pathname === '/frame.js' ? '/frame.js' : undefined;
    if (!path) return secure(new Response('Not found', { status: 404 }), parent);
    // The asset layer redirects /index.html to / (auto-trailing-slash), so ask it for / directly.
    const res = await env.ASSETS.fetch(new Request(new URL(path === '/index.html' ? '/' : path, url.origin), request));
    if (path === '/index.html' && typeof HTMLRewriter !== 'undefined') {
      const rewritten = new HTMLRewriter()
        .on('meta[name="mummer-parent-origin"]', {
          element(el) {
            el.setAttribute('content', parent ?? '');
          },
        })
        .transform(res);
      return secure(rewritten, parent);
    }
    return secure(res, parent);
  },
} satisfies ExportedHandler<Env>;
