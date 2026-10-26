import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';

/** Real, public ZIP 316 test-vector addresses (from the official zcash-test-vectors): non-secret fixtures with shielded receivers only. */
export function shieldedAddresses(count: number): string[] {
  const rows = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../packages/zcash/test/vectors/unified_address.json'), 'utf8')) as unknown[][];
  const out = rows.filter((r) => typeof r[6] === 'string' && (r[6] as string).startsWith('u1') && (r[2] || r[3]) && !r[0] && !r[1]).map((r) => r[6] as string);
  if (out.length < count) throw new Error('not enough address fixtures');
  return out.slice(0, count);
}

let ipCounter = 10;
export interface Person {
  ctx: BrowserContext;
  page: Page;
  ip: string;
}

/** An isolated browser profile (own storage) that Cloudflare-style rate limiting sees as a distinct client. */
export async function newPerson(browser: Browser, opts: { width?: number; height?: number; touch?: boolean } = {}): Promise<Person> {
  const ip = `198.51.100.${++ipCounter}`;
  const ctx = await browser.newContext({
    extraHTTPHeaders: { 'cf-connecting-ip': ip },
    viewport: { width: opts.width ?? 1280, height: opts.height ?? 900 },
    hasTouch: opts.touch,
    reducedMotion: 'reduce',
  });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
  const page = await ctx.newPage();
  return { ctx, page, ip };
}

export async function setClock(request: APIRequestContext, offsetSeconds: number) {
  const r = await request.post('/__test/clock', { data: { offsetSeconds } });
  expect(r.ok()).toBeTruthy();
}

/** Create an exchange through the real UI. Returns the invite URL, the exchange id and the admin link. */
export async function createExchange(page: Page, opts: { title: string; hostPlays?: boolean; cap?: number }) {
  await page.goto('/new');
  await page.getByLabel('Name of the exchange').fill(opts.title);
  if (opts.cap) await page.getByLabel('Most people allowed').fill(String(opts.cap));
  await page.getByLabel(opts.hostPlays ? /Yes, I.m playing too/ : /only organizing/).check();
  await page.getByLabel(/I understand that the draw runs in my browser/).check();
  await page.getByRole('button', { name: 'Create the exchange' }).click();
  await expect(page.getByRole('heading', { name: /Save your admin link/i, level: 2 })).toBeAttached();
  const link = await readSecretLink(page);
  await page.getByLabel('Paste your link').fill(link);
  await page.getByRole('button', { name: 'Confirm I saved it' }).click();
  await expect(page.getByRole('heading', { level: 1, name: opts.title })).toBeVisible();
  const gid = new URL(link).pathname.split('/')[2]!;
  const origin = new URL(page.url()).origin;
  return { gid, adminLink: link, invite: `${origin}/g/${gid}` };
}

/** Reveal the (hidden by default) private link on the save-link screen and return it. */
export async function readSecretLink(page: Page): Promise<string> {
  const box = page.locator('#link-box');
  await expect(box).toHaveValue(/^http/);
  await page.getByRole('button', { name: 'Show' }).click();
  return await box.inputValue();
}

/** Join an exchange through the real UI and save the private link. Returns the member link. */
export async function joinExchange(page: Page, invite: string, o: { name: string; wishlist?: string; address: string }) {
  await page.goto(invite);
  await page.getByRole('button', { name: 'Join this exchange' }).click();
  await page.getByLabel('Your nickname').fill(o.name);
  if (o.wishlist) await page.getByLabel(/Wishlist/).fill(o.wishlist);
  await page.getByRole('button', { name: /Next: your wallet/ }).click();
  await page.getByLabel(/I have a wallet and know my shielded address/).check();
  await page.getByRole('button', { name: /Next: your address/ }).click();
  await page.getByLabel('Your shielded receiving address').fill(o.address);
  await expect(page.getByText('This looks like a valid shielded address')).toBeVisible();
  await page.getByRole('button', { name: /Next: review/ }).click();
  await page.getByLabel(/I understand who can see my details/).check();
  await page.getByRole('button', { name: /^Join / }).click();
  await expect(page.getByRole('heading', { name: /You.re in/ })).toBeVisible();
  const link = await readSecretLink(page);
  await page.getByLabel('Paste your link').fill(link);
  await page.getByRole('button', { name: 'Confirm I saved it' }).click();
  await page.getByRole('button', { name: 'Go to my page' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  return link;
}

/** Host draws via the real UI. */
export async function drawNames(page: Page, adminLink: string) {
  await page.goto(adminLink);
  await page.getByRole('button', { name: 'Review people and draw' }).click();
  await page.getByRole('button', { name: /^Draw names for/ }).click();
  const early = page.getByRole('button', { name: 'Close joining and draw' });
  if (await early.isVisible().catch(() => false)) await early.click();
  await expect(page.getByText('The names are drawn')).toBeVisible();
}

export const refOf = (memo: string): string => {
  const m = /MUM-[0-9A-Z]{4}(?:-[0-9A-Z]{4}){3}-[0-9A-Z]/.exec(memo);
  if (!m) throw new Error(`no reference in memo: ${memo}`);
  return m[0];
};
