# Privacy architecture

How the design enforces the privacy claims, and where it deliberately stops. Companion to `THREAT_MODEL.md` (who) and `CRYPTOGRAPHIC_DESIGN.md` (how).

## Principles

1. **Seal at the edge.** Anything sensitive is sealed in the browser to a key held by the only party who should read it. The server stores and serves blobs it cannot open.
2. **Separate by role, not by pairing.** The assignment table is keyed by *giver*; the acknowledgment table by *recipient*. No column joins them. Only a consented reveal creates a (giver, recipient) row.
3. **Counts, not people.** Everything the group sees about progress is an aggregate. No endpoint returns "who has sent" or "who has confirmed".
4. **Coarse time.** Member-level timestamps are UTC days. Audit events after the draw name no person.
5. **Order carries nothing.** Draw submissions are sorted by member id, and member-linked tables are `WITHOUT ROWID` (stored in primary-key order), so neither request order nor storage order follows the cycle.
6. **Say only what is true.** The trusted-host draw is disclosed; acknowledgments are "recipient says"; wallet behaviour is not claimed.

## Data flow of a gift

```
 member browser                    host browser                       server (D1)                  giver browser
 ──────────────                    ────────────                       ───────────                  ─────────────
 keypair + token (local)
 seal{wishlist,address} → host pk ────────────────────────────────▶ members.sealed_profile
                                   open all profiles (host key)  ◀── GET /profiles
                                   validate addresses, draw (Sattolo)
                                   per giver: seal{recipient, reference} → giver pk
                                   per recipient: SHA-256(group,recipient,reference)
                                   POST bundles + commitments (each sorted by id) ───▶ assignments (by giver)
                                                                                         ack_commitments (by recipient)
                                                                      GET /assignment ─────────────────────────▶ open with own key
                                                                                                    build ZIP 321 URI (address, exact amount, memo)
                                                                                                    verify URI re-parses to intent → QR
                                                                                                    wallet signs and sends (outside Mummer)
 recipient: reads memo in wallet; optionally enters reference
 POST /ack {received, reference?} ──────────────────────────────────▶ compare SHA-256; set state; bump counter once
```

## What each party's screen can show

| Party | Can show | Cannot show |
|---|---|---|
| Host dashboard | Roster nicknames; aggregate counts; the host's own draw review (names and address *validity*, not pairings) | Pairings; who has sent or confirmed |
| Participant | Own assignment; own sent/received state; roster; aggregate counts; reveals visible to them | Others' assignments or states |
| Public | Marketing pages; invite info; rounded, thresholded counters | Any exchange data without a token |

## Where the architecture stops

- The **host's browser knows the pairings** while sealing. This is the trusted-host model.
- An **operator who serves hostile code** defeats client-side sealing (and can forge profiles for the host key).
- **Small groups** leak by deduction; the UI nudges toward five or more.
- **Reveals** deliberately create a pair row, only with the giver's consent and proof.

## Tests that enforce it

`tests/security/privacy-and-abuse.test.ts`: full-lifecycle scans for plaintext in requests, responses and every table; only `reveals` links two members; commitments contain no reference; storage order is by id; timestamps are day buckets; audit events are group-level; no per-member state in member-visible responses. `workers/api/test/join-draw.test.ts`: column shape of `assignments`, `ack_commitments`, `members`, `audit_events`. `tests/e2e/browser-security.spec.ts`: no secrets on the wire or in storage; no third-party origins.
