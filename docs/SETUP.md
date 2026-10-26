# Setup

Tested on Windows 11 with Node 24.13 and npm 11.8. Any current Node 22 or newer should work.

## 1. Install

```bash
git clone <repository-url> mummer
cd mummer
npm ci
```

`npm ci` installs from the committed lockfile. Dependencies include `libsodium-wrappers`, `@noble/hashes`, `@scure/base`, `zod`, `hono`, `react`, `react-router-dom`, `qrcode-generator`, and (dev) `vite`, `vitest`, `wrangler`, `miniflare`, `@playwright/test`, `@axe-core/playwright`.

For browser tests, download Chromium once:

```bash
npx playwright install chromium
```

## 2. Run the checks

```bash
npm run typecheck          # every package, strict TypeScript
npm test                   # Vitest: unit, API integration (real D1 via Miniflare) and security suites
npm run build              # type-checks and builds the web app into apps/web/dist
npx playwright test        # real-browser tests (starts its own server on port 8788)
```

`npx playwright test` runs `scripts/e2e-server.mjs`, which builds the web app, creates a fresh local database from the real migrations, and starts the Worker with the end-to-end test entry (controllable clock, fixed price). Reports go to `playwright-report/`, screenshots to `tests/e2e/.artifacts/screens/`.

## 3. Run locally for development

One command starts everything:

```bash
npm run dev
```

`scripts/dev.mjs` creates a gitignored `workers/api/.dev.vars` if there is none, applies the migrations to a throwaway local database, then runs the Worker (API, port 8787) and the Vite dev server (web app with hot reload, port 5173, `/api` proxied). Open **http://127.0.0.1:5173**. Press Ctrl+C once to stop both. Nothing touches Cloudflare.

The two halves can also be run separately: `npm run dev:api` (after `npm run -w @mummer/api migrate:local`) and `npm run dev:web`. To serve the built app from the Worker instead, run `npm run build` first and open http://127.0.0.1:8787.

With `ENVIRONMENT=development` and no Turnstile secret, the human check is not required. With `ENVIRONMENT=production` (the default in `wrangler.toml`) it is required and **fails closed** if `TURNSTILE_SECRET` is missing.

## 4. Environment variables

| Name | Where | Secret? | Purpose |
|---|---|---|---|
| `ENVIRONMENT` | `[vars]` / `.dev.vars` | no | `production` enforces everything; `development` and `test` may relax the human check |
| `TURNSTILE_SITE_KEY` | `[vars]` | no | Public Turnstile site key served by `/api/config` |
| `TURNSTILE_SECRET` | `wrangler secret put` | **yes** | Turnstile server secret |
| `RATE_LIMIT_SALT` | `wrangler secret put` | **yes** | Salt for hashed rate-limit buckets |
| `BUILD_COMMIT` | `[vars]` (set by deploy) | no | Shown by `/api/health` to identify the deployed build |
| `PRICE_URL` | optional | no | Override the public price endpoint (defaults to CoinGecko's simple price API) |

No secret value is ever committed. `.dev.vars` and `.env*` are gitignored.

## 5. Repository layout

```
apps/web/            React + Vite front end (design system, pages)
workers/api/         Cloudflare Worker (Hono), D1 migrations, E2E entry
packages/crypto/     keys, sealed boxes, tokens, references, backup, protocol helpers
packages/zcash/      ZIP 316 address validation, ZIP 321 requests, memo and money
packages/draw/       Sattolo single-cycle draw with exclusions
packages/shared/     schemas, limits, state machines, timezone logic
tests/e2e/           Playwright journeys, validation, recovery, a11y, responsive, security
tests/security/      adversarial and leakage tests (Vitest, real database)
docs/                architecture, threat model, decisions, evidence, requirements matrix
scripts/             e2e server, commit helpers, screenshot tool
```

## Troubleshooting

- *`wrangler dev` cannot find the assets directory:* run `npm run build` first.
- *Port in use:* `E2E_PORT=8790 npx playwright test`, or choose another port for `wrangler dev`.
- *Windows and Git Bash:* arguments that start with `/` are rewritten to Windows paths. Pass paths without a leading slash to `scripts/screenshot.mjs` (use `.` for the home page).
