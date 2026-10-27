# Baseline audit

Recorded at the start of the build, 26 October 2026 (before any code was written).

## Environment

| Item | Finding |
|---|---|
| Working directory | `C:\Users\DELL\Desktop\mummer`, containing only the two PRDs (`Mummer PRD v0.1.md`, `Mummer_PRD_v1.0_Revised.md`) |
| Git | Not a repository (initialized during Phase 1: branch `main`, local identity from the user's global config) |
| Node / npm | Node 24.13.1, npm 11.8.0, pnpm 11.5.0 available |
| GitHub CLI | Installed and signed in; **no repository or destination was designated**, so nothing has been pushed or published |
| Cloudflare | `wrangler` not installed globally (added as a project dev dependency); **no Cloudflare credentials** in the environment; no existing Cloudflare project designated; no environment-variable names relating to Cloudflare, Turnstile or GitHub tokens |
| Browser automation | Playwright not present; installed locally with Chromium |
| Zcash tooling | None installed; no wallet; no funds |
| Existing documentation | The two PRDs only |

## Existing, missing, assumed, external, risky

| Category | Items |
|---|---|
| **Existing** | PRD v0.1 (vision) and PRD v1.0 (revised specification) |
| **Missing** | Everything else: code, tests, docs, design system, deployment configuration |
| **Unverified assumptions (from the PRDs)** | Zodl scanning of ZIP 321 QR with memo and amount (R01, R02); Zodl fresh-receiver behaviour (R03); Cloudflare edge logging (R09); recovery on real devices (R10); a real group completing a shielded exchange (R12); Turnstile behaviour in a sandboxed frame |
| **External dependencies** | Cloudflare account, D1, Turnstile site key and secret, a price source, a Zcash wallet, real ZEC and consenting participants |
| **Security risks identified up front** | Trusted-host draw; anonymous sealed boxes (profile forgery, address substitution by an operator); bearer-link compromise; metadata at the edge; third-party script (Turnstile) on pages that handle secrets; per-recipient commitments as pairing metadata; row/insertion order and timestamps as correlation channels |
| **Deployment prerequisites** | Account authorization, D1 database id, secrets, a designated deploy destination (none given) |

## How the findings were used

| Finding | Response |
|---|---|
| No ZIP 316 decoder on npm | Wrote one on audited primitives and proved it against the official vectors (`docs/INTEGRATION_RESEARCH.md`) |
| Standard libsodium build lacks argon2 | Used audited `@noble/hashes` argon2id, validated against RFC 9106 |
| Turnstile is a third-party script | Isolated it on a separate origin (D-37; the first design, an opaque-origin sandbox, does not work), exchanged for single-use tickets (D-18) |
| Commitments, row order and timestamps could correlate pairs | Keyed by role, `WITHOUT ROWID`, id-sorted submission, day-bucketed times, aggregate-only progress |
| Hono header merging (found in testing) | Headers applied in an outer wrapper (D-08) |
| No deploy destination or credentials | Prepared and verified everything locally; documented the exact steps and marked deployment pending |
