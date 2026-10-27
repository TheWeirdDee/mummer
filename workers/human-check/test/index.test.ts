import { describe, expect, it } from 'vitest';
import worker, { csp, secure, validOrigin, type Env } from '../src/index.js';

const PARENT = 'https://mummer.example.workers.dev';

function env(...args: [] | [string | undefined]): Env {
  const parent = args.length === 0 ? PARENT : args[0];
  const assets = {
    fetch: async (req: Request) => {
      const p = new URL(req.url).pathname;
      // Like the real asset layer: / is the page, and /index.html is a redirect to it.
      if (p === '/') return new Response('<html><meta name="mummer-parent-origin" content=""></html>', { headers: { 'content-type': 'text/html' } });
      if (p === '/index.html') return new Response(null, { status: 307, headers: { location: '/' } });
      if (p === '/frame.js') return new Response('//', { headers: { 'content-type': 'text/javascript' } });
      return new Response('nope', { status: 404 });
    },
  } as unknown as Fetcher;
  return { ASSETS: assets, PARENT_ORIGIN: parent as string };
}

const get = (path: string, e = env(), method = 'GET') => worker.fetch(new Request(`https://mummer-check.example.workers.dev${path}`, { method }), e);

describe('human-check host', () => {
  it('serves its page and script, and nothing else', async () => {
    expect((await get('/')).status).toBe(200);
    expect((await get('/index.html')).status).toBe(200);
    expect((await get('/frame.js')).status).toBe(200);
    for (const p of ['/api/health', '/secrets', '/frame.js.map', '/../etc/passwd', '/index.html/x']) expect((await get(p)).status, p).toBe(404);
    expect((await get('/', env(), 'POST')).status).toBe(405);
  });

  it('only the configured parent may frame it, and it allows only Cloudflare for script, frames and connections', async () => {
    const h = (await get('/')).headers;
    const policy = h.get('content-security-policy')!;
    expect(policy).toContain(`frame-ancestors ${PARENT}`);
    expect(policy).toContain("script-src 'self' https://challenges.cloudflare.com");
    expect(policy).toContain('frame-src https://challenges.cloudflare.com');
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(h.get('x-frame-options')).toBeNull(); // would contradict frame-ancestors for a different origin
    expect(h.get('referrer-policy')).toBe('no-referrer');
    expect(h.get('x-content-type-options')).toBe('nosniff');
    expect(h.get('cache-control')).toBe('no-store');
    expect(policy).not.toContain('sandbox'); // the frame needs a real origin; isolation comes from being a different origin
  });

  it('a missing or malformed parent origin means nobody may frame it', async () => {
    for (const bad of [undefined, '', 'not a url', 'https://x.example/path', 'https://x.example/', 'javascript:alert(1)', 'https://x.example?q=1']) {
      const policy = (await get('/', env(bad))).headers.get('content-security-policy')!;
      expect(policy, String(bad)).toContain("frame-ancestors 'none'");
    }
    expect(validOrigin('https://ok.example')).toBe('https://ok.example');
    expect(validOrigin('http://127.0.0.1:8788')).toBe('http://127.0.0.1:8788');
    expect(validOrigin('https://ok.example/')).toBeUndefined();
  });

  it('every response is secured, including errors', async () => {
    for (const r of [await get('/nope'), await get('/', env(), 'POST')]) {
      expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(r.headers.get('strict-transport-security')).toContain('max-age=');
    }
    expect(csp('https://a.example')).toContain('frame-ancestors https://a.example');
    expect(secure(new Response('x'), undefined).headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });
});
