import { describe, expect, it } from 'vitest';
import { APP_CSP, APP_CSP_PLAIN_HTTP, applySecurityHeaders } from '../src/security.js';

const page = () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } });

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

  it('only the human-check script is readable cross-origin (the sandboxed frame is an opaque origin); everything else stays same-origin', () => {
    const js = () => new Response('//', { headers: { 'content-type': 'text/javascript' } });
    expect(applySecurityHeaders(js(), '/human-check.js').headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    for (const p of ['/', '/human-check', '/assets/index-abc.js', '/api/health', '/favicon.svg', '/human-check.js.map']) {
      expect(applySecurityHeaders(page(), p).headers.get('cross-origin-resource-policy'), p).toBe('same-origin');
    }
  });

  it('the human-check frame policy and the other security headers do not depend on the transport', () => {
    const a = applySecurityHeaders(page(), '/human-check', true);
    const b = applySecurityHeaders(page(), '/human-check', false);
    expect(a.headers.get('content-security-policy')).toBe(b.headers.get('content-security-policy'));
    expect(a.headers.get('strict-transport-security')).toBe(b.headers.get('strict-transport-security'));
    expect(applySecurityHeaders(page(), '/', false).headers.get('x-frame-options')).toBe('DENY');
    expect(applySecurityHeaders(page(), '/', false).headers.get('referrer-policy')).toBe('no-referrer');
  });
});
