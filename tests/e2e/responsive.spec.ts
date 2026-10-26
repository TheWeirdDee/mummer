import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { makeExchange, type Fixture } from './fixture';
import { newPerson, passSaveLinkGate } from './helpers';

/**
 * Responsive matrix: every public page and every app screen at the PRD's viewport sizes (portrait and landscape).
 * Asserts no horizontal scrolling, nothing sticking out of the viewport outside an intentional scroll container,
 * and 44px touch targets. Full-page screenshots are written to tests/e2e/.artifacts/screens for visual review.
 */

const VIEWPORTS: [number, number][] = [
  [320, 640],
  [360, 740],
  [375, 667],
  [390, 844],
  [430, 932],
  [768, 1024],
  [1024, 768],
  [1280, 800],
  [1440, 900],
  [1920, 1080],
  [844, 390], // landscape phone
  [1024, 600], // landscape small tablet
];

const PUBLIC_PAGES = ['/', '/how-it-works', '/privacy', '/faq', '/wallet-guide', '/evidence', '/stats', '/recover', '/not-a-real-page', '/new'];

async function audit(page: Page, label: string) {
  const report = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out = { overflowX: document.documentElement.scrollWidth - vw, escapes: [] as string[], small: [] as string[] };
    const scrolls = (el: Element | null): boolean => {
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const o = getComputedStyle(e).overflowX;
        if (o === 'auto' || o === 'scroll' || o === 'hidden') return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > vw + 1 && !scrolls(el)) out.escapes.push(`${el.tagName.toLowerCase()}.${(el as HTMLElement).className?.toString().slice(0, 40)} right=${Math.round(r.right)} vw=${vw}`);
    }
    const sel = 'button, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, summary, [role=tab], a.btn';
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width <= 1 || r.height <= 1 || cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (el.closest('.sr-only')) continue;
      if (r.height < 43.5) out.small.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 30)}" h=${Math.round(r.height)}`);
    }
    return out;
  });
  expect(report.overflowX, `${label}: horizontal scroll`).toBeLessThanOrEqual(0);
  expect(report.escapes.slice(0, 5), `${label}: elements escaping the viewport`).toEqual([]);
  expect(report.small.slice(0, 5), `${label}: touch targets under 44px`).toEqual([]);
}

let waiting: Fixture;
let drawn: Fixture;
test.beforeAll(async () => {
  waiting = await makeExchange({ members: 5, title: 'Waiting room' });
  drawn = await makeExchange({ members: 5, draw: true, title: 'Gift in motion' });
});

for (const [w, h] of VIEWPORTS) {
  test(`layout at ${w}x${h}`, async ({ browser }) => {
    const dir = `tests/e2e/.artifacts/screens/${w}x${h}`;
    mkdirSync(dir, { recursive: true });
    const p = await newPerson(browser, { width: w, height: h, touch: w < 800 });
    const { page } = p;
    const shot = async (name: string) => {
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(150);
      await audit(page, `${w}x${h} ${name}`);
      await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
    };

    for (const path of PUBLIC_PAGES) {
      await page.goto(path);
      await shot(path === '/' ? 'home' : path.slice(1).replace(/\W+/g, '-'));
    }

    // Join wizard
    await page.goto(waiting.invite);
    await shot('join-0-invitation');
    await page.getByRole('button', { name: 'Join this exchange' }).click();
    await shot('join-1-you');
    await page.getByLabel('Your nickname').fill('Layout');
    await page.getByRole('button', { name: /Next: your wallet/ }).click();
    await shot('join-2-wallet');
    await page.getByLabel(/I don.t have a wallet yet/).check();
    await shot('join-2b-wallet-help');
    await page.getByRole('button', { name: /Next: your address/ }).click();
    await page.getByLabel('Your shielded receiving address').fill('t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs');
    await shot('join-3-address-error');

    // Host dashboard: waiting room and after the draw
    await page.goto(waiting.adminLink);
    await expect(page.getByRole('heading', { name: /Save your admin link/i, level: 2 })).toBeVisible();
    await shot('admin-0-save-link');
    await passSaveLinkGate(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Waiting room' })).toBeVisible();
    await shot('admin-1-waiting');
    await page.getByRole('button', { name: 'Review people and draw' }).click();
    await expect(page.getByRole('button', { name: /^Draw names for/ })).toBeVisible();
    await shot('admin-2-draw-review');
    await page.goto(drawn.adminLink);
    await passSaveLinkGate(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Gift in motion' })).toBeVisible();
    await shot('admin-3-after-draw');

    // Participant screens (waiting, then assignment with payment, receive, account)
    await page.goto(waiting.members[0]!.link);
    await expect(page.getByRole('heading', { level: 1, name: 'Waiting room' })).toBeVisible();
    await shot('member-0-waiting');
    await page.goto(drawn.members[0]!.link);
    await expect(page.getByRole('img', { name: /Payment request/ })).toBeVisible();
    await shot('member-1-assignment-payment');
    await page.getByRole('tab', { name: 'A gift for you' }).click();
    await shot('member-2-receive');
    await page.getByRole('tab', { name: 'My link' }).click();
    await shot('member-3-account');
    await p.ctx.close();
  });
}
