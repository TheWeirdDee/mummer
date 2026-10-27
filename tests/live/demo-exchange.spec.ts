import { writeFileSync } from 'node:fs';
import { test } from '@playwright/test';
import { createExchange, drawNames, joinExchange, newPerson, shieldedAddresses } from '../e2e/helpers';

/**
 * Makes a THROWAWAY exchange on STAGING and writes one member's private link to tests/e2e/.artifacts/demo-link.txt, so a person can
 * open it and scan the payment QR with a real wallet. Not a test: it only runs when DEMO=1.
 *   DEMO=1 LIVE_URL=https://mummer-staging.mummer-app.workers.dev npx playwright test -c playwright.live.config.ts -g demo
 * Everything in it is fake (public test-vector addresses); the link is a private link for this throwaway exchange only. The
 * payment request it shows pays one of those vector addresses: you scan it to see what the wallet displays, then CANCEL. Never send.
 */
test('demo exchange for a manual wallet test (DEMO=1 only)', async ({ browser }) => {
  test.skip(!process.env.DEMO, 'set DEMO=1');
  test.setTimeout(300_000);
  const addresses = shieldedAddresses(4);
  const names = ['Ada', 'Grace', 'Linus', 'Margaret'];
  const host = await newPerson(browser);
  const ex = await createExchange(host.page, { title: 'Wallet check (fake data)' });
  let link = '';
  for (let i = 0; i < names.length; i++) {
    const p = await newPerson(browser);
    const l = await joinExchange(p.page, ex.invite, { name: names[i]!, wishlist: 'fake', address: addresses[i]! });
    if (i === 0) link = l;
  }
  await drawNames(host.page, ex.adminLink);
  writeFileSync('tests/e2e/.artifacts/demo-link.txt', link + '\n');
  console.log('DEMO LINK WRITTEN to tests/e2e/.artifacts/demo-link.txt');
});
