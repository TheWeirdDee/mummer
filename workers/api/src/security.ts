/**
 * Security headers applied to every response. See docs/SECURITY.md.
 *
 * The app CSP allows no third-party origin to run script. 'wasm-unsafe-eval' permits WebAssembly (libsodium's cryptography is
 * compiled to it) but NOT JavaScript eval(). The one extra origin it may frame is the separate human-check host (see appCsp).
 */
const APP_CSP_DIRECTIVES = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
];

/**
 * The app's policy. No third-party origin may run script here. The ONLY frame allowed besides our own is the separate human-check
 * origin (the `mummer-check` Worker), which hosts Cloudflare Turnstile; it is a different origin, so it cannot read this page.
 * `upgrade-insecure-requests` is added for HTTPS responses and omitted only for plain-HTTP loopback (WebKit applies it to
 * http://127.0.0.1 and then fails every subresource).
 */
export function appCsp(humanCheckOrigin?: string, secureTransport = true): string {
  const frame = humanCheckOrigin ? `frame-src 'self' ${humanCheckOrigin}` : "frame-src 'self'";
  const directives = [...APP_CSP_DIRECTIVES, frame];
  if (secureTransport) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

export const APP_CSP = appCsp();
export const APP_CSP_PLAIN_HTTP = appCsp(undefined, false);

export function applySecurityHeaders(res: Response, pathname: string, secureTransport = true, humanCheckOrigin?: string): Response {
  const headers = new Headers(res.headers);
  headers.set('Content-Security-Policy', appCsp(humanCheckOrigin, secureTransport));
  headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
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
