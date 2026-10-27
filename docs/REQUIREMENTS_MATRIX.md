# Requirements traceability matrix

Sources: **PRD v1.0 (revised)** is primary; **PRD v0.1** items are listed where they add something. Status values:

- **Tested** implemented and covered by automated tests (cited).
- **Implemented** built; verified by inspection or manual run only.
- **Not built** deliberately out of this release, with the honest user-facing label.
- **Blocked** needs something outside this environment (devices, funds, accounts, people).

Test files: `U-Z` = `packages/zcash/test`, `U-C` = `packages/crypto/test`, `U-D` = `packages/draw/test`, `U-S` = `packages/shared/test`, `A-*` = `workers/api/test/*.test.ts` (real D1), `SEC` = `tests/security`, `E-*` = `tests/e2e/*.spec.ts` (Playwright).

## Features (PRD v1.0 section 6)

| ID | Requirement | Status | Implementation | Evidence |
|---|---|---|---|---|
| F01 | Create group; dates, budget, timezone; host saves admin recovery | **Tested** | `routes/groups.ts` POST; `pages/CreateGroup.tsx`; `LinkSaver.tsx` (copy, download, paste-back, backup) | A-groups, E-exchange, E-validation, E-recovery |
| F02 | Join with nickname, wishlist, private link; isolated sessions; duplicate and late join blocked | **Tested** | `routes/members.ts`; `pages/JoinGroup.tsx` | A-join-draw (cap race, deadline, lock, drawn), E-exchange (6 isolated profiles), E-validation |
| F03 | Guided Zodl onboarding, safety copy, no seed collection | **Implemented** (copy) / **Blocked** (device verification) | `pages/WalletGuide.tsx`, join wizard step 2 | E-a11y; copy audit; no field accepts seeds; real-device test R01-R03 blocked |
| F04 | Validate shielded-capable mainnet address (real ZIP 316 decode, network and receiver checks) | **Tested** | `packages/zcash/src/address.ts`, `f4jumble.ts` | U-Z: official F4Jumble, UA Rev 0 and Rev 2 vectors; rejections; E-validation |
| F05 | Encrypted profiles and assignment bundles; only intended keys decrypt | **Tested** | `packages/crypto/src/seal.ts`, `protocol.ts` | U-C; A-flow; SEC (dump scans) |
| F06 | Sattolo trusted-host draw; one cycle; no self-assignment; atomic lock; exclusions or clear refusal | **Tested** | `packages/draw`, `DrawPanel.tsx`, `POST /draw` | U-D (100k seeded draws, chi-square, exclusions, impossibility, search limit); A-join-draw (concurrent draws, idempotency, mismatch) |
| F07 | Single-recipient ZIP 321 request, QR, manual copy; wallet handles address, amount, memo; explicit review | **Tested** (generation) / **Blocked** (wallet behaviour) | `packages/zcash/src/zip321.ts`, `Payment.tsx`, `QR.tsx` | U-Z (spec examples, round trip, tamper detection); E-exchange; wallet gate R01/R02 |
| F08 | Recipient acknowledgment and progress; never "verified" | **Tested** | `POST .../ack`, `Receive.tsx`, aggregate `progress` | A-payments-reveal, SEC, E-exchange |
| F09 | Voluntary reveal; consent rules; no unintended exposure | **Tested** | `POST /reveals`, `Reveal.tsx` | A-payments-reveal (timing, proof, rate limit, audience, confirm), E-exchange |
| F10 | Member and host revocation and safe recovery | **Tested** | rotate, leave, remove, redraw reset, backup | A-payments-reveal (rotation incl. concurrent), A-join-draw, E-recovery |
| F11 | Privacy / glass-box evidence page: redacted sample and schema, no secret blobs downloadable | **Tested** | `/evidence` page; `GET .../glassbox` (host only, sizes + fingerprints) | A-groups (glassbox), E-exchange |
| F12 | Public aggregate stats, thresholded | **Tested** | `GET /stats` (hidden under 5 exchanges, rounded to 5) | A-groups |
| F13 | Company-funded mode | **Not built** | n/a | `DECISIONS.md` C-04; FAQ and evidence page state it |
| F14 | Host-blind verifiable draw | **Not built** | n/a | `INTEGRATION_RESEARCH.md`; never claimed in UI |
| F15 | Independent shielded payment proof | **Not built** | n/a | UI says confirmations are self-reports |
| F16 | Calendar reminder (`.ics`) | **Not built** (optional) | n/a | listed in `KNOWN_LIMITATIONS.md` |

## Security assertions (PRD v1.0 section 12)

| # | Assertion | Status | Evidence |
|---|---|---|---|
| 1 | API never receives plaintext address, memo, wishlist, assignment edge, secret key or seed | **Tested** | SEC: all request bodies of a full exchange scanned; E-browser-security (wire); references reach the server only on ack/reveal, by the user's choice |
| 2 | A member cannot fetch or decrypt another's assignment | **Tested** | A-flow, SEC authorization matrix, U-C wrong-key |
| 3 | A compromised database alone does not reveal assignment edges; API metadata documented separately | **Tested** | SEC dump scans, schema column tests; `THREAT_MODEL.md` |
| 4 | No cross-group IDOR, forged acknowledgment, replayed draw, unauthorized reveal | **Tested** | A-flow (cross-group), SEC (replay, domain separation), A-payments-reveal |
| 5 | No secret fragment forwarded to another origin or logged | **Tested** | E-browser-security: URLs, headers, referrer, bodies, storage; only own origin contacted |
| 6 | Invalid address, transparent-only, unsupported network, stale quote block the send flow | **Tested** | U-Z, E-validation (each refusal), E-validation (stale quote, price outage) |
| 7 | Progress count cannot exceed members or increment twice | **Tested** | A-payments-reveal (concurrent duplicate acks; counter exactly once) |
| 8 | Acknowledgment labelled self-reported unless proof is checked | **Tested** | no `verified` state in shared state machine (U-S); UI copy; E-exchange asserts text |
| 9 | Screenshots, console, telemetry and video cannot expose seeds, complete secret links or keys | **Implemented** | private links hidden by default; no telemetry; E-exchange asserts no console errors; demo plan |
| 10 | Private-group info cannot be enumerated via public stats or guessable ids | **Tested** | 128-bit random ids; stats threshold and rounding (A-groups); 401 for unknown group vs wrong token (A-flow) |

## User journeys (PRD v1.0 section 7; master prompt journeys A to I)

| Journey | Status | Evidence |
|---|---|---|
| A. Create a group (validate fields; interrupted and repeated submissions) | **Tested** | E-validation; A-groups (idempotent create); pending-credential reuse in `CreateGroup.tsx` |
| B. Join (invite, name, wishlist, wallet, address, save link, return later) | **Tested** | E-exchange, E-validation (drafts survive reload), E-recovery |
| C. Wallet onboarding | **Implemented** | `WalletGuide.tsx`; E-a11y; device verification Blocked |
| D. Draw (eligibility, randomness, exclusions, atomic, redraw rules) | **Tested** | U-D, A-join-draw, A-groups (reset only before activity), E-a11y (confirm dialog) |
| E. View assignment | **Tested** | E-exchange, E-responsive |
| F. Send a gift (invalid address, quote, interrupted handoff, duplicates) | **Tested** (UI/URI) / **Blocked** (real send) | E-validation, `alreadyReportedSent` warning; real send R12 |
| G. Confirm receipt | **Tested** | A-payments-reveal, E-exchange |
| H. Reveal | **Tested** | A-payments-reveal, E-exchange (clock moved) |
| I. Recovery and deletion | **Tested** | E-recovery, A-groups (retention, delete), `docs/RECOVERY.md` |

## Recovery table (PRD v1.0 section 8)

| Scenario | Status | Where |
|---|---|---|
| Admin link lost, before draw (no magic recovery; backup) | **Tested** | E-recovery |
| Member link lost before / after draw | **Tested** | E-recovery, `RECOVERY.md` |
| Compromised bearer link (rotate token, re-seal, disclose residual) | **Tested** | A-payments-reveal, E-recovery |
| Member drops out (before: remove; after: manual exception) | **Tested** | A-join-draw |
| Wrong address or network | **Tested** | U-Z, E-validation |
| Memo unsupported or omitted | **Implemented** | copy fields + checklist; wallet behaviour Blocked |
| Under/overpayment | **Implemented** | recipient "Something's wrong" (count only); no settlement |
| Duplicate acknowledgment | **Tested** | A-payments-reveal |
| Multiple draw requests | **Tested** | A-join-draw |
| Rate-limit evasion and bot joins | **Tested** (limits, caps, ticket flow) / **Blocked** (live Turnstile) | A-groups, A-join-draw |
| Stale quote | **Tested** | E-validation |
| Timezone disagreement | **Tested** | U-S (DST and half-hour zones), A-join-draw (Auckland boundary) |
| Host inspects draw | **Implemented** (disclosed) | create/draw screens, privacy page |
| Wallet sync delays or reorg | **Implemented** (copy: recipient decides after the wallet confirms) | FAQ, `Receive.tsx` |
| Fake recipient acknowledgment | **Tested** (labelled self-report) | E-exchange |

## State machines (PRD v1.0 section 10)

| Item | Status | Notes |
|---|---|---|
| Group states | **Tested** | `packages/shared/src/states.ts` and SQL compare-and-swap; deviations in `DECISIONS.md` D-10 (`draft`, `paused`, `deleted` omitted; `reveal_eligible` derived) |
| Member states, sender and recipient as separate dimensions | **Tested** | D-09; sender on `members`, recipient on `ack_commitments` |
| Payment status without `externally_verified` | **Tested** | no such state exists |

## Data model and API (PRD v1.0 section 9)

| Item | Status | Notes |
|---|---|---|
| Tables `groups`, `members`, `assignments`, `ack_commitments`, `audit_events`, `stats`, `reveals` | **Tested** | `0001_init.sql`; column-shape tests; plus `rate_limits`, `human_tickets` |
| "Must not expose recipient ids, lookup patterns or row keys that reconstruct pairings" | **Tested** | SEC; roster rows contain only id, nickname, status |
| API routes (section 9.4) | **Tested** | All present; additions listed in `DECISIONS.md` D-20; `docs/API.md` |
| JSON schemas, headers, CORS, CSRF posture, errors, payload caps, retry semantics | **Tested** | `docs/API.md`; A-groups; E-browser-security |
| Bearer tokens never in query strings | **Tested** | A-flow |

## UX and design (PRD v1.0 section 11)

| Item | Status | Evidence |
|---|---|---|
| Palette, condensed display, readable body, mono for codes only | **Tested** (visual) | `styles/tokens.css`; screenshots under `tests/e2e/.artifacts/screens` |
| All required screens | **Implemented** | landing, create, admin save-link, host dashboard, invite, join, wallet setup, address validation, waiting room, draw review, assignment, payment review and instructions, acknowledgment, progress, dispute (count + flag), reveal, privacy, help (FAQ and guide), settings and recovery, stats, evidence, 404, error and expired-link states |
| 360 / 390 / 768 / 1024 / 1440 and the master prompt's 320 to 1920 plus landscape; no overflow, no hidden actions, 44px targets | **Tested** | E-responsive (12 viewports x 23 states) |
| Keyboard, visible focus, labels, dialogs, contrast, reduced motion, 200% text | **Tested** | E-a11y (axe WCAG 2.2 AA + best-practice; keyboard tests) |
| No footer on task flows; contextual navigation | **Implemented** | `AppLayout` has no footer |
| Real logo, favicon, social previews, route metadata, canonical URLs | **Implemented** | `index.html`, `usePageMeta`, `favicon.svg`, `manifest.webmanifest` (PNG icons and OG image: see `FINAL_AUDIT.md`) |
| Required copy lines (payment review, acknowledgment, secret-link) | **Implemented** | `Payment.tsx`, `Receive.tsx`, `LinkSaver.tsx` |

## Verification plan (PRD v1.0 section 13)

| Layer | Status | Evidence |
|---|---|---|
| Crypto known-answer vectors, wrong key, tamper, randomness, collisions | **Tested** | U-C |
| Draw 100k+ simulations, one cycle, exclusions, impossible cases, concurrency, host disclosure | **Tested** | U-D, A-join-draw |
| API authorization matrix, rate limits, fuzzing-style hostile input, schema errors, races | **Tested** | A-*, SEC |
| Data privacy: full database dump and HTTP trace after a complete flow; platform logs | **Tested** (dump, trace) / **Blocked** (platform logs: R09) | SEC |
| UI: five separate profiles, keyboard, responsive matrix | **Tested** | E-exchange, E-a11y, E-responsive |
| ZIP 321 official valid and invalid vectors, byte limits, round trip | **Tested** | U-Z |
| Wallet: Zodl iOS and Android, memo, amount, failure modes | **Blocked** | R01/R02 |
| Production: clean clone, deploy, cold start, real group | **Blocked** (deploy, real group) / **Tested** (`npm ci` path in CI file, local build) | `DEPLOYMENT.md` |
| Independent adversarial review | **Partial** | audit passes in `FINAL_AUDIT.md` (agent-assisted); no external reviewer |
| Submission: claims matched to tests and receipts | **Implemented** | `EVIDENCE.md`, `KNOWN_LIMITATIONS.md` |

## Research register (PRD v1.0 section 14)

| ID | Status | Detail |
|---|---|---|
| R01 / R02 | **Blocked** | Zodl iOS / Android scanning of Mummer's QR |
| R03 | Docs only | changelog evidence; no device |
| R04 | **Tested** | ZIP 316 decoder against official vectors |
| R05 | Open | organizer rules not researched |
| R06 | **Not built** | selective disclosure |
| R07 | **Not built** | host-blind draw; fallback shipped |
| R08 | **Not built** | company funding; deferred |
| R09 | Open | Cloudflare edge logging not inspected |
| R10 | **Tested** (in browser) / **Blocked** (device-loss) | E-recovery |
| R11 | Open | name and trademark not researched |
| R12 | **Blocked** | real group, real ZEC |

## PRD v0.1 items carried or resolved

| v0.1 item | Resolution |
|---|---|
| G1 host link in under two minutes; G2 guided first-timer; G3 one-scan gift; G4 counted not known; G5 sealed by default (a test scans stored rows); G6 80% completion | G4, G5 **Tested**; G1/G2/G3/G6 are usability targets **not measured** (no user study; no figures claimed) |
| Bounty milestones, Oct 4 dates, tweet, "5 real groups" | Dropped as dated or unmeasurable (`DECISIONS.md` C-06, C-13) |
| Remotion video | Plan only (`DEMO.md`) |
| Calendar file, passphrase backup | Backup **Tested**; calendar **Not built** |
| Stats counts only | **Tested** |
| Name collision fallback "Guiser" | Not researched |

## Additions made after the first matrix (hardening round)

| Capability | Status | Evidence |
|---|---|---|
| Host can change join and reveal dates before the draw | **Tested** | A-extend (`extend.test.ts`), `AdminPage.tsx` |
| Address commitments checked by the host and the giver | **Tested** | A-hardening, `DrawPanel.tsx`, `Payment.tsx` (the browser-side comparisons have no dedicated unit test) |
| Host-key fingerprint in the invite; mismatch blocks joining | **Tested** | E-validation |
| Draw pinned to the members version | **Tested** | A-join-draw, A-hardening |
| Credential conflict screen; link replacement saved before the request | **Tested** (conflict) / **Implemented** (replacement recovery, no automated test) | E-recovery |
| Totals-only host glass box | **Tested** | A-groups, SEC |
| Invisible and bidi characters rejected | **Tested** | U-S, U-Z |
| IPv6 /64 rate-limit buckets; production salt required | **Tested** | A-hardening |
| X25519 public key validation | **Tested** | A-hardening |
| Writes pinned to the validated draw, phase and commitment (replacement, sent, acknowledgment, reveal, leave, confirm) | **Tested** | A-interleaving (deterministic races; 13 of 18 fail on the pre-fix code) |
| Recipient-only reveals hidden from the host | **Tested** | A-payments-reveal, SEC |
| Link replacement under lost replies, refusals, refreshes, several tabs, revoked credentials and storage failures | **Tested** | E-link-replacement, E-storage-failure |
| Payment request refused for a removed recipient | **Tested** | E-review-fixes |
| Cleared dates handled in the create form | **Tested** | E-review-fixes |
| Page metadata, absolute social images, icons, links, no placeholder text | **Tested** | E-metadata |
