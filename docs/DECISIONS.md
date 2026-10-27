# Decisions and deviations

Dated 26 October 2026 unless noted. PRD v1.0 (revised) takes precedence over PRD v0.1 for security and architecture; v0.1 was read in full so that no useful requirement was silently dropped. Each entry gives the decision, the reason, and the alternatives considered. Section 2 lists every conflict between the two PRDs and how it was resolved.

## 1. Architecture and tooling

**D-01. One Cloudflare Worker serves both the static app and the API** (Workers static assets, `run_worker_first`), instead of Pages for the app and a separate Worker. Same origin removes CORS entirely (the API then needs no cross-origin allowances), lets every response, including static files, carry the same security headers, and gives one deploy artifact. *Alternative:* Pages + Worker (v0.1). Rejected for the extra origin and header split.

**D-02. npm workspaces monorepo** matching the PRD layout (`apps/web`, `workers/api`, `packages/{crypto,zcash,draw}`) plus `packages/shared` for schemas, limits, time and state machines used on both sides of the API.

**D-03. TypeScript pinned to 5.9.3.** 7.0.2 (the native port) was the registry's `latest` but is too new for the rest of the toolchain to be trusted. Revisit when Vite, Vitest and Hono types are known good.

**D-04. Dev-tooling overrides** pin `undici` 7.30.1 and `sharp` 0.35.5 (patched versions) because Wrangler and Miniflare pin vulnerable ones. They are dev-only; `npm audit` (full and `--omit=dev`) reports 0 vulnerabilities.

**D-05. Rate limiting in D1 rather than KV.** The PRD says "KV or equivalent". A D1 fixed-window counter is deterministic under test and needs no extra binding. Keys are salted hashes. *Trade-off:* a write per limited request; fine at this scale.

**D-06. Tests use Miniflare 4.20260730.0** (stable API) while Wrangler 4.152.0 brings its own newer beta Miniflare for `wrangler dev`.

**D-07. A separate E2E entry point** (`workers/api/e2e/index.ts`, `wrangler.e2e.toml`) provides a controllable server clock and a fixed price so browser tests can reach reveal day and never depend on a live price feed. Nothing under `src/` reads a test clock; production config never references the E2E entry.

**D-08. Security headers are applied in an outer wrapper**, not middleware. Found by testing against `wrangler dev`: Hono merges the previous response's headers over a replacement response set from middleware, so the asset layer's `Cache-Control` overrode ours. Hashed `/assets/*` are now `immutable`; HTML and API responses are `no-store`.

## 2. Conflicts between PRD v0.1 and PRD v1.0, and resolutions

| # | v0.1 | v1.0 | Resolution |
|---|---|---|---|
| C-01 | "Nobody, not the app and not the chain, can see who gave to whom"; "not even the host" after v1 | Trusted-host baseline; host-blindness only if a reviewed protocol exists; forbidden claims list | **v1.0.** Trusted-host draw, disclosed at creation, draw, privacy page and FAQ. Host-blind draw **not built**; absolute phrases do not appear. |
| C-02 | Delivery code in the memo is how the recipient "marks delivery" and counts it | Codes are not payment proof; recipient acknowledgment, labelled as a self-report | **v1.0.** Optional reference entry; acknowledgment recorded as `recipient_acknowledged` with a `reference_matched` flag; never called verified. |
| C-03 | ~50-bit typed code, 10 tries/hour | "High-entropy" independent confirmation tokens | **80-bit** reference (16 Crockford chars + check character), 10 wrong tries/hour. Strong enough that a plain salted SHA-256 commitment cannot be brute-forced offline. |
| C-04 | One QR may fund every member if Zodl supports multi-recipient | Zodl iOS rejects multi-recipient QR | **v1.0.** Single-recipient requests only. Company-pays **not built**. |
| C-05 | Reveal "with proof" by presenting the code | Consent-aware reveal; sender consent, recipient consent rules, nothing automatic | **Both:** the giver proves they held the assignment with the reference, chooses audience (recipient-only or group), and the pair is shown as agreed by both only after the recipient confirms. Guessing is private (local only). |
| C-06 | Join deadline and October bounty milestones | Past dates removed | **v1.0.** No bounty claims. |
| C-07 | KV for rate limits | KV or equivalent | D1 (D-05). |
| C-08 | Delivery counted per person on the server | Aggregates only; do not expose per-member acknowledgment events | **v1.0.** Group progress is counts; no endpoint lists who sent or confirmed. |
| C-09 | Group states Open to Closed with a redraw loop | `draft, open, locked, drawn, active, reveal_eligible, closed, deleted`, plus `paused`, `needs_resolution` | **See D-10.** |
| C-10 | Pseudonyms and counts visible; dates by day | Same plus audit events without secrets | Both. Stored times are UTC day buckets. |
| C-11 | Min 4 members; host screen recommends 5 | 4 to 50, 5+ recommended | Both: draw needs 4; the UI says why 5 is better. |
| C-12 | Passphrase backup is v1 | Locally encrypted backup for admin recovery | Both: argon2id + secretbox backup for admin and member links. |
| C-13 | Remotion video, bounty tweet | Evidence-led demo; no fabricated footage | **Prepared as a plan only** (`docs/DEMO.md`): no footage exists, none is faked, nothing is published. |
| C-14 | "Zodl first"; Ironwood wording | Wallet claims need tests | Zodl named as the reference wallet; no capability beyond docs is claimed (see `INTEGRATION_RESEARCH.md`). |
| C-15 | Three runtime libraries | Not restricted | More are used where each is audited (zod, hono, react, router). Cryptographic code uses only audited libraries. |
| C-16 | Commit per task | **Commit each changed file separately, no co-author trailers** | Master build prompt asks for "logical commits"; the PRD's stricter per-file rule is followed (D-17). |

## 3. Product and protocol decisions

**D-09. Member status vs. sender/recipient dimensions.** `members.status` is `ready | assigned | removed | revoked`; sender state lives on the member row; recipient state lives in `ack_commitments`. They are separate dimensions, as the PRD requires. "Joined" and "ready" are collapsed: a person is created `ready` at the moment their sealed profile is stored, because the server cannot know earlier. `removed` is reserved; pre-draw removal deletes the row (frees the name), post-draw removal uses `revoked`.

**D-10. Group states.** Stored: `open, locked, drawn, active, needs_resolution, closed`. Omitted: `draft` (creation is atomic), `paused` (the PRD defines no behaviour for it; `needs_resolution` covers failures), `deleted` (deletion removes rows). `reveal_eligible` is **derived from the clock**, so no cron is needed for the reveal date to take effect. `drawn` becomes `active` on the first payment activity (a self-reported send, an acknowledgment, or a problem report), which is exactly the point after which a clean redraw is refused, per PRD section 7.3 step 6.

**D-11. Draw algorithm.** Sattolo over rejection-sampled integers; exclusions by rejection sampling over cycles (uniform over valid cycles), falling back to a bounded randomized search that is labelled non-uniform; impossibility is claimed only if an exhaustive search completes. Exclusions never leave the host's browser.

**D-12. Commitments are plain salted SHA-256 over an 80-bit reference**, not HMAC with a server pepper, so the operator never needs (or sees) a reference unless a person submits one.

**D-13. Client-generated bearer tokens.** The browser generates the 256-bit token and sends only its hash at creation/joining. This also makes creation and joining idempotent on the credential hash (retry safe).

**D-14. Address policy.** Accepted: mainnet unified addresses (Revision 0 `u1`, Revision 2 `zu1` and `tu1`) with an Orchard or Sapling receiver; mainnet Sapling `zs1`. Rejected with a reason: transparent `t1/t3`, `tex1`, Sprout, test networks, UAs with no shielded receiver, malformed or expired addresses. A UA that **also** contains a transparent receiver is *accepted with a warning* (compliant wallets prefer the shielded receiver; refusing would block users of common wallets). Mainnet only; test-network addresses are refused in every environment.

**D-15. Payment amounts** are exact: USD budget in integer cents, ZEC in bigint zatoshis, quote rounded half-up to 4 decimals with a one-step floor, via a first-party price proxy that parses the provider's JSON text without floating point and fails closed. Quotes expire after 10 minutes; the request is hidden until refreshed.

**D-16. Reveal design.** Giver declares `{recipient, reference, audience}`; the server checks the reference against the recipient's commitment (rate limited, uniform error for unknown person vs wrong reference); `reveals` is the only table linking a giver to a recipient and is written only on such a declaration. The recipient can confirm. Guesses are local-only (not stored server-side) to minimise data.

**D-17. Commit policy.** One commit per changed file with a descriptive message (`scripts/commit-files.sh`, `scripts/commit-auto.sh`), and no co-author or attribution trailers (also recorded as a standing user instruction).

**D-18. Human check.** Cloudflare Turnstile runs in a sandboxed (`sandbox="allow-scripts"`, opaque-origin) iframe at `/human-check`, the only page allowed to load a third-party script. Its token is exchanged at `/api/human/verify` for a single-use, ten-minute ticket stored hashed, consumed by creation and joining *after* validation so a typo does not burn it. In production the check is required and **fails closed** if no secret is configured. Real Turnstile has not been exercised against Cloudflare in this environment (no account or site key): see `docs/KNOWN_LIMITATIONS.md`.

**D-19. CSP.** `script-src 'self' 'wasm-unsafe-eval'`. The latter is required to instantiate libsodium's WebAssembly; it does not enable JavaScript `eval`. No `unsafe-inline`, no third-party origins in the app policy.

**D-20. API additions beyond PRD section 9.4**, each with tests: `GET /api/groups/:id/invite` (public join info), `POST .../members/:mid/sent`, `.../rotate`, `.../leave`, `POST .../transition`, `GET .../glassbox`, `POST /api/human/verify`, `GET /api/config`, `GET /api/health`, reveals `POST/GET/confirm`. `POST /api/groups/:id/revoke` is realised as `DELETE .../members/:mid` (host) and `POST .../rotate` (member), covering both the admin and the verified-rotation cases.

**D-21. Stats** are privacy-thresholded: hidden until at least 5 exchanges exist, and rounded down to multiples of 5. Counters carry no group or person identifiers and survive deletion.

**D-22. Unknown URLs** return an HTTP 404 while still serving the app shell so the in-app not-found page renders.

**D-23. Address commitment.** Each join sends `SHA-256` over length-prefixed (group id, NFC nickname, address). The host's browser checks every opened profile against it and the giver's browser checks the roster entry before rendering a payment request. Purpose: detect a database-only swap. Cost: the hash could confirm a guessed address; accepted and documented.

**D-24. Host-key fingerprint in the invite** (`#hk=<public key>`). The joiner's browser compares it with the key the server returns. A mismatch blocks joining; absence only warns, because hand-typed or older links must still work.

**D-25. Members version.** `groups.members_version` increments on join, removal and rotation; the draw request carries it and the compare-and-swap includes it, so a roster that changed after the host read it cannot be drawn.

**D-26. Glass box shows totals only.** Per-person sent and confirmed states are stored but not shown to the host, to avoid narrowing the pairing.

**D-27. Credential conflicts.** A private link whose key differs from the key saved on the device is never applied silently. A link replacement is saved locally before the server is asked, so a lost response is recoverable.

**D-28. Invisible and bidi characters** (U+200B to 200F, 202A to 202E, 2060 to 2064, 2066 to 2069, FEFF) are rejected in nicknames, titles, wishlists and memos.

**D-29. Extend dates.** The host may change join and reveal dates before the draw; extending a locked group reopens it.

**D-30. Writes are pinned to the state they validated.** Link replacement, "sent", acknowledgment, reveal and leave check state in a handler and then write in a batch. Each write now repeats the checked facts in its own SQL (draw version, an open phase, the commitment that was matched, the assignment situation) and checks the affected-row count, answering `409` for a stale request and treating an already-applied repeat as success. Found by the 27 October review; reproduced with deterministic interleaving tests (`workers/api/test/interleaving.test.ts`) before being fixed.

**D-31. Private reveals stay private from the host.** The glass box and the ordinary listing apply the same audience rule. The host sees only reveals shown to the whole group, plus a count of private ones.

**D-32. A link replacement needs a durable copy first.** The new key is written to this device and read back before the server is asked, kept until the real record is saved, adopted later only if the server accepts that token, and held in memory (with the link shown for saving) if storage fails. A browser that will not store it is refused up front and the old link keeps working.

**D-33. Recovery never silently drops a key.** Restoring with storage blocked carries the credentials in the destination fragment; a chosen link that cannot be stored is used from memory and its fragment is kept.

**D-34. The CSP drops `upgrade-insecure-requests` only for plain-HTTP loopback.** WebKit applies the directive to http://127.0.0.1 and then fails every subresource. Responses over HTTPS (all of production) carry the full policy; nothing else changes.

**D-35. Zod runs without just-in-time compilation** so a CSP that forbids `eval` is not reported as violated by its feature probe.

**D-36. Absolute social image URLs** are completed by the Worker from the request origin, because the deployed origin is not known at build time.

## 4. Scope not delivered (explicit)

Host-blind draw (F14), independent shielded payment proof (F15), company-funded mode (F13), real-wallet verification (R01 to R03, R12), and any third-party review. See `docs/KNOWN_LIMITATIONS.md` and `docs/EVIDENCE.md`.
