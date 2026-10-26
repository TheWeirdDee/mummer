# Security

Mummer is a pre-release hackathon project. **It has not had an independent security review.** The automated tests described in `docs/TESTING.md` are not a substitute for one.

## Reporting a vulnerability

Open a private security advisory on the repository, or contact the maintainers listed there. Please do not post private links, member data or exploit details publicly. There is no bounty. Expect an acknowledgment, not an SLA.

## Controls implemented

### Transport and headers (every response, including static files and errors)

| Header | Value | Why |
|---|---|---|
| `Content-Security-Policy` | `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests` | No inline script, no `eval`, no third-party origins. `'wasm-unsafe-eval'` allows WebAssembly (libsodium) only. |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | |
| `Referrer-Policy` | `no-referrer` | Private-link fragments are never sent; there is no Referer at all. |
| `X-Content-Type-Options` | `nosniff` | |
| `X-Frame-Options` | `DENY` (`SAMEORIGIN` for the human-check frame) | |
| `Permissions-Policy` | camera, microphone, geolocation, payment, USB denied | |
| `Cross-Origin-Opener-Policy` / `-Resource-Policy` | `same-origin` | |
| `Cache-Control` | `no-store` for HTML and API; `public, max-age=31536000, immutable` for hashed `/assets/*` | |
| `X-Robots-Tag` | `noindex, nofollow` on `/g/*`, `/new`, `/recover`, `/api/*` | Private routes are not indexable. |

The **only** page allowed to load a third-party script is `/human-check`, with its own CSP permitting `challenges.cloudflare.com`. The app embeds it as `<iframe sandbox="allow-scripts">`, which gives it an opaque origin: it cannot read the app's DOM, storage, keys or fragments. The parent verifies `event.source` on the message it receives. (Tested: the parent cannot read the frame's document.)

### Authentication and authorization

- No accounts and no cookies. Authorization is a 256-bit bearer token in an `Authorization` header; the server stores only its SHA-256 and compares in constant time. Unknown group/member and wrong token return the same `401`.
- Every route enforces its role server-side before touching the body or state; the UI never carries authorization.
- Cross-group access is impossible by construction: every query scopes by group id and member id; foreign keys and composite primary keys back this up.
- No CORS headers are emitted; tokens are never accepted in URLs. A cross-site page cannot ride ambient credentials because there are none.

### Input and output

- Strict Zod schemas on every body (unknown fields rejected); request bodies capped at 96 KiB while streaming; ids validated as 32 hex characters; control characters rejected in names and wishlists; NFKC-normalized uniqueness for nicknames.
- Parameterized SQL only. User text is rendered by React as text; there is no `dangerouslySetInnerHTML`; the QR is rendered as an SVG path, not injected markup.
- Errors are generic for server faults (`internal`) and carry no request data.

### Abuse resistance

- D1 fixed-window rate limits with salted-hash keys (client address never stored in clear), a human check on creation and joining that **fails closed in production**, member caps enforced inside the `INSERT`, 10 wrong references per hour per person, single-use human-check tickets.
- Atomic, idempotent state transitions (compare-and-swap in SQL): one draw per exchange even under simultaneous requests; duplicate acknowledgments counted once; concurrent rotations cannot both win.

### Data minimization and retention

See `docs/PRIVACY.md`. Exchanges are deleted 30 days after the reveal date or on host request; rate-limit rows after two hours; tickets after ten minutes.

### Supply chain

Committed lockfile; `npm audit` clean (0 vulnerabilities); patched `undici` and `sharp` pinned for dev tooling by overrides; cryptography only from audited libraries; CI runs `npm ci`, type checks, tests, `npm audit` and the browser suite.

## Verified by tests

Authorization matrix (every endpoint × none/foreign host/member/host), cross-member and cross-group denial, replay and cross-context rejection, request/response/database leakage scans for plaintext, timing-safe credential handling, injection and hostile-input cases, concurrency races, headers on every response type, CSP enforcement in a real browser, and absence of secrets in URLs, headers, referrers, bodies and storage. See `tests/security/` and `tests/e2e/browser-security.spec.ts`.

## Known weaknesses (not fixed in this release)

1. **Trusted-host draw:** the host's browser can observe the pairings.
2. **Operator-served code:** like every web app, a compromised or malicious operator can serve altered JavaScript. Sealed boxes are anonymous, so an operator can also substitute an address for a member's. Mitigations reduce but do not remove this.
3. **Self-reported states:** "sent" and "received" are personal notes, never verified.
4. **Metadata:** IP addresses and timing at the platform edge are outside Mummer's control and were not inspected.
5. **Real Turnstile and real wallets** have not been exercised in this environment.
6. Local storage on a device holds that person's key and token. XSS (prevented by CSP) or a hostile extension could read it.
