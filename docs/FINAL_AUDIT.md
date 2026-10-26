# Final audit

State of Mummer at the end of this build, in five buckets: implemented, tested, verified in production, externally blocked, and not completed. "Tested" means an automated test in this repository passes locally. **Nothing is verified in production because nothing is deployed.**

## 1. Implemented

- Noncustodial Secret Santa web app (React, Cloudflare Worker, D1) with the full journey: create, invite, join, draw, assignment, payment request, sent, received, reveal, delete, recovery.
- Real ZIP 316 unified-address decoding, address policy, ZIP 321 payment requests with exact zatoshi arithmetic, 512-byte memo construction.
- Client-side sealed boxes (libsodium), padded blobs, context binding, bearer tokens stored as hashes, Argon2id passphrase backups, fragment-based private links, address commitments, host-key fingerprint in the invite.
- Trusted-host draw (rejection sampling, Sattolo cycle, exclusions), with atomic server-side commit pinned to draw and members versions.
- Aggregate-only progress, totals-only host glass box, consent-gated reveals, thresholded public stats.
- Security headers on every response, strict CSP with no inline script, sandboxed human-check frame, rate limiting, retention purge.
- Accessibility work: skip link, landmarks, focus management, ARIA tabs, dialogs, error summaries, responsive tables that stack on narrow screens.
- Documentation set in `docs/` (see `README.md`).

## 2. Tested (automated, local)

| Layer | Result |
|---|---|
| `npm run typecheck` | Clean |
| Vitest (unit, API on real D1, security) | 361 passing in 16 files |
| Playwright (Chromium) | 50 passed in one complete run |
| axe-core | No violations on every route and key state at 390 and 1280 px |
| Responsive matrix | 12 viewports from 320 to 1920 including two landscape sizes, 23 screens: no overflow, 44 px targets |
| `npm audit` | 0 vulnerabilities |

Coverage detail is in `docs/REQUIREMENTS_MATRIX.md`, `docs/TESTING.md` and `docs/VALIDATION_REGISTER.md`.

## 3. Verified in production

**None.** No destination (Cloudflare account, repository, domain) was designated, so nothing was pushed or deployed. `docs/DEPLOYMENT.md` lists the steps and the post-deploy checks to run by hand.

## 4. Externally blocked

| Item | Needs |
|---|---|
| Deployment and live verification | A designated Cloudflare account and project |
| Real Turnstile | A Cloudflare account and site key |
| Zodl (or any wallet) scanning a Mummer QR and prefilling amount and memo (R01/R02) | Physical devices, a funded wallet, signing |
| A real-ZEC exchange with 4 to 5 consenting people (R12) | Real funds and people |
| Hackathon submission and publishing | The owner's decision and accounts |
| Hackathon rules and deadlines (R05); name and trademark (R11); edge logging (R09) | Information outside this environment |
| Manual screen-reader pass | Assistive technology and a tester |
| Safari, Firefox and real-phone checks | Devices and browsers |
| Independent third-party security review | A reviewer |

## 5. Not completed (by design or out of scope)

- Host-blind draw (F14), independent shielded-payment proof (F15), company-funded mode (F13), calendar file (F16). Each is stated as not built in the product and the docs.
- Usability targets from PRD v0.1 (time to first link, completion rate): not measured, no figures claimed.
- One unexplained test flake (below).

## Security and privacy findings and resolutions

Three independent audits (security, protocol, product and UX) were run mid-build. Material findings and their resolution:

| Finding | Resolution | Regression test |
|---|---|---|
| Reference check character missed a last-data and check swap | New weights | `crypto.test.ts` |
| Production human check could mint tickets without a secret | Fails closed | `groups.test.ts` |
| Host glass box exposed per-person state | Totals only | `groups.test.ts`, SEC |
| Draw could omit a late joiner | Members version in the compare-and-swap | `join-draw.test.ts`, `hardening.test.ts` |
| Draw replays and concurrent same-key requests mishandled | Idempotent replay, 409 only for constraint errors | `hardening.test.ts` |
| Weak or malformed X25519 keys accepted | Key validator in join and rotate | `hardening.test.ts` |
| IPv6 rate-limit evasion; no production salt | /64 bucketing; salt required | `hardening.test.ts` |
| Swapped host key or profile not detectable | Address commitments and host-key fingerprint | `hardening.test.ts`, `validation.spec.ts` |
| Stale or foreign assignment bundle shown | Pinned to the group's current draw version | No automated test of the client guard (the server side of draw versioning is tested) |
| Saved key silently overwritten by a different link | Conflict screen | `recovery.spec.ts` |
| Lost reply to a link replacement stranded the member | Replacement saved first; adopted after a 401 | Not covered by an automated test (manual reasoning only) |
| Invisible and bidi characters accepted in text | Rejected everywhere | `shared.test.ts`, `zip321.test.ts` |
| Unknown URLs returned 200; asset caching overridden | Real 404; header wrapper | `validation.spec.ts`, `browser-security.spec.ts` |
| Several accessibility and layout defects (skip link order, duplicate landmarks, dialog focus escape, eyebrow contrast, `hashchange` ignored) | Fixed | `a11y.spec.ts`, `responsive.spec.ts`, `validation.spec.ts` |

### Open items

1. **Unexplained test flake:** once in seven full Vitest runs, a join request inside the security suite got a 500 (`TypeError`). Not reproduced. Capture the stack if it recurs.
2. **No dedicated test** for the client's draw-version guard or for the pending-link-replacement recovery path.
3. **Residual risks** listed in `docs/KNOWN_LIMITATIONS.md` and `docs/PRIVACY_AUDIT.md` (trusted host, malicious operator serving code, metadata, small groups, self-reported states).
4. **Cosmetic:** a doc comment above `parseUsdPrice` in `workers/api/src/services.ts` is misplaced.

## Hackathon-readiness assessment

This is a candid assessment of the repository, not a prediction of judging.

**Strengths**

- A complete, working product with a real cryptographic and Zcash-address core, not a mock-up; the privacy claims are narrow and each one has a test behind it.
- Unusually honest evidence: a page in the product and documents that say what was not verified.
- Documentation, requirements traceability and a reproducible test suite.

**Gaps that matter before submitting**

1. **Not deployed.** There is no live URL. Deployment needs the owner's Cloudflare account (`docs/DEPLOYMENT.md`).
2. **No real wallet or payment has ever been exercised.** Whether Zodl fills in the amount and memo from the QR is unknown (R01/R02). The app is designed so copy buttons always work, but a demo with a real shielded payment is the single most valuable missing proof.
3. **Real Turnstile has not run**; the production human-check path is untested against Cloudflare.
4. **Trusted-host draw** is a real limitation judges will notice; it is disclosed and the docs explain why host-blind was not built.
5. **Hackathon rules, dates and bounty overlap are unknown** (R05); no submission was prepared or made.
6. **No third-party review**, no manual screen-reader test, Chromium only.

**Suggested next steps, in order:** designate a deployment target; deploy and run the checks in `docs/DEPLOYMENT.md`; do a small real-ZEC trial with consenting friends (R12) using the demo plan in `docs/DEMO.md`; record that evidence in `docs/EVIDENCE.md`; then read the hackathon rules and submit.
