# Integration research

Research for Mummer's Zcash integration, recorded 26 October 2026. Every finding is classified:

| Class | Meaning |
|---|---|
| **EXECUTED** | Verified by running code or a real wallet in this project. |
| **DOCS** | Verified against current official documentation or specification text (fetched on the date above). |
| **INSPECTED** | Supported by reading an implementation or changelog, but not exercised. |
| **UNVERIFIED** | Nothing in hand establishes it. |
| **UNSUPPORTED** | Established not to be possible in the needed form. |

A documented capability is **not** treated as proof that it works on a user's actual device. Nothing in the "Wallet" rows below has been exercised on a real phone: see the open gates at the end.

## Sources and versions

| Source | What was read | Retrieved |
|---|---|---|
| [ZIP 321: Payment Request URIs](https://zips.z.cash/zip-0321) and its source in `zcash/zips` (`zips/zip-0321.rst`) | Grammar, semantics, the spec's valid and invalid examples | 2026-10-26 |
| [ZIP 316: Unified Addresses](https://zips.z.cash/zip-0316) | Bech32m + F4Jumble encoding, Revision 0 (`u`) and Revision 2 (`zu`, `tu`) HRPs, typecodes, validity rules | 2026-10-26 |
| `zcash/zcash-test-vectors` (`test-vectors/json/`: `f4jumble.json`, `f4jumble_long.json`, `unified_address.json`, `unified_address_r2.json`), master at commit dated 2026-07-01 | Official vectors, committed under `packages/zcash/test/vectors/` | 2026-10-26 |
| [Zodl: Using the Zcash memo field](https://support.zodl.com/article/41-using-the-zcash-memo-field) | Memo behaviour in the wallet | 2026-10-26 |
| [Zodl iOS CHANGELOG](https://github.com/zodl-inc/zodl-ios/blob/main/CHANGELOG.md) | Entries for ZIP 321, payment requests, memos, unified addresses (versions 2.0.3 to 3.16.0) | 2026-10-26 |
| [ZIP 311: Zcash Payment Disclosures](https://zips.z.cash/zip-0311) | Status **draft** (as cited in PRD v1.0; not re-fetched in full) | cited |
| npm registry | Libraries for ZIP 316 decoding, bech32, BLAKE2b, libsodium, argon2 | 2026-10-26 |

Library versions used: `libsodium-wrappers` 0.8.4 (libsodium 1.0.22), `@noble/hashes` 2.4.0, `@scure/base` 2.4.0, `qrcode-generator` 2.0.4, `zod` 4.6.7, `hono` 4.13.14, `wrangler` 4.152.0, Miniflare 4.20260730.0 (tests).

## The twelve mandatory questions

| # | Question | Finding | Class |
|---|---|---|---|
| 1 | Can Zodl reliably scan a ZIP 321 payment request? | The iOS changelog lists "several issues with ZIP321 QR code parsing" fixed in 2.4.12 (2026-01-29) and a payment-request confirmation warning in 3.15.0 (2026-09-23). That suggests scanning exists and is maintained, not that it works for Mummer's URIs on a given device. | INSPECTED. **Open gate R01/R02** |
| 2 | Does it populate the amount? | Changelog 3.15.0: amounts in payment requests now use the right number of decimals. Not exercised. | INSPECTED |
| 3 | Does it populate the memo? | Changelog 3.10.3 refers to a fee "computed for the exact payment being set up, including its memo". Not exercised with a ZIP 321 `memo` parameter. | INSPECTED. **Open gate** |
| 4 | Does it support the receiver type Mummer accepts? | Changelog 2.0.3 (2025-05-19): "Unified address without transparent receiver ... regenerated with every Receive screen access". So Zodl hands out shielded-only unified addresses (Orchard + Sapling). Mummer accepts exactly this, plus Sapling `zs1`. | INSPECTED |
| 5 | Can the recipient read the memo? | Zodl's help article: only the recipient can read it, by tapping the payment in the Activity list; memos work only with shielded addresses. | DOCS |
| 6 | Can Mummer obtain transaction evidence without exposing sensitive payment information? | No. Mummer is not a wallet and has no viewing key by design. A TXID alone proves nothing about amount, memo or recipient on a shielded payment. | UNSUPPORTED (by design) |
| 7 | Can payment verification be done without wallet secrets or custody? | Not for shielded payments, short of a selective-disclosure proof. Mummer therefore offers **recipient acknowledgment only**, labelled as a self-report. | UNSUPPORTED |
| 8 | Does any supported wallet expose payment disclosures or suitable receipt proofs? | ZIP 311 (payment disclosures) is a draft. No wallet capability was found that Mummer could rely on, and none was tested. | UNVERIFIED. Feature F15 not built |
| 9 | Can a company fund multiple recipients without exposing assignments? | Zodl iOS 3.7.2 **rejects** ZIP 321 requests with more than one recipient, so one QR cannot pay many people. Funding each recipient separately makes the funder-to-recipient link a property of the funding wallet's history, which defeats "the company doesn't learn pairs" only if the funder is also the host. A privacy-reviewed design was not completed. | INSPECTED (rejection); company-funded mode **not built** (F13) |
| 10 | What can observers infer from timing, requests and wallet behaviour? | See `docs/THREAT_MODEL.md`. Summary: the public ledger shows that shielded payments happened and when; a cluster near the reveal date is visible; network and hosting providers see connections; wallet sync providers see wallet traffic. | Analysis |
| 11 | Which integrations need native wallet functionality a browser can't provide? | Signing and broadcasting; scanning a QR with the OS camera; reading a received memo; viewing history. The browser only builds and displays the request and offers a `zcash:` link. | DOCS (ZIP 321) |
| 12 | What happens when a wallet does not support a requested operation? | Every part of the request (address, amount, memo, full URI) has its own copy button, and the app tells the user which three things to check. The product never claims a scan prefilled anything. | EXECUTED (UI behaviour) |

## Library evaluation: ZIP 316 address decoding

No maintained JavaScript or TypeScript package for decoding ZIP 316 unified addresses was found on npm (`zcash-address`, `@zcash/address`, `zcash-bech32m` do not exist; `zcashjs` wraps `zcash-cli`). A WebAssembly binding (`nuttycom/zcash_address_wasm`) exists but is marked experimental and does not cover unified addresses.

**Decision.** Implement the decoder (F4Jumble, Bech32m, typed-length-value parsing, ZIP 316 consumer rules) in `packages/zcash`, built only on audited primitives (`@scure/base`, `@noble/hashes` BLAKE2b), and prove it against the **official test vectors**:

- 8 F4Jumble vectors and the two long vectors (3,246,395 and 4,194,368 bytes, matched by BLAKE2b digest);
- 60 Revision 0 and 60 Revision 2 unified-address vectors, decoded to the exact receivers and expiry fields;
- negative cases (every single-character substitution fails the checksum; truncation, extension, mixed case, transparent, TEX, Sprout, test network, expired Revision 2 addresses).

Limit: receivers are validated structurally (checksum, lengths, ordering, typecodes). Mummer does not check that receiver bytes are valid curve points. A wallet does that at send time.

NCC Group's NU5 review noted a parser that failed to reject repeated typecodes and invalid receiver combinations; those rules (strictly ascending typecodes, no P2PKH+P2SH, at least one non-metadata item, shielded receiver required in Revision 0, no transparent receiver in `zu`, MUST-understand metadata rejected) are enforced and tested.

## Library evaluation: cryptography

| Need | Choice | Why |
|---|---|---|
| Sealed boxes (X25519, XSalsa20-Poly1305) | `libsodium-wrappers` 0.8.4 | Widely reviewed; matches the PRD. The standard build has no `crypto_pwhash`. |
| Passphrase key derivation | `@noble/hashes` argon2id (RFC 9106) | Audited, pure JS, avoids shipping the larger "sumo" libsodium build. **Executed:** matches the RFC 9106 section 5.3 known-answer vector. |
| BLAKE2b (F4Jumble), SHA-256 | `@noble/hashes` | Audited; SHA-256 cross-checked against `node:crypto`. |
| Bech32 / Bech32m / Base58Check | `@scure/base` | Audited, zero dependencies. |
| QR | `qrcode-generator` | Small, dependency-free; rendered as an SVG path (no inner HTML). |

No cryptographic primitive was invented. See `docs/CRYPTOGRAPHIC_DESIGN.md` for the protocol built from them.

## Host-blind drawing: evaluation

Evaluated: multiparty shuffling with re-randomizable encryption, verifiable permutations, commitments, existing audited protocols, collusion assumptions, dropout recovery, phone performance.

- Libsodium sealed boxes are **not re-randomizable**, so the shuffle-and-re-encrypt design sketched in PRD v0.1 cannot be built on them. A sound design needs an ElGamal-style scheme with proofs of correct shuffling, plus an interactive protocol in which every participant takes a turn (so any dropout stalls the draw).
- No audited, browser-ready library implementing a verifiable shuffle was identified. Writing one under deadline pressure is exactly what the PRD forbids.
- **Decision:** ship the trusted-host draw, disclosed plainly in the create screen, the draw screen, the privacy page and the FAQ, with a "host who isn't playing" option. Host-blind drawing is recorded as **not built** (F14, R07 fallback).

## Company-funded mode: evaluation

One QR cannot pay several recipients in Zodl (see row 9). A noncustodial design would need one request per recipient from the funder's wallet, and the funder learns each recipient's address. Because the host already learns addresses in this model, a funded mode that keeps pairings secret from the funder would require the funder to be someone other than the host and to receive only anonymized recipient slots, which needs a protocol that was not designed or reviewed. **Not built** (F13, R08 fallback: defer).

## Open verification gates (not passed, not claimed)

| Gate | Needs | Status |
|---|---|---|
| R01 / R02 | Real Zodl iOS and Android: scan a Mummer QR; confirm address, amount and memo are filled in; send; receive and read the memo | **BLOCKED**: no physical devices, wallet funds or signing in this environment |
| R03 | Zodl fresh-receiver generation on devices | Changelog only |
| R05 | ZECATHON exact deadline, build window, bounty overlap | Requires the organizer; not researched here |
| R06 | Per-payment selective disclosure | Not built |
| R09 | What Cloudflare logs and retains at the edge | Platform settings not inspectable without an account; the privacy copy makes no claim beyond "hosting providers can see connections" |
| R10 | Recovery on real devices | Covered by browser tests of link replacement, backup restore and leaving; device-loss on real phones not exercised |
| R11 | Domain and trademark for "Mummer" | Not researched |
| R12 | A consenting group of 4 to 5 completing a real shielded exchange | **BLOCKED**: requires real funds and people |
