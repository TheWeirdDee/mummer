/**
 * Security headers applied to every response. See docs/SECURITY.md.
 *
 * The app CSP allows no third-party origins at all. 'wasm-unsafe-eval' permits WebAssembly
 * (libsodium's cryptography is compiled to it) but NOT JavaScript eval().
 * The only page permitted to
 * load a third-party script is the sandboxed human-check frame (see
 * FRAME_CSP), and it runs in an opaque origin with no access to the app.
 */
const APP_CSP_DIRECTIVES = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
];

/** The app CSP as served over HTTPS (all of production): everything above plus upgrade-insecure-requests. */
export const APP_CSP = [...APP_CSP_DIRECTIVES, 'upgrade-insecure-requests'].join('; ');

/**
 * The same policy without upgrade-insecure-requests, for the plain-HTTP loopback used in local development and tests. WebKit
 * applies that directive even to http://127.0.0.1 and then fails every subresource with "SSL connect error", while Chromium and
 * Firefox exempt loopback. Nothing is weakened: no policy directive is removed, and a page served over HTTPS always gets the full one.
 */
export const APP_CSP_PLAIN_HTTP = APP_CSP_DIRECTIVES.join('; ');

/** CSP for /human-check only: Cloudflare Turnstile's script and frame. Sandboxed by the embedding iframe. */
export const FRAME_CSP = [
  "default-src 'none'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://challenges.cloudflare.com",
  "connect-src 'self' https://challenges.cloudflare.com",
  'frame-src https://challenges.cloudflare.com',
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  // Even if loaded top-level or framed without the iframe attribute, this document gets an opaque origin.
  'sandbox allow-scripts',
].join('; ');

export function applySecurityHeaders(res: Response, pathname: string, secureTransport = true): Response {
  const headers = new Headers(res.headers);
  const isFrame = pathname === '/human-check' || pathname === '/human-check.html';
  headers.set('Content-Security-Policy', isFrame ? FRAME_CSP : secureTransport ? APP_CSP : APP_CSP_PLAIN_HTTP);
  headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', isFrame ? 'SAMEORIGIN' : 'DENY');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  // Marketing pages may be indexed; invitation, admin, member and API routes never.
  if (/^\/(g\/|api\/|new\b|recover\b)/.test(pathname)) headers.set('X-Robots-Tag', 'noindex, nofollow');
  if (pathname.startsWith('/api/') || res.headers.get('content-type')?.includes('text/html')) {
    headers.set('Cache-Control', 'no-store');
  } else if (pathname.startsWith('/assets/') && res.status === 200) {
    // Vite emits content-hashed file names, so these never change under the same URL.
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
