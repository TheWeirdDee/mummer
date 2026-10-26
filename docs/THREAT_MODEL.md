# Threat model

Scope: the Mummer web app and API as implemented in this repository. Wallet software, the Zcash network and the user's device are out of Mummer's control; where they matter, the limit is stated.

**Assets.** Wallet receiving addresses; wishlists; the pairing (who gives to whom); gift references; private links, keys and tokens; membership and timing metadata; acknowledgment and "sent" states.

**Trust model (baseline, shipped).** *Trusted host*: the host's browser performs the draw and could observe pairings. Mummer's server is *honest-but-curious* with respect to data at rest: sensitive fields are sealed, but the operator sees request metadata and serves the code. See "Residual risk" for the operator who is not honest.

## Adversaries

Each row: what they can reach, attacks considered, boundaries that hold, mitigations implemented, what remains, and the test that backs it.

### 1. Public ledger observer

- **Can see:** that shielded transactions occurred, times, fees.
- **Attacks:** timing correlation (many payments near the reveal date); linking a funded address to an exchange.
- **Boundary:** Mummer puts nothing about the exchange on the ledger. Payments are shielded and addresses must be shielded-capable.
- **Mitigation:** transparent, TEX, Sprout and test-network addresses are refused; wallet guide recommends fresh addresses and staggering sends.
- **Remaining:** timing and the act of funding a wallet are visible. Mummer cannot hide them.
- **Tests:** `packages/zcash/test/address.test.ts` (refusals).

### 2. Application operator (Mummer's API and database)

- **Can see:** group name, nicknames, budget, dates, counts, sealed blobs and their sizes (bucketed), token hashes, commitments, request metadata (IP, timing, paths).
- **Attacks:** read the database; correlate sealed bundles with acknowledgments; infer pairings from row order or timestamps; learn addresses.
- **Boundary:** no plaintext address, wishlist, memo, secret key, or pairing is ever received or stored.
- **Mitigations:** client-side sealing; assignments keyed by giver and commitments keyed by recipient with no linking column; `WITHOUT ROWID` tables and id-sorted submission so storage order carries no cycle information; day-bucketed timestamps; group-level audit events only; progress is aggregate-only so counts cannot be differenced to a person; bundle fetches are never logged.
- **Key substitution:** the invite carries a fingerprint of the host's public key (`#hk=`), which the joiner's browser compares with what the server returns; a mismatch blocks joining. Each join also stores an **address commitment** (hash over group, nickname and address) that the host and the giver re-check, so a database writer who swaps a sealed profile or roster entry is detected. Neither helps against an operator who serves altered JavaScript, and an invite without the fingerprint only produces a notice.
- **Remaining:** IP address and request timing at the network edge; a **malicious** operator can serve altered JavaScript and capture secrets or substitute addresses (anonymous sealing allows forging a profile for the host key). A "bundle fetched then acknowledged soon after" correlation is possible for an operator who logs timing; Mummer does not log bundle fetches, but cannot prove the platform does not.
- **Tests:** `tests/security/privacy-and-abuse.test.ts`: whole-exchange request/response/database scans for addresses, wishlists, references, tokens and keys; only the consented `reveals` table links two members; timestamps are day buckets; audit events are group-level.

### 3. Hosting and network providers

- **Can see:** connections, timing, volume, TLS metadata.
- **Boundary:** contents are TLS-protected and secrets are in URL fragments, which browsers do not send.
- **Mitigations:** `Referrer-Policy: no-referrer`; HSTS; no third-party requests on any page; fragments stripped from the address bar after saving; tokens only in `Authorization` headers.
- **Remaining:** platform logs are outside Mummer's control and were not inspected (R09 open). The privacy copy claims nothing beyond "they can see that you connected".
- **Tests:** `tests/e2e/browser-security.spec.ts`: no secret in any URL, header, referrer or body; no third-party origin contacted.

### 4. Malicious host

- **Can see:** every nickname, wishlist and address; the pairings during the draw.
- **Attacks:** record or leak pairings; refuse to draw; manipulate the draw (bias); delete the exchange; remove people; stage a rigged redraw.
- **Boundary:** the host cannot read member private links, cannot open assignments after the draw (they are sealed to givers), and cannot learn who has sent or confirmed.
- **Mitigations:** disclosure at creation, draw and in the privacy page; recommendation of a non-playing host; the host's screen never displays pairings; redraw is allowed only before any payment activity; the draw is unbiased and validated.
- **Remaining:** a determined host can capture pairings or bias outcomes. **Not mitigated by design in this release.**
- **Tests:** draw uniformity and validity (`packages/draw`); host screens contain no addresses (`exchange.spec.ts`).

### 5. Curious group member

- **Can see:** roster nicknames; aggregate counts; their own assignment and acknowledgment state.
- **Attacks:** read another member's assignment; read other members' send/confirm state; use the API to enumerate.
- **Mitigations:** every read and write is authorized server-side by token and by path member id; progress is aggregate-only; roster rows contain only id, nickname, status; no endpoint lists per-member state.
- **Tests:** authorization matrix across endpoints × roles; cross-member and cross-group denial; "no per-member state leaks" (`payments-reveal.test.ts`, `privacy-and-abuse.test.ts`).

### 6. Malicious member

_Redraw-gate griefing:_ because the draw is pinned to a members version, a member who joins and leaves repeatedly can force the host to retry. Bounded by rate limits, not prevented.

- **Attacks:** forge acknowledgments for others; guess references; replay actions; submit hostile or malformed sealed data; abuse reveals to name someone else; spam joining; SQL/HTML injection; oversize input.
- **Mitigations:** acknowledgments only by the recipient's own token; reference guesses limited to 10/hour with a 2^80 space; draw-version checks and idempotent, compare-and-swap state changes; schemas reject unknown fields; request bodies capped at 96 KiB while streaming; reveals require the memo reference *and* are rate-limited; reveal errors do not distinguish "unknown person" from "wrong reference"; parameterized SQL only; user text is rendered as text by React; names limited to 32 code points with control characters rejected; rate limits and a human check on creation and joining.
- **Remaining:** a member can lie in an acknowledgment or a "sent" note; Mummer says so everywhere and never calls either "verified". A member can post garbage ciphertext as a profile: the host's browser detects it and the person must rejoin.
- **Tests:** replay, forgery, injection and hostile-input suites; concurrency tests (double acknowledgment counted once; two simultaneous draws yield exactly one).

### 7. Stolen invitation or private link

- **Invite link:** contains no secret; it only lets someone request to join while joining is open (rate limited, capped, human-checked). The host can remove unwanted entries before the draw.
- **Private (member/admin) link:** a bearer credential. **Mitigations:** carried only in the fragment, hidden by default on screen, saved and verified by paste-back, removable from the address bar; "Replace my link" re-keys and kills the old token; the host can remove a member.
- **Remaining:** anything read with a stolen link before replacement cannot be un-read.
- **Tests:** `recovery.spec.ts` (replace link; old link dead; assignment re-sealed), `groups.test.ts`/`payments-reveal.test.ts` (rotation, concurrent rotation).

### 8. Database compromise (dump or write access)

- **Read:** sealed blobs, token hashes, commitments (non-reversible), nicknames, counts. No pairing, address or wishlist.
- **Write:** an attacker who can write to the database can replace sealed profiles (substituting addresses for the host key, which is public) or swap rows. **Remaining.** The host's browser detects structurally invalid or non-decrypting profiles, but cannot detect a well-formed substitution.
- **Tests:** database-dump scan; `glassbox` view shows only sizes and fingerprints.

### 9. Network observer

- Sees that a device contacted Mummer. HTTPS with HSTS; no third-party calls; no analytics.
- **Test:** every origin contacted during the end-to-end journey is Mummer's own.

### 10. Controller of a participant's browser or device

- Out of scope: they hold the key. Mitigations are limited to not persisting plaintext assignments, hiding link text by default, and `Forget this device`. Local storage holds the key and token for convenience; XSS or a malicious extension could read it, hence the strict CSP.
- **Tests:** local and session storage never contain plaintext addresses, wishlists, assignments or references (`browser-security.spec.ts`).

### 11. Colluding participants

- A giver and the host together can confirm a pairing; two members comparing notes can narrow the group. Aggregate-only progress prevents counts from identifying anyone, but small groups leak by deduction. The UI recommends five or more participants. In a group of four, each member can infer more about the cycle.

### 12. Draw manipulator

- A host biasing the draw is covered under "Malicious host". A member cannot influence it (the draw is host-side and members' inputs are only sealed profiles). A server cannot influence it: it never sees pairings, and the draw is committed once, atomically, under an idempotency key.
- **Tests:** concurrent draws (exactly one wins); replay with the same key is a no-op; wrong draw version refused.

## Cross-cutting controls

| Control | Where | Test |
|---|---|---|
| Strict CSP, no third-party script on secret-bearing pages, `wasm-unsafe-eval` for libsodium only | `workers/api/src/security.ts` | `browser-security.spec.ts`, `groups.test.ts` |
| Human check isolated in a sandboxed, opaque-origin frame; exchanged for a single-use ticket | `apps/web/public/human-check.*`, `src/human.ts` | `groups.test.ts` (tickets), `browser-security.spec.ts` (sandbox) |
| Rate limits, fail-closed human check, fail-closed price | `src/ratelimit.ts`, `src/services.ts` | `groups.test.ts`, `services.test.ts` |
| Atomic, idempotent state transitions (compare-and-swap in SQL) | `src/routes/*.ts` | race tests in `join-draw.test.ts`, `payments-reveal.test.ts` |
| Bearer only (no cookies), no CORS | API design | `groups.test.ts`, `browser-security.spec.ts` |
| Generic errors; no body, token or address logging | `src/app.ts` | `groups.test.ts` ("server errors are generic") |

## Residual risk summary

1. Trusted-host draw. 2. Malicious operator can alter served code or substitute addresses. 3. Platform and network metadata. 4. Self-reported sent/confirmed states. 5. Small groups leak by deduction. 6. No independent security review has been performed.
