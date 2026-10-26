# API reference

Base path `/api`. JSON in and out. Source of truth: `workers/api/src/routes/*.ts` and the Zod schemas in `packages/shared/src/schemas.ts`.

## Conventions

- **Authentication.** `Authorization: Bearer <token>` where the token is the 43-character base64url value from a private link. Tokens are never accepted in query strings or cookies. There are **no cookies** and **no CORS headers**; the API is same-origin only.
- **Roles.** *Host* = admin token of the group. *Member* = a member's own token. Authorization is checked on the server for every route, before body or state logic. An unknown group, an unknown member and a wrong token are indistinguishable: `401`.
- **IDs.** 32 lowercase hex characters (128 bits), random.
- **Errors.** `{ "error": { "code": "<code>", "message": "<plain language>" } }`. Codes: `bad_request` (400), `unauthorized` (401), `forbidden` (403), `not_found` (404), `conflict` / `invalid_state` / `group_full` / `join_closed` / `duplicate_pseudonym` / `draw_already_done` / `draw_mismatch` (409), `payload_too_large` (413), `validation_failed` / `reference_mismatch` (422), `rate_limited` (429), `human_check_failed` / `reveal_not_open` (403), `quote_unavailable` (503), `internal` (500, generic, no details).
- **Validation.** Zod, strict (unknown fields rejected). Bodies are capped at 96 KiB, enforced while streaming.
- **Idempotency.** Create and join are idempotent on the credential hash; the draw requires an `Idempotency-Key` header (16 to 64 URL-safe characters); acknowledgment, sent, reveal and rotate are idempotent or compare-and-swap.
- **Caching.** API responses are `Cache-Control: no-store`.
- **Logging.** No request bodies, tokens, addresses or client addresses are logged.
- **Time.** Dates are `YYYY-MM-DD` in the group's IANA timezone; instants are ISO 8601 UTC. Stored member-level times are UTC days.

## Public

| Method and path | Purpose |
|---|---|
| `GET /health` | `{ok, environment, commit, time}` |
| `GET /config` | `{humanCheckRequired, turnstileSiteKey, environment, commit}` (no secrets) |
| `GET /price` | `{usdPerZec, asOf, validUntil, source}`. USD per ZEC as an exact decimal string, cached 60 s, valid 10 min, **fails closed** (`503 quote_unavailable`). 60 requests/min per client. |
| `GET /stats` | `{available:false, reason}` until 5 exchanges exist, then `{available:true, roundedDownTo:5, groups, members, giftsAcknowledged}` |
| `POST /human/verify` | Body `{token}` (Turnstile). Returns `{required, ticket, expiresInSeconds}`. In production with no secret configured: `403`. 30/hour per client. |
| `GET /groups/:gid/invite` | Public join information: title, budget (cents), dates, timezone, cap, `hostPlays`, `hostPublicKey`, `state`, `joinOpen`, `spotsLeft`, `joinClosesAt`. 60/min per client. No member data. |

## Create and join

| Method and path | Auth | Body → result |
|---|---|---|
| `POST /groups` | human ticket (production) | `{title, budgetCents (500..25000), joinDeadline, revealDate, timezone, memberCap (4..50), hostPlays, hostPublicKey, adminTokenHash, humanTicket?}` → `201 {groupId}`; the same body again → `200 {groupId}`; same credentials, different body → `409`. 10/hour per client. |
| `POST /groups/:gid/members` | human ticket (production) | `{pseudonym (2..32), publicKey, tokenHash, sealedProfile, humanTicket?}` → `201 {memberId}`; replay → `200`. Capacity and "still open" are enforced inside the `INSERT`. Names unique case-insensitively (NFKC). 20/hour per client. |

## Host

| Method and path | Purpose |
|---|---|
| `GET /groups/:gid` | Overview (also readable by members): config, state, `drawVersion`, roster `{id, pseudonym, status, addressCommitment}`, aggregate `progress` `{ready, assigned, reportedSent, acknowledged, needsAttention}`; members also get `me`. |
| `GET /groups/:gid/profiles` | Sealed profiles for the draw, with `membersVersion` and each `addressCommitment`. Only before the draw. |
| `POST /groups/:gid/extend` | `{joinDeadline, revealDate}`. Only while `open` or `locked`; validated like create; extending a locked group reopens it; one audit event `dates_changed`. |
| `POST /groups/:gid/draw` | `{drawVersion, membersVersion, closeEarly?, bundles:[{memberId, sealedBundle}], commitments:[{memberId, commitment}]}` + `Idempotency-Key`. Validates that bundles and commitments cover **exactly** the ready members; commits state, bundles, commitments and audit event in one atomic batch whose first statement is a compare-and-swap. `201 {drawVersion, replay:false}`; same key replay `200 {replay:true}`; a second draw `409 draw_already_done`. |
| `POST /groups/:gid/transition` | `{action}`: `lock`, `reopen`, `reset_draw` (only in `drawn`; deletes assignments, commitments and reveals), `flag_resolution`, `clear_resolution`, `close`. |
| `DELETE /groups/:gid/members/:mid` | Before the draw: deletes the member. After: revokes the token, deletes the assignment, flags `needs_resolution`. |
| `GET /groups/:gid/glassbox` | Every row held for the group, with sealed values reduced to length + fingerprint. Sent and confirmed states appear only as totals, never per person. |
| `DELETE /groups/:gid` | Deletes everything (cascade). |

## Member

| Method and path | Purpose |
|---|---|
| `GET /groups/:gid/members/:mid/assignment` | `{drawVersion, sealedBundle}` for that member only. Never logged. |
| `POST .../sent` | `{drawVersion}`. Giver's self-report; idempotent; moves `drawn` to `active`. |
| `POST .../ack` | `{drawVersion, outcome: "received"|"problem", reference?}`. Recipient only. A wrong well-formed reference is `422 reference_mismatch` and counts against 10/hour; a malformed one is `422 validation_failed` and does not. Returns `{recipientState, referenceMatched}`. Idempotent; a concurrent duplicate increments the public counter once. |
| `POST .../rotate` | `{newTokenHash, newPublicKey, newSealedBundle?}`. Replaces a possibly leaked credential; the bundle must be re-sealed if one exists; compare-and-swap on the current token hash. |
| `POST .../leave` | Self-removal (same semantics as host removal). |
| `POST /groups/:gid/reveals` | `{drawVersion, recipientId, reference, audience: "recipient"|"group"}`. Only after the reveal instant; reference must match the recipient's commitment. `201`, replay `200`, a different second reveal `409`. |
| `POST /groups/:gid/reveals/:giverId/confirm` | The named recipient confirms. |
| `GET /groups/:gid/reveals` | Reveals visible to the caller (group-audience, or those involving the caller). |

## State machines

Group: `open → locked → drawn → active → closed`; plus `drawn → locked` (reset), `needs_resolution ↔ active`, any live state → `closed`. `reveal_eligible` is derived from the clock. Recipient: `not_acknowledged → recipient_acknowledged | disputed`, `disputed → recipient_acknowledged`. There is **no** `verified` state anywhere.

Invalid transitions return `409 invalid_state`; every transition is a compare-and-swap in SQL, so concurrent requests cannot both win.

## Rate limits

Fixed-window counters in D1 keyed by salted hashes of client address and scope: create 10/h, join 20/h, human verify 30/h, invite 60/min, price 60/min, wrong acknowledgment or reveal references 10/h per person. Production relies on Cloudflare's `CF-Connecting-IP`, which clients cannot spoof there.
