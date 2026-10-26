import { expect, test } from '@playwright/test';
import { makeExchange } from './fixture';
import { newPerson } from './helpers';

const PASSPHRASE = 'correct horse battery staple';

test.describe('lost, damaged and compromised links', () => {
  test('a device without the key, and a truncated link, are explained instead of failing silently', async ({ browser }) => {
    const fx = await makeExchange({ members: 4, title: 'Lost key' });
    const m = fx.members[0]!;
    const p = await newPerson(browser);
    await p.page.goto(`/g/${fx.gid}/m/${m.id}`);
    await expect(p.page.getByRole('heading', { name: 'Open your private link' })).toBeVisible();
    await expect(p.page.getByText(/Mummer can.t recover it for you/)).toBeVisible();
    // A link cut off mid-key.
    await p.page.goto(m.link.slice(0, -8));
    await expect(p.page.getByRole('heading', { name: /link is incomplete/ })).toBeVisible();
    // Host side: same.
    await p.page.goto(`/g/${fx.gid}/admin`);
    await expect(p.page.getByRole('heading', { name: 'Open your admin link' })).toBeVisible();
    await p.ctx.close();
  });

  test('a link whose key differs from the one saved here asks before replacing it, and keeping the saved key works', async ({ browser }) => {
    const fx = await makeExchange({ members: 4, title: 'Conflict test' });
    const m = fx.members[0]!;
    const other = fx.members[1]!;
    const p = await newPerson(browser);
    await p.page.goto(m.link);
    await expect(p.page.getByRole('heading', { level: 1, name: 'Conflict test' })).toBeVisible();
    // Someone hands over a link for the same address but carrying a different key.
    const foreign = `/g/${fx.gid}/m/${m.id}${other.link.slice(other.link.indexOf('#'))}`;
    await p.page.goto('/');
    await p.page.goto(foreign);
    await expect(p.page.getByRole('heading', { name: 'This link is different from the one saved here' })).toBeVisible();
    await p.page.getByRole('button', { name: 'Keep the key saved on this device' }).click();
    await expect(p.page.getByRole('heading', { level: 1, name: 'Conflict test' })).toBeVisible();
    // The foreign key never replaced the saved one: a reload still works without any fragment.
    await p.page.goto(`/g/${fx.gid}/m/${m.id}`);
    await expect(p.page.getByRole('heading', { level: 1, name: 'Conflict test' })).toBeVisible();
    await p.ctx.close();
  });

  test('a passphrase backup restores access on a fresh device; a wrong passphrase does not', async ({ browser }) => {
    const fx = await makeExchange({ members: 4, title: 'Backup test' });
    const m = fx.members[1]!;
    const a = await newPerson(browser);
    await a.page.goto(m.link);
    await expect(a.page.getByRole('heading', { name: 'Save your private link' })).toBeVisible();
    const saver = a.page.getByRole('region', { name: 'Save your private link' }).first();
    await saver.getByText('Optional: make a passphrase-protected backup').click();
    await saver.getByLabel('Passphrase', { exact: true }).fill('short');
    await saver.getByRole('button', { name: 'Create backup' }).click();
    await expect(saver.getByRole('alert')).toContainText(/at least 10 characters/i);
    await saver.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
    await saver.getByRole('button', { name: 'Create backup' }).click();
    const backup = (await saver.locator('pre.codebox').innerText()).trim();
    expect(backup).toMatch(/^MUMBK1\./);
    // The backup contains neither the key nor the token in clear.
    expect(backup).not.toContain(m.token);
    await a.ctx.close();

    const b = await newPerson(browser);
    await b.page.goto('/recover');
    await b.page.getByLabel('Backup text').fill(backup);
    await b.page.getByLabel('Passphrase', { exact: true }).fill('not the right passphrase');
    await b.page.getByRole('button', { name: 'Restore access' }).click();
    await expect(b.page.getByText(/passphrase doesn.t open this backup/)).toBeVisible();
    await b.page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
    await b.page.getByRole('button', { name: 'Restore access' }).click();
    await expect(b.page).toHaveURL(new RegExp(`/g/${fx.gid}/m/${m.id}`));
    await expect(b.page.getByText(/Waiting for the draw|waiting for the draw/i).first()).toBeVisible();
    await expect(b.page.getByText(m.name, { exact: true }).first()).toBeVisible();
    await b.ctx.close();
  });

  test('restoring from a pasted private link works, and a half-pasted link is rejected', async ({ browser }) => {
    const fx = await makeExchange({ members: 4, title: 'Paste test' });
    const m = fx.members[2]!;
    const p = await newPerson(browser);
    await p.page.goto('/recover');
    await p.page.getByLabel('Private link').fill(m.link.slice(0, -10));
    await p.page.getByRole('button', { name: 'Use this link' }).click();
    await expect(p.page.getByText(/isn.t a complete private link/)).toBeVisible();
    await p.page.getByLabel('Private link').fill(m.link);
    await p.page.getByRole('button', { name: 'Use this link' }).click();
    await expect(p.page).toHaveURL(new RegExp(`/g/${fx.gid}/m/${m.id}$`));
    await p.ctx.close();
  });

  test('replacing a possibly leaked link re-seals the assignment and kills the old link', async ({ browser }) => {
    const fx = await makeExchange({ members: 5, draw: true, title: 'Leaky link' });
    const m = fx.members[0]!;
    const original = await newPerson(browser);
    const leaked = await newPerson(browser);
    await original.page.goto(m.link);
    await expect(original.page.getByText(/You.re giving to/)).toBeVisible();
    const recipientBefore = ((await original.page.locator('.assignment-name').textContent()) ?? '').trim();
    await original.page.getByRole('tab', { name: 'My link' }).click();
    await original.page.getByRole('button', { name: 'Replace my link' }).first().click();
    await original.page.getByRole('button', { name: 'Replace it' }).click();
    await expect(original.page.getByText('Your link was replaced')).toBeVisible();
    // The page asks for the NEW link to be saved (hidden by default); capture it from the first saver.
    const box = original.page.getByLabel('Your private link', { exact: true }).first();
    await original.page.getByRole('button', { name: 'Show' }).first().click();
    const newLink = await box.inputValue();
    expect(newLink).toMatch(/#k=/);
    expect(newLink).not.toBe(m.link);
    // Someone holding the OLD link is locked out.
    await leaked.page.goto(m.link);
    await expect(leaked.page.getByRole('heading', { name: /doesn.t work any more/ })).toBeVisible();
    // The new link opens the same assignment.
    const fresh = await newPerson(browser);
    await fresh.page.goto(newLink);
    await expect(fresh.page.getByText(/You.re giving to/)).toBeVisible();
    expect(((await fresh.page.locator('.assignment-name').textContent()) ?? '').trim()).toBe(recipientBefore);
    for (const x of [original, leaked, fresh]) await x.ctx.close();
  });

  test('leaving before the draw removes you and frees your name; forgetting a device keeps the server side intact', async ({ browser }) => {
    const fx = await makeExchange({ members: 5, title: 'Leave test' });
    const m = fx.members[3]!;
    const p = await newPerson(browser);
    await p.page.goto(m.link);
    await expect(p.page.getByRole('heading', { level: 1, name: 'Leave test' })).toBeVisible();
    await p.page.getByText('My link, backup and leaving').click();
    await p.page.getByRole('button', { name: 'Forget this device' }).first().click();
    await p.page.getByRole('button', { name: 'Remove my key from this device' }).click();
    await expect(p.page).toHaveURL(/\/$/);
    // Still a member server-side: the link still works from scratch.
    await p.page.goto(m.link);
    await expect(p.page.getByText(m.name, { exact: true }).first()).toBeVisible();
    await p.page.getByText('My link, backup and leaving').click();
    await p.page.getByRole('button', { name: 'Leave the exchange' }).first().click();
    await p.page.getByRole('button', { name: 'Leave', exact: true }).click();
    await expect(p.page).toHaveURL(new RegExp(`/g/${fx.gid}$`));
    await p.page.reload();
    await expect(p.page.getByText('Spots left')).toBeVisible();
    await p.ctx.close();
  });
});
