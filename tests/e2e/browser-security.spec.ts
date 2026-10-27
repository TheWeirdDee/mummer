import { expect, test } from '@playwright/test';
import { api, makeExchange } from './fixture';
import { newPerson } from './helpers';

test.describe('browser-enforced security', () => {
  test('the browser enforces the CSP: inline script, inline handlers, third-party script and cross-origin requests are blocked; WebAssembly works', async ({ browser }) => {
    const fx = await makeExchange({ members: 4, title: 'CSP test' });
    const p = await newPerson(browser);
    const violations: string[] = [];
    await p.page.exposeFunction('reportViolation', (d: string) => violations.push(d));
    await p.page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => (window as unknown as { reportViolation: (d: string) => void }).reportViolation(`${e.violatedDirective}|${e.blockedURI}`));
    });
    await p.page.goto(fx.members[0]!.link);
    await expect(p.page.getByRole('heading', { level: 1, name: 'CSP test' })).toBeVisible();

    // Note: code run through page.evaluate is injected by DevTools, which bypasses CSP (so eval() would appear to work
    // there). The absence of 'unsafe-eval' is asserted on the header below; here we test what the page itself enforces.
    const results = await p.page.evaluate(async () => {
      const out: Record<string, string> = {};
      (window as unknown as { injected?: string }).injected = 'no';
      const s = document.createElement('script');
      s.textContent = "window.injected = 'inline script ran'";
      document.body.appendChild(s);
      out.inlineScript = (window as unknown as { injected: string }).injected;
      const img = document.createElement('img');
      img.setAttribute('onerror', "window.injected = 'handler ran'");
      img.src = 'data:image/png;base64,invalid';
      document.body.appendChild(img);
      const ext = document.createElement('script');
      ext.src = 'https://example.com/evil.js';
      document.body.appendChild(ext);
      out.wasm = typeof WebAssembly.instantiate === 'function' ? 'available' : 'missing';
      try {
        const r = await fetch('https://example.com/', { mode: 'no-cors' });
        out.crossOriginFetch = `allowed ${r.type}`;
      } catch {
        out.crossOriginFetch = 'blocked';
      }
      await new Promise((r) => setTimeout(r, 300));
      out.afterHandler = (window as unknown as { injected: string }).injected;
      return out;
    });
    expect(results.inlineScript).toBe('no');
    expect(results.afterHandler).toBe('no');
    expect(results.crossOriginFetch).toBe('blocked');
    expect(results.wasm).toBe('available');
    const blocked = violations.join(' ; ');
    expect(blocked).toContain('script-src');
    expect(blocked).toContain('connect-src');
    expect(blocked).toContain('example.com');
    // The policy itself forbids eval and inline script outright.
    const head = (await p.page.request.get('/privacy')).headers()['content-security-policy']!;
    expect(head).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(head).not.toContain("'unsafe-eval'");
    expect(head).not.toContain("'unsafe-inline'");
    await p.ctx.close();
  });

  test('private-link secrets never appear in any request URL, header, referrer or body leaving the browser', async ({ browser }) => {
    const fx = await makeExchange({ members: 5, draw: true, title: 'Wire test' });
    const m = fx.members[0]!;
    const secretKey = new URL(m.link).hash.match(/k=([A-Za-z0-9_-]+)/)![1]!;
    const p = await newPerson(browser);
    const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
    p.page.on('request', (r) => seen.push({ url: r.url(), headers: r.headers(), body: r.postData() ?? '' }));
    await p.page.goto(m.link);
    await expect(p.page.getByText(/You.re giving to/)).toBeVisible();
    await p.page.getByRole('button', { name: 'I sent it' }).click();
    await p.page.getByRole('button', { name: 'Yes, I sent it' }).click();
    await expect(p.page.getByText('You already marked this gift as sent')).toBeVisible();
    await p.page.getByRole('tab', { name: 'My link' }).click();
    await p.page.getByRole('tab', { name: 'A gift for you' }).click();
    await p.page.getByLabel(/Reference from the memo/).fill('MUM-0000-0000-0000-0000-0');
    await p.page.getByRole('button', { name: 'I received this gift' }).click();
    await p.page.getByRole('button', { name: 'Yes, I received it' }).click();

    expect(seen.length).toBeGreaterThan(10);
    for (const r of seen) {
      expect(r.url, 'no fragment or secret in any URL').not.toContain('#');
      expect(r.url).not.toContain(secretKey);
      expect(r.url).not.toMatch(/[?&](t|k|token|key)=/);
      expect(r.body).not.toContain(secretKey);
      expect(r.body).not.toContain(m.token);
      expect(r.headers['referer'] ?? '', `${r.url} must not send a Referer`).toBe('');
      const origin = new URL(r.url).origin;
      expect(origin.startsWith('http://127.0.0.1'), `unexpected origin ${origin}`).toBe(true);
      if (r.headers['authorization']) expect(r.url).toContain('/api/');
      // The secret key never travels, even inside the Authorization header.
      expect(r.headers['authorization'] ?? '').not.toContain(secretKey);
    }
    // Plaintext assignment data (the recipient's address) never left the browser either.
    const wire = seen.map((r) => r.body).join('\n');
    expect(wire).not.toContain(fx.members[1]!.address.slice(0, 24));
    await p.ctx.close();
  });

  test('after joining, local storage holds this device’s key but never plaintext addresses, wishlists or assignments', async ({ browser }) => {
    const fx = await makeExchange({ members: 5, draw: true, title: 'Storage test' });
    const p = await newPerson(browser);
    await p.page.goto(fx.members[0]!.link);
    await expect(p.page.getByText(/You.re giving to/)).toBeVisible();
    const dump = await p.page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    for (const m of fx.members) {
      expect(dump).not.toContain(m.address.slice(0, 24));
      expect(dump).not.toContain(m.wishlist);
    }
    expect(dump).not.toMatch(/MUM-[0-9A-Z]{4}-/);
    // The fragment is removed from the address bar once saved.
    expect(p.page.url()).not.toContain('#');
    expect(await p.page.evaluate(() => document.cookie)).toBe('');
    await p.ctx.close();
  });

  test('every document response carries the security headers; Cloudflare is never allowed on the app itself', async ({ request }) => {
    for (const path of ['/', '/privacy', '/new', '/g/0123456789abcdef0123456789abcdef', '/nope']) {
      const r = await request.get(path);
      const h = r.headers();
      expect(h['content-security-policy'], path).toContain("default-src 'none'");
      expect(h['content-security-policy']).not.toContain('challenges.cloudflare.com');
      expect(h['content-security-policy']).toContain("frame-src 'self' http://127.0.0.1:8789");
      expect(h['content-security-policy']).toContain("script-src 'self' 'wasm-unsafe-eval'");
      expect(h['referrer-policy']).toBe('no-referrer');
      expect(h['x-frame-options']).toBe('DENY');
      expect(h['x-content-type-options']).toBe('nosniff');
      expect(h['strict-transport-security']).toContain('max-age=');
      expect(h['cache-control']).toBe('no-store');
    }
    // The app no longer serves any human-check page of its own: that lives on a separate origin.
    expect((await request.get('/human-check')).status()).toBe(404);
    expect((await request.get('/human-check.js')).status()).toBe(404);
    const asset = await request.get('/favicon.svg');
    expect(asset.headers()['content-security-policy']).toContain("default-src 'none'");
    // Private routes are not indexable; marketing routes are.
    expect((await request.get('/g/0123456789abcdef0123456789abcdef')).headers()['x-robots-tag']).toContain('noindex');
    expect((await request.get('/privacy')).headers()['x-robots-tag']).toBeUndefined();
  });

  test('the human-check frame is a separate origin: it loads and runs, reports to the app, and cannot read the app', async ({ browser }) => {
    // Turnstile cannot finish in an opaque-origin sandbox (its challenge frame inherits the null origin), so the frame lives on its own
    // origin instead. This runs the real second Worker on another port: it must load its script, post only to the app, and be unable
    // to read or be read by the app. (An earlier version of this test accepted a timeout and so hid a real production failure.)
    const p = await newPerson(browser);
    const failed: string[] = [];
    p.page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
    await p.page.goto('/privacy');
    const result = await p.page.evaluate(
      () =>
        new Promise<{ origin: string; data: { type?: string; reason?: string; source?: string }; access: string } | 'timeout'>((resolve) => {
          const f = document.createElement('iframe');
          f.setAttribute('sandbox', 'allow-scripts allow-same-origin'); // safe: the frame's origin is not ours
          f.src = 'http://127.0.0.1:8789/'; // no site key: the script reports that straight away, which proves it ran
          const t = setTimeout(() => resolve('timeout'), 10_000);
          window.addEventListener('message', (e) => {
            if (e.source !== f.contentWindow) return;
            clearTimeout(t);
            let access = 'blocked';
            try {
              void (f.contentDocument as Document).title;
              access = 'allowed';
            } catch {
              access = 'blocked';
            }
            resolve({ origin: e.origin, data: e.data, access });
          });
          document.body.appendChild(f);
        }),
    );
    expect(failed.filter((f) => f.includes('8789'))).toEqual([]);
    expect(result).not.toBe('timeout');
    const r = result as { origin: string; data: { type?: string; reason?: string; source?: string }; access: string };
    expect(r.origin).toBe('http://127.0.0.1:8789'); // the message carries the frame's own, real origin, not "null"
    expect(r.data).toEqual({ source: 'mummer-human-check', type: 'error', reason: 'missing-sitekey' });
    expect(r.access).toBe('blocked'); // the app cannot read the frame
    // And the frame cannot reach the app's storage or keys: it is on a different origin.
    expect(await p.page.evaluate(() => location.origin)).toBe('http://127.0.0.1:8788');
    await p.ctx.close();
  });

  test('only the app may embed the human-check frame: a page on any other origin is refused', async ({ browser, request }) => {
    const header = (await request.get('http://127.0.0.1:8789/')).headers();
    expect(header['content-security-policy']).toContain('frame-ancestors http://127.0.0.1:8788');
    expect(header['x-frame-options']).toBeUndefined();
    const p = await newPerson(browser);
    // A page on an unrelated origin tries to embed the check frame.
    await p.page.route('http://attacker.test/', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>x</title><iframe id="f" src="http://127.0.0.1:8789/"></iframe>' }));
    const seen: string[] = [];
    await p.page.exposeFunction('report', (m: string) => seen.push(m));
    await p.page.addInitScript(() => window.addEventListener('message', (e) => void (window as unknown as { report(m: string): void }).report(String(e.origin))));
    await p.page.goto('http://attacker.test/');
    await p.page.waitForTimeout(4000);
    expect(seen, 'the frame must not run for a foreign parent').toEqual([]);
    await p.ctx.close();
  });

  test('the check host serves only its page and script', async ({ request }) => {
    expect((await request.get('http://127.0.0.1:8789/frame.js')).status()).toBe(200);
    for (const p of ['/api/health', '/secrets', '/index.html/x']) expect((await request.get('http://127.0.0.1:8789' + p)).status(), p).toBe(404);
    expect((await request.post('http://127.0.0.1:8789/', { data: {} })).status()).toBe(405);
  });

  test('state-changing API calls cannot be made cross-site with ambient credentials (no cookies, bearer only)', async ({ request }) => {
    const fx = await makeExchange({ members: 4, title: 'CSRF test' });
    const noAuth = await api('POST', `/api/groups/${fx.gid}/transition`, { body: { action: 'close' } });
    expect(noAuth.status).toBe(401);
    const r = await request.post(`/api/groups/${fx.gid}/transition`, { data: { action: 'close' }, headers: { origin: 'https://evil.example' } });
    expect(r.status()).toBe(401);
    expect(r.headers()['access-control-allow-origin']).toBeUndefined();
    expect(r.headers()['set-cookie']).toBeUndefined();
  });
});
