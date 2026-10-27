# Evidence

What was actually run, with the result. Nothing here was run against a deployment, a real wallet, real Turnstile or real funds. Numbers come from the commands shown; rerun them to check.

Environment: Windows 11, Node 24.13.1, Chromium 156.0.8078.4, Firefox 157.0 and WebKit 27.2 from Playwright 1.64.1, local Worker under Miniflare 4.20260730.0 with a real D1 (SQLite) implementation, Rust 1.99.1 for the cross-check. The repository state tested is the commit recorded at the end of `docs/FINAL_AUDIT.md`.

## Final verification (2026-10-27)

| Check | Command | Result |
|---|---|---|
| Type check, all workspaces | `npm run typecheck` | No errors |
| Unit, API integration, race and security tests | `npx vitest run` | **409 passed, 0 failed, 21 files** |
| Package tests only | `npm run test:unit` | 176 passed in 7 files |
| Production build | `npm run build` | Succeeds; first-party assets only |
| Dependency audit | `npm audit` | 0 vulnerabilities |
| Reference-parser cross-check | `npm run test:crosscheck` | 3 passed (needs Rust; opt-in) |
| Browser, Chromium | `npx playwright test` | **76 passed, 0 failed in one command (9.8 minutes)** |
| Live deployment, read-only (production) | `LIVE_URL=https://mummer.mummer-app.workers.dev npx playwright test -c playwright.live.config.ts -g "reports its commit|accessible"` | 3 passed |
| Live deployment, full journey (staging) | `LIVE_URL=https://mummer-staging.mummer-app.workers.dev npx playwright test -c playwright.live.config.ts` | 4 passed (headers and commit, full journey, axe and layout at 390 and 1280 px) |
| Wrangler config | `wrangler deploy --dry-run` | Succeeds |

Vitest per file: security 21; crypto 39 + 4; shared 42; draw 20; zcash 21 + 6 + 46; API: diagnostics 3, extend 10, flow 7, groups 43, hardening 17, interleaving 17, join-draw 30, payments-reveal 26, resilient-d1 5, routes 27, security-headers 7, services 14; human-check 4.

Playwright per file (Chromium): a11y 13, browser-security 8, exchange 1, link-replacement 10, metadata 6, recovery 6, responsive 12, review-fixes 4, storage-failure 4, validation 12.

## Live deployment (Cloudflare, 2026-10-27)

Full detail in `docs/DEPLOYMENT.md`. Summary of what was observed:

- **Resources created (free tier, no billing):** workers.dev subdomain `mummer-app`; D1 databases `mummer` and `mummer-staging` (both migrated, 0001 and 0002); Workers `mummer`, `mummer-check`, `mummer-staging`, `mummer-staging-check`; one Turnstile widget (managed, restricted to the production check hostname). Secrets were uploaded from files outside the repository that were deleted afterwards.
- **Production:** `/api/health` returns `ok`, `production` and the deployed commit; `/api/config` reports the human check required with the site key and check origin; headers and CSP as designed; axe clean and no horizontal scroll on nine public pages at 390 and 1280 px; D1 holds zero exchanges.
- **Turnstile:** the planned opaque-origin sandbox failed (error 300030, messages from origin "null" discarded; even Cloudflare's always-pass key gave no token). After moving the check to its own origin, the real widget renders inside it on production, and the always-pass control delivers a token to the app with origin `https://mummer-check.mummer-app.workers.dev` and no origin warnings. The real managed challenge holds an automated browser (headless and headed), as designed, so **it has not been completed on production**.
- **Staging (public test keys), full journey in a real browser:** create (human check passed), four joins, draw, assignment with payment QR and a live price quote (Kraken), sent, confirmations with references, link replacement, glass box, delete, no console errors, no third-party origin contacted by the pages: passed. **D1 contents after it** (real database): sealed profiles and bundles all 747 characters, 64-character hashes and commitments, day-granular dates, zero plaintext hits for the wishlist text or an address prefix.
- **Problems found only by deploying, all fixed with tests that fail without the fix:** the sandboxed frame; CoinGecko answering 403 to Workers (Kraken added); Cloudflare's test keys returning the placeholder hostname `example.com` (the hostname binding skips only responses Cloudflare marks as test-key); the test helper's spoofed `cf-connecting-ip` header being rejected by the edge with Error 1000; a transient Error 1000 and DNS failures on this machine during runs (not reproducible on retry).
- **Not verified:** the real managed challenge on production; Cloudflare's dashboard logging setting; reveal day on a live deployment; edge log retention.

## Other browsers (Playwright; opt-in with `E2E_ALL_BROWSERS=1`)

Run file by file at different points in the final build; **not** one combined run.

| Spec | Firefox | WebKit |
|---|---|---|
| validation (12), recovery (6), review-fixes (4), link-replacement (10) | not run as a set | **32 of 32 passed** |
| storage-failure (4) | 4 passed | 4 passed |
| a11y (13) and browser-security (6) | 19 of 19 passed | 18 of 19 first run; the failure was the skip-link test (Safari/WebKit leaves links out of the Tab order; Playwright cannot press Option+Tab). The test now checks document order and focus there, and passed |
| exchange (the six-participant journey) | **passed** (1.5 minutes) | **fails**, at a different step each run (the "Next: your wallet" button, the save-link confirmation, and others); the cause was not established (see below) |
| responsive (12 viewports) | one full run: 11 of 12 passed; the failure at 844x390 was an audit artifact (closed-disclosure content that Firefox lays out but never shows) | one full run: 12 of 12 passed |
| responsive, stricter audit (disclosures opened as well) | 320x640, 844x390, 1024x600 passed | 320x640, 844x390, 1024x600 passed |

Defects that Firefox and WebKit found and that were fixed: zod's just-in-time probe was reported as a CSP violation (Firefox); `upgrade-insecure-requests` made WebKit fail every subresource on plain-HTTP loopback (WebKit); test helpers granted clipboard permissions that WebKit does not have.

**Unresolved:** `exchange.spec.ts` in WebKit. Every shorter spec passes in WebKit, including the join wizard, so this is probably resource pressure from six concurrent contexts on this 8 GB machine, but that is a guess, not a finding. No real iOS Safari or Android device was used.

## The intermittent HTTP 500

Investigated in detail; see `docs/KNOWN_LIMITATIONS.md` item 23 and `docs/TESTING.md`.

- Diagnostics added to the error handler (route with ids masked, error name, masked message, underlying network cause, top stack frames; no bodies, headers, tokens or ids) captured the failure under deliberate load: `TypeError: fetch failed`, cause `connect EADDRINUSE 127.0.0.1:<port>`, on join, create and acknowledgment requests.
- At that moment 13,933 sockets were in TIME_WAIT against a Windows dynamic range of 16,384 ports; a full suite opens roughly 4,000 loopback connections to Miniflare.
- A test-harness-only guard retries a connect that failed with EADDRINUSE or EADDRNOTAVAIL (nothing was transmitted, so a repeat cannot duplicate a write) and nothing else, logging each retry. Four consecutive full runs afterwards needed 0 retries and produced 0 server errors.
- **The very first occurrence had no diagnostics.** It is consistent with this cause; it is not proven to be it. Three parallel full suites remain unsupported on this machine (timeouts and `ECONNRESET`, deliberately not retried).

## What the browser suites cover

- **Responsive:** 12 viewports (320x640 to 1920x1080 plus landscape 844x390 and 1024x600) across 23 screens, measured twice (disclosures closed, then every disclosure opened): no horizontal scroll, nothing escaping the viewport, 44 px targets.
- **Accessibility:** axe-core (WCAG 2.0/2.1/2.2 A and AA plus best practice) on every route and key state at 390 and 1280 px; keyboard tests for the skip link, visible focus, dialog focus, ARIA tabs, the phone menu, route-change focus and 200% text. **No screen reader was used** (`docs/ACCESSIBILITY_MANUAL_CHECKLIST.md`).
- **Browser security:** CSP enforced by the real browser; no private-link secret in any URL, header, referrer or body in the flows listed; storage holds a key but no plaintext; headers on every document type; sandboxed human-check frame; no cookies, no cross-site requests.
- **Link replacement and storage:** a lost reply, a refusal, a server error, a refresh, going offline, repeated requests, two replacements, another tab, a stale link, a removed member, blocked storage, failing credential writes. Each was run against the **pre-fix client and failed there** before it was kept.
- **Metadata and completeness:** unique titles and descriptions, absolute social images, icons and manifest, every internal link resolving, shared navigation, footers only on marketing pages, no placeholder text, no nameless buttons.

## Race tests

`workers/api/test/interleaving.test.ts` makes a competing request complete between a handler's check and its write (a draw, a reset and redraw, a close). Against the pre-fix server code **12 of its 17 tests fail** and the rest are idempotency and normal-path controls; with the fixes all pass.

## Official vectors and cross-check

F4Jumble (8 vectors plus two multi-megabyte vectors), 60 Rev 0 and 60 Rev 2 unified-address vectors, ZIP 321 specification examples, RFC 9106 Argon2id, FIPS SHA-256. In addition the reference Rust `zip321` crate decodes every URI Mummer builds to the same address, amount and memo. **That shows another implementation accepts Mummer's output, not that Zodl does.**

## Independent reviews

Three automated reviews during development and a source review on 27 October (`docs/BUILD_REVIEW.md`, 12 findings). Every one of its findings was fixed, and each fix has a test that fails without it (table in `docs/FINAL_AUDIT.md`). These are reviews by automated reviewers, **not** a third-party penetration test.

## Test doubles

See `docs/TESTING.md`. A fake clock and fixed price exist only in the API tests and the E2E-only Worker entry; the Turnstile verifier is a stub in API tests; addresses are public Zcash test vectors with no keys. Prices in screenshots read "e2e-fixture" for that reason.

## Not run (and why)

| Item | Reason |
|---|---|
| Reveal day on a live deployment | The clock cannot be moved; earliest reveal is hours away |
| The real managed Turnstile challenge on production | Needs a person; automation is held by design |
| Zodl (or any wallet) scanning a Mummer QR, memo prefill, sending, receiving | No devices here; Zodl has no Windows build and no emulator or virtualization is available. A no-money manual test is written up in `docs/ZODL_MANUAL_TEST.md` (R01/R02/R12) |
| Any Zcash testnet transaction | Tooling downloaded but the build of `zcash-devtool` was blocked by the harness permission policy; no wallet or key exists (`docs/INTEGRATION_RESEARCH.md`) |
| A real-ZEC trial with 4 to 5 consenting people | Requires real funds and people |
| Screen reader | Not available to the automation (`docs/ACCESSIBILITY_MANUAL_CHECKLIST.md`) |
| Real iOS Safari, Android Chrome, other devices | Not available |
| Load testing | Not performed |
| Third-party security review, trademark search by counsel | Not commissioned |
