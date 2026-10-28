# Privacy release audit (28 October 2026)

A time-boxed check of the deployed product before submission, aimed at unintended disclosure. It is not an independent security review. "Intended" means what `docs/THREAT_MODEL.md` and `docs/PRIVACY.md` already say the host or server can see.

**Verdict: no confirmed critical or high-severity leak. Go for submitting an honest prototype, with the open items below stated and not hidden.** One accuracy problem in the project's own wording was found and fixed (finding 1). Nothing here is a clean bill of health: the limits of this audit are listed at the end.

## What was checked, and how

| Area | Method | Result |
|---|---|---|
| Deployed code is the documented code | Production and staging both report commit `4ab9a65`. The 27 October review fixes (including hiding private reveals from the host's glass box) are ancestors of it. The only later change to code that deploys is one test file | Confirmed |
| Private-link credentials in URLs, referrers, history | Live headers: `Referrer-Policy: no-referrer`, `Cache-Control: no-store` on every response, `X-Robots-Tag: noindex, nofollow` on group pages and the API. Tokens travel only in the `Authorization` header (the code says so and the live scan found no query strings). Keys and tokens live in the URL fragment, which browsers do not send; the app removes the fragment from the address bar after the link is saved. External links use `noopener noreferrer` | No leak found. Residual: the browser's history holds the link until it is saved (documented) |
| Credentials, addresses, wishlists and references on the wire | `tests/live/privacy-scan.spec.ts` drove a host and four people through create, join, draw, assignment, "sent", confirm and the glass box on the deployed staging instance and recorded every request and response. No private key, no bearer token (outside its owner's own `Authorization` header), no address (first 20 or last 14 characters), no wishlist text appeared in any URL, header, request body or response body; no request carried a `Referer` | Passed |
| Third-party requests | The same scan: the pages contacted only the app, the human-check host (`mummer-staging-check`) and `challenges.cloudflare.com` (inside the check frame). The CSP allows nothing else on app pages. No analytics, no external fonts | Passed |
| Assignment and cross-person authorization | 55 replays of each session's authenticated reads with every other person's token and with no token. None returned data that only the original session had received (sealed profiles, assignments, acknowledgment data); none was rate-limited. The 409-test suite also covers removed or revoked members, stale writes, recipient-only reveals and strangers | Passed |
| Host access | The host's glass box and dashboard return counts, nicknames and redacted rows only; the scan found no address or wishlist in anything the host's browser received besides the sealed blobs the host is meant to open for the draw | Intended visibility only |
| Public information | `/api/stats` publishes nothing until at least 5 exchanges exist (live: `available: false`). Group pages and the API return 401 without a token (live probe) | Passed |
| Payment request data | The QR and "Open in my wallet" link carry the recipient's address, the amount and a memo made of a random reference plus an optional note the giver types. Nothing identifying the giver or the group is added by the app | Intended |
| Server-side logging | The Worker logs only `api_error` (with ids and long blobs masked) and `price_unavailable`; no request bodies or headers. `[observability] enabled = false` in the deployed configuration; the settings API shows no log destination, no log push and no tail consumers | Configuration confirmed. The dashboard toggle and Cloudflare's own edge logging were **not** inspected |

## Findings

| # | Finding | Exploit path | Severity | Status |
|---|---|---|---|---|
| 1 | The README, the submission text and the demo narration said everything a person enters at joining is "sealed in the browser". The nickname is not sealed: the group and the server can read it (as `docs/PRIVACY.md` and the threat model already stated) | None; an accuracy problem. A reader would wrongly believe the server cannot see nicknames | Medium for a project that is judged on its privacy claims; no data exposure | **Fixed**: README, submission text and PRIVACY wording corrected; the video was re-recorded with corrected narration |
| 2 | When a recipient types the gift reference to confirm a gift, the reference is sent to the server in clear and compared with a stored hash | The server learns a random 80-bit reference. It cannot tie it to a giver (the reference is only in the giver's sealed assignment and, at the draw, the host's browser), so it learns nothing it did not know | Low (informational) | Documented in `docs/PRIVACY.md`; the live scan allows it only in that one request |
| 3 | The address commitment stored per member lets someone who holds the database confirm a **guessed** address | A database reader who already has a candidate address checks it against the hash | Low; already documented | Unchanged |
| 4 | A host (or an operator serving altered JavaScript) can read what the draw needs, or swap code | Trusted-host design; documented as the main residual risk | Known design limit | Unchanged; stated in the README, submission and app |
| 5 | The Worker sends the visitor's IP address and the Turnstile token to Cloudflare to verify the human check | As described in Turnstile's documentation | Low | Now stated in `docs/PRIVACY.md` |
| 6 | Cloudflare edge logging and the dashboard Workers Logs toggle were not inspected | Unknown until someone looks | Unknown | Open: needs a person with the dashboard (steps in the final report) |

## Limits of this audit

- The authenticated flows were scanned on **staging**, because production's real Turnstile challenge needs a person. Staging runs the same commit, differs only in its Turnstile test keys and its database, and is the instance the video shows.
- It covers one four-person journey and a fixed set of requests. It is not fuzzing, a cryptographic proof, a penetration test or an independent review.
- Nothing about real wallets was tested: whether a wallet shows the memo, whether the QR scans, or how a real shielded payment behaves.
- It does not cover what hosting and network providers observe (connection metadata) and cannot reduce it.
- Small groups leak by deduction regardless of the code (use 5 or more).
