# Privacy

Mummer helps keep gift payments shielded on Zcash, while limiting what the organizer app stores. It does not make anyone invisible. This document is the operator-level companion to the in-app [privacy page](../apps/web/src/pages/Privacy.tsx); both must say the same thing.

## What Mummer promises (and what backs it)

| Promise | Backing |
|---|---|
| The server never receives a plaintext wallet address, wishlist, memo, assignment, secret key or seed phrase. | Client-side sealing; test scans of every request, response and database row across a complete exchange (`tests/security`). |
| Each person can open only their own assignment. | Server-side authorization matrix and cryptographic sealing to the giver's key. |
| The public ledger is not asked to carry anything about an exchange. | Payments are shielded; non-shielded addresses are refused. |
| Mummer never holds or moves money, and never asks for seed phrases or viewing keys. | No custody code exists; no field accepts them. |
| Group progress is counts only. | No endpoint exposes per-member send or confirm state. |

## What Mummer does not promise

- That nobody can tell who gave to whom. A giver knows who they drew; a recipient may infer their giver.
- That the host cannot see the pairings. The draw runs in the host's browser.
- That payments are verified. Recipient confirmations are self-reports.
- That the operator or hosting providers learn nothing: connections and timing are observable.
- That deleted data vanishes everywhere: screenshots, wallet history and blockchain records persist.

## Data inventory

| Data | Stored | Form | Retention |
|---|---|---|---|
| Group name, budget, dates, timezone, member cap | `groups` | Clear (group-visible by design) | 30 days after reveal date, or until deleted |
| Host public key; hashed admin token | `groups` | Public key; SHA-256 | Same |
| Nickname | `members` | Clear (group-visible) | Same |
| Address commitment | `members.address_commitment` | One-way hash of group, nickname and address; lets host and giver detect a swapped profile. It cannot reveal an address nobody has guessed, but could confirm a guessed one | Same |
| Members version | `groups.members_version` | Integer counter | Same |
| Member public key; hashed token | `members` | Public key; SHA-256 | Same |
| Wishlist and address | `members.sealed_profile` | Sealed to the host's key | Same |
| Assignment (recipient, wishlist, address, reference, budget) | `assignments` | Sealed to the giver's key | Same |
| Gift reference fingerprint, acknowledgment state | `ack_commitments` | One-way hash; state; day | Same |
| "I sent it" note | `members.sender_state` | Flag only | Same |
| Consented reveal (giver, recipient, audience) | `reveals` | Clear, only after the giver consented and proved it | Same |
| Group-level events | `audit_events` | Event name + day; no actor after the draw | Same |
| Aggregate counters | `stats` | Three numbers, no identifiers | Indefinite (anonymous) |
| Rate-limit buckets | `rate_limits` | Salted hash of (scope, client address) + count | Pruned after about two hours |
| Human-check tickets | `human_tickets` | Hash | Ten minutes |

**Not stored anywhere:** IP addresses in the database, request bodies in logs, analytics, cookies, advertising or session-replay identifiers. No third-party script loads on any page of the app. On create and join, a frame from a separate origin (the `mummer-check` Worker) loads Cloudflare Turnstile; that origin cannot read the app, and Cloudflare can see the visitor's connection and browser signals as any Turnstile deployment can.

**Seen in transit, not stored:** (1) When a recipient types the gift reference from the memo to confirm a gift, the reference is sent to the server, which compares its hash with the stored fingerprint and discards it. The server cannot tell which giver the reference belongs to (it lives only in the giver's sealed assignment and in the host's browser at the draw), so this adds nothing to what it already knows; it is listed here because the reference is otherwise kept sealed. (2) On create and join, the Worker passes the visitor's IP address and the Turnstile token to Cloudflare's verification API, as Turnstile's documentation describes. The deployed instance was scanned for both (`tests/live/privacy-scan.spec.ts`; results in `docs/EVIDENCE.md`).

**On the user's device:** the person's key and token in local storage (so they can return), non-secret form drafts in session storage (the address is deliberately **not** kept in a draft), a pending link replacement while one is in flight, and, if they choose, their local reveal-day guess. "Forget this device" removes all of these.

## Metadata controls

- First-party static assets and fonts; no CDN or tag manager.
- `Referrer-Policy: no-referrer`; secrets only in URL fragments (never sent to servers); the fragment is removed from the address bar after saving.
- Timestamps on member-level rows are UTC *days*, so row times cannot be used to correlate actions.
- Hashing a client address for rate limits does not hide it from the network edge; the privacy page says so.
- What Cloudflare itself logs and retains for a given account was **not** inspected (gate R09). Any operator statement about edge logging should be written only after checking the account's settings.

## Rights and deletion

The host can delete an exchange at any time (immediate cascade). A participant can leave (before the draw: row deleted; after: credentials revoked and the assignment dropped). The scheduled job purges expired exchanges. There are no accounts, so there is no cross-exchange profile to export or erase.
