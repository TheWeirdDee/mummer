# Deployment

**Status: deployed on Cloudflare's free tier on 2026-10-27.**

| | URL |
|---|---|
| App (production) | https://mummer.mummer-app.workers.dev |
| Human-check host (production) | https://mummer-check.mummer-app.workers.dev |
| App (staging, test keys) | https://mummer-staging.mummer-app.workers.dev |
| Human-check host (staging) | https://mummer-staging-check.mummer-app.workers.dev |

The deployed commit is shown by `/api/health` (field `commit`). Production works end to end except that **creating or joining an exchange needs a person to pass Cloudflare's real Turnstile challenge**, which an automated browser cannot (see "Turnstile"). Nobody has done that yet, so no real exchange has ever been created on production. Facts about Cloudflare below were read from Cloudflare's documentation on 2026-10-26 (page dates in brackets) or observed during this deployment.

## What is deployed

Two Workers per environment, one D1 database per environment, one daily cron:

| Worker | Source | Serves | Bindings |
|---|---|---|---|
| `mummer` | `workers/api` | The web app (Workers static assets, `run_worker_first = true`, SPA fallback) and the JSON API under `/api` | D1 `DB`, assets, secrets `TURNSTILE_SECRET` and `RATE_LIMIT_SALT`, vars `ENVIRONMENT=production`, `TURNSTILE_SITE_KEY`, `HUMAN_CHECK_ORIGIN`, `BUILD_COMMIT` |
| `mummer-check` | `workers/human-check` | One page and one script that host Cloudflare Turnstile, on its own origin | assets, var `PARENT_ORIGIN` (the only origin allowed to frame it and to receive its messages) |

The check host is separate on purpose (decision D-37 in `docs/DECISIONS.md`): Turnstile cannot finish inside an opaque-origin sandbox, and putting Cloudflare's script on the app's own pages would expose private-link fragments and keys. The `workers.dev` subdomain `mummer-app` was registered for the account (it determines the URLs above and can be changed in the dashboard, which would change every URL).

## Cost (free tier is enough to start; nothing here needed a card)

| Limit (Free plan) | Value | Source |
|---|---|---|
| Worker requests | 100,000 per day across all Workers on the account (resets 00:00 UTC); over it, error 1027 | workers/platform/limits [Oct 12 2026] |
| CPU time | 10 ms per request and per cron run | same |
| Subrequests | 50 per invocation | same |
| Cron triggers | 5 per account (Mummer uses 1) | same |
| Static asset requests | "free and unlimited", **but** with `run_worker_first = true` every page and asset hit reaches the Worker script, so treat each as one of the 100,000 (an inference, not a documented number). The check host is a second Worker with the same property | workers/static-assets/billing-and-limitations [Apr 23 2026], static-assets/binding [Oct 12 2026] |
| D1 | 500 MB per database, 10 databases, 5 GB per account; 5 million rows read and 100,000 rows written per day; 50 queries per invocation (a `batch()` counts as one) | d1/platform/limits [Oct 24 2026], d1/platform/pricing [Apr 21 2026] |
| Turnstile | Free, unlimited challenges; 20 widgets per account, 10 hostnames per widget | turnstile/plans [Aug 14 2026] |

Paid D1 for scale (not needed to start): $0.001 per million rows read and $1.00 per million rows written beyond 25 billion and 50 million per month. Whether the free plan needs a payment method on file was not stated in the documentation; **no billing was enabled and none was asked for** during this deployment. Do not enable a paid plan without the account owner's approval.

**Design option if traffic ever nears 100,000 requests a day:** `run_worker_first` accepts patterns with `!` negations so only `/api/*` runs the Worker and assets are served directly. That would bypass the security-header wrapper for those assets, so it needs headers via `_headers` and its own tests. Not done.

## Environment variables and secrets

| Name | Kind | Where | Purpose |
|---|---|---|---|
| `ENVIRONMENT` | var | `workers/api/wrangler.toml` | `production` enforces the human check and the salt; never relax it in production |
| `TURNSTILE_SITE_KEY` | var (public) | same | Served by `/api/config` |
| `HUMAN_CHECK_ORIGIN` | var (public) | same | The separate check host, no trailing slash. Required for the check to appear; the client refuses an origin equal to its own |
| `TURNSTILE_SECRET` | **secret** | `wrangler deploy --secrets-file` or `wrangler secret put` | Server-side Turnstile verification; if missing in production the check **fails closed** |
| `RATE_LIMIT_SALT` | **secret** | same | Salt for hashed rate-limit buckets; required in production |
| `BUILD_COMMIT` | var | `wrangler deploy --var BUILD_COMMIT:<sha>` | Shown by `/api/health` |
| `PRICE_URL` | var, optional | | Replaces both built-in price sources (CoinGecko, then Kraken) with one CoinGecko-format URL |
| `PARENT_ORIGIN` | var | `workers/human-check/wrangler.toml` | See above |

Secrets are never committed. They were uploaded with `--secrets-file` from a file outside the repository that was deleted immediately afterwards; Cloudflare stores them write-only.

## How it was deployed (repeatable)

```bash
# Once
cd workers/api && npx wrangler d1 create mummer                       # put the printed database_id in wrangler.toml
npx wrangler d1 migrations apply mummer --remote                      # applies 0001 and 0002

# Turnstile widget (API; the wrangler OAuth login includes the challenge-widgets scope). Domain = the CHECK host, mode managed.
#   POST /accounts/<id>/challenges/widgets  {"name":"Mummer","domains":["<check host>"],"mode":"managed","bot_fight_mode":false,"region":"world"}
#   The response holds the public sitekey and a secret; the secret goes straight into the secrets file, never into chat or git.

# Every deploy, from the repository root
npm ci && npm run typecheck && npm test && npm run build
cd workers/human-check && npx wrangler deploy                         # the check host first
cd ../api && npx wrangler deploy --var BUILD_COMMIT:$(git rev-parse --short HEAD) [--secrets-file <outside-the-repo>.json]
```

`wrangler secret put` creates and deploys a new version immediately, so set secrets before the first `deploy` or use `--secrets-file`. Never deploy with `wrangler.e2e.toml`. The staging copy uses `-c wrangler.staging.toml` in both Worker folders, its own database (`mummer-staging`), and Cloudflare's public test keys.

Migrations are `0001_init.sql` and `0002_commitments_and_versions.sql`. The daily cron (`17 3 * * *` UTC) deletes exchanges more than 30 days past their reveal date and prunes rate-limit rows and expired tickets.

## Turnstile (what was found, and what a person must do)

- **The first design failed in production and was replaced.** An `<iframe sandbox="allow-scripts">` gives the frame an opaque origin; Turnstile's challenge frame inherits it and Turnstile discards its messages ("Ignored message from wrong origin: null", error 300030). Even Cloudflare's always-pass test key never produced a token. Local tests could not see this because the check is off in development. The page now lives on the separate `mummer-check` origin (D-37). Cloudflare's documentation does not cover the sandboxed case; one public report matched the symptom.
- **Verified on production:** `/api/config` reports the check required with the right site key and origin; the check frame loads, runs and shows Cloudflare's real "Verify you are human" widget; with Cloudflare's always-pass key the identical production frame delivers a token to the app with the verified origin `https://mummer-check.mummer-app.workers.dev` and no origin warnings.
- **Not possible to automate:** the real managed challenge holds an automated browser (headless and headed) in its waiting state, as designed. **A person must open https://mummer.mummer-app.workers.dev/new once, pass the check, and create a throwaway exchange to prove the last step on production** (see "Manual steps").
- **Verified on staging with test keys:** the whole journey, through the real Workers runtime and D1 (below).
- The server accepts a token only if Cloudflare says it was solved on the check host (the hostname field), except for responses Cloudflare itself marks as made with a test key, whose placeholder hostname is `example.com`.

## Logging (privacy decision)

New Workers have Workers Logs on by default (invocation logs hold request metadata and `console` output is kept for 3 days on Free). `wrangler.toml` sets `[observability] enabled = false` for every Worker. **Checked through the API (2026-10-27):** the settings of all four Workers show `logpush: false`, no tail consumers and no observability block, which is consistent with logging being off but does not state it outright, so **confirm in the dashboard (Workers & Pages, each Worker, Observability)**. `wrangler tail` streams logs in real time without storing them; it showed the Worker's own `price_unavailable` diagnostic during this deployment. Logpush is a paid feature and is not used. Cloudflare's privacy policy says edge request data may include IP addresses and gives no retention figure; the product copy claims nothing beyond "hosting providers can see connections".

The Worker logs only for unexpected errors (method, route with ids masked, error name, masked message, network cause, top stack frames) and for an unavailable price (the reasons per source). Never bodies, headers, tokens, query strings or ids.

## Verification on the live deployment (2026-10-27)

Run `LIVE_URL=<origin> EXPECT_COMMIT=<sha> npx playwright test -c playwright.live.config.ts` (`tests/live`).

| Check | Production | Staging |
|---|---|---|
| `/api/health`: `ok`, `production`, expected commit; `/api/config`: check required, origin present | passed | passed |
| Headers on `/`: CSP with no `unsafe-inline` and no Cloudflare origin, `frame-src 'self' <check origin>`, HSTS, `no-referrer`, `nosniff`, `X-Frame-Options: DENY`, `no-store`; absolute `og:image` that loads; real 404 for unknown pages; no `/human-check` on the app; the check host frames only for the app and serves only its page and script | passed | passed |
| axe-core (WCAG 2.0 to 2.2 A/AA plus best practice) and no horizontal scroll on 9 public pages at 390 and 1280 px | passed | passed |
| Full journey in a real browser: create (human check), four joins, draw, assignment with payment QR and a live price quote, sent, confirmations with references, link replacement (old link dead, new link opens the same assignment), glass box with sealed blobs only, delete (links stop working), no console errors, no third-party origin contacted by the pages | **not run: needs a person to pass the real challenge** | passed |
| Reveal day | not testable on a live deployment: the clock cannot be moved; the earliest reveal is about 16 hours after creating an exchange in the Pacific/Kiritimati timezone | not testable |

**Database contents (real D1, 2026-10-27).** Production: zero exchanges, zero members, zero assignments, one hashed rate-limit counter. Staging after the journey: sealed profiles and bundles all exactly 747 characters (padding), tokens and commitments 64-character hashes, dates at day granularity, `ack_commitments` without any member-to-member link column, and no occurrence of the wishlist text or an address prefix in any sealed column. The leftover test exchange was then deleted.

**Findings from the first real deployment** (each fixed, with a test that fails without the fix): the sandboxed Turnstile frame (above); CoinGecko answering 403 to Workers, now Kraken as a second source (`services.test.ts`); Cloudflare's test keys returning a placeholder hostname (`services.test.ts`); and the test helper's spoofed `cf-connecting-ip` header, which Cloudflare's edge rejects with Error 1000 (only affects tests).

## Manual steps that remain

1. **Pass the real Turnstile once on production.** Open https://mummer.mummer-app.workers.dev/new in a normal browser, fill the form, tick the Cloudflare checkbox, create the exchange, join once from a second browser profile, then delete the exchange from its admin page. If the widget does not show, check that the widget's hostname list in the dashboard (Turnstile) contains exactly `mummer-check.mummer-app.workers.dev`.
2. **Confirm logging is off** in the dashboard for `mummer` and `mummer-check` (Observability).
3. **Reveal day on a live exchange**: create one in the Pacific/Kiritimati timezone with the earliest dates and check the reveal screen about 16 hours later.

## Rollback

`npx wrangler rollback` (run in the Worker's folder) restores the previous version. Migrations are additive. To remove all data, delete the D1 database; to take the site down, delete the Workers.

## Monitoring and operations

- The dashboard shows request volume and errors; Mummer adds no analytics or error-reporting service.
- Abuse: tune the limits in `workers/api/src/routes/*.ts` and consider Cloudflare's WAF rules.
- Record what the platform retains at the edge for the account before making any statement about operator visibility (gate R09; the documentation gives no retention figure for end-user logs).

## Sources (accessed 2026-10-26 unless noted)

developers.cloudflare.com: /workers/platform/limits, /workers/platform/pricing, /workers/static-assets/billing-and-limitations, /workers/static-assets/binding, /workers/wrangler/configuration, /workers/wrangler/commands/workers, /workers/configuration/routing/workers-dev, /workers/observability/logs/workers-logs, /workers/observability/logs/real-time-logs, /d1/platform/limits, /d1/platform/pricing, /d1/wrangler-commands, /turnstile/plans, /turnstile/get-started/server-side-validation, /turnstile/troubleshooting/testing, /turnstile/reference/content-security-policy, /turnstile/troubleshooting/client-side-errors/error-codes. Privacy policy: cloudflare.com/privacypolicy (effective Nov 4 2025). Sandboxed-iframe report: github.com/Baroshem/nuxt-security/issues/666.

## Not verified

Whether the free plan requires a payment method; edge request-log retention; whether invocation logs include client IPs (logging is configured off); whether `run_worker_first` requests count towards the 100,000 per day (assume yes); the real managed Turnstile challenge on production (needs a person).
