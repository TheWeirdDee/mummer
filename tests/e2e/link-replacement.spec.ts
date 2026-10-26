import { expect, test, type Page } from '@playwright/test';
import { api, makeExchange } from './fixture';
import { newPerson } from './helpers';

/**
 * Link replacement must never strand a legitimate member and never bring back access that was revoked.
 * The client saves the replacement credentials on the device BEFORE asking the server, and adopts them later only if
 * the server accepts them. These tests break the network in every awkward place.
 */

const ROTATE = '**/api/groups/*/members/*/rotate';

async function startReplace(page: Page) {
  await page.getByRole('tab', { name: 'My link' }).click();
  await page.getByRole('button', { name: 'Replace my link' }).first().click();
  await page.getByRole('button', { name: 'Replace it' }).click();
}

async function readNewLink(page: Page) {
  const box = page.getByLabel('Your private link', { exact: true }).first();
  await page.getByRole('button', { name: 'Show' }).first().click();
  return await box.inputValue();
}

async function storedKeys(page: Page, needle: string) {
  return page.evaluate((n) => Object.keys(localStorage).filter((k) => k.includes(n)), needle);
}

async function openAssignment(page: Page, link: string) {
  await page.goto(link);
  await expect(page.getByText(/You.re giving to/)).toBeVisible();
}

const groupStatus = async (gid: string, token: string) => (await api('GET', `/api/groups/${gid}`, { token })).status;

test.describe('link replacement under failure', () => {
  test('the reply is lost after the server replaced the link: a reload adopts the new key, asks to save the new link, and the old link stays dead', async ({ browser }) => {
    const fx = await makeExchange({ members: 5, draw: true, title: 'Lost reply' });
    const m = fx.members[0]!;
    const p = await newPerson(browser);
    await openAssignment(p.page, m.link);
    const recipient = ((await p.page.locator('.assignment-name').textContent()) ?? '').trim();

    // The request reaches the server and succeeds, but the browser never hears back.
    await p.page.route(ROTATE, async (route) => {
      await route.fetch();
      await route.abort('connectionreset');
    });
    await startReplace(p.page);
    await expect(p.page.getByText(/lost the connection while replacing your link/)).toBeVisible();
    await p.page.unroute(ROTATE);
    expect(await groupStatus(fx.gid, m.token)).toBe(401); // the server really did replace it

    await p.page.reload();
    // Adopted automatically; the person is told to save the NEW link (the old one is dead).
    await expect(p.page.getByText('Your link was replaced')).toBeVisible();
    const newLink = await readNewLink(p.page);
    expect(newLink).toMatch(/#k=/);
    expect(newLink).not.toBe(m.link);
    expect(await storedKeys(p.page, 'rotation')).toEqual([]);
    await expect(p.page.getByText(/You.re giving to/)).toBeVisible();

    // The new link works elsewhere and opens the same assignment; the old one does not.
    const other = await newPerson(browser);
    await openAssignment(other.page, newLink);
    expect(((await other.page.locator('.assignment-name').textContent()) ?? '').trim()).toBe(recipient);
    const stale = await newPerson(browser);
    await stale.page.goto(m.link);
    await expect(stale.page.getByRole('heading', { name: /doesn.t work any more/ })).toBeVisible();
    for (const x of [p, other, stale]) await x.ctx.close();
  });

  test('the server refuses the replacement: nothing changes, the old link keeps working, no pending record is left', async ({ browser }) => {
    const fx = await makeExchange({ members: 5, draw: true, title: 'Refused' });
    const m = fx.members[1]!;
    const p = await newPerson(browser);
    await openAssignment(p.page, m.link);
    await p.page.route(ROTATE, (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'conflict', message: 'That change conflicted with another one. Reload and try again.' } }) }));
    await startReplace(p.page);
    await expect(p.page.getByText(/conflicted with another one/)).toBeVisible();
    expect(await storedKeys(p.page, 'rotation')).toEqual([]);
    expect(await groupStatus(fx.gid, m.token)).toBe(200);
    await p.page.unroute(ROTATE);
    await p.page.reload();
    await expect(p.page.getByText(/You.re giving to/)).toBeVisible();
    await expect(p.page.getByText('Your link was replaced')).toHaveCount(0);
    await p.ctx.close();
  });

  test('a server error is treated as ambiguous: the pending record is kept and settled by the next attempt', async ({ browser }) => {
    const fx = await makeExchange({ members: 5, draw: true, title: 'Server error' });
    const m = fx.members[2]!;
    const p = await newPerson(browser);
    await openAssignment(p.page, m.link);
    // The server applies the change but answers 500.
    await p.page.route(ROTATE, async (route) => {
      await route.fetch();
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Something went wrong on our side. Please try again.' } }) });
    });
    await startReplace(p.page);
    await expect(p.page.getByText(/lost the connection while replacing your link/)).toBeVisible();
    expect(await storedKeys(p.page, 'rotation')).not.toEqual([]);
    expect(await groupStatus(fx.gid, m.token)).toBe(401);
    await p.page.unroute(ROTATE);
    await p.page.reload();
    await expect(p.page.getByText('Your link was replaced')).toBeVisible();
    await expect(p.page.getByText(/You.re giving to/)).toBeVisible();
    await p.ctx.close();
  });

  test('a refresh while the request never reached the server leaves the old link working and strands nobody', async ({ browser }) => {
    const fx = await makeExchange({ members: 5, draw: true, title: 'Refresh before send' });
    const m = fx.members[3]!;
    const p = await newPerson(browser);
    await openAssignment(p.page, m.link);
    await p.page.route(ROTATE, (route) => route.abort('connectionreset')); // never reaches the server
    await startReplace(p.page);
    await expect(p.page.getByText(/lost the connection while replacing your link/)).toBeVisible();
    await p.page.unroute(ROTATE);
    expect(await groupStatus(fx.gid, m.token)).toBe(200); // still the old, working token
    await p.page.reload();
    await expect(p.page.getByText(/You.re giving to/)).toBeVisible();
    await expect(p.page.getByText('Your link was replaced')).toHaveCount(0);

    // A later, clean replacement settles the stale record first (the server rejects the never-registered key) and succeeds.
    await startReplace(p.page);
    await expect(p.page.getByText('Your link was replaced')).toBeVisible();
    expect(await storedKeys(p.page, 'rotation')).toEqual([]);
    expect(await groupStatus(fx.gid, m.token)).toBe(401);
    await p.ctx.close();
  });

  test('going offline during a replacement, then back online, ends with exactly one working link', async ({ browser }) => {
    const fx = await makeExchange({ members: 5, draw: true, title: 'Offline' });
    const m = fx.members[4]!;
    const p = await newPerson(browser);
    await openAssignment(p.page, m.link);
    await p.page.getByRole('tab', { name: 'My link' }).click();
    await p.ctx.setOffline(true);
    await p.page.getByRole('button', { name: 'Replace my link' }).first().click();
    await p.page.getByRole('button', { name: 'Replace it' }).click();
    await expect(p.page.getByText(/lost the connection while replacing your link|reach Mummer/)).toBeVisible();
    await p.ctx.setOffline(false);
    expect(await groupStatus(fx.gid, m.token)).toBe(200);
    await p.page.getByRole('button', { name: 'Replace my link' }).first().click();
    await p.page.getByRole('button', { name: 'Replace it' }).click();
    await expect(p.page.getByText('Your link was replaced')).toBeVisible();
    const link = await readNewLink(p.page);
    expect(await groupStatus(fx.gid, m.token)).toBe(401);
    const other = await newPerson(browser);
    await openAssignment(other.page, link);
    await p.ctx.close();
    await other.ctx.close();
  });

  test('repeated requests: asking again after a lost reply adopts the first replacement instead of making a second one', async ({ browser }) => {
    const fx = await makeExchange({ members: 5, draw: true, title: 'Repeat' });
    const m = fx.members[0]!;
    const p = await newPerson(browser);
    await openAssignment(p.page, m.link);
    let calls = 0;
    await p.page.route(ROTATE, async (route) => {
      calls++;
      await route.fetch();
      await route.abort('connectionreset');
    });
    await startReplace(p.page);
    await expect(p.page.getByText(/lost the connection while replacing your link/)).toBeVisible();
    expect(calls).toBe(1);
    // Without reloading, press the button again.
    await p.page.getByRole('button', { name: 'Replace my link' }).first().click();
    await p.page.getByRole('button', { name: 'Replace it' }).click();
    await expect(p.page.getByText('Your link was replaced')).toBeVisible();
    expect(calls).toBe(1); // no second replacement was sent
    const link = await readNewLink(p.page);
    const other = await newPerson(browser);
    await openAssignment(other.page, link);
    await p.page.unroute(ROTATE);
    await p.ctx.close();
    await other.ctx.close();
  });

  test('two replacements in a row both work, and only the latest link is alive', async ({ browser }) => {
    const fx = await makeExchange({ members: 5, draw: true, title: 'Twice' });
    const m = fx.members[1]!;
    const p = await newPerson(browser);
    await openAssignment(p.page, m.link);
    await startReplace(p.page);
    await expect(p.page.getByText('Your link was replaced')).toBeVisible();
    const first = await readNewLink(p.page);
    await startReplace(p.page);
    await expect(p.page.getByText('Your link was replaced')).toBeVisible();
    const second = await readNewLink(p.page);
    expect(second).not.toBe(first);
    const a = await newPerson(browser);
    await a.page.goto(first);
    await expect(a.page.getByRole('heading', { name: /doesn.t work any more/ })).toBeVisible();
    const b = await newPerson(browser);
    await openAssignment(b.page, second);
    for (const x of [p, a, b]) await x.ctx.close();
  });
});

test.describe('several tabs, stale and revoked credentials', () => {
  test('another tab replaced the link: this tab picks up the saved key by itself instead of dead-ending', async ({ browser }) => {
    const fx = await makeExchange({ members: 5, draw: true, title: 'Two tabs' });
    const m = fx.members[0]!;
    const p = await newPerson(browser);
    await openAssignment(p.page, m.link);
    const second = await p.ctx.newPage();
    await second.goto(`/g/${fx.gid}/m/${m.id}`); // uses the key saved on this device
    await expect(second.getByText(/You.re giving to/)).toBeVisible();

    await startReplace(p.page);
    await expect(p.page.getByText('Your link was replaced')).toBeVisible();

    // The second tab still holds the old token in memory. Its next background refresh gets a 401 and it must switch to the
    // key now saved on this device by itself. The proof is that an authenticated action works there afterwards: with the old
    // token it would be refused.
    await second.waitForTimeout(18_000); // longer than one 15 s polling interval
    await second.getByRole('button', { name: 'I sent it' }).click();
    await second.getByRole('button', { name: 'Yes, I sent it' }).click();
    await expect(second.getByText('You already marked this gift as sent')).toBeVisible();
    await expect(second.getByRole('heading', { name: /doesn.t work any more/ })).toHaveCount(0);
    // And a reload there uses the new saved key too.
    await second.reload();
    await expect(second.getByText(/You.re giving to/)).toBeVisible();
    await p.ctx.close();
  });

  test('opening an old, replaced link on a device that already holds the new key keeps the new key and says so', async ({ browser }) => {
    const fx = await makeExchange({ members: 5, draw: true, title: 'Stale link' });
    const m = fx.members[2]!;
    const p = await newPerson(browser);
    await openAssignment(p.page, m.link);
    await startReplace(p.page);
    await expect(p.page.getByText('Your link was replaced')).toBeVisible();
    // Someone opens the OLD link in the same browser.
    await p.page.goto('/');
    await p.page.goto(m.link);
    await expect(p.page.getByRole('heading', { name: 'This link is different from the one saved here' })).toHaveCount(0);
    await expect(p.page.getByText('That link has been replaced')).toBeVisible();
    await expect(p.page.getByText(/You.re giving to/)).toBeVisible();
    // The dead key never overwrote the live one.
    await p.page.goto(`/g/${fx.gid}/m/${m.id}`);
    await expect(p.page.getByText(/You.re giving to/)).toBeVisible();
    await p.ctx.close();
  });

  test('a revoked member is not let back in by a stale pending record or a stale link', async ({ browser }) => {
    const fx = await makeExchange({ members: 5, draw: true, title: 'Revoked' });
    const m = fx.members[3]!;
    const p = await newPerson(browser);
    await openAssignment(p.page, m.link);
    // A replacement whose request never reached the server leaves a pending record that the server has never accepted.
    await p.page.route(ROTATE, (route) => route.abort('connectionreset'));
    await startReplace(p.page);
    await expect(p.page.getByText(/lost the connection while replacing your link/)).toBeVisible();
    await p.page.unroute(ROTATE);
    expect(await storedKeys(p.page, 'rotation')).not.toEqual([]);

    // The host removes this member.
    const removed = await api('DELETE', `/api/groups/${fx.gid}/members/${m.id}`, { token: fx.host.token });
    expect(removed.status).toBeLessThan(300);
    await p.page.reload();
    await expect(p.page.getByRole('heading', { name: /doesn.t work any more/ })).toBeVisible();
    // The pending record was probed, rejected and dropped; nothing was adopted.
    await expect.poll(() => storedKeys(p.page, 'rotation')).toEqual([]);
    expect(await groupStatus(fx.gid, m.token)).toBe(401);

    // Opening the old link on a clean device does not restore anything either.
    const clean = await newPerson(browser);
    await clean.page.goto(m.link);
    await expect(clean.page.getByRole('heading', { name: /doesn.t work any more/ })).toBeVisible();
    await p.ctx.close();
    await clean.ctx.close();
  });
});
