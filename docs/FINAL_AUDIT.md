# Final audit

State of Mummer after its first real deployment, in five buckets: implemented, tested, verified in production, externally blocked, and not completed. "Tested" means an automated test in this repository passes. Exact run results, and the runs that were not clean, are in `docs/EVIDENCE.md`.

## 1. Implemented

- Noncustodial Secret Santa web app (React, Cloudflare Workers, D1): create, invite, join, draw, assignment, payment request, sent, received, reveal, delete, recovery; link replacement, backup, leaving, extending dates.
- Real ZIP 316 address decoding, address policy, ZIP 321 payment requests with exact zatoshi arithmetic and a 512-byte memo; the output is also accepted by the reference Rust `zip321` parser.
- Client-side sealed boxes, padded blobs, context binding, hashed bearer tokens, Argon2id backups, fragment-based private links, address commitments, host-key fingerprint in the invite.
- Trusted-host draw with an atomic commit pinned to the draw and members versions; every member write pinned to the state it validated.
- Totals-only host glass box that never reveals a recipient-only reveal; consent-gated reveals; thresholded public stats.
- Strict CSP (no inline script, no eval, no third-party origin on app pages), security headers everywhere, rate limiting, retention purge, masked diagnostics.
- **A separate-origin human-check host** (its own Worker) that runs Cloudflare Turnstile; the app accepts messages only from that exact origin, the check page can be framed only by the app, and the server accepts a token only if Cloudflare says it was solved on the check host.
- Two price sources (CoinGecko, then Kraken), failing closed.
- Handling of blocked, full or failing browser storage; conflict screen; recovery of a link replacement whose reply was lost.
- Deployed to Cloudflare (free tier) with staging and production environments, a repeatable deployment guide, a live test suite, and `npm run dev` for local work.

## 2. Tested (automated)

| Layer | Result |
|---|---|
| `npm run typecheck` | Clean |
| Vitest (unit, API on a real D1, race tests, security, human-check host) | **409 passed, 21 files** |
| Playwright, Chromium | **76 passed in one command** |
| Playwright, Firefox and WebKit | Run spec by spec: all passed except the six-participant journey in WebKit (unresolved) |
| axe-core | No violations on every route and key state at 390 and 1280 px in all three browsers, and on nine live pages on both deployments |
| Responsive | 12 viewports (320 to 1920 plus two landscape), measured with disclosures closed and open |
| Reference-parser cross-check | 3 passed |
| Live suite | Production read-only checks 3 passed; staging full journey and checks 4 passed |
| `npm audit` | 0 vulnerabilities |

## 3. Verified in production

Production is https://mummer.mummer-app.workers.dev (check host https://mummer-check.mummer-app.workers.dev). Verified there: health and deployed commit; `/api/config`; headers and CSP; absolute social image; real 404s; the check host's framing rules; axe and layout on nine public pages at 390 and 1280 px; the real Turnstile widget renders inside the check frame; an always-pass control delivers a token to the app with the verified origin; the database holds no exchanges.

**Not verified in production:** an actual exchange. Creating one needs a person to pass the real challenge (below). The whole journey was verified on **staging** instead, which differs from production only in using Cloudflare's public test keys and its own database.

## 4. Externally blocked (needs you or someone else)

| Item | Needs |
|---|---|
| The real Turnstile challenge on production, then one throwaway exchange | A person in a normal browser (`docs/DEPLOYMENT.md`, "Manual steps") |
| Confirming Workers Logs are off | A look at the Cloudflare dashboard |
| Reveal day on a live exchange | Waiting about 16 hours after creating one in the earliest timezone |
| Zodl scanning a Mummer QR, memo and amount display, cancellation (R01/R02) | A phone with Zodl; no money needed for the scan test: `docs/ZODL_MANUAL_TEST.md` |
| Zcash testnet send, receipt and memo | **A decision from you.** Tooling (protoc, `zcash-devtool` source) is downloaded outside the repo, but building it was blocked by the harness's permission policy and not retried another way; then a human step for test coins (a faucet CAPTCHA or a Discord request). Steps in `docs/INTEGRATION_RESEARCH.md` |
| A real-ZEC exchange (R12) | Real funds, people and a spending limit from you |
| ZECATHON rules, deadline (appears to be 2026-10-28), licence and demo requirements | The official site, behind a login |
| Trademark clearance for "Mummer" | A search by counsel |
| Screen-reader pass | A person with NVDA, VoiceOver and TalkBack (`docs/ACCESSIBILITY_MANUAL_CHECKLIST.md`) |
| Real iOS Safari and Android devices | Devices |
| Independent security review | A reviewer |
| Submission | Your decision and accounts; nothing was submitted |

## 5. Not completed

- Host-blind draw (F14), independent shielded-payment proof (F15), company-funded mode (F13), calendar file (F16): stated as not built.
- No Zcash testnet or Zodl result of any kind.
- The six-participant journey in WebKit does not pass (it stalls at a different step each run; this machine was nearly out of RAM during runs; cause not established).
- No automated test of the "chosen link cannot be stored" conflict path.
- Usability targets from PRD v0.1: not measured.

## Findings and resolutions

### From the first real deployment (found only because it was deployed)

| Finding | Resolution |
|---|---|
| **The planned Turnstile isolation does not work.** In an opaque-origin sandbox Turnstile's challenge frame gets origin "null", its messages are discarded (error 300030) and even Cloudflare's always-pass key never yields a token. All local tests passed because the check is off in development, and the one frame test accepted a timeout | The check moved to a separate origin (decision D-37) with a strict CSP, parent-only framing, origin-checked messaging and a host-bound token; the local E2E runs the second Worker; the frame test no longer accepts a timeout; verified live with an always-pass control |
| CoinGecko answers 403 to Cloudflare Workers, so no payment amount could be shown | Kraken added as a second source; `price_unavailable` now logs the reason per source; tested |
| Cloudflare's test keys report the placeholder hostname `example.com`, which the new host binding refused | The binding is skipped only for responses Cloudflare marks as test-key; tested, including that nothing else bypasses it |
| The test helper's spoofed `cf-connecting-ip` header makes Cloudflare's edge answer Error 1000 | Not sent on live runs |

### From the build review of 27 October (`docs/BUILD_REVIEW.md`, 12 findings)

All 12 fixed, each with a test that fails without the fix: private reveals hidden from the host's glass box; link replacement no longer races the draw; "sent", acknowledgment, reveal, confirmation and leave writes pinned to the state they validated; blocked or failing storage cannot lose a replacement key; no payment request for a removed recipient; leave during a draw no longer reports a removal that did not happen; cleared dates are validated; recovery survives blocked storage; `npm run test:unit` runs; closed exchanges refuse confirmations; reveal copy matches the listing; removing someone in draw review no longer forces a stale-list retry.

### Other

The intermittent test-suite HTTP 500 was diagnosed as loopback port exhaustion in the test harness on Windows and guarded there (`docs/KNOWN_LIMITATIONS.md` item 23); the very first occurrence is consistent with it but not proven. Firefox and WebKit found two real defects (zod's feature probe reported as a CSP violation; `upgrade-insecure-requests` breaking WebKit on plain-HTTP loopback) and one wrong test assumption (that Tab reaches links in Safari), all fixed. Earlier audits' findings are in earlier versions of this file and were all fixed.

## Open items

1. Real Turnstile on production, WebKit journey, wallet and testnet verification (above).
2. Residual design risks in `docs/KNOWN_LIMITATIONS.md` and `docs/PRIVACY_AUDIT.md` (trusted host, a malicious operator serving code, metadata, small groups, self-reported states, price sources not cross-checked).
3. The repository is public by the owner's choice. It contains no secrets (history scanned; `.dev.vars` and environment files ignored; the Turnstile secret and the salt live only in Cloudflare), but the full threat model and limitations are visible. The database ids and the Turnstile site key in `wrangler.toml` are public identifiers, not secrets.
4. Cosmetic: a misplaced doc comment above `parseUsdPrice` in `workers/api/src/services.ts`.

## Hackathon-readiness assessment

A candid assessment of the repository, not a prediction of judging. The ZECATHON deadline appeared on public pages as **2026-10-28**; it was not confirmed from the official rules, which are behind a login.

**Strengths:** a complete, working product with a real cryptographic and Zcash-address core; narrow privacy claims, each with a test; a real deployment with a live suite; a problem found and fixed by actually deploying (and documented honestly); documentation that says what was not verified; the code is on GitHub.

**Gaps that matter before submitting**

1. **Nobody has created an exchange on production yet.** One person passing the real challenge closes this in about five minutes.
2. **No real wallet or payment has ever been exercised**; Zodl compatibility is unknown (R01/R02). The scan test in `docs/ZODL_MANUAL_TEST.md` needs no money. A demo with one small real shielded payment (needs your approval and a spending limit) is the most valuable missing proof. No testnet transaction exists either.
3. **Trusted-host draw** is a real limitation judges will notice; it is disclosed.
4. **The official rules, licence and demo requirements were not read.**
5. No third-party review, no screen reader, Chromium-first testing, WebKit journey failing here.

**Next steps, in order:** read the official rules and confirm the deadline; pass the real Turnstile on production once and create and delete a throwaway exchange; do the no-money Zodl scan test; decide on the testnet build; a small real-ZEC trial with consenting friends under a limit you set; record the evidence; submit.
