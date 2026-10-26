# Cryptographic design

Mummer composes established primitives. It defines **no** new primitive and no new protocol beyond the message formats below. Source: `packages/crypto`, `packages/shared`, `packages/draw`.

## Primitives

| Purpose | Primitive | Library |
|---|---|---|
| Public-key encryption of profiles and assignments | `crypto_box_seal` (X25519 key agreement, XSalsa20-Poly1305, ephemeral sender key) | libsodium 1.0.22 via `libsodium-wrappers` 0.8.4 |
| Passphrase to key | argon2id, t=3, m=32 MiB, p=1, 32-byte output | `@noble/hashes` (checked against the RFC 9106 §5.3 known-answer vector) |
| Backup encryption | `crypto_secretbox_easy` (XSalsa20-Poly1305), random 24-byte nonce, random 16-byte salt | libsodium |
| Token and commitment hashing | SHA-256 | `@noble/hashes` (cross-checked with `node:crypto`) |
| Randomness | `crypto.getRandomValues` (platform CSPRNG), libsodium's `crypto_box_keypair` | Web Crypto, libsodium |
| Draw | Sattolo's algorithm over unbiased rejection-sampled integers | `packages/draw` |
| Padding | ISO/IEC 7816-4 padding (`sodium.pad`) to 256-byte blocks | libsodium |

## Keys and secrets

| Secret | Generated | Lives in | Never |
|---|---|---|---|
| Host X25519 key pair | Host's browser at creation | Secret half: the admin link's `#k=` fragment and the host's local storage. Public half: the server | Sent to any server |
| Member X25519 key pair | Member's browser at joining | Same pattern, member link | Sent to any server |
| Bearer token (256-bit) | The person's browser (`generateToken`) | The link's `#t=` fragment and local storage. Only its SHA-256 hash is sent at creation or joining; the token itself is sent only in an `Authorization` header to Mummer's own API | Put in a URL, query string or log |
| Group and member ids (128-bit) | Server (`generateId`) | Database; URLs | Sequential or guessable |
| Gift reference (80-bit) | Host's browser at the draw | Inside the giver's sealed bundle; its fingerprint under the recipient's id | Stored in the clear |

The **authorization token and the encryption key are distinct** values, carried separately in the link, so that a server that sees the token (it must, to authorize) still cannot decrypt anything.

## Message formats

All sealed payloads are JSON, validated by Zod schemas (`packages/shared/src/schemas.ts`), padded to a 256-byte block, then `crypto_box_seal`ed to the recipient's public key and encoded as unpadded base64url.

**Profile** (member to host): `{v:1, kind:"profile", groupId, pseudonym, wishlist, address}`

**Assignment bundle** (host to giver): `{v:1, kind:"assignment", groupId, drawVersion, giverId, recipient:{memberId, pseudonym, wishlist, address}, reference, budgetCents}`

**Acknowledgment commitment** (filed under the recipient's id):
`SHA-256( len16("mummer/ack-commitment/v1") ‖ groupId ‖ recipientId ‖ canonicalReference )` with each field length-prefixed (16-bit big-endian), so the encoding is unambiguous.

**Backup**: `"MUMBK1." ‖ base64url(salt16 ‖ nonce24 ‖ secretbox(JSON{role, groupId, memberId?, secretKey, token}))`.

### Why context lives inside the plaintext

A sealed box is *anonymous*: anyone who knows the recipient's public key can create one, and the ciphertext is not bound to the sender, group, member or draw. Mummer therefore binds every payload to its context inside the plaintext and every opener checks it:

- `groupId` must equal the page's group (blocks cross-group replay);
- `giverId` must equal the opening member's id (blocks swapping bundles between members);
- `drawVersion` must equal the current draw (blocks replay after a redraw);
- the profile's `pseudonym` must equal the roster row.

This is tested (`packages/crypto/test/crypto.test.ts`: cross-group, cross-member and cross-draw replay are rejected).

### Padding

Stored blob length is bucketed to 256-byte multiples (+48 bytes sealed-box overhead), so a database holder cannot read wishlist or address length precisely. Tested: profiles with different wishlist lengths store with identical length.

## Commitments and the gift reference

The reference is 16 Crockford base32 characters (80 bits of CSPRNG output) plus one check character: `MUM-XXXX-XXXX-XXXX-XXXX-C`. The check character is a position-weighted sum (odd weights 3, 5, 7 … mod 32). It catches every single-character error and about 97% of adjacent transpositions (tested: more than 90% required, 288 samples). It is a typo guard, not a MAC.

The server stores `SHA-256(domain ‖ group ‖ recipient ‖ reference)`. With 80 bits of entropy, an attacker holding a database dump cannot recover a reference offline (about 2^80 hash evaluations), so no server-side secret ("pepper") is needed and the operator never learns a reference unless a recipient or giver chooses to submit it (acknowledgment or reveal). Online guessing is limited to ten wrong references per hour per person (`rate_limits`).

What a matching reference **does and does not** establish:

- It shows that whoever submitted it held a reference issued for that gift. The host (who generated it) and, if they read their memo, the recipient also know it.
- It does **not** show that a payment occurred, its amount, or who sent it. It is never labelled as proof.

## The draw

`packages/draw`:

1. `uniformInt` draws an integer in [0, max) from 32-bit CSPRNG words by **rejection sampling** (words at or above `floor(2^32 / max) * max` are discarded), so there is no modulo bias. A test feeds the rejection boundary word explicitly.
2. **Sattolo's algorithm** (`for i = n-1 down to 1: j = random in [0, i-1]; swap`) yields a uniformly random single n-cycle: nobody draws themselves and, for n at least 3, nobody draws each other. Tested for uniformity over all 24 cycles of 5 members with 100,000 seeded draws (chi-square, critical value at p = 1e-6).
3. **Exclusions**: first uniform *rejection sampling over Sattolo cycles* (so the result is uniform over all valid cycles; chi-square tested), then, only if constraints are so dense that sampling fails, a **bounded randomized depth-first search** for a Hamiltonian cycle. That path is labelled non-uniform. An exhaustive search that completes proves impossibility; hitting the node budget is reported as inconclusive, never as impossible.
4. An independent `validateAssignment` re-checks bijection, no self-assignment, a single cycle and every exclusion.
5. The host's browser then seals one bundle per giver and computes one commitment per recipient. Both arrays are **sorted by member id** (a canonical order unrelated to the cycle), and the database tables are `WITHOUT ROWID`, so neither list order nor row storage order correlates a giver with a recipient.

### What the draw does not protect

The host's browser holds the pairings while it seals the bundles. A host can copy them. This is the **trusted-host** model, disclosed everywhere it matters. A host-blind alternative is not built (see `docs/INTEGRATION_RESEARCH.md`).

## Attack analysis: key compromise and recovery

| Event | Consequence | Mitigation / recovery |
|---|---|---|
| Member link leaked | The holder can read that member's assignment and act as them | **Replace my link**: new key pair and token; the assignment is re-sealed to the new key by the member's browser; the old token hash is replaced atomically (compare-and-swap, so two simultaneous rotations cannot both win). Anything already read cannot be un-read. |
| Member key lost, before draw | Profile is sealed to the host key, not the member's | Rejoin with new credentials; host removes the old entry |
| Member key lost, after draw | The bundle is sealed to a key that no longer exists | **Not recoverable by design**; a passphrase backup is the only remedy. Host can flag the exchange for manual resolution, or redraw if nobody has reported sending |
| Host key lost | Profiles unreadable; no draw possible | Not recoverable: create a new exchange (no funds were held) |
| Host token leaked | Attacker can close, delete or remove people; cannot read profiles without the host key | Close or delete; the host key is a separate secret |
| Database dump | Sealed blobs, token hashes, commitments | No pairings or plaintext; see `THREAT_MODEL.md` |
| Server operator serves malicious code | Can capture keys and addresses as they are entered | Inherent to web apps; mitigated by a strict CSP and no third-party scripts on secret-bearing routes, not eliminated |

## Safe handling of sensitive memory

JavaScript cannot guarantee zeroization. `wipe()` calls `sodium.memzero` on key buffers it controls (derived argon2 keys, backup flows), but the platform may retain copies (garbage collection, JIT, swap). The design therefore does not depend on wiping: secrets are kept out of long-lived state, decrypted assignments exist only in React component state (never in storage), and the draw's pairings live in local variables for the duration of one function.

## Test evidence

`packages/crypto/test/crypto.test.ts` (39 tests): known-answer vectors (RFC 9106, SHA-256), wrong-key and tamper rejection across every region of the ciphertext, truncated and oversize input, malformed JSON and invalid UTF-8 inside valid ciphertext, replay across group/member/draw, plaintext-absence scans of every stored value, reference collision and error-detection tests, link-fragment strictness, backup round-trips and failures.
