# Evidence

What was actually run, with the result. Nothing here was run against a deployment, a real wallet, real Turnstile or real funds. Where a result is a number, it comes from the command shown; rerun it to check.

Environment: Windows 11, Node 24.13.1, Chromium from Playwright 1.64.1 (Chromium only), local Worker under Miniflare 4.20260730.0 with a real D1 (SQLite) implementation.

## Automated runs

| Check | Command | Result |
|---|---|---|
| Type check, all workspaces | `npm run typecheck` | No errors |
| Unit, API integration and security tests | `npx vitest run` | **361 passed, 0 failed**, 16 files. Seven full runs were made after the last code change to those layers; six were clean and one had a single unexplained failure (see "Open anomaly") |
| Production build | `npm run build` | Succeeds; `apps/web/dist` is 1.7 MB across 42 asset files, first-party only |
| Browser end to end | `npx playwright test` | **50 passed, 0 failed** in a single complete run (8.4 minutes) after the last code, test and doc-affecting changes. Earlier in the build an interim run had 4 failures (3 assertions on changed copy, 1 same-document fragment navigation that exposed a real defect: the host-key check ignored `hashchange`); all were fixed |
| Dependency audit | `npm audit` | 0 vulnerabilities (patched `undici` 7.30.1 and `sharp` 0.35.5 pinned through `overrides`) |

Counts per Vitest file: security 20; crypto 39 + 4; draw 20; shared 41; zcash 21 + 6 + 44; API: extend 10, flow 7, groups 42, hardening 17, join-draw 30, payments-reveal 25, routes 27, services 8.

Counts per Playwright file: a11y 13, browser-security 6, exchange 1, recovery 6, responsive 12 (one per viewport), validation 12.

## What the browser suites cover

- **Responsive:** 12 viewports (320x640, 360x740, 375x667, 390x844, 430x932, 768x1024, 1024x768, 1280x800, 1440x900, 1920x1080, and landscape 844x390 and 1024x600) across 23 screens: no horizontal overflow, nothing escaping the viewport, interactive targets at least 44 px. Screenshots are saved to `tests/e2e/.artifacts/screens` (not committed) and were looked at, not only measured.
- **Accessibility:** axe-core with WCAG 2.0/2.1/2.2 A and AA plus best-practice tags on every route and key state at 390 and 1280 px, with dialogs open; keyboard tests for the skip link, focus visibility, dialog focus trap and return, ARIA tabs, the phone menu, route-change focus and 200% text. This is **automated and scripted keyboard checking only**; no screen reader was used.
- **Browser security:** CSP enforced by the real browser (inline script, inline handlers, third-party script and cross-origin requests blocked; WebAssembly works); no private-link secret in any URL, header, referrer or request body; storage holds this device's key but no plaintext addresses, wishlists or assignments; headers on every document type; sandboxed human-check frame; no cookies and no usable cross-site requests.
- **Full journey:** one host and five participants in isolated browser profiles: create, save link, join, draw, open assignments, mark sent, acknowledge with reference, move the (test) server clock past reveal day, reveal and confirm, glass box, delete.

## Test doubles

See `docs/TESTING.md`. In short: a fake clock and fixed price exist only in the API tests and the E2E-only Worker entry (`workers/api/e2e`); the Turnstile verifier is a stub in API tests; all addresses are public Zcash test-vector addresses with no keys. The price quoted in screenshots reads "e2e-fixture" for that reason.

## Official vectors used

F4Jumble (8 vectors plus two multi-megabyte vectors), 60 Rev 0 and 60 Rev 2 unified-address vectors, ZIP 321 specification examples, RFC 9106 Argon2id, FIPS SHA-256. Files are under `packages/zcash/test/vectors` and `packages/crypto/test`.

## Independent reviews

Three independent code and design audits were run during development (security, protocol and product/UX/copy). Their findings were fixed and each fix has a regression test where one is possible; the list is in `docs/FINAL_AUDIT.md`. These were reviews by separate automated reviewers, **not** a third-party penetration test or professional audit.

## Open anomaly

In one of seven full Vitest runs, `tests/security/privacy-and-abuse.test.ts` ("exclusions cannot be bypassed through the API") received a 500 from a member-join request (error name `TypeError`). It passed alone, passed in six further full runs, and did not recur with the stack temporarily logged. The cause is unidentified. It is listed as open in `docs/KNOWN_LIMITATIONS.md` and `docs/FINAL_AUDIT.md`.

## Not run (and why)

| Item | Reason |
|---|---|
| Deployed environment checks | No destination or credentials designated; nothing was pushed or deployed |
| Real Turnstile | No Cloudflare account or site key |
| Zodl (or any wallet) scanning a Mummer QR, memo prefill, sending, receiving | No devices, funds or signing in this environment (gates R01/R02/R12) |
| A real-ZEC trial with 4 to 5 consenting people | Requires real funds and people |
| Safari, Firefox, real phones | Chromium only |
| Screen reader on real assistive technology | Not available |
| Load testing | Not performed |
| Third-party security review | Not commissioned |
