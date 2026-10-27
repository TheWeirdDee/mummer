# Final audit

State of Mummer at the end of this build, in five buckets: implemented, tested, verified in production, externally blocked, and not completed. "Tested" means an automated test in this repository passes locally. **Nothing is verified in production because nothing is deployed.** Code and tests were verified at commit `a8aa088`; later commits change documentation only. Exact run results and the runs that were *not* clean are in `docs/EVIDENCE.md`.

## 1. Implemented

- Noncustodial Secret Santa web app (React, Cloudflare Worker, D1) with the full journey: create, invite, join, draw, assignment, payment request, sent, received, reveal, delete, recovery; link replacement, backup, leaving, extending dates.
- Real ZIP 316 unified-address decoding, address policy, ZIP 321 payment requests with exact zatoshi arithmetic and a 512-byte memo; the output is also accepted by the reference Rust `zip321` parser.
- Client-side sealed boxes (libsodium), padded blobs, context binding, bearer tokens stored as hashes, Argon2id passphrase backups, fragment-based private links, address commitments, host-key fingerprint in the invite.
- Trusted-host draw with an atomic commit pinned to the draw and members versions; every member write (replacement, sent, acknowledgment, reveal, confirmation, leave) is pinned to the state it validated.
- Aggregate-only progress, totals-only host glass box that never reveals a recipient-only reveal, consent-gated reveals, thresholded public stats.
- Security headers on every response, strict CSP with no inline script or eval, sandboxed human-check frame, rate limiting, retention purge, structured error diagnostics with ids and blobs masked.
- Link-safety handling for browser storage that is blocked, full or failing; conflict screen; recovery of a replacement whose reply was lost.
- Accessibility work, responsive layouts, absolute social-image URLs.
- One-command local development (`npm run dev`) and a documentation set in `docs/`.

## 2. Tested (automated, local)

| Layer | Result |
|---|---|
| `npm run typecheck` | Clean |
| Vitest (unit, API on a real D1, security, race tests) | 395 passed in 20 files |
| Playwright, Chromium | 74 tests; one-command run 73 passed, 1 interrupted by the computer sleeping and passed on rerun |
| Playwright, Firefox and WebKit | Run spec by spec: all passed except the six-participant journey in WebKit (unresolved; see below) |
| axe-core | No violations on every route and key state at 390 and 1280 px in all three browsers |
| Responsive | 12 viewports (320 to 1920 plus two landscape), measured with disclosures closed and open |
| Reference-parser cross-check | 3 passed |
| `npm audit` | 0 vulnerabilities |

## 3. Verified in production

**None.** The code is on GitHub (https://github.com/TheWeirdDee/mummer), but no Cloudflare destination was designated, so nothing is deployed. `docs/DEPLOYMENT.md` is a sourced, step-by-step checklist with costs, token permissions, secrets, the logging decision and verification commands; `wrangler deploy --dry-run` validates the configuration.

## 4. Externally blocked

| Item | Needs |
|---|---|
| Deployment and live verification | A designated Cloudflare account and project (free tier is enough to start) |
| Real Turnstile, including inside Mummer's sandboxed opaque-origin frame (the highest-risk first-deployment check) | A Cloudflare account and site key |
| Zodl (or any wallet) scanning a Mummer QR, memo prefill, sending, receiving (R01/R02) | A phone with Zodl and a small funded wallet; none can run in this environment (`docs/INTEGRATION_RESEARCH.md`) |
| A real-ZEC exchange with 4 to 5 consenting people (R12) | Real funds and people; a spending limit set by the owner |
| ZECATHON rules (R05), trademark clearance (R11), edge logging (R09) | The official site behind a login (the deadline appears to be 2026-10-28 and is unconfirmed), a trademark search by counsel, a Cloudflare account |
| Screen-reader pass | A person with NVDA, VoiceOver and TalkBack (`docs/ACCESSIBILITY_MANUAL_CHECKLIST.md`) |
| Real iOS Safari and Android devices | Devices |
| Independent third-party security review | A reviewer |

## 5. Not completed

- Host-blind draw (F14), independent shielded-payment proof (F15), company-funded mode (F13), calendar file (F16): stated as not built in the product and the docs.
- The six-participant journey in WebKit (`exchange.spec.ts`) does not pass: it stalls at a different step each run while every shorter WebKit spec passes. Cause not established.
- A complete single-command Playwright run of 74 of 74 in Chromium (one test was interrupted by the machine sleeping).
- The conflict screen when the chosen link also cannot be stored: implemented, no automated test.
- Usability targets from PRD v0.1: not measured; no figures are claimed.

## Findings and resolutions

### Build review of 27 October (`docs/BUILD_REVIEW.md`, 12 findings)

Every finding was reproduced or confirmed before fixing; each fix has a test that fails without it (the race tests, the storage tests and the UI tests were each run against the pre-fix code).

| # | Finding | Resolution |
|---|---|---|
| 1 | Recipient-only reveals leaked through the host's glass box | Same audience rule as the listing; the host sees a count only |
| 2 | Link replacement could race the draw and strand an assignment | The replacement applies only if the assignment situation (and draw version) is still what the request was built for; the request carries the bundle's draw version |
| 3 | "Sent", acknowledgment (and reveal) writes not pinned to the validated draw and phase | Each write repeats the checked facts in its SQL and checks the row count; stale requests get `409`; idempotent repeats still succeed |
| 4 | Storage failure during replacement could lose the new key | No replacement without a durable, read-back copy; the record is kept until the real one is saved; the page holds the key in memory if storage fails |
| 5 | Payment request shown for a removed recipient | Refused with an explanation; banner copy no longer says the assignment "still works" |
| 6 | Leave during a draw reported a removal that did not happen; false audit event | Row count checked, audit event conditional, retried under the post-draw rules |
| 7 | Clearing a date threw before validation | Both dates validated before any arithmetic, in the create form and the change-dates form |
| 8 | Recovery failed when storage was blocked | Credentials carried in the destination fragment; a chosen link that cannot be stored is used from memory and its fragment kept |
| 9 | `npm run test:unit` selected a nonexistent project | Fixed; runs 176 tests |
| 10 | Closed exchanges accepted reveal confirmations | Refused in the route and in the UPDATE |
| 11 | Reveal copy promised consent the listing did not enforce | Copy now matches the listing |
| 12 | Removing someone in draw review forced a stale-list retry | The list is reloaded from the server after a removal |

The review's remaining gaps were closed too: deterministic interleaving tests, browser coverage for blocked and failing storage and for cleared dates, and a privacy sweep of every host-visible response after a private reveal. The review's own full-suite stall (`spawn EPERM`) was a limit of its sandbox.

### Other findings in this round

| Finding | Resolution |
|---|---|
| Intermittent HTTP 500 in the test suite | Cause established under load (loopback port exhaustion, `EADDRINUSE`); guarded in the test harness only; the very first occurrence is consistent with it but not proven (`docs/KNOWN_LIMITATIONS.md` item 23) |
| Firefox: zod's feature probe reported as a CSP violation | Zod runs without just-in-time compilation |
| WebKit: `upgrade-insecure-requests` broke every subresource on http://127.0.0.1 | Dropped only for plain-HTTP loopback; production HTTPS keeps the full policy; tested |
| `og:image` and `twitter:image` were relative URLs | The Worker completes them from the request origin; tested |
| Stale tab dead-ended after another tab replaced the link | The tab probes the saved key and adopts it; tested against the pre-fix code |
| `wrangler.toml` left Workers Logs at their default (on) | Disabled explicitly; to be verified in the dashboard after deployment |
| `npm run dev` did not exist | Added, with setup in `docs/SETUP.md` |
| Responsive audit counted closed-disclosure content (Firefox artifact) | The audit skips unseen content and also measures with every disclosure open |

Earlier audits (security, protocol, product) are listed in earlier versions of this file in git history; all their findings were fixed with regression tests.

## Open items

1. The WebKit journey (above).
2. No automated test of the "chosen link cannot be stored" conflict path.
3. Residual risks in `docs/KNOWN_LIMITATIONS.md` and `docs/PRIVACY_AUDIT.md` (trusted host, a malicious operator serving code, metadata, small groups, self-reported states).
4. The repository is public by the owner's choice; it contains no secrets (history scanned for key, token and credential patterns; `.dev.vars` and environment files are ignored), but all documentation, including the threat model and known limitations, is visible.
5. A misplaced doc comment above `parseUsdPrice` in `workers/api/src/services.ts` (cosmetic).

## Hackathon-readiness assessment

A candid assessment of the repository, not a prediction of judging. The ZECATHON deadline appeared on public pages as **2026-10-28**; it was not confirmed from the official rules, which are behind a login.

**Strengths:** a complete, working product with a real cryptographic and Zcash-address core; narrow privacy claims, each with a test; documentation that states what was not verified; a reproducible test suite including race tests and an independent-implementation cross-check; the code is already on GitHub.

**Gaps that matter before submitting**

1. **Not deployed**: no live URL. Needs a Cloudflare account (`docs/DEPLOYMENT.md`).
2. **No real wallet or payment has ever been exercised**; Zodl compatibility is unknown (R01/R02). A demo with one small real shielded payment is the most valuable missing proof.
3. **Turnstile in the sandboxed frame is untested** and could stop creating and joining until a design choice is made.
4. **Trusted-host draw** is a real limitation judges will notice; it is disclosed.
5. **The official rules, licence and demo requirements were not read.**
6. No third-party review, no screen reader, Chromium-first testing.

**Next steps, in order:** read the official rules and confirm the deadline; designate a deployment target and deploy; run the post-deployment checks; do a small real-ZEC trial with consenting friends; record the evidence; submit.
