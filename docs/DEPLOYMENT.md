# Deployment

**Status: not deployed.** No Cloudflare account was designated for this work and nothing has been deployed; no claim is made about a live URL. The code is on GitHub (private-by-intent, currently public) but that is not a deployment. Everything below is verified locally (`wrangler dev --local`, `wrangler d1 migrations apply --local`, and `wrangler deploy --dry-run`, which validates `wrangler.toml` and the asset bundle without contacting Cloudflare) except the steps that need an account, which are marked **needs account**.

Facts about Cloudflare below were read from Cloudflare's own documentation on **2026-10-26** (page "last updated" dates in brackets). Cloudflare changes limits and prices; re-check before relying on them.

## What gets deployed

One Cloudflare Worker (`workers/api`, name `mummer`) that serves **both** the static web app (Workers static assets, `[assets]` binding with `run_worker_first = true`, `not_found_handling = "single-page-application"`) and the JSON API under `/api`. One D1 database (binding `DB`), one daily cron trigger. It is Workers static assets, not Pages. Bundle size on the last dry run: 970 KiB uploaded, 173 KiB gzip, 53 asset files.

## Cost (free tier is enough to start; nothing here needs a card unless you choose a paid plan)

| Limit (Free plan) | Value | Source |
|---|---|---|
| Worker requests | 100,000 per day (resets 00:00 UTC); over it, error 1027 | workers/platform/limits [Oct 12 2026] |
| CPU time | 10 ms per request and per cron run | same |
| Subrequests | 50 per invocation | same |
| Cron triggers | 5 per account (Mummer uses 1) | same |
| Static asset requests | "free and unlimited", **but** with `run_worker_first = true` every request reaches the Worker script, so treat every page and asset hit as one of the 100,000 Worker requests (this is an inference from two statements in the docs, not a documented number) | workers/static-assets/billing-and-limitations [Apr 23 2026], static-assets/binding [Oct 12 2026] |
| D1 | 500 MB per database, 10 databases, 5 GB per account; 5 million rows read and 100,000 rows written per day; 50 queries per Worker invocation (a `batch()` counts as one) | d1/platform/limits [Oct 24 2026], d1/platform/pricing [Apr 21 2026] |
| Turnstile | Free, unlimited challenges; 20 widgets per account, 10 hostnames per widget | turnstile/plans [Aug 14 2026] |
| Workers Logs (if left on) | 200,000 events/day, 3 days retention on Free | observability/logs/workers-logs [Oct 12 2026] |

Paid D1 for scale (not needed to start): $0.001 per million rows read and $1.00 per million rows written beyond 25 billion and 50 million per month (d1/platform/pricing). Whether the free plan needs a payment method on file was **not stated in the pages read**; check at sign-up. **Do not enable a paid plan without the account owner's approval.**

**Design option if traffic ever nears 100,000 requests a day:** `run_worker_first` also accepts an array of patterns with `!` negations, so only `/api/*` and `/human-check` would run the Worker while other assets are served directly. That would also bypass the security-header wrapper for those assets, so it needs a deliberate redesign (headers via `_headers`) and its own tests. Not done.

## Prerequisites (**needs account**)

1. A Cloudflare account. Workers and D1 are available on the free plan.
2. Either `npx wrangler login` (interactive OAuth in a browser; requests all scopes unless limited with `--scopes`, list them with `wrangler login --scopes-list`), **or** an API token for CI. For a token (Account API tokens, scoped to the one account) the documented permissions are **Workers Scripts: Edit** and **D1: Edit** (the dashboard's "Edit Cloudflare Workers" template; it was **not verified** whether that template includes D1, so check the token's permission list and add Account / D1 / Edit if missing). Export as `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
3. A **workers.dev** subdomain. If the account has none, Wrangler offers to create one during the first deploy. Default URL: `https://mummer.<your-subdomain>.workers.dev`. A custom domain is not required (and nothing here buys one); Cloudflare suggests a custom domain for production.
4. A **Turnstile widget** (dashboard, Turnstile): give it the hostname the Worker will be served from, widget mode *Managed* (recommended by Cloudflare). This yields a public **site key** and a **secret key**.

## Environment variables and secrets

| Name | Kind | Where set | Purpose |
|---|---|---|---|
| `ENVIRONMENT` | var | `[vars]` (default `production`) | `production` enforces the human check and requires the rate-limit salt; never change it in production |
| `TURNSTILE_SITE_KEY` | var (public) | `[vars]` | Served by `/api/config` |
| `TURNSTILE_SECRET` | **secret** | `wrangler secret put TURNSTILE_SECRET` | Server-side Turnstile verification; if missing in production the human check **fails closed** (creating and joining stop working) |
| `RATE_LIMIT_SALT` | **secret** | `wrangler secret put RATE_LIMIT_SALT` | Salt for hashed rate-limit buckets; required in production (use `openssl rand -hex 32` or similar) |
| `BUILD_COMMIT` | var | `[vars]` | Shown by `/api/health` |
| `PRICE_URL` | var, optional | `[vars]` | Override of the price source |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | CI only | CI secret store | Deploy credentials; never in the repo |

Turnstile has official **test** keys (always-pass site key `1x00000000000000000000AA` with secret `1x0000000000000000000000000000000AA`; always-fail `2x00000000000000000000AB` with `2x0000000000000000000000000000000AA`; they work on any domain). They are for development only. Never put them on the production Worker.

## Steps

```bash
# 0. Pre-flight (all local)
npm ci && npm run typecheck && npm test && npm run build && npx playwright test
cd workers/api && npx wrangler deploy --dry-run --outdir /tmp/mummer-dryrun   # validates config; deploys nothing

# 1. Database  (needs account)
npx wrangler d1 create mummer          # note the database_id it prints
# Edit workers/api/wrangler.toml: replace the placeholder database_id with the returned id.

# 2. Secrets (never committed)
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put RATE_LIMIT_SALT

# 3. Public configuration: edit [vars] in wrangler.toml
#    TURNSTILE_SITE_KEY = "<site key>"
#    BUILD_COMMIT       = "<git commit sha being deployed>"

# 4. Migrate then deploy (from workers/api)
npx wrangler d1 migrations apply mummer --remote     # applies 0001 and 0002; a failed migration is rolled back
npx wrangler deploy
```

`wrangler secret put` creates and deploys a new Worker version immediately, so set the secrets before the first `deploy`, or expect a version with a missing secret in between (Mummer fails closed, it does not run open). Never deploy with `wrangler.e2e.toml`.

Migrations are `0001_init.sql` and `0002_commitments_and_versions.sql`. The Worker also has a daily cron (`17 3 * * *` UTC) that deletes exchanges more than 30 days past their reveal date and prunes rate-limit rows and expired human-check tickets.

## Logging (privacy decision)

New Workers have Workers Logs **enabled by default** (invocation logs hold request metadata, and `console` output is kept for 3 days on Free). `wrangler.toml` therefore sets `[observability] enabled = false` explicitly. The docs do not say whether invocation logs contain client IPs, and do not say that `enabled = false` is honoured for a Worker that already has logging on, so **verify in the dashboard after the first deploy** that nothing is being stored. `wrangler tail` streams logs in real time without storing them (it shows request URL, method, headers and `cf` data to whoever runs it, so run it only on your own machine). Logpush is a paid feature and is not used. Cloudflare's privacy policy says edge request data may include IP addresses and gives no retention figure for end-user logs; the product copy makes no claim beyond "hosting providers can see connections".

The Worker itself logs only for unexpected errors: method, route with ids masked, error name, a masked 200-character message, the underlying network cause and the top stack frames. Never bodies, headers, tokens, query strings or ids.

## Pre-deployment checklist

- [ ] `npm run typecheck`, `npm test`, `npm run build`, `npx playwright test` pass; `npm audit` reports 0 vulnerabilities.
- [ ] `wrangler deploy --dry-run` succeeds.
- [ ] `database_id` is the real one; both secrets set; `BUILD_COMMIT` equals the commit being deployed.
- [ ] `git status` is clean and the commit is pushed (`git ls-remote origin main` equals `git rev-parse HEAD`).
- [ ] Migrations applied with `--remote` (not `--local`).
- [ ] The Turnstile widget's hostname list contains the exact hostname of the deployment.

## Post-deployment verification (do all of these against the live URL)

Replace `$URL` with the deployed origin.

```bash
curl -s $URL/api/health                       # ok:true, environment:"production", expected commit
curl -s $URL/api/config                       # humanCheckRequired:true and a non-empty site key
curl -sI $URL/ | grep -iE "content-security-policy|strict-transport|referrer-policy|x-content-type|cache-control"
curl -sI $URL/privacy; curl -sI $URL/human-check; curl -sI $URL/definitely-not-a-page   # last one must be 404
curl -sI $URL/assets/$(curl -s $URL/ | grep -o 'assets/index-[^"]*\.js' | head -1 | cut -d/ -f2) | grep -i cache-control   # immutable
```

1. Headers match `docs/SECURITY.md` (CSP with no `unsafe-inline`, HSTS, `no-referrer`, `nosniff`, frame options; `immutable` caching only on `/assets/*`; `no-store` on HTML and API).
2. **Turnstile in the sandboxed frame (the highest-risk check).** The widget runs inside `/human-check`, an iframe with `sandbox="allow-scripts"` and an opaque origin. Cloudflare's docs do not cover this combination, and one public issue reports error 110200 ("domain not authorized") together with a "frame is sandboxed" console message. Create an exchange from a phone and from a desktop. If the widget fails, **do not** add `allow-same-origin` (that would let the frame remove its own sandbox). The fallback options are to serve the frame from a separate origin or to accept the widget in the main page under the strict CSP; either needs a design decision and new tests.
3. Join from a second browser profile, draw, open an assignment, confirm the QR and copy fields, acknowledge, reveal, delete. Confirm links stop working after deletion.
4. Open the browser console on every page: no errors, no blocked resources, no third-party origins except the `challenges.cloudflare.com` frame on create and join.
5. `wrangler tail` during a full flow: no bodies, tokens or addresses in what streams.
6. `wrangler d1 execute mummer --remote --command "SELECT name FROM sqlite_master"` and then inspect rows for the exchange you made: only sealed blobs, hashes and the documented clear columns.
7. Dashboard: confirm Workers Logs is off and note the request count against the 100,000 per day budget.
8. The Playwright suite does **not** run against a deployment (it starts its own server with a controllable clock, a fixed price and a lenient human check). Record the manual results in `docs/EVIDENCE.md`.

## Rollback

`npx wrangler rollback` restores the previous Worker version. Migrations are additive (two so far). To remove all data, delete the D1 database.

## Monitoring and operations

- Use Cloudflare's dashboard for request volume and errors; Mummer deliberately adds no analytics or error-reporting service.
- Abuse: tune the limits in `workers/api/src/routes/*.ts` and consider Cloudflare's WAF rules for the domain.
- Record what the platform retains at the edge for your account before making any statement about operator visibility (open gate R09; the documentation read here gives no retention figure for end-user logs).

## Sources (accessed 2026-10-26)

Workers limits and pricing: developers.cloudflare.com/workers/platform/limits, /workers/platform/pricing, /workers/static-assets/billing-and-limitations, /workers/static-assets/binding, /workers/wrangler/configuration, /workers/wrangler/commands/workers, /workers/ci-cd/external-cicd/github-actions, /workers/configuration/routing/workers-dev, /workers/observability/logs/workers-logs, /workers/observability/logs/real-time-logs, /workers/observability/logs/logpush. D1: /d1/platform/limits, /d1/platform/pricing, /d1/wrangler-commands. Turnstile: /turnstile/plans, /turnstile/get-started, /turnstile/get-started/server-side-validation, /turnstile/troubleshooting/testing, /turnstile/reference/content-security-policy, /turnstile/troubleshooting/client-side-errors/error-codes. Privacy policy: cloudflare.com/privacypolicy (effective Nov 4 2025). Sandboxed-iframe report: github.com/Baroshem/nuxt-security/issues/666.

## Not verified

Whether the free plan requires a payment method; whether the "Edit Cloudflare Workers" token template includes D1; the exact `wrangler login` scope names; whether invocation logs include client IP; edge request-log retention; Turnstile inside a sandboxed opaque-origin iframe; whether `run_worker_first = true` requests count towards the 100,000 per day (assume yes).
