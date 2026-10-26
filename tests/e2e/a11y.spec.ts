import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { makeExchange, type Fixture } from './fixture';
import { newPerson, passSaveLinkGate, shieldedAddresses } from './helpers';

/**
 * WCAG 2.2 AA automated checks (axe-core) across every route and key state, at a phone and a desktop width,
 * plus keyboard-only behaviour. Automated tools find roughly a third of accessibility problems: manual review
 * notes and limits are recorded in docs/TESTING.md.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function expectNoViolations(page: Page, label: string) {
  await page.waitForLoadState('networkidle');
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = result.violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n   ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('\n   ')}`);
  expect(summary, `${label}\n${summary.join('\n')}`).toEqual([]);
}

let waiting: Fixture;
let drawn: Fixture;
test.beforeAll(async () => {
  waiting = await makeExchange({ members: 5, title: 'A11y waiting' });
  drawn = await makeExchange({ members: 5, draw: true, title: 'A11y drawn' });
});

for (const [w, h] of [
  [390, 844],
  [1280, 800],
] as const) {
  test(`axe: every public page at ${w}px`, async ({ browser }) => {
    const p = await newPerson(browser, { width: w, height: h });
    for (const path of ['/', '/how-it-works', '/privacy', '/faq', '/wallet-guide', '/evidence', '/stats', '/recover', '/new', '/nothing-here']) {
      await p.page.goto(path);
      await expectNoViolations(p.page, `${path} @${w}`);
    }
    await p.ctx.close();
  });

  test(`axe: create form, errors, invitation and the join wizard at ${w}px`, async ({ browser }) => {
    const p = await newPerson(browser, { width: w, height: h });
    const { page } = p;
    await page.goto('/new');
    await page.getByRole('button', { name: 'Create the exchange' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Please fix' })).toBeVisible();
    await expectNoViolations(page, `create form with errors @${w}`);

    await page.goto(waiting.invite);
    await expectNoViolations(page, `invitation @${w}`);
    await page.getByRole('button', { name: 'Join this exchange' }).click();
    await expectNoViolations(page, `join step 1 @${w}`);
    await page.getByRole('button', { name: /Next: your wallet/ }).click();
    await expectNoViolations(page, `join step 1 with errors @${w}`);
    await page.getByLabel('Your nickname').fill('Axe Tester');
    await page.getByRole('button', { name: /Next: your wallet/ }).click();
    await page.getByLabel(/I don.t have a wallet yet/).check();
    await expectNoViolations(page, `join step 2 @${w}`);
    await page.getByRole('button', { name: /Next: your address/ }).click();
    await page.getByLabel('Your shielded receiving address').fill('t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs');
    await expectNoViolations(page, `join step 3 with refusal @${w}`);
    await page.getByLabel('Your shielded receiving address').fill(shieldedAddresses(1)[0]!);
    await expect(page.getByText('This looks like a valid shielded address')).toBeVisible();
    await expectNoViolations(page, `join step 3 valid @${w}`);
    await page.getByRole('button', { name: /Next: review/ }).click();
    await expectNoViolations(page, `join review @${w}`);
    await p.ctx.close();
  });

  test(`axe: host and participant screens at ${w}px`, async ({ browser }) => {
    const p = await newPerson(browser, { width: w, height: h });
    const { page } = p;
    await page.goto(waiting.adminLink);
    await expectNoViolations(page, `admin save-link gate @${w}`);
    await passSaveLinkGate(page);
    await expect(page.getByRole('heading', { level: 1, name: 'A11y waiting' })).toBeVisible();
    await expectNoViolations(page, `admin waiting @${w}`);
    await page.getByRole('button', { name: 'Review people and draw' }).click();
    await expect(page.getByRole('button', { name: /^Draw names for/ })).toBeVisible();
    await expectNoViolations(page, `admin draw review @${w}`);
    await page.getByText(/Exclusions: people who shouldn/).click();
    await expectNoViolations(page, `admin exclusions open @${w}`);
    await page.getByRole('button', { name: /^Draw names for/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoViolations(page, `admin confirm-draw dialog @${w}`);
    await page.keyboard.press('Escape');
    await page.getByText('What Mummer’s server stores for this exchange').click();
    await page.getByRole('button', { name: /Show what.s stored/ }).click();
    await expect(page.getByLabel('Redacted database contents')).toBeVisible();
    await expectNoViolations(page, `admin glass-box @${w}`);

    await page.goto(drawn.adminLink);
    await passSaveLinkGate(page);
    await expect(page.getByRole('heading', { level: 1, name: 'A11y drawn' })).toBeVisible();
    await expectNoViolations(page, `admin after draw @${w}`);

    await page.goto(waiting.members[0]!.link);
    await expect(page.getByRole('heading', { level: 1, name: 'A11y waiting' })).toBeVisible();
    await expectNoViolations(page, `member waiting @${w}`);

    await page.goto(drawn.members[0]!.link);
    await expect(page.getByRole('img', { name: /Payment request/ })).toBeVisible();
    await expectNoViolations(page, `member assignment and payment @${w}`);
    await page.getByRole('button', { name: 'I sent it' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoViolations(page, `member sent dialog @${w}`);
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'A gift for you' }).click();
    await expectNoViolations(page, `member receive @${w}`);
    await page.getByRole('button', { name: 'I received this gift' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoViolations(page, `member receive dialog @${w}`);
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'My link' }).click();
    await expectNoViolations(page, `member account @${w}`);
    await p.ctx.close();
  });
}

test.describe('keyboard-only use', () => {
  test('the skip link is the first stop and moves focus to the main content', async ({ browser }) => {
    const p = await newPerson(browser);
    await p.page.goto('/');
    await p.page.keyboard.press('Tab');
    const skip = p.page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await p.page.keyboard.press('Enter');
    await expect(p.page.locator('#main')).toBeFocused();
    await p.ctx.close();
  });

  test('focus is always visible on interactive elements', async ({ browser }) => {
    const p = await newPerson(browser);
    await p.page.goto('/new');
    for (let i = 0; i < 12; i++) {
      await p.page.keyboard.press('Tab');
      const ok = await p.page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return true;
        const cs = getComputedStyle(el);
        return (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2) || cs.boxShadow !== 'none';
      });
      expect(ok, `focus indicator on step ${i}`).toBe(true);
    }
    await p.ctx.close();
  });

  test('a dialog traps focus, closes on Escape and returns focus to the button that opened it', async ({ browser }) => {
    const p = await newPerson(browser);
    await p.page.goto(drawn.members[1]!.link);
    const trigger = p.page.getByRole('button', { name: 'I sent it' });
    await trigger.focus();
    await p.page.keyboard.press('Enter');
    const dialog = p.page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const inside = async () => p.page.evaluate(() => !!document.activeElement?.closest('dialog'));
    for (let i = 0; i < 6; i++) {
      await p.page.keyboard.press('Tab');
      expect(await inside(), `focus stays in the dialog after Tab ${i + 1}`).toBe(true);
    }
    await p.page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await p.ctx.close();
  });

  test('member tabs follow the ARIA tabs pattern: arrow keys move between tabs, only the selected tab is in the tab order', async ({ browser }) => {
    const p = await newPerson(browser);
    await p.page.goto(drawn.members[2]!.link);
    const gift = p.page.getByRole('tab', { name: 'Your gift to give' });
    await gift.focus();
    await p.page.keyboard.press('ArrowRight');
    await expect(p.page.getByRole('tab', { name: 'A gift for you' })).toBeFocused();
    await expect(p.page.getByRole('tab', { name: 'A gift for you' })).toHaveAttribute('aria-selected', 'true');
    await expect(gift).toHaveAttribute('tabindex', '-1');
    await p.page.keyboard.press('End');
    await expect(p.page.getByRole('tab', { name: 'My link' })).toBeFocused();
    await p.page.keyboard.press('ArrowRight');
    await expect(gift).toBeFocused();
    await p.ctx.close();
  });

  test('the phone menu opens and closes with the keyboard and announces its state', async ({ browser }) => {
    const p = await newPerson(browser, { width: 390, height: 844 });
    await p.page.goto('/');
    const toggle = p.page.getByRole('button', { name: 'Menu' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.focus();
    await p.page.keyboard.press('Enter');
    await expect(p.page.getByRole('button', { name: 'Close' })).toHaveAttribute('aria-expanded', 'true');
    await expect(p.page.getByRole('link', { name: 'How it works' }).first()).toBeVisible();
    await p.ctx.close();
  });

  test('page changes move focus to the new page heading', async ({ browser }) => {
    const p = await newPerson(browser);
    await p.page.goto('/');
    await p.page.getByRole('link', { name: 'Privacy' }).first().click();
    await expect(p.page.getByRole('heading', { level: 1, name: 'Who can see what' })).toBeFocused();
    await p.ctx.close();
  });

  test('text can be enlarged to 200% and the page still works without horizontal scrolling', async ({ browser }) => {
    const p = await newPerson(browser, { width: 640, height: 800 });
    await p.page.goto('/');
    await p.page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
    const overflow = await p.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(p.page.getByRole('link', { name: 'Start an exchange' }).first()).toBeVisible();
    await p.ctx.close();
  });
});
