import { expect, test, type Page } from '@playwright/test';
import { createExchange, drawNames, joinExchange, newPerson, refOf, shieldedAddresses, type Person } from '../e2e/helpers';

/**
 * A privacy scan of a DEPLOYED instance (run it on staging, which runs the same commit as production). It drives a real journey with
 * four people and a host, records every request and response every browser makes, and then checks what the server and the network
 * actually saw:
 *  - no private key, address, wishlist or memo reference is in any URL, header (other than a person's own bearer token), request
 *    body or response body;
 *  - private-link secrets never appear in a URL, and the bearer token appears only in that person's own Authorization header;
 *  - no request carries a Referer, and no origin other than the app and the human-check host is contacted;
 *  - sealed data that one person's session receives is never returned to another person's token, or to no token at all.
 *   LIVE_URL=https://mummer-staging.mummer-app.workers.dev npx playwright test -c playwright.live.config.ts -g "privacy scan"
 */
interface Exchange {
  who: string;
  method: string;
  url: string;
  reqHeaders: Record<string, string>;
  postData: string;
  status: number;
  body: string;
}

const BLOB = /[A-Za-z0-9_+/=-]{100,}/g;
const blobsOf = (text: string) => new Set(text.match(BLOB) ?? []);
const fragmentOf = (link: string) => new URLSearchParams(new URL(link).hash.slice(1));

test('privacy scan of a deployed instance: what the server and the network actually saw', async ({ browser, playwright }) => {
  test.setTimeout(900_000);
  const addresses = shieldedAddresses(4);
  // Nicknames are group-visible by design, so they are not scanned for.
  const nicknames = ['Zephyrine', 'Quillon', 'Marigold', 'Thaddeus'];
  // Wishlists of very different lengths: this is the setup the 28 October audit used to recover every pairing from stored lengths.
  const wishlists = nicknames.map((n, i) => `WISHTEXT-${n}-kq77${i}${' gift'.repeat(i * 15)}`);
  const log: Exchange[] = [];
  const pending: Promise<void>[] = [];

  const watch = (who: string, page: Page) => {
    page.on('response', (r) => {
      const req = r.request();
      pending.push(
        (async () => {
          let body = '';
          try {
            body = await r.text();
          } catch {
            /* redirects and aborted requests have no body */
          }
          log.push({ who, method: req.method(), url: req.url(), reqHeaders: await req.allHeaders(), postData: req.postData() ?? '', status: r.status(), body });
        })(),
      );
    });
  };

  const host = await newPerson(browser);
  watch('host', host.page);
  const ex = await createExchange(host.page, { title: 'Privacy Scan Exchange' });
  const origin = new URL(host.page.url()).origin;
  const people: Person[] = [];
  const links: string[] = [];
  for (let i = 0; i < 4; i++) {
    const p = await newPerson(browser);
    watch(nicknames[i]!, p.page);
    people.push(p);
    links.push(await joinExchange(p.page, ex.invite, { name: nicknames[i]!, wishlist: wishlists[i]!, address: addresses[i]! }));
  }
  await drawNames(host.page, ex.adminLink);

  const refs = new Map<string, string>();
  const recipientOf = new Map<string, string>();
  for (let i = 0; i < 4; i++) {
    await people[i]!.page.goto(links[i]!);
    await expect(people[i]!.page.getByText(/You.re giving to/)).toBeVisible();
    recipientOf.set(nicknames[i]!, ((await people[i]!.page.locator('.assignment-name').textContent()) ?? '').trim());
    refs.set(nicknames[i]!, refOf(await people[i]!.page.locator('#memo-box').inputValue()));
    await people[i]!.page.getByRole('button', { name: 'I sent it' }).click();
    await people[i]!.page.getByRole('button', { name: 'Yes, I sent it' }).click();
    await expect(people[i]!.page.getByText('You already marked this gift as sent')).toBeVisible();
  }
  for (let i = 0; i < 4; i++) {
    const giver = [...recipientOf.entries()].find(([, r]) => r === nicknames[i])![0];
    await people[i]!.page.getByRole('tab', { name: 'A gift for you' }).click();
    await people[i]!.page.getByLabel(/Reference from the memo/).fill(refs.get(giver)!);
    await people[i]!.page.getByRole('button', { name: 'I received this gift' }).click();
    await people[i]!.page.getByRole('button', { name: 'Yes, I received it' }).click();
    await expect(people[i]!.page.getByText('Mummer recognises the reference you entered.')).toBeVisible();
  }
  await host.page.goto(ex.adminLink);
  await host.page.getByText('What Mummer’s server stores for this exchange').click();
  await host.page.getByRole('button', { name: /Show what.s stored/ }).click();
  await expect(host.page.getByLabel('Redacted database contents')).toContainText('"sealed": true');
  await Promise.all(pending);

  // 1. Secrets in links: keys and tokens by person.
  const secrets = [
    { who: 'host', link: ex.adminLink },
    ...nicknames.map((n, i) => ({ who: n, link: links[i]! })),
  ].map((s) => ({ ...s, k: fragmentOf(s.link).get('k')!, t: fragmentOf(s.link).get('t')! }));
  for (const s of secrets) {
    expect(s.k?.length, `${s.who} key`).toBeGreaterThan(20);
    expect(s.t?.length, `${s.who} token`).toBeGreaterThan(20);
  }
  const ownTokenHeader = (who: string) => `Bearer ${secrets.find((s) => s.who === who)!.t}`;

  const own = log.filter((e) => e.url.startsWith(origin));
  const failures: string[] = [];
  for (const e of own) {
    const auth = e.reqHeaders['authorization'];
    const nonAuthHeaders = JSON.stringify({ ...e.reqHeaders, authorization: '' });
    const surfaces: [string, string][] = [['url', e.url], ['request headers', nonAuthHeaders], ['request body', e.postData], ['response body', e.body]];
    for (const [name, text] of surfaces) {
      for (const s of secrets) {
        if (text.includes(s.k)) failures.push(`${e.method} ${new URL(e.url).pathname}: ${s.who}'s private KEY in ${name}`);
        if (text.includes(s.t)) failures.push(`${e.method} ${new URL(e.url).pathname}: ${s.who}'s bearer TOKEN in ${name}`);
      }
      for (const a of addresses) if (text.includes(a.slice(0, 20)) || text.includes(a.slice(-14))) failures.push(`${e.method} ${new URL(e.url).pathname}: a wallet address in ${name}`);
      for (const w of wishlists) if (text.includes(w)) failures.push(`${e.method} ${new URL(e.url).pathname}: wishlist text in ${name}`);
      // Documented exceptions (docs/PRIVACY.md): nicknames are group-visible clear text, and a recipient's "I received it" request
      // carries the memo reference they typed so the server can compare its hash. Nothing else may carry either.
      const isAckBody = name === 'request body' && /\/members\/[0-9a-f]{32}\/ack$/.test(new URL(e.url).pathname);
      for (const r of refs.values()) if (text.includes(r) && !isAckBody) failures.push(`${e.method} ${new URL(e.url).pathname}: a memo reference in ${name}`);
    }
    if (auth && auth !== ownTokenHeader(e.who)) failures.push(`${e.method} ${new URL(e.url).pathname}: ${e.who} sent someone else's token`);
    if (new URL(e.url).search) failures.push(`${e.method} ${new URL(e.url).pathname}: has a query string`);
    if (e.reqHeaders['referer']) failures.push(`${e.method} ${new URL(e.url).pathname}: sends a Referer`);
  }
  expect(failures, failures.join('\n')).toEqual([]);

  // 1b. Every sealed blob that crossed the wire (profiles in join requests, bundles in the draw request and in assignment responses) has
  // exactly the same length even though the wishlists above differ a lot, so stored lengths cannot be used to match givers to recipients.
  expect(new Set(wishlists.map((w) => w.length)).size).toBe(4);
  const sealedLengths = new Set<number>();
  let sealedSeen = 0;
  for (const e of own.filter((x) => new URL(x.url).pathname.startsWith('/api/'))) {
    for (const t of [e.postData, e.body]) {
      for (const m of t.match(/[A-Za-z0-9_-]{1000,}/g) ?? []) {
        sealedLengths.add(m.length);
        sealedSeen++;
      }
    }
  }
  console.log('SEALED BLOBS SEEN:', sealedSeen, 'DISTINCT LENGTHS:', JSON.stringify([...sealedLengths]));
  expect(sealedSeen).toBeGreaterThan(8);
  expect([...sealedLengths]).toHaveLength(1);

  // 2. No other origin than the app and the human-check host was contacted by the pages themselves.
  const foreign = [...new Set(log.map((e) => new URL(e.url).origin))].filter((o) => o !== origin);
  console.log('ORIGINS CONTACTED BY PAGES:', JSON.stringify(foreign));
  expect(foreign.every((o) => /^https:\/\/[a-z-]*check\.[a-z0-9-]+\.workers\.dev$/.test(o) || o === 'https://challenges.cloudflare.com'), foreign.join(', ')).toBe(true);

  // 3. Cross-person replay of authenticated reads: what one session received must not come back to another token or to nobody.
  const api = await playwright.request.newContext({ baseURL: origin });
  const authedGets = own.filter((e) => e.method === 'GET' && e.url.includes('/api/') && e.reqHeaders['authorization']);
  const received = new Map<string, Set<string>>();
  for (const e of own) {
    if (!received.has(e.who)) received.set(e.who, new Set());
    for (const b of blobsOf(e.body)) received.get(e.who)!.add(b);
  }
  const persons = ['host', ...nicknames];
  const paths = (who: string) => [...new Set(authedGets.filter((e) => e.who === who).map((e) => new URL(e.url).pathname))];
  let replays = 0;
  const leaks: string[] = [];
  const throttled: string[] = [];
  const replay = async (path: string, auth: string | undefined) => {
    replays++;
    await new Promise((r) => setTimeout(r, 150));
    const res = await api.get(path, { headers: auth ? { authorization: auth } : {}, failOnStatusCode: false });
    return { status: res.status(), body: await res.text() };
  };
  for (const p of persons) {
    const onlyP = new Set([...(received.get(p) ?? [])].filter((b) => persons.every((q) => q === p || !(received.get(q)?.has(b)))));
    for (const path of paths(p)) {
      const targets: [string, string | undefined][] = [['nobody', undefined], ...persons.filter((q) => q !== p).map((q) => [q, ownTokenHeader(q)] as [string, string])];
      for (const [label, auth] of targets) {
        const r = await replay(path, auth);
        if (r.status === 429) throttled.push(`${path} as ${label}`);
        for (const b of blobsOf(r.body)) if (onlyP.has(b)) leaks.push(`GET ${path} as ${label} returned data that only ${p} received (status ${r.status})`);
      }
    }
  }
  console.log(`REPLAYS: ${replays} cross-token and no-token reads of ${persons.length} sessions' authenticated routes; throttled: ${throttled.length}`);
  expect(throttled, 'rate limited, so the scan was inconclusive').toEqual([]);
  expect(leaks, leaks.join('\n')).toEqual([]);

  // 4. Deletion: the glass box says everything is removed, and every link then stops working.
  await host.page.getByRole('button', { name: 'Delete the exchange' }).click();
  await host.page.getByLabel(/Type .Privacy Scan Exchange. to confirm/).fill('Privacy Scan Exchange');
  await host.page.getByRole('button', { name: 'Delete everything' }).click();
  await host.page.waitForURL(/\/\?deleted=1/);
  for (const path of paths('host').slice(0, 3)) {
    const r = await replay(path, ownTokenHeader('host'));
    expect([401, 403, 404, 410], `${path} after deletion`).toContain(r.status);
  }
  await api.dispose();
  for (const p of [host, ...people]) await p.ctx.close();
});
