import { expect, test } from '@playwright/test';
import { api, makeExchange } from './fixture';
import { newPerson, passSaveLinkGate, setClock } from './helpers';

/** Behaviours found by the build review, exercised in the real browser. */

test.describe('create form dates', () => {
  test('clearing a date shows a message in the error summary instead of crashing the form', async ({ browser }) => {
    const p = await newPerson(browser);
    const pageErrors: string[] = [];
    p.page.on('pageerror', (e) => pageErrors.push(String(e)));
    await p.page.goto('/new');
    await p.page.getByLabel('Name of the exchange').fill('Cleared dates');
    await p.page.getByLabel(/only organizing/).check();
    await p.page.getByLabel(/I understand that the draw runs in my browser/).check();
    await p.page.getByLabel('Reveal date').fill('');
    await p.page.getByRole('button', { name: 'Create the exchange' }).click();
    await expect(p.page.getByRole('alert').filter({ hasText: 'Choose the reveal date.' }).first()).toBeVisible();
    // The join date too, on its own and together with the reveal date.
    await p.page.getByLabel('People can join until').fill('');
    await p.page.getByRole('button', { name: 'Create the exchange' }).click();
    await expect(p.page.getByRole('alert').filter({ hasText: 'Choose the last day people can join.' }).first()).toBeVisible();
    await expect(p.page.getByRole('alert').filter({ hasText: 'Choose the reveal date.' }).first()).toBeVisible();
    // The summary links to the offending fields and the page still responds.
    await expect(p.page.getByRole('button', { name: 'Create the exchange' })).toBeEnabled();
    expect(pageErrors).toEqual([]);
    await p.ctx.close();
  });
});

test.describe('payments for people who left', () => {
  test('a giver is not shown a payment request once the recipient has been removed, and is told why', async ({ browser }) => {
    const fx = await makeExchange({ members: 5, draw: true, title: 'Recipient left' });
    const giver = fx.members[0]!;
    const p = await newPerson(browser);
    await p.page.goto(giver.link);
    await expect(p.page.getByText(/You.re giving to/)).toBeVisible();
    const recipientName = ((await p.page.locator('.assignment-name').textContent()) ?? '').trim();
    await expect(p.page.getByRole('img', { name: /Payment request/ })).toBeVisible();
    const recipient = fx.members.find((m) => m.name.toLowerCase() === recipientName.toLowerCase())!;
    expect(recipient).toBeTruthy();

    // The host removes the recipient after the draw.
    const removed = await api('DELETE', `/api/groups/${fx.gid}/members/${recipient.id}`, { token: fx.host.token });
    expect(removed.status).toBeLessThan(300);
    await p.page.reload();
    await expect(p.page.getByText(/has left or been removed from this exchange, so please don.t send this gift/)).toBeVisible();
    await expect(p.page.getByRole('img', { name: /Payment request/ })).toHaveCount(0);
    await expect(p.page.getByRole('button', { name: 'I sent it' })).toHaveCount(0);
    // The resolution banner no longer says a showing assignment "still works".
    await expect(p.page.getByText(/it still works/)).toHaveCount(0);
    await p.ctx.close();
  });
});

test.describe('host review before the draw', () => {
  test('removing someone in the review step does not make the next draw fail with a stale-list error', async ({ browser }) => {
    const fx = await makeExchange({ members: 6, title: 'Remove then draw' });
    const host = await newPerson(browser);
    await host.page.goto(fx.adminLink);
    await passSaveLinkGate(host.page);
    await host.page.getByRole('button', { name: 'Review people and draw' }).click();
    await expect(host.page.getByRole('list', { name: 'People in this draw' })).toBeVisible();
    await host.page.getByRole('button', { name: `Remove ${fx.members[5]!.name}` }).click();
    await host.page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
    // The list is reloaded from the server: the removed person is gone and the rest remain.
    await expect(host.page.getByRole('list', { name: 'People in this draw' }).getByText(fx.members[5]!.name)).toHaveCount(0);
    await expect(host.page.getByRole('list', { name: 'People in this draw' }).getByText(fx.members[0]!.name)).toBeVisible();
    await host.page.getByRole('button', { name: /^Draw names for/ }).click();
    const early = host.page.getByRole('button', { name: 'Close joining and draw' });
    if (await early.isVisible().catch(() => false)) await early.click();
    await expect(host.page.getByText('The names are drawn')).toBeVisible();
    await expect(host.page.getByText(/changed since you|out of date|Reload/i)).toHaveCount(0);
    await host.ctx.close();
  });
});

test.describe('reveal wording', () => {
  test('the reveal list explains that a reveal shows straight away and whether the recipient has confirmed it', async ({ browser, request }) => {
    const fx = await makeExchange({ members: 5, draw: true, title: 'Reveal wording' });
    const p = await newPerson(browser);
    await setClock(request, 18 * 86_400); // reveal day
    try {
      await p.page.goto(fx.members[0]!.link);
      await expect(p.page.getByRole('heading', { name: 'Reveal day' })).toBeVisible();
      await expect(p.page.getByText(/It appears here straight away/)).toBeVisible();
      await expect(p.page.getByText(/only shown as agreed by both people/)).toHaveCount(0);
    } finally {
      await setClock(request, 0);
    }
    await p.ctx.close();
  });
});
