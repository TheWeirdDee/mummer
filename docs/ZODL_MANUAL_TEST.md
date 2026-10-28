# Manual Zodl test (10 to 15 minutes, no money)

**Status: not done.** Zodl has no Windows build and no phone or emulator is available to the development environment, so nobody has yet tested what Zodl does with a Mummer payment request. This page is the test, written so a person can do it and report back. **Mummer's compatibility claims stay "unverified" until it is done.**

**You never send anything and never reveal a recovery phrase.** The test only scans a QR and looks at what the wallet *shows* on its review screen, then cancels.

## What you need

- A phone with **Zodl** from the App Store or Google Play (the official app). Note its version (Settings, About) and the phone model and OS.
- A computer to show the QR. A wallet is **not** required to have any balance: the review screen appears before any funds check on most wallets; if Zodl refuses with "insufficient funds", that is itself a result to record (see the table).
- Do **not** use your main wallet if you have one. Create a new Zodl wallet if you want, and write its seed on paper only.

## Make a throwaway exchange to scan

On this repository's machine (everything in it is fake data):

```bash
DEMO=1 LIVE_URL=https://mummer-staging.mummer-app.workers.dev npx playwright test -c playwright.live.config.ts -g demo
```

(The demo-video run, `docs/DEMO_VIDEO.md`, also leaves a ready-made `zodl-scan-qr.png` and `zodl-scan-details.txt` in `tests/e2e/.artifacts/demo/`: scan the PNG and compare with the details file.)

It writes a private link for a staging exchange to `tests/e2e/.artifacts/demo-link.txt` (a throwaway exchange with public test-vector addresses; staging uses Cloudflare's public test keys). Open that link in a browser on the computer. The "You're giving to" page shows a QR, an address, an amount in ZEC and a memo that starts `MUMMER MUM-`.

## Steps and what to record

| # | Do this | Record |
|---|---|---|
| 1 | In Zodl choose Scan (or Send, then Scan) and scan the QR on the computer screen | Did Zodl recognise it as a payment request? Any error text, word for word |
| 2 | On the review screen read the **recipient address** and compare its first and last 8 characters with "Their shielded address" on the Mummer page | Matches? Shown in full, shortened or not at all? |
| 3 | Read the **amount** and compare with "Amount (ZEC)" on the Mummer page | Exact match? Rounded? Missing (then you would type it)? |
| 4 | Look for the **memo** and compare with the Mummer memo box | Is a memo shown before sending? Is it the full text including `MUMMER MUM-...`? Is it editable? |
| 5 | Check whether Zodl warns about anything (for example that the address is not one of yours, or about the memo) | Exact warning text |
| 6 | Press **Cancel / back**. Do not confirm | Cancels cleanly? Anything left half-filled? |
| 7 | Tap "Open in my wallet" on the Mummer page from the **phone** (open the same link on the phone) | Does Zodl open? Does it fill in the same fields? |
| 8 | On the phone, use "Copy" for the address, amount and memo and paste them into a new Zodl send screen by hand | Does the memo field accept the whole text? Any length or character problem? |

Take screenshots of steps 2 to 5 and **blur or crop the screen so no recovery phrase or personal balance shows** before sharing them. Add your results (Zodl version, platform, a row per step) to `docs/EVIDENCE.md` under "Zodl manual test", and set R01 and R02 in `docs/REQUIREMENTS_MATRIX.md` accordingly. If something fails, the Mummer page's copy buttons are the supported fallback, and the finding becomes a bug to fix in how Mummer builds its request.

## Why a scan test is enough to learn the important things

What Zodl does with a request is decided at the review screen: whether it parses a ZIP 321 URI from a QR, what it shows for the recipient, amount and memo, and what it does with a memo. Public Zodl issues suggest the risky cases are multi-recipient requests (Mummer never builds one) and unusual characters in memos (Mummer emits only URL-safe base64 with no `+`, `/` or `=`). A real sent payment, which would need funds and your explicit spending limit, would additionally show memo delivery to the recipient; that is a separate step and is **not** part of this test.
