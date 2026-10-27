import { expect, test, type Page } from '@playwright/test';
import { api, makeExchange } from './fixture';
import { newPerson } from './helpers';

/**
 * Browser storage can be blocked (some privacy modes), full, or can start failing mid-session. Nobody may be locked out by that,
 * and a link replacement must never kill the old link unless the new key is safely held somewhere.
 */

const groupStatus = async (gid: string, token: string) => (await api('GET', `/api/groups/${gid}`, { token })).status;

/** Storage that refuses everything from the very first script. */
async function blockStorageEntirely(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  });
}

/** Storage that works, except that writes of the saved private-link record can be switched off at any time. */
async function failCredentialWritesOnDemand(page: Page) {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if ((window as unknown as { __failCreds?: boolean }).__failCreds && /^mummer:v1:member:/.test(k)) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.call(this, k, v);
    };
  });
}

test.describe('browser storage failures', () => {
  test('with storage blocked, opening a private link still works from the address bar and says the link must be saved', async ({ browser }) => {
    const fx = await makeExchange({ members: 5, draw: true, title: 'No storage' });
    const m = fx.members[0]!;
    const p = await newPerson(browser);
    await blockStorageEntirely(p.page);
    await p.page.goto(m.link);
    await expect(p.page.getByText(/You.re giving to/)).toBeVisible();
    // Nothing could be saved, so the fragment is not stripped and the page asks the person to keep the link.
    expect(new URL(p.page.url()).hash).toContain('k=');
    await expect(p.page.getByText(/Save your private link/i).first()).toBeVisible();
    await p.ctx.close();
  });

  test('restoring from a pasted link with storage blocked carries the key in the destination so the page still opens', async ({ browser }) => {
    const fx = await makeExchange({ members: 5, draw: true, title: 'Restore blocked' });
    const m = fx.members[1]!;
    const p = await newPerson(browser);
    await blockStorageEntirely(p.page);
    await p.page.goto('/recover');
    await p.page.getByLabel('Private link').fill(m.link);
    await p.page.getByRole('button', { name: 'Use this link' }).click();
    await expect(p.page).toHaveURL(new RegExp(`/g/${fx.gid}/m/${m.id}`));
    expect(new URL(p.page.url()).hash).toContain('k=');
    await expect(p.page.getByText(/You.re giving to/)).toBeVisible();
    await p.ctx.close();
  });

  test('replacing a link is refused, and changes nothing, when this browser will not keep the new key', async ({ browser }) => {
    const fx = await makeExchange({ members: 5, draw: true, title: 'Refuse replace' });
    const m = fx.members[2]!;
    const p = await newPerson(browser);
    // Open normally (credentials saved), then make the pending-record write fail from here on.
    await p.page.goto(m.link);
    await expect(p.page.getByText(/You.re giving to/)).toBeVisible();
    await p.page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k: string, v: string) {
        if (/rotation:/.test(k)) throw new DOMException('Quota exceeded', 'QuotaExceededError');
        return original.call(this, k, v);
      };
    });
    await p.page.getByRole('tab', { name: 'My link' }).click();
    await p.page.getByRole('button', { name: 'Replace my link' }).first().click();
    await p.page.getByRole('button', { name: 'Replace it' }).click();
    await expect(p.page.getByText(/NOT been replaced and still works/)).toBeVisible();
    expect(await groupStatus(fx.gid, m.token)).toBe(200); // the old link was never invalidated
    await p.ctx.close();
  });

  test('if the new key cannot be saved after the server replaced the link, the page holds it in memory and still works', async ({ browser }) => {
    const fx = await makeExchange({ members: 5, draw: true, title: 'Memory handoff' });
    const m = fx.members[3]!;
    const p = await newPerson(browser);
    await failCredentialWritesOnDemand(p.page);
    await p.page.goto(m.link);
    await expect(p.page.getByText(/You.re giving to/)).toBeVisible();
    await p.page.evaluate(() => ((window as unknown as { __failCreds: boolean }).__failCreds = true));

    await p.page.getByRole('tab', { name: 'My link' }).click();
    await p.page.getByRole('button', { name: 'Replace my link' }).first().click();
    await p.page.getByRole('button', { name: 'Replace it' }).click();
    await expect(p.page.getByText('Your link was replaced')).toBeVisible();
    expect(await groupStatus(fx.gid, m.token)).toBe(401);

    // The new link is shown so it can be saved by hand.
    const box = p.page.getByLabel('Your private link', { exact: true }).first();
    await p.page.getByRole('button', { name: 'Show' }).first().click();
    const newLink = await box.inputValue();
    expect(newLink).toMatch(/#k=/);

    // The page keeps working with the key it holds in memory: an authenticated action succeeds.
    await p.page.getByRole('tab', { name: /gift to give/i }).click();
    await p.page.getByRole('button', { name: 'I sent it' }).click();
    await p.page.getByRole('button', { name: 'Yes, I sent it' }).click();
    await expect(p.page.getByText('You already marked this gift as sent')).toBeVisible();

    // Reload with writes still failing: the pending record is still there, the server accepts it, and the page recovers.
    await p.page.reload();
    await expect(p.page.getByText(/You.re giving to/)).toBeVisible({ timeout: 30_000 });
    // The new link also works on a clean device.
    const other = await newPerson(browser);
    await other.page.goto(newLink);
    await expect(other.page.getByText(/You.re giving to/)).toBeVisible();
    await p.ctx.close();
    await other.ctx.close();
  });
});
