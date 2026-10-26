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
| R05 | ZECATHON exact deadline, build window, bounty overlap | **Partly researched 2026-10-26** (see "Follow-up research"): the official site shows a 30-day build window and the **deadline appears to be 2026-10-28**, but the rules, judging criteria and licence requirements are behind a login and were **not read**; the date and prize split come from a search summary of a social post that could not be opened. **Confirm on the official site before relying on it** |
| R06 | Per-payment selective disclosure | Not built |
| R09 | What Cloudflare logs and retains at the edge | Documentation read 2026-10-26 (see `docs/DEPLOYMENT.md`): Workers Logs are on by default for new Workers (3 days on Free) and are now disabled explicitly in `wrangler.toml`; Cloudflare's privacy policy says end-user data may include IP addresses and gives **no retention figure**. Account settings are not inspectable without an account, so the privacy copy still claims nothing beyond "hosting providers can see connections" |
| R10 | Recovery on real devices | Covered by browser tests of link replacement, backup restore and leaving; device-loss on real phones not exercised |
| R11 | Domain and trademark for "Mummer" | **Researched with public searches only 2026-10-26** (see "Follow-up research"). Not a clearance; no counsel or official trademark-database search was possible |
| R12 | A consenting group of 4 to 5 completing a real shielded exchange | **BLOCKED**: requires real funds and people |

## Follow-up research, 2026-10-26

All items were read on 2026-10-26 by an automated research pass using public web pages, GitHub's API and RDAP. Where a statement rests only on a search summary it is labelled. None of this was tested on a device.

### ZECATHON (gate R05)

- Run by "zkSNARKs" (not ZecHub, ECC or ZCG). Official site: thezecathon.com. It shows a $100,000 prize pool, five tracks and "thirty days to build"; submissions are "sealed until judging". Tracks, rules, schedule, prizes and the submission form are visible only after signing in (GitHub, Google or email; one account per project). /rules, /resources, /schedule and /faq return 404 to anonymous requests.
- **Deadline: 2026-10-28, from a search summary of a social post (x.com/zksnarks_/status/2104606505177899314) that returned HTTP 402 and could not be opened; a third-party project repository repeats the same date.** Time zone not stated. Treat as unconfirmed but urgent.
- Tracks (same unconfirmed source): Shielded Payments, Private Markets, Cross-Chain, Core & Tooling, Wildcard; $15k per track, $5k Community Choice, $20k grand prize.
- **Not found (behind login):** judging criteria, licence/open-source requirement, whether a deployed demo or video is required. Mummer's README and docs do not claim any of these.
- Not to be confused with the ZecHub Hackathon (zechub.wiki/hackathon): a different event whose voting closed in July 2026.

### Zodl (wallet compatibility, gates R01/R02/R03)

- ZODL (Zcash Open Development Lab) is the former ECC team; Zashi was renamed Zodl, same app, no seed migration (forklog.com report).
- Platforms: iOS (App Store) and Android (Google Play, F-Droid, signed APKs on GitHub). **No Windows build was found**; a macOS Apple-silicon proof-of-concept DMG exists (poc-macos-dmg-test, mac-v1.0.1, 2026-08-25).
- Android release **3.17.2 (build 3157), 2026-10-20** (a TLS-verification security fix); previous 3.17.0 on 2026-10-13. The iOS repository has tags but no GitHub releases, so the current App Store version is **not found**.
- Android registers an intent filter for the `zcash:` scheme (VIEW, BROWSABLE) and parses ZIP 321 (address, amount, memo) from QR codes and URIs. A system-camera scan opening the app was fixed (issue 1865, closed 2025-05-13). Issue 1758 (open) asks for fuller `zcash:` link handling, so opening a link from a browser may be inconsistent.
- **Known limitations that affect Mummer's design:**
  - Android issue 2217 (open): a multi-payment URI shows only the first recipient but signs all of them. **Mummer only ever builds single-recipient URIs.**
  - iOS PR 1849 (merged 2026-06-26): iOS refuses ("fails closed" on) multi-recipient requests and reads only the first payment. Same conclusion.
  - iOS issue 1420 (open): characters such as `+` in memos are accepted when they should be rejected; Android issue 1678: a memo with `+` in standard base64 failed to parse (closed, consistent with the spec). **Mummer encodes memos as URL-safe base64 without padding (as ZIP 321 requires), so the memo never contains `+`, `/` or `=`** (covered by `packages/zcash/test`).
  - iOS issue 1754 (open): a stale-proposal race when scanning a second request after a first.
- Whether Zodl runs in a Windows Android emulator is **untested**. The Android source contains no Play Integrity, SafetyNet or hardware attestation checks (grep of main at 2026-10-25), which makes it plausible.
- **Zodl compatibility is still not verified:** no Mummer QR has been opened in the real application.

### Other tooling that could test ZIP 321 and shielded behaviour independently (distinct from Zodl compatibility)

| Tool | State | Notes |
|---|---|---|
| ZIP 321 specification | Active | No formal test-vector set, only examples (which Mummer's tests use). Memo is base64url without padding, max 512 bytes; a memo on a transparent address makes the URI invalid; indexed parameters carry several payments |
| `zip321` crate (librustzcash) | 0.10.0, 2026-10-21 | Reference-style parser; rejects Sprout. Would let a cross-implementation check be written (parse Mummer's URIs with the Rust parser) but needs a Rust toolchain, which is not installed here |
| zcash-devtool | build from source, "do not use in production" | Testnet (`-n test`), `wallet pay` takes a ZIP 321 request |
| zingolib / zingo-cli | 7.0.0, 2026-10-15 | Testnet and regtest; Windows build and raw URI parsing unverified |
| Zkool | 6.35.0, 2026-10-25 | Has a Windows .exe, ZIP 321 handling in the send page; testnet unverified |
| zebrad / zallet | 7.0.0 (2026-10-22) / 0.1.0-beta.3 | Node and wallet for regtest-style tests |

None of these have been run. They would establish that *another independent parser* accepts Mummer's URIs, not that Zodl does.

### Name and domain (gate R11)

Public searches only; **this is not trademark clearance** and a real search of the USPTO, EUIPO and WIPO databases plus counsel would be needed.

- No Zcash, crypto, wallet or Secret Santa product named Mummer was found on GitHub search, the iOS App Store (only "Zany Mummer") or package registries. The npm name `mummer` was unpublished in 2015; `mummer` is free on PyPI and crates.io at the time of reading.
- **MUMmer** is a well-known bioinformatics genome-alignment tool (MUMmer4); it dominates search results for the name, in an unrelated field.
- Nearby marks reported by Justia (search summary): MUMMER-ABLE (live band performances, US reg. 3520299) and two SUMMER MUMMERS applications. No standalone MUMMER mark was found, but the USPTO search itself could not be used.
- RDAP (not authoritative): mummer.com is registered (expires 2027-05-06) and redirects to a for-sale page; mummer.org is registered (2024-12-01); mummer.io, .xyz and .net looked unregistered; mummer.app was inconclusive. Nothing was bought.
- "Mummer" is also an ordinary English word (mummers' plays and parades), which may make it a weak, descriptive-leaning mark.
