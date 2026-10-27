import { describe, expect, it } from 'vitest';
import { APP_CSP, APP_CSP_PLAIN_HTTP, appCsp, applySecurityHeaders } from '../src/security.js';

const page = () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
const CHECK = 'https://mummer-check.example.workers.dev';

describe('content security policy by transport', () => {
  it('HTTPS responses (all of production) carry the full policy including upgrade-insecure-requests', () => {
    const csp = applySecurityHeaders(page(), '/', true).headers.get('content-security-policy')!;
    expect(csp).toBe(APP_CSP);
    expect(csp).toContain('upgrade-insecure-requests');
  });

  it('is the default, so a caller that forgets the argument gets the stricter policy', () => {
    expect(applySecurityHeaders(page(), '/').headers.get('content-security-policy')).toBe(APP_CSP);
  });

  it('plain-HTTP loopback drops only upgrade-insecure-requests and removes no other directive', () => {
    const csp = applySecurityHeaders(page(), '/', false).headers.get('content-security-policy')!;
    expect(csp).toBe(APP_CSP_PLAIN_HTTP);
    expect(csp).not.toContain('upgrade-insecure-requests');
    const full = APP_CSP.split('; ');
    expect(full.filter((d) => !csp.split('; ').includes(d))).toEqual(['upgrade-insecure-requests']);
    for (const must of ["default-src 'none'", "script-src 'self' 'wasm-unsafe-eval'", "frame-ancestors 'none'", "object-src 'none'"]) expect(csp).toContain(must);
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain("'unsafe-eval'");
  });
});

describe('the one extra frame the app may embed: the separate human-check origin', () => {
  it('without a configured origin the app can frame only itself', () => {
    expect(appCsp()).toContain("frame-src 'self'");
    expect(appCsp()).not.toContain('https://');
  });

  it('with one, that exact origin is added to frame-src and nothing else about script or connect changes', () => {
    const csp = applySecurityHeaders(page(), '/', true, CHECK).headers.get('content-security-policy')!;
    expect(csp).toContain(`frame-src 'self' ${CHECK}`);
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'"); // no third-party script on app pages
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain('challenges.cloudflare.com'); // Cloudflare is only ever loaded by the separate origin
    expect(csp).not.toContain('unsafe-inline');
  });

  it('no response, including the old frame path, relaxes cross-origin resource policy or sandboxes the app', () => {
    for (const p of ['/', '/human-check', '/human-check.js', '/assets/index-abc.js', '/api/health']) {
      const h = applySecurityHeaders(page(), p, true, CHECK).headers;
      expect(h.get('cross-origin-resource-policy'), p).toBe('same-origin');
      expect(h.get('content-security-policy'), p).not.toContain('sandbox');
      expect(h.get('x-frame-options'), p).toBe('DENY');
    }
  });

  it('the other security headers do not depend on the transport', () => {
    expect(applySecurityHeaders(page(), '/', false).headers.get('x-frame-options')).toBe('DENY');
    expect(applySecurityHeaders(page(), '/', false).headers.get('referrer-policy')).toBe('no-referrer');
    expect(applySecurityHeaders(page(), '/', false).headers.get('strict-transport-security')).toContain('max-age=63072000');
  });
});
