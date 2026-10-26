# Architecture

```
                         ┌───────────────────────────────────────────────┐
  Browser (React, Vite)  │  Cloudflare Worker (Hono)  ── one deployment   │
  ─────────────────────  │  ───────────────────────────────────────────  │
  keys, sealing, draw,   │  /api/*  routes + validation + authorization   │
  QR, validation  ◀────▶ │  everything else → static assets (SPA)         │
                         │  security headers on every response            │
   wallet (outside) ···  │  D1 (SQLite): sealed blobs, hashes, counters   │
                         └───────────────────────────────────────────────┘
```

Gifts never touch Mummer: the giver's own wallet signs and sends a shielded payment to the recipient's wallet. Mummer builds and displays the request and records what people *say* happened.

## Packages

| Package | Responsibility | Depends on |
|---|---|---|
| `packages/shared` | Zod schemas (API boundary and sealed payloads), limits, state machines, timezone and date logic, response types | `zod` |
| `packages/crypto` | X25519 keys, sealed boxes with padding and context binding, bearer tokens, 80-bit gift references, link-fragment codec, argon2id passphrase backup, draw packaging and assignment opening | libsodium, `@noble/hashes`, `@scure/base`, shared |
| `packages/zcash` | ZIP 316 address decoding and gift-address policy, ZIP 321 request builder, parser and verifier, memo builder (UTF-8 byte limits), exact ZEC arithmetic and USD quoting | `@noble/hashes`, `@scure/base` |
| `packages/draw` | Unbiased CSPRNG sampling, Sattolo cycle, exclusions with bounded search, independent validator | none |
| `workers/api` | Hono app, D1 schema, routes, rate limiting, price proxy, human-check tickets, retention purge, E2E entry | all packages |
| `apps/web` | React app: marketing pages, create, join, host dashboard, participant page, recovery | all packages |

Module boundaries match the master prompt's list: group management (`routes/groups.ts`), member registration and identity (`routes/members.ts`, `db.ts`), cryptographic keys and profile encryption (`packages/crypto`), assignment generation (`packages/draw` + `DrawPanel`), payment requests (`packages/zcash` + `Payment.tsx`), acknowledgment (`routes/members.ts`), reveal (`routes/members.ts`, `Reveal.tsx`), recovery (`Account.tsx`, `Recover.tsx`, `LinkSaver.tsx`), statistics (`routes/public.ts`), infrastructure (`security.ts`, `ratelimit.ts`, `services.ts`).

## Data model

`workers/api/migrations/0001_init.sql`. Tables: `groups`, `members`, `assignments` (by giver), `ack_commitments` (by recipient), `reveals` (the only pair table; consent-gated), `audit_events`, `stats`, `rate_limits`, `human_tickets`. Foreign keys cascade from `groups`, so deleting a group removes everything attached. `assignments`, `ack_commitments`, `members` and `reveals` are `WITHOUT ROWID` so rows are stored in key order, not insertion order. See `docs/PRIVACY_ARCHITECTURE.md`.

## State machines (see `docs/DECISIONS.md` D-09, D-10)

Group: `open → locked → drawn → active → closed`; `drawn → locked` redraw (only before payment activity); `needs_resolution ↔ active`; `reveal_eligible` derived from the clock. Member: `ready → assigned | revoked`; sender state `not_started → user_reports_sent`; recipient state `not_acknowledged → recipient_acknowledged | disputed`. No `verified` state exists. Every transition is a compare-and-swap in SQL; invalid transitions are `409`.

## Request pipeline

1. The outer wrapper (`app.ts`) calls the inner Hono app, then applies security headers to the **final** response (see D-08).
2. Inner app: deps (clock, human check, price) are injected so tests are deterministic.
3. Route: authorize (constant-time token hash compare, scoped by group and member id) → validate (Zod, size-capped stream) → rate limit where public → act in a single `D1.batch` (atomic) with conditional statements → respond with generic errors only.

## Front end

React 19, `react-router-dom` 7, no state library. Pages that handle keys are code-split so libsodium's WebAssembly (about 158 KB gzipped) is never downloaded on public pages (entry bundle about 92 KB gzipped). All fonts and assets are first-party. Design system: tokens (`styles/tokens.css`), base, components, layout and page styles; the visual language is an original masquerade / archival-poster look (paper, ink, wax red, pine, gold; Anton, Newsreader, Inter, IBM Plex Mono, all OFL and self-hosted). Motion is limited to a one-time wax-seal stamp, a slow decorative ring rotation and a short rise-in, all disabled under `prefers-reduced-motion`.

## Failure behaviour

| Failure | Behaviour |
|---|---|
| Price source down or response malformed | `503 quote_unavailable`; the payment request is hidden; retry offered |
| Quote older than ten minutes | Request hidden until refreshed |
| Human check unavailable in production | Create/join refused (fails closed) |
| Network failure | `ApiError('network')` with a retryable message; retry works from an error state |
| Duplicate submissions | Idempotent (create, join, draw, acknowledgment, sent) |
| Concurrent draw | Exactly one wins |
| Draw payload not matching ready members | `409 draw_mismatch`; host reloads and redraws |
| Credential rotated elsewhere | The old token returns `401`; the page explains |

## Testing layers

See `docs/TESTING.md`.
