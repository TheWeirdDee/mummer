# Testing

Layered, and honest about what each layer does and does not prove. Counts below are from the final verification recorded in `docs/EVIDENCE.md`: Vitest 409 tests in 21 files (all passing); Playwright 76 tests in Chromium (all passing in one command), with Firefox and WebKit run spec by spec; plus a live suite of 4 tests against real deployments.

| Layer | Tool | Where | What it proves |
|---|---|---|---|
| Unit: Zcash | Vitest | `packages/zcash/test` | F4Jumble (8 official vectors + two 3 to 4 MB long vectors), 60 Rev 0 and 60 Rev 2 official unified-address vectors decoded to exact receivers, address policy and every refusal, ZIP 321 spec examples (valid and invalid), exact money arithmetic, memo byte limits |
| Unit: crypto | Vitest | `packages/crypto/test` | Known-answer vectors (RFC 9106 argon2id, FIPS SHA-256), sealed-box round trips, wrong key, tamper at every region, truncation, malformed JSON/UTF-8 inside valid ciphertext, context-binding replay, padding buckets, reference entropy and error detection, link strictness, backup round trips, no plaintext in anything stored |
| Unit: draw | Vitest | `packages/draw/test` | Rejection sampling at the boundary, Sattolo validity for n = 4..50, uniformity over all 24 cycles of 5 (100,000 seeded draws, chi-square), exclusions (random layouts, uniform over valid cycles, dense fallback, impossibility, search limit), independent validator |
| Unit: shared | Vitest | `packages/shared/test` | DST and half-hour timezone arithmetic, state machine rules, schema edge cases |
| API integration | Vitest + Miniflare (real D1 under workerd) | `workers/api/test` | Whole exchange end to end, authorization, validation, human-check tickets, rate limits, retention, race conditions (concurrent joins, draws, acknowledgments, rotations), price provider (real `fetch` path against a local server), header set on every response type, route matcher |
| Security / adversarial | Vitest, real database | `tests/security` | Plaintext-leak scans of every request, response and table over a full lifecycle; endpoint × role authorization matrix; replay and cross-context attacks; injection and hostile input; metadata minimization |
| Browser end-to-end | Playwright (Chromium) against the real Worker and D1 | `tests/e2e` | See below |

## Browser suites (`tests/e2e`)

| File | Count | Covers |
|---|---|---|
| `exchange.spec.ts` | 1 | A complete exchange with a host and five participants in isolated browser contexts: create, save link, join x5, draw, open assignments (QR, amount, memo), mark sent, confirm with reference, move the server clock, reveal, glass-box, delete; no console errors; no third-party origin |
| `link-replacement.spec.ts` | 10 | Lost reply after a successful replacement, a refusal, a server error treated as ambiguous, a refresh, offline then online, repeated requests, two replacements in a row, another tab, a stale link opened on a device holding the new key, a removed member not let back in by a stale record |
| `storage-failure.spec.ts` | 4 | Storage blocked entirely (open and restore), a replacement refused when the new key cannot be kept, a replacement whose new key cannot be saved afterwards (held in memory, reload recovers) |
| `review-fixes.spec.ts` | 4 | Cleared dates, no payment request for a removed recipient, removal during draw review, reveal wording |
| `metadata.spec.ts` | 6 | Titles and descriptions, absolute social images, icons and manifest, internal links and navigation, external link safety, footers, no placeholder text or nameless buttons |
| `validation.spec.ts` | 12 | Create-form and join-wizard validation, every address refusal, duplicate nickname, drafts across reload, full / drawn / unknown invitations, the invite's host-key fingerprint (match, absent, wrong), API outage and retry, price outage, expired quote, oversize note |
| `recovery.spec.ts` | 6 | Missing key, truncated link, a link carrying a different key than the saved one (asks, keeping works), passphrase backup restore and wrong passphrase, pasted-link restore, link replacement (old link dead, new link opens the same assignment), leaving and forgetting a device |
| `browser-security.spec.ts` | 6 | CSP enforcement in a real browser, no secret in any URL, header, referrer, body or storage, headers on every document type, sandboxed human-check frame, no cookies or CORS |
| `responsive.spec.ts` | 12 | 23 screens at 12 viewports (320 to 1920 plus two landscape sizes): no horizontal scroll, no element escaping the viewport, 44px touch targets; screenshots saved for review |
| `a11y.spec.ts` | 13 | axe-core (WCAG 2.0/2.1/2.2 A and AA plus best-practice) on every route and key state at 390 and 1280 px, with dialogs open; skip link, visible focus, dialog focus handling, ARIA tabs keyboard pattern, menu, route-change focus, 200% text |

`tests/e2e/fixture.ts` creates exchanges over HTTP with real cryptography so layout, accessibility and security suites can reach any state without clicking through the whole UI. The UI journey itself is `exchange.spec.ts`.

## Test doubles (and where they are confined)

| Double | Used by | Why |
|---|---|---|
| Fake clock | API integration tests; the E2E entry (`workers/api/e2e`) | Deadlines, reveal day and expiry. Nothing under `workers/api/src` reads a test clock. |
| Turnstile verifier stub (`token === 'turnstile-ok'`) | API integration tests only | No Cloudflare account; the ticket logic and fail-closed behaviour are tested, the real widget is not. |
| Fixed price | API tests; the E2E entry | Determinism. The real provider code path is tested separately against a local HTTP server. |
| Official public test-vector addresses | E2E and fixtures | Obviously not real wallets. No real keys, seeds or funds are used anywhere. |

## Running

```bash
npm run typecheck && npm test       # Vitest (21 files, 409 tests)
LIVE_URL=https://<staging> npx playwright test -c playwright.live.config.ts   # the real Cloudflare stack (see below)
npm run test:unit                   # package tests only (176)
npm run test:crosscheck             # reference Rust ZIP 321 parser (needs Rust; opt-in)
E2E_ALL_BROWSERS=1 npx playwright test --project=firefox   # or webkit; needs: npx playwright install firefox webkit
npx playwright test                 # starts its own server on :8788, builds first
npx playwright test tests/e2e/a11y.spec.ts
```

## Manual review notes and limits

- **Automated accessibility checks cover a fraction of WCAG.** No manual screen-reader session on real assistive technology was performed. Reading order, focus order, error announcement and tab/dialog behaviour were checked by keyboard tests and by inspecting accessibility-tree snapshots, not with NVDA, JAWS or VoiceOver.
- **Visual review:** every viewport's screenshots were inspected (by the author and by an independent reviewer; see `docs/FINAL_AUDIT.md`), not only checked numerically.
- **Not tested:** real Zodl scanning, real shielded payments, real Turnstile, deployed behaviour, Safari and Firefox, long-running load, mobile-device performance measurement beyond the bundle sizes recorded in `docs/EVIDENCE.md`.

## Regression tests added after findings

| Finding | Regression test |
|---|---|
| Check character missed a last-data/check swap (weights ended at 31 ≡ -1 mod 32) | `crypto.test.ts` "detects the large majority of adjacent transpositions" |
| Production without a Turnstile secret could still mint tickets with a lenient verifier | `groups.test.ts` "production fails CLOSED when no Turnstile secret is configured" |
| Join refusal after the deadline blamed the host (lazy lock) | `join-draw.test.ts` "refuses joins after the deadline, after the host closes joining, and after the draw" |
| Hono merged asset-layer headers over ours | live header checks; `browser-security.spec.ts` header test |
| `useAsync.reload` after a failure left no data and no error (blank crash) | `validation.spec.ts` "an API outage shows a retryable message" |
| After "Replace my link" the new link was never shown (state unmounted by the re-fetch) | `recovery.spec.ts` "replacing a possibly leaked link" |
| Skip link was not the first Tab stop (focus stolen on first load) | `a11y.spec.ts` skip-link test |
| Duplicate landmark names and ids from two link savers | `a11y.spec.ts` axe on member account |
| Eyebrow contrast on the pine band | `a11y.spec.ts` axe on the home page |
| `hashchange` (pasting a link into an open tab) was ignored | covered by recovery and deletion flows |
| A link carrying a different key silently overwrote the key saved on the device | `recovery.spec.ts` "a link whose key differs from the one saved here asks before replacing it" |
| An invitation with a wrong or missing host-key fingerprint was not flagged | `validation.spec.ts` "the invite carries the host key fingerprint" |
| An HTML entity inside a JS string rendered literally in the "received" notice | `exchange.spec.ts` (asserts the rendered sentence) |
| Draw replays, stale member lists, forged curve points, oversize bodies | `workers/api/test/hardening.test.ts`, `extend.test.ts` |

## Load-dependent failures and the guard against them

A security test once got an HTTP 500 from a join request in one of seven full runs. Structured diagnostics (`describeError` in `workers/api/src/app.ts`: route with ids masked, error name, masked message, the underlying network cause, top stack frames; never bodies, headers, tokens or ids) then captured the failure under deliberate load as `TypeError: fetch failed` with cause `connect EADDRINUSE 127.0.0.1:<port>`. The harness reaches Miniflare's D1 over loopback; a full suite opens about 4,000 connections that each linger in TIME_WAIT for two minutes on Windows, whose dynamic range is 16,384 ports (13,933 were in use at the time). This affects the **test environment only**.

`workers/api/test/resilient-d1.ts` retries a D1 call only when it failed to *connect* with EADDRINUSE or EADDRNOTAVAIL (nothing was sent, so a repeat cannot duplicate a write); anything else, including constraint errors and failures after sending, is thrown unchanged, and every retry is logged. `resilient-d1.test.ts` proves that other errors are never retried. Four consecutive full runs afterwards: 0 retries, 0 server errors.

**Not claimed:** that the very first, undiagnosed occurrence was this cause (it is consistent with it), or that heavy parallelism is safe: three full suites at once still produce timeouts and `ECONNRESET` on this machine, which the guard intentionally does not retry.

## Race tests

`workers/api/test/interleave.ts` wraps the database binding so a competing request can complete exactly between a handler's checks and its write; `interleaving.test.ts` uses it for draw versus link replacement, redraw versus "sent" and acknowledgment, close versus acknowledgment, draw versus leave, and redraw versus reveal. Twelve of its 17 tests fail against the pre-fix server code.

## Cross-implementation check

`tests/crosscheck/zip321-rust.test.ts` (run with `npm run test:crosscheck`; needs a Rust toolchain; the helper crate is `tools/zip321-crosscheck`) feeds Mummer's payment requests to the reference `zip321` crate and compares address, amount and memo bytes, and checks that it rejects what Mummer rejects. It shows that an independent implementation of the specification accepts Mummer's output. It does not test any wallet.

## Regression tests added after the 27 October review

| Finding | Test that fails without the fix |
|---|---|
| Glass box exposed recipient-only reveals | `payments-reveal.test.ts` "glass box never exposes", `tests/security` "recipient-only reveals stay between the two people" |
| Replacement raced the draw and could strand an assignment | `interleaving.test.ts` (replacement versus the draw, a stale bundle, a redraw in between) |
| Delayed "sent", acknowledgment, reveal or confirm wrote into a newer draw or a closed exchange | `interleaving.test.ts` (payment writes, reveals) |
| Storage failure during replacement could lose the new key | `storage-failure.spec.ts` |
| A removed recipient's giver still saw a payment request | `review-fixes.spec.ts` |
| Leaving during a draw reported a removal that did not happen | `interleaving.test.ts` "leaving versus the draw" |
| Clearing a date threw instead of validating | `review-fixes.spec.ts` |
| Recovery with storage blocked dropped the key | `storage-failure.spec.ts` |
| `npm run test:unit` selected a nonexistent project | the script now runs (176 tests) |
| Closed exchanges accepted reveal confirmations | `interleaving.test.ts` |
| Reveal copy contradicted the listing | `review-fixes.spec.ts` |
| Removing someone in draw review forced a stale-list retry | `review-fixes.spec.ts` |

## Live suite (`tests/live`, `playwright.live.config.ts`)

Runs against a real deployment (`LIVE_URL`, optionally `EXPECT_COMMIT`). Four tests: health and commit, `/api/config`, security headers, absolute social image, the check host's framing and routes; the full journey (create with the human check, four joins, draw, payment request with a live price quote, sent, confirmations, link replacement, glass box over the real database, delete, no console errors, no unexpected third-party origin); and axe plus layout on nine public pages at 390 and 1280 px. The journey needs a deployment whose Turnstile uses Cloudflare's public always-pass test keys (`workers/api/wrangler.staging.toml`), because a real managed challenge needs a person; the other three run against production. `demo-exchange.spec.ts` (only with `DEMO=1`) makes a throwaway staging exchange for the manual wallet test in `docs/ZODL_MANUAL_TEST.md`. Reveal day cannot be tested live (the clock cannot be moved).

On a live run the shared helpers wait for "Check passed." before submitting and stop sending the spoofed `cf-connecting-ip` header that the local runs use for per-browser rate limits (Cloudflare's edge rejects it with Error 1000).

## Human-check host tests

`workers/human-check/test` (4 Vitest tests): routes (only the page and script), the framing policy (`frame-ancestors` names only the parent; Cloudflare allowed only for script, frames and connections), malformed or missing parent origins meaning nobody may frame it, and secured error responses. The local E2E starts this Worker on port 8789 and `browser-security.spec.ts` loads the real cross-origin frame: it must load and run, post only to the app with its real origin, be unreadable by the app, refuse a foreign parent, and serve nothing else. An earlier version of that test accepted a timeout, which hid the production failure until the first real deployment; no test in that spec accepts a timeout now.
