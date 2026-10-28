# ZECATHON submission package (Wildcard)

**Nothing here has been submitted.** This is the text, links and evidence for the submission form, prepared for the owner to paste in. The owner decides whether and when to submit.

**What could not be checked.** The official rules, the Wildcard track description, the form fields, the video-length limit and the licence requirements are behind the ZECATHON sign-in (`thezecathon.com` shows only that rules and the form exist after login). Nothing below is a claim about what the rules require. The deadline, **28 October 2026, 23:59 UTC**, is the owner's statement. Before submitting, compare the "Required materials" table at the end with the real form.

## Title

**Mummer**

## Tagline

A Secret Santa where the gifts are small shielded Zcash payments, sent from people's own wallets. Mummer never holds the money.

## Short description (about 40 words)

Mummer organizes a Secret Santa where each gift is a shielded Zcash payment sent from the giver's own wallet. Names are drawn in the host's browser, assignments are sealed to each giver, and Mummer never holds money or sees addresses in the clear.

## Description

Gift exchanges have a privacy problem. On most blockchains every payment is public, which spoils a secret gift. Collecting everyone's payment details in a group chat leaks them. And the organiser ends up chasing "did yours show up?" with no honest way to know.

Mummer is a noncustodial organiser built around shielded Zcash:

1. **A host starts an exchange**: a name, a budget, two dates and one invite link.
2. **Everyone joins** with a nickname, an optional wishlist and a fresh shielded address from their own wallet. Mummer checks the address with a real ZIP 316 decoder and refuses transparent, testnet and malformed addresses with a reason. The wishlist and address are sealed in the browser before anything is sent; the nickname is visible to the group and to Mummer's server.
3. **The host's browser draws the names** as a single cycle, so nobody draws themselves, and seals each person's assignment so only that person can open it.
4. **Each giver sees a ZIP 321 payment request**: a QR, plus address, amount and memo as copyable fields, with a checklist for the moment of approval. The giver's own wallet shows the request and the giver approves and sends. Mummer never touches funds.
5. **Recipients report what arrived, and on reveal day givers may choose to unmask.** These are self-reports. Mummer cannot see a shielded payment and never labels anything "verified".

Mummer is aimed at small groups: friends, families, teams.

## Architecture

- **Monorepo** (npm workspaces, TypeScript): `packages/zcash` (ZIP 316 addresses, ZIP 321 requests, 512-byte memos, exact zatoshi arithmetic), `crypto`, `draw`, `shared`; `apps/web` (React 19, Vite); `workers/api` (Cloudflare Worker, Hono, D1); `workers/human-check` (separate Worker).
- **Cloudflare free tier.** One Worker serves the built app and the API; D1 holds the data; a daily cron purges expired data. A second Worker on its own origin hosts the Cloudflare Turnstile human check, so Cloudflare's script never runs on an origin that holds private-link keys. The app accepts check results only from that exact origin, and the server accepts a token only if Cloudflare says it was solved on the check host.
- **Client-side cryptography** (libsodium sealed boxes, padded blobs, context binding). Private links keep their keys in the URL fragment, which browsers do not send to servers. Tokens are stored only as hashes. Backups use Argon2id.
- **Concurrency.** Every write is pinned to the state it validated (SQL predicates plus row-count checks), with deterministic race tests.
- **Strict security headers.** No inline script, no eval, no third-party origin on app pages, rate limiting, retention purge, masked diagnostics, logging disabled.
- **Price.** CoinGecko, then Kraken as a fallback. It fails closed: with no price there is no payment amount.

Details: `docs/ARCHITECTURE.md`, `docs/CRYPTOGRAPHIC_DESIGN.md`, `docs/PRIVACY_ARCHITECTURE.md`, `docs/DECISIONS.md` (decisions D-1 to D-39).

## Privacy model (what is and is not hidden)

**Protected, and tested by scanning every request and every stored value:**
- Mummer's server and database cannot read addresses, wishlists or pairings; they hold sealed blobs of identical padded length, hashes and day-level dates. They **can** read the exchange name, nicknames, budget, dates, counts and request metadata (IP address, timing), as `docs/THREAT_MODEL.md` states. When a recipient types the memo reference to confirm a gift, that reference is sent to the server for a hash comparison; the server never learns which giver it belongs to.
- The host's "glass box" page shows exactly what the server stores, as sizes and fingerprints.
- Reveals are consent-gated; public statistics are thresholded.

**Not protected (stated in the app and in the repository):**
- ****An earlier version leaked pairings through stored sealed-blob lengths; that is fixed (see above), but the fix is days old and has had no independent review.** The draw is trusted-host.** The host's browser opens everyone's details to run the draw and could see who draws whom. A host-blind draw was not built. The app offers "I'm only organizing" so the host need not play.
- A malicious operator who serves altered JavaScript could read secrets or swap addresses. The host-key fingerprint in the invite detects a swapped host key, and each address commitment lets the host and giver notice a profile changed in isolation, but the commitment is a public hash with no member signature behind it: someone who can write to the database can replace a profile and its commitment together without detection. Neither protects against altered JavaScript.
- Hosting and network providers see connections. In groups under five people, deduction leaks.
- "Sent" and "received" are self-reports; no independent proof of payment.

Banned wording in all copy: "anonymous", "untraceable", "verified payment", "even the host can't see".

## Links

| | |
|---|---|
| Live app | https://mummer.mummer-app.workers.dev |
| Repository | https://github.com/TheWeirdDee/mummer (public, MIT licence) |
| Demo video | *To be added by the owner after upload (see `docs/DEMO_VIDEO.md`)* |
| Staging copy (Cloudflare public test keys, for automated journeys) | https://mummer-staging.mummer-app.workers.dev |

## Technical evidence

Run history and the runs that were not clean: `docs/EVIDENCE.md`. Summary:

| Check | Result |
|---|---|
| Type check | Clean |
| Unit, API (real D1), race and security tests | 409 passed (21 files) |
| Browser tests, Chromium | 76 passed in one command |
| Firefox and WebKit | Browser-security specs pass; the six-person journey fails in WebKit on this machine (unresolved, see below) |
| Accessibility (axe-core) | No violations on every route and key state, 390 and 1280 px, three browsers, and on nine live pages of both deployments |
| Responsive | 12 viewports, 320 to 1920 px, disclosures closed and open |
| ZIP 316 | Official test vectors (60 Rev 0, 60 Rev 2, F4Jumble) |
| ZIP 321 | Specification examples; output also parsed by the reference Rust `zip321` crate (3 checks) |
| Live production | Read-only suite passed; headers, CSP, framing rules, 404s, social image, price, health |
| Live staging | Full journey (create, join, draw, assignment, payment request, sent, confirm, recover, delete) passed in a real browser |
| Real Turnstile on production | A person completed the real challenge and created an exchange; the production database holds 2 exchanges and 0 members (read-only count, 28 Oct 2026). **Joining with the real challenge has not been recorded yet** |
| Privacy audits | Two audits on 28 October 2026. A deployed-instance scan found no secret on the wire, no third-party origin beyond the human-check host and Cloudflare's challenge, and no cross-person data in 55 replays; it also found a wording over-claim (corrected). An **independent audit found a critical leak the first one missed**: sealed-blob lengths (256-byte buckets) let a database observer match every giver to a recipient when wishlists differed in length. It was fixed the same day (one fixed 4096-byte size for every sealed payload), deployed to staging and production, and re-verified live: all sealed blobs on the wire have one length. Limits and findings: `docs/PRIVACY_RELEASE_AUDIT.md`, decision D-40 |
| Dependencies | `npm audit` reports 0 vulnerabilities |
| Fresh mainnet address | A new mainnet unified address (Orchard and Sapling receivers only) was made with the Zcash Foundation's maintained `zcash_keys` 0.17 crate from a throwaway in-memory seed that was never printed or stored (`tools/test-address`). It is accepted by Mummer's address policy and has never been funded |

A defect found only by deploying, and fixed: Turnstile never produces a token inside a sandboxed, opaque-origin frame (not even Cloudflare's always-pass key). The check moved to its own Worker on a separate origin (decision D-37). Three smaller deployment defects (a price source answering 403 to Workers, the test-key hostname, a spoofed test header refused by Cloudflare) were also fixed, each with a test that fails without the fix.

## Limitations to disclose

- **Real Zodl compatibility is unverified.** No phone with Zodl was available. The app never claims that a scan prefills a wallet and always offers copy buttons. A 10 to 15 minute no-money test is in `docs/ZODL_MANUAL_TEST.md`.
- **No real shielded payment has been executed**, on mainnet or testnet. Testnet tooling (`zcash-devtool`) was not built. Nothing in this project has been described as a verified payment.
- The draw is trusted-host. Host-blind draw, independent payment proof, company-funded mode and a calendar file were not built.
- The WebKit six-person journey does not pass on the development machine (low free memory during the runs; cause not established). The Chromium and Firefox results are unaffected.
- Reveal day cannot be exercised on a live deployment (the clock cannot be moved there); it is covered by tests with a controllable clock.
- No independent security review, no manual screen-reader pass, no real-device iOS or Android run, no trademark clearance for the name "Mummer".
- Whether Cloudflare Workers Logs are off in the dashboard has not been confirmed visually. The deployment configuration disables them and the API shows no log destination, no log push and no tail consumers.

Full list: `docs/KNOWN_LIMITATIONS.md`, `docs/FINAL_AUDIT.md`.

## Required materials (compare with the real form)

| Material | Status |
|---|---|
| Project title, tagline, descriptions | Above |
| Public repository with licence | Done (GitHub, MIT) |
| Live URL | Done |
| Architecture and privacy explanation | Above, plus `docs/` |
| Demo video | Recorded from the real app; upload and link are the owner's step (`docs/DEMO_VIDEO.md`) |
| Real-wallet or on-chain evidence | **None.** Disclosed above |
| Any field, track statement or rule not listed here | **Unknown**: the official rules are behind the sign-in |

## Before the owner submits

1. Sign in to ZECATHON, read the rules and the Wildcard description, and compare them with the table above.
2. Upload the video, paste its link above, and paste the text sections into the form.
3. Delete throwaway exchanges on production (host page, "Delete the exchange").
4. Optional but valuable: run the Zodl scan test and, only with the owner's explicit approval and a spending limit, a small real payment. Do not describe either as done until it is.
