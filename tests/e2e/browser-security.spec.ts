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

  test('every document response carries the security headers; the human-check frame alone allows Cloudflare', async ({ request }) => {
    for (const path of ['/', '/privacy', '/new', '/g/0123456789abcdef0123456789abcdef', '/nope']) {
      const r = await request.get(path);
      const h = r.headers();
      expect(h['content-security-policy'], path).toContain("default-src 'none'");
      expect(h['content-security-policy']).not.toContain('challenges.cloudflare.com');
      expect(h['referrer-policy']).toBe('no-referrer');
      expect(h['x-frame-options']).toBe('DENY');
      expect(h['x-content-type-options']).toBe('nosniff');
      expect(h['strict-transport-security']).toContain('max-age=');
      expect(h['cache-control']).toBe('no-store');
    }
    const frame = await request.get('/human-check');
    expect(frame.headers()['content-security-policy']).toContain('challenges.cloudflare.com');
    expect(frame.headers()['x-frame-options']).toBe('SAMEORIGIN');
    const asset = await request.get('/favicon.svg');
    expect(asset.headers()['content-security-policy']).toContain("default-src 'none'");
    // Private routes are not indexable; marketing routes are.
    expect((await request.get('/g/0123456789abcdef0123456789abcdef')).headers()['x-robots-tag']).toContain('noindex');
    expect((await request.get('/privacy')).headers()['x-robots-tag']).toBeUndefined();
  });

  test('the human-check frame is sandboxed (opaque origin) and cannot reach the app', async ({ browser }) => {
    const p = await newPerson(browser);
    await p.page.goto('/privacy');
    const result = await p.page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const f = document.createElement('iframe');
          f.setAttribute('sandbox', 'allow-scripts');
          f.src = '/human-check?sitekey=1x00000000000000000000AA';
          const t = setTimeout(() => resolve('timeout'), 8000);
          window.addEventListener('message', (e) => {
            if (e.source === f.contentWindow) {
              clearTimeout(t);
              let access = 'blocked';
              try {
                // A sandboxed frame without allow-same-origin has an opaque origin: this must throw.
                void (f.contentDocument as Document).title;
                access = 'allowed';
              } catch {
                access = 'blocked';
              }
              resolve(`${(e.data as { type: string }).type}:${access}`);
            }
          });
          document.body.appendChild(f);
        }),
    );
    // Whether or not Cloudflare's script is reachable from this machine, the parent cannot read the frame.
    expect(result.endsWith(':blocked') || result === 'timeout').toBe(true);
    await p.ctx.close();
  });

  test('the sandboxed frame\'s own script actually loads and runs in an opaque origin (no timeout allowed)', async ({ browser }) => {
    // Found on the first real deployment: the frame is an opaque origin, so its same-site script counted as cross-origin and
    // `Cross-Origin-Resource-Policy: same-origin` blocked it. The test above accepts "timeout" and so could not see that.
    // With no site key the script reports an error straight away, which proves it was fetched and executed.
    const p = await newPerson(browser);
    const failed: string[] = [];
    p.page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
    await p.page.goto('/privacy');
    const message = await p.page.evaluate(
      () =>
        new Promise<{ type: string; reason?: string } | 'timeout'>((resolve) => {
          const f = document.createElement('iframe');
          f.setAttribute('sandbox', 'allow-scripts');
          f.src = '/human-check';
          const t = setTimeout(() => resolve('timeout'), 10_000);
          window.addEventListener('message', (e) => {
            if (e.source === f.contentWindow) {
              clearTimeout(t);
              resolve(e.data as { type: string; reason?: string });
            }
          });
          document.body.appendChild(f);
        }),
    );
    expect(failed.filter((f) => f.includes('human-check'))).toEqual([]);
    expect(message).toEqual({ source: 'mummer-human-check', type: 'error', reason: 'missing-sitekey' });
    const res = await p.page.request.get('/human-check.js');
    expect(res.headers()['cross-origin-resource-policy']).toBe('cross-origin');
    expect((await p.page.request.get('/')).headers()['cross-origin-resource-policy']).toBe('same-origin');
    await p.ctx.close();
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
