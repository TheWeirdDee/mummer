import { expect, test, type Page } from '@playwright/test';
import { createExchange, drawNames, joinExchange, newPerson, refOf, setClock, shieldedAddresses, type Person } from './helpers';

const NAMES = ['Ada', 'Grace', 'Linus', 'Margaret', 'Dennis'];

test.describe.configure({ mode: 'serial' });

test('a full exchange with a host and five participants, in isolated browser profiles', async ({ browser, request }) => {
  const addresses = shieldedAddresses(5);
  const host = await newPerson(browser);
  const people: Person[] = [];
  const links: string[] = [];
  const consoleErrors: string[] = [];
  const requestedOrigins = new Set<string>();

  const watch = (p: Person) => {
    p.page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    p.page.on('pageerror', (e) => consoleErrors.push(e.message));
    p.page.on('request', (r) => requestedOrigins.add(new URL(r.url()).origin));
  };
  watch(host);

  // 1. Host creates the exchange and saves the admin link (verified by pasting it back).
  const ex = await createExchange(host.page, { title: 'Winter Mummers' });
  await expect(host.page.getByText('Nobody has joined yet')).toBeVisible();
  // Credentials were moved out of the address bar after saving.
  expect(host.page.url()).not.toContain('#');

  // 2. Five people join in their own isolated profiles.
  for (let i = 0; i < 5; i++) {
    const p = await newPerson(browser);
    watch(p);
    people.push(p);
    links.push(await joinExchange(p.page, ex.invite, { name: NAMES[i]!, wishlist: `${NAMES[i]} would love socks and a good book`, address: addresses[i]! }));
  }

  // 3. The host sees everyone and draws.
  await host.page.goto(ex.adminLink);
  for (const n of NAMES) await expect(host.page.getByRole('list', { name: 'People in this exchange' }).getByText(n, { exact: true })).toBeVisible();
  await drawNames(host.page, ex.adminLink);
  // The host's screen never shows who draws whom.
  const hostText = await host.page.locator('main').innerText();
  for (const a of addresses) expect(hostText).not.toContain(a.slice(0, 20));

  // 4. Every participant opens their own assignment: a recipient, a wishlist, a QR code, copyable details and a memo reference.
  const recipientOf = new Map<string, string>();
  const referenceOf = new Map<string, string>();
  for (let i = 0; i < 5; i++) {
    const page = people[i]!.page;
    await page.goto(links[i]!);
    await expect(page.getByText(/You.re giving to/)).toBeVisible();
    const recipient = ((await page.locator('.assignment-name').textContent()) ?? '').trim();
    expect(NAMES).toContain(recipient);
    expect(recipient).not.toBe(NAMES[i]);
    recipientOf.set(NAMES[i]!, recipient);
    await expect(page.getByText(/would love socks/)).toBeVisible();
    await expect(page.getByRole('img', { name: /Payment request for .* ZEC to/ })).toBeVisible();
    const memo = await page.locator('#memo-box').inputValue();
    expect(memo).toMatch(/^MUMMER MUM-/);
    referenceOf.set(NAMES[i]!, refOf(memo));
    // $25 at $31.54/ZEC, rounded to 4 decimals.
    await expect(page.getByLabel('Amount (ZEC)')).toHaveValue('0.7926');
    await expect(page.getByRole('link', { name: 'Open in my wallet' })).toHaveAttribute('href', /^zcash:u1/);
  }
  // Everyone is given to exactly once, and nobody gives to themselves.
  expect(new Set(recipientOf.values()).size).toBe(5);

  // 5. Each giver notes the gift as sent. Mummer calls this a note, never a verified payment.
  for (let i = 0; i < 5; i++) {
    const page = people[i]!.page;
    await page.getByRole('button', { name: 'I sent it' }).click();
    await expect(page.getByRole('dialog')).toContainText('only your word');
    await page.getByRole('button', { name: 'Yes, I sent it' }).click();
    await expect(page.getByText('You already marked this gift as sent')).toBeVisible();
  }

  // 6. Each recipient confirms, with the reference from their giver's memo (as they would read it in their wallet).
  for (let i = 0; i < 5; i++) {
    const recipientName = NAMES[i]!;
    const giverName = [...recipientOf.entries()].find(([, r]) => r === recipientName)![0];
    const page = people[i]!.page;
    await page.getByRole('tab', { name: 'A gift for you' }).click();
    await page.getByLabel(/Reference from the memo/).fill(referenceOf.get(giverName)!);
    await page.getByRole('button', { name: 'I received this gift' }).click();
    await expect(page.getByRole('dialog')).toContainText('your own word');
    await page.getByRole('button', { name: 'Yes, I received it' }).click();
    await expect(page.getByText('You confirmed this gift')).toBeVisible();
    await expect(page.getByText('Mummer recognises the reference you entered.')).toBeVisible();
  }

  // 7. Progress is counts only.
  await host.page.goto(ex.adminLink);
  await expect(host.page.getByText('5 / 5').first()).toBeVisible();
  const progressText = await host.page.locator('#progress-title').locator('..').innerText();
  expect(progressText).toMatch(/Counts only/);
  expect(progressText.toLowerCase()).not.toContain('verified');

  // 8. Reveal day: move the server clock past the reveal date; a giver unmasks to their recipient only.
  await setClock(request, 18 * 86_400);
  const giver = people[0]!.page;
  await giver.goto(links[0]!);
  await expect(giver.getByRole('heading', { name: 'Reveal day' })).toBeVisible();
  await giver.getByLabel(/Only the person I gave to/).check();
  await giver.getByRole('button', { name: 'Review and reveal' }).click();
  await giver.getByRole('button', { name: 'Reveal', exact: true }).click();
  await expect(giver.getByText('You revealed')).toBeVisible();
  const recipient = people[NAMES.indexOf(recipientOf.get('Ada')!)]!.page;
  await recipient.goto(links[NAMES.indexOf(recipientOf.get('Ada')!)]!);
  await expect(recipient.getByText(/Ada says they gave to/)).toBeVisible();
  await recipient.getByRole('button', { name: 'Yes, they gave to me' }).click();
  await expect(recipient.getByText(/confirmed\./)).toBeVisible();
  // A bystander does not see a private reveal.
  const bystanderIdx = NAMES.findIndex((n) => n !== 'Ada' && n !== recipientOf.get('Ada'));
  await people[bystanderIdx]!.page.goto(links[bystanderIdx]!);
  await expect(people[bystanderIdx]!.page.getByText('No one has revealed yet')).toBeVisible();
  await setClock(request, 0);

  // 9. The host inspects what the server stores: sealed blobs only.
  await host.page.goto(ex.adminLink);
  await host.page.getByText('What Mummer’s server stores for this exchange').click();
  await host.page.getByRole('button', { name: /Show what.s stored/ }).click();
  const box = host.page.getByLabel('Redacted database contents');
  await expect(box).toContainText('"sealed": true');
  const dump = await box.innerText();
  for (const a of addresses) expect(dump).not.toContain(a.slice(0, 20));
  expect(dump).not.toContain('socks');

  // No console errors anywhere in the real journey up to this point.
  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);

  // 10. The host deletes the exchange; every link then stops working.
  await host.page.getByRole('button', { name: 'Delete the exchange' }).click();
  await host.page.getByLabel(/Type .Winter Mummers. to confirm/).fill('Winter Mummers');
  await host.page.getByRole('button', { name: 'Delete everything' }).click();
  await host.page.waitForURL(/\/\?deleted=1/);
  await people[1]!.page.goto('about:blank');
  await people[1]!.page.goto(links[1]!);
  await expect(people[1]!.page.getByRole('heading', { name: /doesn.t work any more/ })).toBeVisible();
  await people[2]!.page.goto(ex.invite);
  await expect(people[2]!.page.getByRole('heading', { name: /can.t find this invitation|already in/ })).toBeVisible();

  // After deletion the browser logs the 401/404 responses we deliberately provoked; anything else would be a real error.
  const unexpected = consoleErrors.filter((e) => !/Failed to load resource: the server responded with a status of (401|404)/.test(e));
  expect(unexpected, unexpected.join('\n')).toEqual([]);
  // No third-party origins were contacted during the whole journey.
  const origins = [...requestedOrigins].filter((o) => !o.startsWith('http://127.0.0.1') && !o.startsWith('data:') && !o.startsWith('blob:'));
  expect(origins).toEqual([]);

  for (const p of [host, ...people]) await p.ctx.close();
});

async function textOf(page: Page) {
  return page.locator('body').innerText();
}
void textOf;
