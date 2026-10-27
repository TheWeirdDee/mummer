# Privacy audit

A check of what each party can learn, against what the product says. Method: read every table and endpoint, run plaintext scans over a whole exchange's requests, responses and database rows (`tests/security/privacy-and-abuse.test.ts`), run a browser that watches every outgoing request (`tests/e2e/browser-security.spec.ts`), and review the three independent audits' findings. This is an internal audit by the author and automated reviewers, not a third-party assessment.

## Verified by test

| Property | How it is checked |
|---|---|
| The server never receives a plaintext address, wishlist, memo, assignment edge, secret key, seed or viewing key | Every request body of a full exchange is scanned for the plaintext values that were typed in |
| The database never holds them either | Every stored value after a full exchange is scanned; sealed blobs must not contain the plaintext; lengths are bucketed to 256 bytes |
| Private-link secrets (`#k=`, `#t=`) never leave the browser in a URL, header, referrer or request body (in the flows listed) | A real browser records all traffic while a member opens their link, marks a gift sent, opens the "My link" and "A gift for you" tabs, and confirms receipt (create, join, recovery and link replacement are not covered by a traffic recording) |
| Local storage keeps this device's key but no plaintext address, wishlist or assignment | Storage is inspected after joining |
| No third-party origin is contacted | Same traffic recording; the only exception is the separate-origin human-check frame (and Cloudflare inside it) |
| The only table linking two members is `reveals`, written after the giver's consent and proof | Schema and row scans |
| Member-level times are day buckets; audit events carry no actor after the draw | Row scans |
| Progress and the host's glass box show totals, never per person | API response shape tests |
| A member cannot read another member's assignment; cross-group access fails | Authorization matrix |
| Draw replays, stale member lists and forged draws are rejected | `workers/api/test/join-draw.test.ts`, `hardening.test.ts` |
| Address and profile swaps by a database writer are detected | Address commitment checks (host on opening, giver on payment); `hardening.test.ts` |

## Findings during development and their status

| Finding | Status |
|---|---|
| Per-person sent and confirmed state visible in the host's glass box narrowed the pairing | Fixed: totals only |
| Reference check-character weights allowed an undetected swap of the last data and check characters | Fixed with a regression test |
| Human check could mint tickets with a lenient verifier in production if the secret was missing | Fixed: fails closed |
| Rate-limit buckets keyed by full IPv6 address were trivially evaded | Fixed: bucketed by /64; a production salt is required |
| A draw could silently omit a member who joined after the host read the list | Fixed: draw pinned to a members version |
| A host key swapped by the server would seal everything to someone else | Mitigated: fingerprint in the invite; absent fingerprint only warns |
| A saved address in a join draft persisted in session storage | Fixed: not stored |
| A private link with a different key silently replaced the saved key | Fixed: conflict screen |
| Invisible and bidi characters could hide text in nicknames or memos | Fixed: rejected |
| Stats could be differenced to reveal one exchange | Mitigated: hidden under 5 exchanges, rounded to multiples of 5; not differentially private |

## What remains true (and is stated in the product)

1. **The host's browser runs the draw and can record who draws whom.** The create screen, the draw screen, the privacy page and the FAQ say so, and offer "I'm only organizing".
2. **A malicious operator who serves altered JavaScript can read secrets or swap addresses.** Commitments and the host-key fingerprint defeat database-only attacks, not this one.
3. **Hosting and network providers see connections** (IP, timing). Cloudflare's own logging and retention were not inspected (gate R09), and the copy makes no claim about it.
4. **Small groups leak by deduction** (four people can narrow the cycle); five or more is recommended.
5. **A giver knows their recipient** and a recipient can guess their giver from timing, amount or a note.
6. **Sealed-blob sizes are bucketed, not constant**, so a very long wishlist can hint at its length.
7. **The address commitment is a one-way hash, but it can confirm a guessed address.** It is stored next to the nickname.
8. **Redraw gating can be griefed** by repeated joining and leaving; rate limits bound it.
9. **Self-reported states** ("sent", "received") are not verified.

## Not checked

- What the hosting platform logs or retains (R09).
- Behaviour of real wallets with respect to memos and address reuse.
- Timing side channels in the Worker or in libsodium's WebAssembly build beyond what the library documents.
- Any statement a legal reviewer would need to make about regulations (GDPR or otherwise). The product collects no email, no account and no analytics, and deletes data 30 days after the reveal date or on request, but no legal review was done.
