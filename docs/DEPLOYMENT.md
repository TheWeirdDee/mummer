# Deployment

**Status: not deployed.** No Cloudflare account, project or repository was designated for this work, so nothing has been pushed or published, and no claim is made about a live URL. Everything below is verified locally (`wrangler dev --local`, `wrangler d1 migrations apply --local`) except the steps that need an account, which are marked **needs account**.

## Prerequisites (**needs account**)

1. A Cloudflare account with Workers and D1 enabled (the free tier is sufficient for a hackathon-scale exchange). Enabling paid plans needs the account owner's explicit approval.
2. `npx wrangler login` (interactive OAuth), or an API token with Workers and D1 edit permission exported as `CLOUDFLARE_API_TOKEN`.
3. A Turnstile widget (Cloudflare dashboard → Turnstile) for the domain, giving a **site key** (public) and **secret key**.

## Steps

```bash
# 1. Database
cd workers/api
npx wrangler d1 create mummer          # note the database_id it prints
# Edit wrangler.toml: replace the placeholder database_id with the returned id.

# 2. Secrets (never committed)
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put RATE_LIMIT_SALT      # a long random string, for example: openssl rand -hex 32

# 3. Public configuration: edit [vars] in wrangler.toml
#    TURNSTILE_SITE_KEY = "<site key>"
#    BUILD_COMMIT       = "<git commit sha being deployed>"

# 4. Build, migrate, deploy
cd ../..
npm ci && npm run typecheck && npm test && npm run build
cd workers/api
npx wrangler d1 migrations apply mummer --remote
npx wrangler deploy
```

`wrangler.toml` keeps `ENVIRONMENT = "production"` by default: the human check is enforced and fails closed. Never deploy with `wrangler.e2e.toml`.

The Worker also has a daily cron (`17 3 * * *` UTC) that deletes exchanges more than 30 days past their reveal date and prunes rate-limit rows and expired human-check tickets.

## Pre-deployment checklist

- [ ] `npm run typecheck`, `npm test`, `npm run build` pass; `npx playwright test` passes.
- [ ] `npm audit` reports 0 vulnerabilities.
- [ ] `database_id` is the real one; secrets set; `BUILD_COMMIT` equals the commit being deployed.
- [ ] `git status` is clean and the commit is pushed to the intended remote (verify with `git remote -v` and `git ls-remote`).
- [ ] Migrations applied with `--remote` (not `--local`).

## Post-deployment verification (do all of these against the live URL)

1. `GET /api/health` returns `ok:true`, `environment:"production"`, and the expected commit.
2. `GET /api/config` shows `humanCheckRequired:true` and a site key.
3. Response headers on `/`, `/privacy`, a `/g/<id>` page, `/api/health` and `/human-check` match `docs/SECURITY.md` (CSP, HSTS, `no-referrer`, `nosniff`, frame options; `immutable` caching only on `/assets/*`).
4. Create an exchange from a phone: the Turnstile widget loads inside the sandboxed frame and a ticket is issued. **This is the first real test of Turnstile and has not been run here.**
5. Join from a second browser profile, draw, open an assignment, confirm the QR and copy fields, acknowledge, delete. Confirm links stop working after deletion.
6. Open the browser console on every page: no errors, no blocked resources, no requests to third-party origins other than the `challenges.cloudflare.com` frame on create/join.
7. Check that the Worker's logs contain no bodies, tokens or addresses (`wrangler tail` during a full flow).
8. Inspect the deployed D1 data (`wrangler d1 execute mummer --remote --command "SELECT ..."`) for the exchange you just made: only sealed blobs and hashes.
9. Re-run `npx playwright test` with `E2E_BASE_URL` pointed at the deployment for the read-only and security specs (the full-journey spec needs the test clock and is local only).

## Rollback

`npx wrangler rollback` restores the previous Worker version. Migrations are additive; there is one (`0001_init.sql`). To remove all data, delete the D1 database.

## Monitoring and operations

- Use Cloudflare's dashboard for request volume and errors; Mummer deliberately adds no analytics or error-reporting service (no third-party scripts, no body logging).
- The Worker logs only `api_error { route, name }` for server errors, with ids redacted.
- Abuse: tune the limits in `workers/api/src/routes/*.ts` and enable Cloudflare's WAF rules for the domain.
- Record what the platform retains at the edge (log retention, analytics) for your account before making any statement about operator visibility (open gate R09).
