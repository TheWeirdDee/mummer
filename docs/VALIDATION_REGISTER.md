# Validation register

Every input the product accepts, where it is checked, and the message a person sees. Checks run in the browser for guidance **and** in the Worker for enforcement (schemas live in `packages/shared/src/schemas.ts`; the address and memo rules in `packages/zcash`). The browser is never trusted: a request that skips the form still meets the Worker's schema.

Invisible and bidirectional control characters (U+200B to 200F, 202A to 202E, 2060 to 2064, 2066 to 2069, FEFF) and other control characters are rejected in every free-text field below.

| Field | Rule | Where enforced | Message (summary) | Tests |
|---|---|---|---|---|
| Exchange name | 3 to 60 characters after trimming; no control or invisible characters | Browser form; Worker schema | Says what is missing or too long; linked from the error summary | `validation.spec.ts` (empty form), `shared.test.ts` |
| Budget | Between $5 and $250 (500 to 25,000 cents); suggested range $5 to $50; stored as cents | Browser; Worker | Plain-language range message | `validation.spec.ts` (budget, dates and size limits) |
| Join deadline | Not in the past; at most 90 days ahead; checked in the exchange's timezone | Browser; Worker (create and extend) | "The join deadline cannot be in the past" and similar | `validation.spec.ts`, `groups.test.ts`, `extend.test.ts` |
| Reveal date | At least a day after the join deadline; at most 180 days ahead | Browser; Worker (create and extend) | "The reveal date must be at least a day after the join deadline" | same |
| Timezone | Valid IANA name | Worker schema; browser default | Rejected with a validation error | `shared.test.ts` |
| Most people allowed | Integer from 4 to 50 (default 20); at least 4 members are needed to draw | Browser; Worker | Range message | `validation.spec.ts`, `join-draw.test.ts` (cap race) |
| Host plays or not; draw acknowledgment | Required choice; required checkbox that the draw runs in the host's browser | Browser | Error summary names the unanswered choice | `validation.spec.ts` |
| Nickname | 2 to 32 characters; unique within the exchange; NFC-normalised | Browser; Worker (unique constraint) | "Name already taken" sends the person back to fix it, keeping other answers | `validation.spec.ts` (duplicate), `groups.test.ts` |
| Wishlist | Up to 280 characters; stored only sealed (sealed profile at most 8,192 encoded characters) | Browser; Worker (size of sealed blob) | Counter plus message | `validation.spec.ts`, `crypto.test.ts` (padding) |
| Wallet readiness | Required acknowledgment before the address step | Browser | Explains and links to the wallet guide | `validation.spec.ts` |
| Receiving address | Decoded as a real ZIP 316 unified address (checksum, jumble, lengths, ordering); mainnet only; must contain a shielded receiver; transparent-only and testnet refused; a unified address that also contains a transparent receiver is accepted with a warning | Browser (`validateGiftAddress`) | A reason per refusal: wrong network, transparent only, bad checksum, truncated, and so on | `address.test.ts`, `validation.spec.ts` (every refusal) |
| Consent to who sees details | Required checkbox | Browser | Error summary | `validation.spec.ts` |
| Host key in the invite (`#hk=`) | If present must equal the key the server returns | Browser | Blocks joining on mismatch; notice if absent | `validation.spec.ts` (host key) |
| Private link and admin link fragments | `#k=` 43 base64url characters and `#t=` 43 base64url characters; anything else is "incomplete" | Browser | "That link is incomplete" with recovery options | `recovery.spec.ts`, `crypto.test.ts` (link strictness) |
| Pasted link or backup text | Parsed strictly; backup is `MUMBK1.` plus authenticated ciphertext | Browser | "The passphrase doesn't open this backup" without detail on why | `recovery.spec.ts` |
| Backup passphrase | At least 10 characters | Browser | "at least 10 characters" | `recovery.spec.ts` |
| Payment note | At most 400 **bytes** of UTF-8 (the counter shows bytes, so emoji use more); at most 512 bytes in the whole memo; no control or invisible characters | Browser; `packages/zcash/memo` | "That note is too long for a memo. Shorten it: emoji and accented letters take extra room." The QR is withheld while invalid | `validation.spec.ts`, `zip321.test.ts` |
| Gift reference | `MUM-XXXX-XXXX-XXXX-XXXX-C`, Crockford base32, check character | Browser (format); Worker (match against commitment) | A malformed reference is a validation error and is not counted; a well-formed wrong reference is `reference_mismatch` and counts against a rate limit | `crypto.test.ts`, `payments-reveal.test.ts` |
| Reveal choices | Audience required; only after the reveal instant; reference must match | Browser; Worker | Explains the date or the mismatch | `payments-reveal.test.ts`, `exchange.spec.ts` |
| Identifiers in paths | 32 lowercase hex characters | Worker | A malformed or unknown id is refused (validation error or not found) | `routes.test.ts` |
| Request bodies | JSON only, size capped (draw body 256 KiB), strict schemas (unknown keys refused) | Worker | `validation_failed` / `payload_too_large` | `hardening.test.ts`, `routes.test.ts` |
| Public keys | Must be 32-byte X25519 keys that are usable (not low-order or identity points) | Worker | `validation_failed` | `hardening.test.ts` |
| Human check | Single-use hashed ticket required for create and join in production; fails closed without a configured secret | Worker | "Mummer can't start new exchanges or accept new joins right now" | `groups.test.ts` |
| Dates changing the draw | Draw must carry the current draw version and members version | Worker (compare-and-swap) | Conflict; the host is asked to reload and retry | `join-draw.test.ts`, `hardening.test.ts` |

## Known gaps

- Receivers are checked structurally, not for elliptic-curve point validity (`docs/KNOWN_LIMITATIONS.md` item 10).
- Client-side messages are checked by tests that assert on visible text for the main paths; not every message on every field has its own assertion.
