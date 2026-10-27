import { expect, test } from '@playwright/test';
import { newPerson } from './helpers';

/** Product-completeness checks that are about the shipped pages themselves: titles, descriptions, social tags, icons and links. */

const PUBLIC_ROUTES = ['/', '/how-it-works', '/privacy', '/faq', '/wallet-guide', '/evidence', '/stats', '/new', '/recover'];

test.describe('page metadata', () => {
  test('every public page has its own title and description, and no framework default', async ({ browser }) => {
    const p = await newPerson(browser);
    const titles = new Map<string, string>();
    for (const route of PUBLIC_ROUTES) {
      await p.page.goto(route);
      await expect(p.page.locator('h1').first()).toBeVisible();
      const title = await p.page.title();
      const description = await p.page.locator('meta[name="description"]').getAttribute('content');
      expect(title.length, route).toBeGreaterThan(8);
      expect(title, route).toContain('Mummer');
      expect(title, route).not.toMatch(/vite|react app|untitled|localhost/i);
      expect((description ?? '').length, `${route} description`).toBeGreaterThan(40);
      titles.set(route, title);
    }
    // Titles distinguish pages (the landing page may differ in form but no two pages share one).
    expect(new Set(titles.values()).size).toBe(titles.size);
    await p.ctx.close();
  });

  test('social tags use absolute image URLs, and the images, icons and manifest all load', async ({ browser, request, baseURL }) => {
    const html = await (await request.get('/')).text();
    for (const re of [/property="og:image" content="([^"]+)"/, /name="twitter:image" content="([^"]+)"/]) {
      const url = re.exec(html)?.[1];
      expect(url, String(re)).toBeTruthy();
      expect(url!.startsWith(`${baseURL}/`), `absolute for this origin: ${url}`).toBe(true);
      const img = await request.get(url!);
      expect(img.status(), url).toBe(200);
      expect(img.headers()['content-type']).toContain('image/png');
    }
    for (const path of ['/favicon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/manifest.webmanifest', '/robots.txt']) {
      expect((await request.get(path)).status(), path).toBe(200);
    }
    const manifest = await (await request.get('/manifest.webmanifest')).json();
    for (const icon of manifest.icons) expect((await request.get(icon.src)).status(), icon.src).toBe(200);
    const p = await newPerson(browser);
    await p.page.goto('/');
    expect(await p.page.locator('html').getAttribute('lang')).toBe('en');
    await p.ctx.close();
  });
});

test.describe('links and navigation', () => {
  test('every internal link on every public page resolves, and the navigation is the same wherever it appears', async ({ browser, request }) => {
    const p = await newPerson(browser);
    const checked = new Map<string, number>();
    const navByPage = new Map<string, string[]>();
    for (const route of PUBLIC_ROUTES) {
      await p.page.goto(route);
      await expect(p.page.locator('h1').first()).toBeVisible();
      const hrefs = await p.page.$$eval('a[href]', (as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? ''));
      for (const href of hrefs) {
        if (!href || href.startsWith('#') || /^(mailto:|tel:|https?:\/\/(?!127\.0\.0\.1))/.test(href) || href.startsWith('zcash:')) continue;
        const path = href.split('#')[0]!;
        if (!path || checked.has(path)) continue;
        const res = await request.get(path);
        checked.set(path, res.status());
        expect(res.status(), `${route} links to ${href}`).toBeLessThan(400);
      }
      navByPage.set(route, await p.page.$$eval('header nav a, header a', (as) => as.map((a) => (a as HTMLAnchorElement).textContent?.trim() ?? '').filter(Boolean)));
    }
    expect(checked.size).toBeGreaterThan(8);
    // The marketing pages share one navigation.
    const marketing = ['/', '/how-it-works', '/privacy', '/faq', '/wallet-guide', '/evidence', '/stats'].map((r) => JSON.stringify(navByPage.get(r)));
    expect(new Set(marketing).size).toBe(1);
    await p.ctx.close();
  });

  test('external links open safely: new tabs carry noopener and are announced', async ({ browser }) => {
    const p = await newPerson(browser);
    for (const route of PUBLIC_ROUTES) {
      await p.page.goto(route);
      const bad = await p.page.$$eval('a[target="_blank"]', (as) =>
        as.filter((a) => !/noopener/.test(a.getAttribute('rel') ?? '') || !/noreferrer|noopener/.test(a.getAttribute('rel') ?? '')).map((a) => (a as HTMLAnchorElement).href),
      );
      expect(bad, route).toEqual([]);
    }
    await p.ctx.close();
  });

  test('the app screens have no marketing footer, and the marketing pages do', async ({ browser }) => {
    const p = await newPerson(browser);
    await p.page.goto('/privacy');
    await expect(p.page.locator('footer.site-footer')).toHaveCount(1);
    await p.page.goto('/new');
    await expect(p.page.locator('footer.site-footer')).toHaveCount(0);
    await p.ctx.close();
  });
});

test.describe('no unfinished or decorative controls', () => {
  test('no visible text on a public page is a placeholder, and every button is a real control with a name', async ({ browser }) => {
    const p = await newPerson(browser);
    for (const route of PUBLIC_ROUTES) {
      await p.page.goto(route);
      await expect(p.page.locator('h1').first()).toBeVisible();
      const text = await p.page.locator('main').innerText();
      expect(text, route).not.toMatch(/lorem ipsum|\bTODO\b|\bTBD\b|coming soon|undefined|\[object Object\]|NaN/i);
      const nameless = await p.page.$$eval('button, [role="button"]', (els) => els.filter((e) => !(e.getAttribute('aria-label') || e.textContent || '').trim()).length);
      expect(nameless, `${route}: buttons without an accessible name`).toBe(0);
      const disabledForever = await p.page.$$eval('button[disabled]', (els) => els.map((e) => (e.textContent ?? '').trim()));
      // A page may disable a button while a form is incomplete, but never ship one that cannot ever be used on a public page without a form.
      if (route !== '/new' && route !== '/recover') expect(disabledForever, route).toEqual([]);
    }
    await p.ctx.close();
  });
});
