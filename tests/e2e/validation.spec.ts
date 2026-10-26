import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { makeExchange } from './fixture';
import { newPerson, shieldedAddresses } from './helpers';

const vectors = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../packages/zcash/test/vectors/unified_address.json'), 'utf8')) as unknown[][];
const withTransparent = vectors.find((r) => typeof r[6] === 'string' && (r[6] as string).startsWith('u1') && (r[2] || r[3]) && r[0])![6] as string;

test.describe('create form validation', () => {
  test('an empty form lists every problem, links to each field, and recovers as it is fixed', async ({ browser }) => {
    const p = await newPerson(browser);
    await p.page.goto('/new');
    await p.page.getByRole('button', { name: 'Create the exchange' }).click();
    const summary = p.page.getByRole('alert').filter({ hasText: 'Please fix' });
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('Give the exchange a name');
    await expect(summary).toContainText('whether you’ll take part');
    await expect(summary).toContainText('confirm you understand how the draw works');
    // The summary links move focus to the field.
    await summary.getByRole('link', { name: /Give the exchange a name/ }).click();
    await expect(p.page.getByLabel('Name of the exchange')).toBeFocused();
    await expect(p.page.getByLabel('Name of the exchange')).toHaveAttribute('aria-invalid', 'true');
    await p.page.getByLabel('Name of the exchange').fill('Fixed Name');
    await p.page.getByLabel(/only organizing/).check();
    await p.page.getByLabel(/I understand that the draw runs/).check();
    await p.page.getByRole('button', { name: 'Create the exchange' }).click();
    await expect(p.page.getByRole('heading', { name: /Save your admin link/i, level: 2 })).toBeAttached();
    await p.ctx.close();
  });

  test('budget, dates and size limits are enforced with plain-language messages', async ({ browser }) => {
    const p = await newPerson(browser);
    await p.page.goto('/new');
    await p.page.getByLabel('Name of the exchange').fill('Limits');
    await p.page.getByLabel(/only organizing/).check();
    await p.page.getByLabel(/I understand that the draw runs/).check();
    await p.page.getByRole('button', { name: 'Other' }).click();
    for (const [value, message] of [
      ['abc', /Enter the budget as dollars/],
      ['3', /Budgets run from \$5 to \$250/],
      ['300', /Budgets run from \$5 to \$250/],
    ] as const) {
      await p.page.getByLabel('Budget in dollars').fill(value);
      await p.page.getByRole('button', { name: 'Create the exchange' }).click();
      await expect(p.page.getByRole('alert').filter({ hasText: 'Please fix' })).toContainText(message);
    }
    await p.page.getByLabel('Budget in dollars').fill('12.50');
    await p.page.getByLabel('People can join until').fill('2020-01-01');
    await p.page.getByLabel('Most people allowed').fill('3');
    await p.page.getByRole('button', { name: 'Create the exchange' }).click();
    const summary = p.page.getByRole('alert').filter({ hasText: 'Please fix' });
    await expect(summary).toContainText('can’t be in the past');
    await expect(summary).toContainText('between 4 and 50');
    await p.page.getByLabel('People can join until').fill('2999-01-01');
    await p.page.getByRole('button', { name: 'Create the exchange' }).click();
    await expect(summary).toContainText('within 90 days');
    await p.ctx.close();
  });
});

test.describe('join wizard validation', () => {
  test('each step explains what is wrong and addresses are refused with reasons', async ({ browser }) => {
    const fx = await makeExchange({ members: 1, title: 'Join checks' });
    const p = await newPerson(browser);
    await p.page.goto(fx.invite);
    await p.page.getByRole('button', { name: 'Join this exchange' }).click();

    await p.page.getByRole('button', { name: /Next: your wallet/ }).click();
    await expect(p.page.getByRole('alert').filter({ hasText: 'Please fix' })).toContainText('nickname');
    await p.page.getByLabel('Your nickname').fill('A');
    await p.page.getByRole('button', { name: /Next: your wallet/ }).click();
    await expect(p.page.getByRole('alert').filter({ hasText: 'Please fix' })).toContainText('at least 2');
    await p.page.getByLabel('Your nickname').fill('Zed');
    await p.page.getByLabel(/Wishlist/).fill('x'.repeat(281));
    await expect(p.page.getByText('281 / 280')).toBeVisible();
    await p.page.getByRole('button', { name: /Next: your wallet/ }).click();
    await expect(p.page.getByRole('alert').filter({ hasText: 'Please fix' })).toContainText('280 characters');
    await p.page.getByLabel(/Wishlist/).fill('socks');
    await p.page.getByRole('button', { name: /Next: your wallet/ }).click();

    await p.page.getByRole('button', { name: /Next: your address/ }).click();
    await expect(p.page.getByRole('alert').filter({ hasText: 'Please fix' })).toContainText('Choose the option');
    await p.page.getByLabel(/I don.t have a wallet yet/).check();
    await expect(p.page.getByText('Set one up first')).toBeVisible();
    await expect(p.page.getByText('Never enter your secret words here')).toBeVisible();
    await p.page.getByRole('button', { name: /Next: your address/ }).click();

    const address = p.page.getByLabel('Your shielded receiving address');
    const next = p.page.getByRole('button', { name: /Next: review/ });
    await expect(next).toBeDisabled();
    const good = shieldedAddresses(1)[0]!;
    const cases: [string, RegExp][] = [
      ['t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs', /transparent address/],
      ['t3Vz22vK5z2LcKEdg16Yv4FFneEL1zg9ojd', /transparent address/],
      ['tex1s2rt77ggv6q989lr49rkgzmh5slsksa9khdgte', /TEX/],
      ['ztestsapling10yy2ex5dcqkclhc7z7yrnjq2z6feyjad56ptwlfgmy77dmaqqrl9gyhprdx59qgmsnyfska2kez', /testnet/],
      ['helloworld', /does not look like a Zcash/],
      ['hello world', /Remove spaces or line breaks/],
      ['0x71C7656EC7ab88b098defB751B7401B5f6d8976F', /does not look like a Zcash/],
      [good.slice(0, -3) + (good.endsWith('qqq') ? 'ppp' : 'qqq'), /typo/],
      [good.slice(0, 60), /typo|damaged/i],
      [good.slice(0, 20) + good.slice(20).toUpperCase(), /typo/],
    ];
    for (const [value, message] of cases) {
      await address.fill(value);
      await expect(p.page.getByText('We can’t use this address')).toBeVisible();
      await expect(p.page.locator('.address-check')).toContainText(message);
      await expect(next).toBeDisabled();
    }
    // A unified address that also has a transparent part is accepted with a clear warning.
    await address.fill(withTransparent);
    await expect(p.page.getByText('This looks like a valid shielded address')).toBeVisible();
    await expect(p.page.locator('.address-check')).toContainText('also contains a transparent');
    // A shielded-only one is accepted without it, and shows where it ends.
    await address.fill(good);
    await expect(p.page.getByText('This looks like a valid shielded address')).toBeVisible();
    await expect(p.page.locator('.address-check')).not.toContainText('also contains a transparent');
    await expect(p.page.locator('.address-check')).toContainText(`…${good.slice(-6)}`);
    await next.click();
    // Review requires consent before joining.
    await p.page.getByRole('button', { name: /^Join Join checks/ }).click();
    await expect(p.page.getByRole('alert').filter({ hasText: 'Please fix' })).toContainText('who can see your details');
    await p.ctx.close();
  });

  test('a nickname already taken sends you back to fix it, keeping your other answers', async ({ browser }) => {
    const fx = await makeExchange({ members: 1, title: 'Name clash' });
    const p = await newPerson(browser);
    await p.page.goto(fx.invite);
    await p.page.getByRole('button', { name: 'Join this exchange' }).click();
    await p.page.getByLabel('Your nickname').fill('ada');
    await p.page.getByRole('button', { name: /Next: your wallet/ }).click();
    await p.page.getByLabel(/I have a wallet and know/).check();
    await p.page.getByRole('button', { name: /Next: your address/ }).click();
    await p.page.getByLabel('Your shielded receiving address').fill(shieldedAddresses(2)[1]!);
    await p.page.getByRole('button', { name: /Next: review/ }).click();
    await p.page.getByLabel(/I understand who can see/).check();
    await p.page.getByRole('button', { name: /^Join / }).click();
    await expect(p.page.getByRole('alert').filter({ hasText: 'Please fix' })).toContainText('already uses that name');
    await expect(p.page.getByLabel('Your nickname')).toHaveValue('ada');
    await p.ctx.close();
  });

  test('drafts survive a detour to the wallet guide and a reload', async ({ browser }) => {
    const fx = await makeExchange({ members: 0, title: 'Draft keeper' });
    const p = await newPerson(browser);
    await p.page.goto(fx.invite);
    await p.page.getByRole('button', { name: 'Join this exchange' }).click();
    await p.page.getByLabel('Your nickname').fill('Keeper');
    await p.page.getByLabel(/Wishlist/).fill('a very specific wishlist');
    await p.page.reload();
    await p.page.getByRole('button', { name: 'Join this exchange' }).click();
    await expect(p.page.getByLabel('Your nickname')).toHaveValue('Keeper');
    await expect(p.page.getByLabel(/Wishlist/)).toHaveValue('a very specific wishlist');
    await p.ctx.close();
  });
});

test.describe('invitation states', () => {
  test('a full exchange, a drawn exchange and a closed window each explain why nobody can join', async ({ browser }) => {
    const full = await makeExchange({ members: 4, title: 'Full house', patch: { memberCap: 4 } });
    const drawn = await makeExchange({ members: 4, draw: true, title: 'Already drawn' });
    const p = await newPerson(browser);
    await p.page.goto(full.invite);
    await expect(p.page.getByText('This exchange is full.')).toBeVisible();
    await p.page.goto(drawn.invite);
    await expect(p.page.getByText(/names have already been drawn/)).toBeVisible();
    await expect(p.page.getByRole('button', { name: 'Join this exchange' })).toHaveCount(0);
    await p.ctx.close();
  });

  test('the invite carries the host key fingerprint: a matching one is silent, a missing one is flagged, a wrong one blocks joining', async ({ browser }) => {
    const ex = await makeExchange({ members: 2, title: 'Key check' });
    const hk = ex.hostPublicKey;
    const p = await newPerson(browser);
    // Matching fingerprint: no warning, joining is allowed.
    await p.page.goto(`${ex.invite}#hk=${hk}`);
    await expect(p.page.getByRole('button', { name: 'Join this exchange' })).toBeEnabled();
    await expect(p.page.getByText(/doesn.t match the host.s key/)).toHaveCount(0);
    await expect(p.page.getByText('This link has no host key to check')).toHaveCount(0);
    // No fingerprint: allowed, but said plainly.
    await p.page.goto(ex.invite);
    await expect(p.page.getByText('This link has no host key to check')).toBeVisible();
    await expect(p.page.getByRole('button', { name: 'Join this exchange' })).toBeEnabled();
    // A different key: refused.
    const wrong = hk.replace(/^./, hk[0] === 'A' ? 'B' : 'A');
    await p.page.goto(`${ex.invite}#hk=${wrong}`);
    await expect(p.page.getByText(/doesn.t match the host.s key/)).toBeVisible();
    await expect(p.page.getByRole('button', { name: 'Join this exchange' })).toBeDisabled();
    await p.ctx.close();
  });

  test('an unknown invitation says so kindly, with a real 404 for the page itself', async ({ browser, request }) => {
    const p = await newPerson(browser);
    await p.page.goto('/g/0123456789abcdef0123456789abcdef');
    await expect(p.page.getByRole('heading', { name: /can.t find this invitation/ })).toBeVisible();
    const r = await request.get('/definitely-not-a-page');
    expect(r.status()).toBe(404);
    await p.page.goto('/definitely-not-a-page');
    await expect(p.page.getByRole('heading', { name: /This mask is empty/ })).toBeVisible();
    await expect(p.page.getByRole('link', { name: 'Go to the home page' })).toBeVisible();
    await p.ctx.close();
  });
});

test.describe('failure handling', () => {
  test('an API outage shows a retryable message instead of a blank screen', async ({ browser }) => {
    const fx = await makeExchange({ members: 0, title: 'Outage test' });
    const p = await newPerson(browser);
    await p.page.route('**/api/groups/*/invite', (r) => r.abort());
    await p.page.goto(fx.invite);
    await expect(p.page.getByRole('heading', { name: /couldn.t load this invitation/ })).toBeVisible();
    await expect(p.page.getByText(/couldn.t reach Mummer/)).toBeVisible();
    await p.page.unroute('**/api/groups/*/invite');
    await p.page.getByRole('button', { name: 'Try again' }).click();
    await expect(p.page.getByRole('heading', { name: 'Outage test' })).toBeVisible();
    await p.ctx.close();
  });

  test('the payment request is withheld, with a retry, when the price is unavailable', async ({ browser }) => {
    const fx = await makeExchange({ members: 5, draw: true, title: 'No price' });
    const p = await newPerson(browser);
    await p.page.route('**/api/price', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'quote_unavailable', message: 'A ZEC price is not available right now.' } }) }));
    await p.page.goto(fx.members[0]!.link);
    await expect(p.page.getByText('We couldn’t get a price right now')).toBeVisible();
    await expect(p.page.getByRole('img', { name: /Payment request/ })).toHaveCount(0);
    await expect(p.page.getByRole('link', { name: 'Open in my wallet' })).toHaveCount(0);
    await p.page.unroute('**/api/price');
    await p.page.getByRole('button', { name: 'Try again' }).click();
    await expect(p.page.getByRole('img', { name: /Payment request/ })).toBeVisible();
    await p.ctx.close();
  });

  test('an expired quote hides the QR until refreshed', async ({ browser }) => {
    const fx = await makeExchange({ members: 5, draw: true, title: 'Stale quote' });
    const p = await newPerson(browser);
    const past = new Date(Date.now() - 3_600_000).toISOString();
    await p.page.route('**/api/price', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ usdPerZec: '31.54000000', asOf: past, validUntil: past, source: 'fixture' }) }));
    await p.page.goto(fx.members[0]!.link);
    await expect(p.page.getByText('This quote has expired')).toBeVisible();
    await expect(p.page.getByRole('img', { name: /Payment request/ })).toHaveCount(0);
    await p.ctx.close();
  });

  test('an oversize or control-character note is refused before it can reach a memo', async ({ browser }) => {
    const fx = await makeExchange({ members: 5, draw: true, title: 'Notes' });
    const p = await newPerson(browser);
    await p.page.goto(fx.members[0]!.link);
    const note = p.page.getByLabel(/Add a note/);
    await note.fill('🎁'.repeat(101));
    await expect(p.page.getByText(/note is too long for a memo/)).toBeVisible();
    await expect(p.page.getByRole('img', { name: /Payment request/ })).toHaveCount(0);
    await note.fill('🎁'.repeat(100));
    await expect(p.page.getByRole('img', { name: /Payment request/ })).toBeVisible();
    await expect(p.page.locator('#memo-box')).toHaveValue(/^MUMMER MUM-.*\n🎁{100}$/su);
    await p.ctx.close();
  });
});
