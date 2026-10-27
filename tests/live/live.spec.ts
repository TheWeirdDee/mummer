import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { createExchange, drawNames, joinExchange, newPerson, refOf, shieldedAddresses, type Person } from '../e2e/helpers';

/**
 * A journey against a REAL deployment (set LIVE_URL). It runs against STAGING, whose Turnstile uses Cloudflare's public always-pass
 * test keys, so an automated browser can pass the human check. Production uses a real managed challenge that needs a person.
 * Everything else is the real stack: Cloudflare Workers, D1, headers, the cross-origin human-check frame, the price provider.
 * The clock cannot be moved on a real deployment, so reveal day is not covered here.
 */

const NAMES = ['Ada', 'Grace', 'Linus', 'Margaret'];

test.describe.configure({ mode: 'serial' });

test('the deployment reports its commit and serves the security headers', async ({ request }) => {
  const health = await (await request.get('/api/health')).json();
  expect(health.ok).toBe(true);
  expect(health.environment).toBe('production');
  expect(health.commit).toMatch(/^[0-9a-f]{7,40}$/);
  if (process.env.EXPECT_COMMIT) expect(health.commit.startsWith(process.env.EXPECT_COMMIT)).toBe(true);
  const config = await (await request.get('/api/config')).json();
  expect(config.humanCheckRequired).toBe(true);
  expect(config.humanCheckOrigin).toMatch(/^https:\/\//);
  const res = await request.get('/');
  const h = res.headers();
  expect(h['content-security-policy']).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(h['content-security-policy']).toContain(`frame-src 'self' ${config.humanCheckOrigin}`);
  expect(h['content-security-policy']).not.toContain('unsafe-inline');
  expect(h['strict-transport-security']).toContain('max-age=');
  expect(h['referrer-policy']).toBe('no-referrer');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['cache-control']).toBe('no-store');
  // The social image is an absolute URL on this origin and it loads.
  const html = await res.text();
  const og = /property="og:image" content="([^"]+)"/.exec(html)![1]!;
  expect(og.startsWith('https://')).toBe(true);
  expect((await request.get(og)).status()).toBe(200);
  // Unknown pages are a real 404; the human check lives on its own origin, not here.
  expect((await request.get('/definitely-not-a-page')).status()).toBe(404);
  expect((await request.get('/human-check')).status()).toBe(404);
  // The check host: framable only by this app, serves only its page and script.
  const check = await request.get(config.humanCheckOrigin + '/');
  expect(check.headers()['content-security-policy']).toContain(`frame-ancestors ${new URL(res.url()).origin}`);
  expect((await request.get(config.humanCheckOrigin + '/api/health')).status()).toBe(404);
});

test('a full exchange on the live deployment: create, join, draw, pay request, confirm, recover, inspect, delete', async ({ browser }) => {
  test.setTimeout(900_000);
  const addresses = shieldedAddresses(4);
  const host = await newPerson(browser);
  const people: Person[] = [];
  const links: string[] = [];
  const errors: string[] = [];
  const origins = new Set<string>();
  const watch = (p: Person) => {
    p.page.on('console', (m) => m.type() === 'error' && !/data:,|Content Security Policy|OTS parsing|Failed to load resource/.test(m.text()) && errors.push(m.text()));
    p.page.on('pageerror', (e) => errors.push(e.message));
    p.page.on('request', (r) => origins.add(new URL(r.url()).origin));
  };
  watch(host);

  const ex = await createExchange(host.page, { title: 'Live Mummers' });
  for (let i = 0; i < NAMES.length; i++) {
    const p = await newPerson(browser);
    watch(p);
    people.push(p);
    links.push(await joinExchange(p.page, ex.invite, { name: NAMES[i]!, wishlist: `${NAMES[i]} likes socks`, address: addresses[i]! }));
  }

  await drawNames(host.page, ex.adminLink);
  const hostText = await host.page.locator('main').innerText();
  for (const a of addresses) expect(hostText).not.toContain(a.slice(0, 20));

  const recipientOf = new Map<string, string>();
  const referenceOf = new Map<string, string>();
  for (let i = 0; i < NAMES.length; i++) {
    const page = people[i]!.page;
    await page.goto(links[i]!);
    await expect(page.getByText(/You.re giving to/)).toBeVisible();
    recipientOf.set(NAMES[i]!, ((await page.locator('.assignment-name').textContent()) ?? '').trim());
    await expect(page.getByRole('img', { name: /Payment request for .* ZEC to/ })).toBeVisible({ timeout: 30_000 });
    const memo = await page.locator('#memo-box').inputValue();
    referenceOf.set(NAMES[i]!, refOf(memo));
    expect(await page.getByLabel('Amount (ZEC)').inputValue()).toMatch(/^\d+\.\d{4}$/); // a real price quote from the live provider
    await expect(page.getByRole('link', { name: 'Open in my wallet' })).toHaveAttribute('href', /^zcash:u1/);
  }
  expect(new Set(recipientOf.values()).size).toBe(NAMES.length);

  for (let i = 0; i < NAMES.length; i++) {
    const page = people[i]!.page;
    await page.getByRole('button', { name: 'I sent it' }).click();
    await page.getByRole('button', { name: 'Yes, I sent it' }).click();
    await expect(page.getByText('You already marked this gift as sent')).toBeVisible();
  }
  for (let i = 0; i < NAMES.length; i++) {
    const giverName = [...recipientOf.entries()].find(([, r]) => r === NAMES[i])![0];
    const page = people[i]!.page;
    await page.getByRole('tab', { name: 'A gift for you' }).click();
    await page.getByLabel(/Reference from the memo/).fill(referenceOf.get(giverName)!);
    await page.getByRole('button', { name: 'I received this gift' }).click();
    await page.getByRole('button', { name: 'Yes, I received it' }).click();
    await expect(page.getByText('Mummer recognises the reference you entered.')).toBeVisible();
  }
  await host.page.goto(ex.adminLink);
  await expect(host.page.getByText('4 / 4').first()).toBeVisible();

  // Recovery: replace one member's link; the old link dies and the new one opens the same assignment.
  const m = people[0]!.page;
  await m.goto(links[0]!);
  await m.getByRole('tab', { name: 'My link' }).click();
  await m.getByRole('button', { name: 'Replace my link' }).first().click();
  await m.getByRole('button', { name: 'Replace it' }).click();
  await expect(m.getByText('Your link was replaced')).toBeVisible();
  const box = m.getByLabel('Your private link', { exact: true }).first();
  await m.getByRole('button', { name: 'Show' }).first().click();
  const newLink = await box.inputValue();
  const old = await newPerson(browser);
  await old.page.goto(links[0]!);
  await expect(old.page.getByRole('heading', { name: /doesn.t work any more/ })).toBeVisible();
  const fresh = await newPerson(browser);
  await fresh.page.goto(newLink);
  await expect(fresh.page.getByText(/You.re giving to/)).toBeVisible();

  // The glass box shows sealed blobs only, over the real database.
  await host.page.goto(ex.adminLink);
  await host.page.getByText('What Mummer’s server stores for this exchange').click();
  await host.page.getByRole('button', { name: /Show what.s stored/ }).click();
  const dump = await host.page.getByLabel('Redacted database contents').innerText();
  expect(dump).toContain('"sealed": true');
  for (const a of addresses) expect(dump).not.toContain(a.slice(0, 20));
  expect(dump).not.toContain('socks');

  // The only third-party origin the pages ever contacted is the human-check host (and Cloudflare inside it, which the pages never see).
  const ownOrigin = new URL(host.page.url()).origin;
  const foreign = [...origins].filter((o) => o !== ownOrigin && !o.startsWith('data:') && !o.startsWith('blob:'));
  expect(foreign.every((o) => /^https:\/\/[a-z-]*check\.[a-z0-9-]+\.workers\.dev$/.test(o) || o === 'https://challenges.cloudflare.com')).toBe(true);
  expect(errors, errors.join('\n')).toEqual([]);

  await host.page.getByRole('button', { name: 'Delete the exchange' }).click();
  await host.page.getByLabel(/Type .Live Mummers. to confirm/).fill('Live Mummers');
  await host.page.getByRole('button', { name: 'Delete everything' }).click();
  await host.page.waitForURL(/\/\?deleted=1/);
  await people[1]!.page.goto('about:blank');
  await people[1]!.page.goto(links[1]!);
  await expect(people[1]!.page.getByRole('heading', { name: /doesn.t work any more/ })).toBeVisible();
  for (const p of [host, ...people, old, fresh]) await p.ctx.close();
});

for (const [w, h] of [
  [390, 844],
  [1280, 800],
] as const) {
  test(`the live public pages are accessible and fit the screen at ${w}px`, async ({ browser }) => {
    test.setTimeout(300_000);
    const p = await newPerson(browser, { width: w, height: h });
    for (const route of ['/', '/how-it-works', '/privacy', '/faq', '/wallet-guide', '/evidence', '/stats', '/recover', '/new']) {
      await p.page.goto(route);
      await expect(p.page.locator('h1').first()).toBeVisible();
      if (route === '/new') await p.page.locator('iframe.humancheck').first().waitFor({ state: 'attached', timeout: 15_000 });
      const overflow = await p.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${route} horizontal scroll`).toBeLessThanOrEqual(0);
      const results = await new AxeBuilder({ page: p.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`), `${route} at ${w}px`).toEqual([]);
    }
    await p.ctx.close();
  });
}
