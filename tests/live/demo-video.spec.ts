import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { joinExchange, newPerson, readSecretLink, shieldedAddresses, waitForHumanCheck, type Person } from '../e2e/helpers';

/**
 * Records the demo video: one real browser page driving the real app on STAGING (Cloudflare's public Turnstile test keys), with
 * captions drawn into the page and a Windows (SAPI) voiceover. Not a test: it only runs when DEMO_VIDEO=1.
 *   DEMO_VIDEO=1 LIVE_URL=https://mummer-staging.mummer-app.workers.dev npx playwright test -c playwright.live.config.ts -g "demo video"
 * Everything on screen is real app behaviour; the data is fake (public test-vector addresses), the payment is never made and the
 * exchange is deleted at the end. Output: tests/e2e/.artifacts/demo/ (raw video, narration.wav, timeline.json, QR for a wallet scan).
 */
const OUT = 'tests/e2e/.artifacts/demo';
const NAMES = ['Ada', 'Grace', 'Linus', 'Margaret'];
const TITLE = 'Office Secret Santa';

interface Scene {
  /** Narration for the scene; it stays on screen at least as long as the voiceover takes. */
  text: string;
  run: () => Promise<void>;
}

function synth(text: string, file: string): number {
  const ps = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    "$s.SelectVoice('Microsoft David Desktop')",
    '$s.Rate = 0',
    '$s.SetOutputToWaveFile($env:OUT_FILE)',
    '$s.Speak($env:SAY)',
    '$s.Dispose()',
  ].join('; ');
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { env: { ...process.env, OUT_FILE: file, SAY: text } });
  if (r.status !== 0) throw new Error(`speech synthesis failed: ${r.stderr?.toString()}`);
  return wavInfo(readFileSync(file)).seconds;
}

function wavInfo(buf: Buffer) {
  let pos = 12;
  let fmt: { rate: number; channels: number; bits: number } | undefined;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(pos + 10), rate: buf.readUInt32LE(pos + 12), bits: buf.readUInt16LE(pos + 22) };
    if (id === 'data') {
      if (!fmt) throw new Error('wav without fmt');
      const data = buf.subarray(pos + 8, pos + 8 + size);
      return { ...fmt, data, seconds: data.length / (fmt.rate * fmt.channels * (fmt.bits / 8)) };
    }
    pos += 8 + size + (size % 2);
  }
  throw new Error('wav without data');
}

/** Lays each narration clip at its scene's start time on one silent track and writes a single WAV. */
function mixNarration(clips: { file: string; startSeconds: number }[], totalSeconds: number, out: string) {
  const parsed = clips.map((c) => ({ ...c, ...wavInfo(readFileSync(c.file)) }));
  const f = parsed[0]!;
  const bytesPerSecond = f.rate * f.channels * (f.bits / 8);
  const frame = f.channels * (f.bits / 8);
  const track = Buffer.alloc(Math.ceil(totalSeconds * bytesPerSecond / frame) * frame);
  for (const p of parsed) {
    if (p.rate !== f.rate || p.channels !== f.channels || p.bits !== f.bits) throw new Error('narration clips differ in format');
    const at = Math.floor((p.startSeconds * bytesPerSecond) / frame) * frame;
    p.data.copy(track, at, 0, Math.max(0, Math.min(p.data.length, track.length - at)));
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + track.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(f.channels, 22);
  header.writeUInt32LE(f.rate, 24);
  header.writeUInt32LE(bytesPerSecond, 28);
  header.writeUInt16LE(frame, 32);
  header.writeUInt16LE(f.bits, 34);
  header.write('data', 36);
  header.writeUInt32LE(track.length, 40);
  writeFileSync(out, Buffer.concat([header, track]));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('demo video of the real app on staging (DEMO_VIDEO=1 only)', async ({ browser }) => {
  test.skip(!process.env.DEMO_VIDEO, 'set DEMO_VIDEO=1');
  test.setTimeout(900_000);
  mkdirSync(`${OUT}/clips`, { recursive: true });
  const addresses = shieldedAddresses(4);

  let ctx!: BrowserContext;
  let page!: Page;
  let t0 = 0;
  let current = '';
  const origin = new URL(test.info().project.use.baseURL as string).origin;

  const paint = (text: string) =>
    page.evaluate((t) => {
      try {
        sessionStorage.setItem('__demo_caption', t);
      } catch {
        /* ignore */
      }
      (window as unknown as { __demoPaint?: () => void }).__demoPaint?.();
    }, text);
  // Site data is cleared when the window changes identity, so the caption is re-applied to every new document.
  const caption = async (text: string) => {
    current = text;
    await paint(text);
  };
  const forgetEverything = async () => {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
    await cdp.detach();
  };
  /** Opens a private link as a person on a new device would: nothing remembered, so the save-your-link check comes first. */
  const openAs = async (link: string) => {
    await forgetEverything();
    await page.goto(link);
    const gate = page.getByLabel('Paste your link');
    if (await gate.waitFor({ timeout: 30_000 }).then(() => true, () => false)) {
      await gate.fill(await readSecretLink(page));
      await page.getByRole('button', { name: 'Confirm I saved it' }).click();
    }
  };
  const slowType = async (label: string | RegExp, text: string) => {
    const box = page.getByLabel(label);
    await box.click();
    await box.pressSequentially(text, { delay: 45 });
  };

  let invite = '';
  let adminLink = '';
  let adaLink = '';
  let adaRecipient = '';
  let adaRef = '';
  const hidden: Person[] = [];
  const memberLinks = new Map<string, string>();
  let hiddenJoins: Promise<void> = Promise.resolve();

  const scenes: Scene[] = [
    {
      text: 'Mummer is a Secret Santa where the gifts are small shielded Zcash payments, sent from people\'s own wallets. Mummer never holds the money.',
      run: async () => {
        await page.goto('/');
        await caption('Mummer: a Secret Santa paid with shielded Zcash, from your own wallet');
      },
    },
    {
      text: 'A host names the exchange, sets a budget and two dates, and acknowledges one honest fact: the draw runs in the host\'s browser.',
      run: async () => {
        await page.goto('/new');
        await caption('The host starts an exchange and acknowledges the trusted-host draw');
        await slowType('Name of the exchange', TITLE);
        await page.getByLabel(/only organizing/).check();
        await page.getByLabel(/I understand that the draw runs in my browser/).check();
        await page.mouse.wheel(0, 400);
      },
    },
    {
      text: 'Cloudflare Turnstile keeps bots out. This staging copy uses Cloudflare\'s public test keys, so it passes by itself. On the real site, a person completes the challenge.',
      run: async () => {
        await caption('Human check: Cloudflare Turnstile (test keys on this staging copy)');
        await waitForHumanCheck(page);
        await page.getByRole('button', { name: 'Create the exchange' }).click();
        await expect(page.getByRole('heading', { name: /Save your admin link/i, level: 2 })).toBeAttached();
      },
    },
    {
      text: 'The admin link keeps its keys after the hash, which browsers never send to a server. The host proves it was saved by pasting it back.',
      run: async () => {
        await caption('Private links keep their keys in the URL fragment; the server never sees them');
        adminLink = await readSecretLink(page);
        await page.getByLabel('Paste your link').fill(adminLink);
        await page.getByRole('button', { name: 'Confirm I saved it' }).click();
        await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
        invite = await page.getByRole('textbox', { name: 'Invite link' }).inputValue();
      },
    },
    {
      text: 'One invite link goes to the group. Friends join with a nickname and a wishlist. Three have already joined; now we join as Ada.',
      run: async () => {
        await caption('One invite link for the whole group');
        // The other three people join in their own isolated browser profiles while this window shows Ada joining.
        hiddenJoins = (async () => {
          for (let i = 1; i < NAMES.length; i++) {
            const p = await newPerson(browser);
            hidden.push(p);
            memberLinks.set(NAMES[i]!, await joinExchange(p.page, invite, { name: NAMES[i]!, wishlist: `${NAMES[i]} would love socks and a good book`, address: addresses[i]! }));
          }
        })();
        await forgetEverything();
        await page.goto(invite);
      },
    },
    {
      text: 'Each person joins with a nickname and a wishlist. The wallet address is checked right here, in the browser.',
      run: async () => {
        await caption('Joining: nickname, wishlist, then a shielded address from your own wallet');
        await page.getByRole('button', { name: 'Join this exchange' }).click();
        await slowType('Your nickname', 'Ada');
        await page.getByLabel(/Wishlist/).fill('Ada would love socks and a good book');
        await page.getByRole('button', { name: /Next: your wallet/ }).click();
        await page.getByLabel(/I have a wallet and know my shielded address/).check();
        await page.getByRole('button', { name: /Next: your address/ }).click();
      },
    },
    {
      text: 'Mummer decodes the address with real ZIP 316 rules. A transparent address is refused, with a reason, because it would make the gift public.',
      run: async () => {
        await caption('A transparent address is refused: it would make the gift public');
        await page.getByLabel('Your shielded receiving address').fill('t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs');
        await page.getByLabel('Your shielded receiving address').blur();
        await sleep(2500);
      },
    },
    {
      text: 'A real shielded unified address is accepted. The address and wishlist are sealed in the browser before they are sent. Only the nickname is visible to the group.',
      run: async () => {
        await caption('A valid shielded address is accepted (demo address, not a real wallet)');
        await page.getByLabel('Your shielded receiving address').fill(addresses[0]!);
        await expect(page.getByText('This looks like a valid shielded address')).toBeVisible();
        await page.getByRole('button', { name: /Next: review/ }).click();
        await page.getByLabel(/I understand who can see my details/).check();
        await waitForHumanCheck(page);
        await page.getByRole('button', { name: /^Join / }).click();
        await expect(page.getByRole('heading', { name: /You.re in/ })).toBeVisible();
      },
    },
    {
      text: 'Ada saves her own private link the same way, then goes to her page and waits for the draw.',
      run: async () => {
        await caption('Ada saves her private link and waits for the draw');
        adaLink = await readSecretLink(page);
        await page.getByLabel('Paste your link').fill(adaLink);
        await page.getByRole('button', { name: 'Confirm I saved it' }).click();
        await page.getByRole('button', { name: 'Go to my page' }).click();
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        memberLinks.set('Ada', adaLink);
        await hiddenJoins;
      },
    },
    {
      text: 'Back as the host: four people have joined. The host\'s browser opens their details, checks them, and draws the names as a single cycle, so nobody draws themselves.',
      run: async () => {
        await caption('The host draws in their own browser: one cycle, nobody draws themselves');
        await openAs(adminLink);
        await page.getByRole('button', { name: 'Review people and draw' }).click();
        await page.getByRole('button', { name: /^Draw names for/ }).click();
        const early = page.getByRole('button', { name: 'Close joining and draw' });
        if (await early.isVisible().catch(() => false)) await early.click();
        await expect(page.getByText('The names are drawn')).toBeVisible();
      },
    },
    {
      text: 'The host\'s page never shows who gives to whom. Only each person can open their own assignment.',
      run: async () => {
        await caption('The host\'s page shows no pairings');
        await sleep(1500);
      },
    },
    {
      text: 'Ada opens her private link: who she gives to, their wishlist, and a payment request. It is a QR code plus the address, the amount and a memo, each with a copy button.',
      run: async () => {
        await caption('Ada\'s assignment and a ZIP 321 payment request, for her own wallet to approve');
        await openAs(adaLink);
        await expect(page.getByText(/You.re giving to/)).toBeVisible();
        adaRecipient = ((await page.locator('.assignment-name').textContent()) ?? '').trim();
        const qr = page.getByRole('img', { name: /Payment request for .* ZEC to/ });
        await expect(qr).toBeVisible();
        await qr.scrollIntoViewIfNeeded();
        const memo = await page.locator('#memo-box').inputValue();
        adaRef = /MUM-[0-9A-Z]{4}(?:-[0-9A-Z]{4}){3}-[0-9A-Z]/.exec(memo)?.[0] ?? '';
        expect(adaRef).not.toBe('');
        await qr.screenshot({ path: `${OUT}/zodl-scan-qr.png` });
        const amount = await page.getByLabel('Amount (ZEC)').inputValue();
        writeFileSync(`${OUT}/zodl-scan-details.txt`, `Recipient: ${adaRecipient}\nAmount (ZEC): ${amount}\nMemo: ${memo}\nAddress: ${addresses[NAMES.indexOf(adaRecipient)] ?? '(see the page)'}\n\nThis QR pays a public test-vector address. Scan it to see what the wallet shows, then CANCEL. Never send.\n`);
      },
    },
    {
      text: 'Mummer never touches funds. Ada\'s own wallet shows the request and she approves it there. This demo makes no payment. Wallet scanning has not been verified on a real device.',
      run: async () => {
        await caption('No payment is made in this demo. Wallet scanning is not yet verified on real devices.');
        await page.getByText(/Before you approve in your wallet|before you approve/i).first().scrollIntoViewIfNeeded().catch(() => undefined);
        await sleep(1500);
      },
    },
    {
      text: 'After paying in a real exchange, the giver taps I sent it. Mummer is honest about what that is: only the giver\'s word.',
      run: async () => {
        await caption('"I sent it" is a note, not proof: Mummer cannot see shielded payments');
        await page.getByRole('button', { name: 'I sent it' }).click();
        await expect(page.getByRole('dialog')).toContainText('only your word');
        await sleep(2000);
        await page.getByRole('button', { name: 'Yes, I sent it' }).click();
        await expect(page.getByText('You already marked this gift as sent')).toBeVisible();
      },
    },
    {
      text: 'The recipient sees a gift for them, enters the reference from the memo they read in their own wallet, and confirms. Again, it is their own word.',
      run: async () => {
        await caption('The recipient confirms with the memo reference: a self-report, never "verified"');
        await openAs(memberLinks.get(adaRecipient)!);
        await page.getByRole('tab', { name: 'A gift for you' }).click();
        await page.getByLabel(/Reference from the memo/).fill(adaRef);
        await page.getByRole('button', { name: 'I received this gift' }).click();
        await expect(page.getByRole('dialog')).toContainText('your own word');
        await sleep(1500);
        await page.getByRole('button', { name: 'Yes, I received it' }).click();
        await expect(page.getByText('You confirmed this gift')).toBeVisible();
      },
    },
    {
      text: 'The host sees counts only. And a glass box shows exactly what the server stores: sealed values, every one exactly the same size, and fingerprints. Never addresses or wishlists.',
      run: async () => {
        await caption('Glass box: the server stores sealed blobs, all exactly the same size, so length reveals nothing');
        await openAs(adminLink);
        await page.getByText('What Mummer’s server stores for this exchange').click();
        await page.getByRole('button', { name: /Show what.s stored/ }).click();
        await expect(page.getByLabel('Redacted database contents')).toContainText('"sealed": true');
        const box = page.getByLabel('Redacted database contents');
        await box.scrollIntoViewIfNeeded();
        // Show the sealed rows themselves: every one reports the same byte count.
        await box.evaluate((el) => {
          const text = (el as HTMLTextAreaElement).value ?? el.textContent ?? '';
          const at = text.indexOf('"bytes"');
          el.scrollTop = at < 0 ? 0 : Math.max(0, (el.scrollHeight * at) / text.length - 120);
        });
        await sleep(2500);
        await box.evaluate((el) => {
          el.scrollTop += 220;
        });
      },
    },
    {
      text: 'On reveal day, givers may choose to unmask to their recipient or to the group. That is covered by automated tests that move the clock, and is not shown here.',
      run: async () => {
        await caption('Reveal day is consent-based; covered by tests that move the clock, not shown here');
        await page.evaluate(() => window.scrollTo(0, 0));
        await sleep(1000);
      },
    },
    {
      text: 'When the exchange is over, the host deletes it. Everything Mummer\'s database holds for it is removed immediately, and every link stops working.',
      run: async () => {
        await caption('Delete: everything the database holds is removed immediately');
        await page.getByRole('button', { name: 'Delete the exchange' }).click();
        await page.getByLabel(new RegExp(`Type .${TITLE}. to confirm`)).fill(TITLE);
        await page.getByRole('button', { name: 'Delete everything' }).click();
        await page.waitForURL(/\/\?deleted=1/);
      },
    },
    {
      text: 'Mummer. Live at mummer dot mummer-app dot workers dot dev, and open source on GitHub. Real Zodl compatibility and real shielded payment execution are not yet verified.',
      run: async () => {
        await caption('Mummer - github.com/TheWeirdDee/mummer - Not yet verified: real Zodl scanning and a real shielded payment');
        await sleep(500);
      },
    },
  ];

  // Voiceover first, so every scene stays on screen at least as long as its narration. This happens before the browser window exists
  // so the video starts on the first scene instead of on a blank page.
  const clips = scenes.map((s, i) => {
    const file = `${OUT}/clips/scene-${String(i + 1).padStart(2, '0')}.wav`;
    return { file, seconds: synth(s.text, file) };
  });

  // The recorded page: one browser window; identities are switched by clearing the app's site data, exactly as a different person
  // on a different device would start with nothing.
  ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: `${OUT}/raw`, size: { width: 1280, height: 720 } }, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => {
    if (window.top !== window) return;
    const paint = () => {
      let text = '';
      try {
        text = sessionStorage.getItem('__demo_caption') ?? '';
      } catch {
        /* storage blocked */
      }
      let bar = document.getElementById('__demo_caption');
      if (!text) {
        bar?.remove();
      } else {
        if (!bar) {
          bar = document.createElement('div');
          bar.id = '__demo_caption';
          document.documentElement.appendChild(bar);
        }
        bar.replaceChildren();
        const line = document.createElement('div');
        line.textContent = text;
        const tag = document.createElement('div');
        tag.textContent = 'Demo data on a staging copy. No payment is made.';
        Object.assign(tag.style, { font: '500 13px Inter, system-ui, sans-serif', color: '#B8913A', marginTop: '4px' });
        bar.append(line, tag);
        Object.assign(bar.style, { position: 'fixed', left: '0', right: '0', bottom: '0', padding: '12px 40px 12px', background: '#17140F', color: '#F2ECDF', font: '600 22px/1.35 Inter, system-ui, sans-serif', textAlign: 'center', zIndex: '2147483647', pointerEvents: 'none' });
      }
      document.documentElement.style.scrollPaddingBottom = '110px';
    };
    (window as unknown as { __demoPaint: () => void }).__demoPaint = paint;
    document.addEventListener('DOMContentLoaded', paint);
  });
  page = await ctx.newPage();
  page.on('domcontentloaded', () => void paint(current).catch(() => undefined));
  t0 = Date.now();

  const timeline: { scene: number; startSeconds: number; narration: string }[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const start = Date.now();
    timeline.push({ scene: i + 1, startSeconds: (start - t0) / 1000, narration: scenes[i]!.text });
    await scenes[i]!.run();
    const remaining = clips[i]!.seconds * 1000 + 700 - (Date.now() - start);
    if (remaining > 0) await sleep(remaining);
  }
  const totalSeconds = (Date.now() - t0) / 1000 + 1;

  await ctx.close();
  copyFileSync(await page.video()!.path(), `${OUT}/mummer-demo-raw.webm`);
  mixNarration(clips.map((c, i) => ({ file: c.file, startSeconds: timeline[i]!.startSeconds })), totalSeconds, `${OUT}/narration.wav`);
  writeFileSync(`${OUT}/timeline.json`, JSON.stringify({ totalSeconds, timeline }, null, 1));
  for (const p of hidden) await p.ctx.close();
  console.log(`DEMO WRITTEN to ${OUT} (${totalSeconds.toFixed(0)} s)`);
});
