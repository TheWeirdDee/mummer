# Testing

Layered, and honest about what each layer does and does not prove. Counts below are from the last full runs recorded in `docs/EVIDENCE.md`: Vitest 361 tests in 16 files (all passing), Playwright 50 tests (all passing).

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
npm run typecheck && npm test       # Vitest (16 files, 361 tests)
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

## Known test flake

In one of seven full Vitest runs, a single security test (`exclusions cannot be bypassed through the API`, which creates 26 exchanges in one test) received an HTTP 500 from a member-join request. It passed alone and in six further full runs, and with the error stack logged it did not recur, so the cause is **not identified**. It was a load-dependent `TypeError` inside the Worker under Miniflare. Treat it as an open item: if it recurs in CI, capture the stack (the server log intentionally records only the route and error name).
