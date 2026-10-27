# Known limitations

Plain statements of what Mummer does **not** do or has **not** verified. The product copy repeats the user-relevant ones.

## Product and privacy

1. **The draw is run by the host's browser (trusted-host).** A host can see or record pairings. Not host-blind. (F14 not built.)
2. **No independent payment proof.** "Sent" and "received" are self-reports. Mummer cannot inspect a shielded payment and has no viewing key. (F15 not built.)
3. **No company-funded mode.** Zodl iOS rejects multi-recipient requests; a funding design needs its own privacy review. (F13 not built.)
4. **Small groups leak by deduction.** Four people can narrow the cycle; five or more is recommended.
5. **A giver knows their recipient** and a recipient may infer their giver from timing, amount or a note.
6. **Address substitution by a malicious operator or database writer** is possible because sealed boxes are anonymous. Two checks narrow it but do not close it: (a) each join sends a hash (the "address commitment") of the nickname and address, which the host's browser re-checks against the opened profile and the giver's browser re-checks against the roster before showing a payment request, so a *database-only* swap is caught; (b) the host's invite link carries a fingerprint of the host's public key, so joiners notice a swapped host key. An operator who serves altered JavaScript can defeat both, and a joiner who opens an invite without the fingerprint gets only a notice. Ask recipients to confirm arrival.
6a. **Redraw griefing.** The draw is pinned to a "members version" so a join or leave between reading and drawing makes the draw fail rather than silently omit someone. A member who repeatedly joins and leaves can therefore make a host retry. Rate limits bound this; it is not eliminated.
6b. **Sealed-blob sizes are bucketed (256-byte steps), not constant.** A very long wishlist can place a profile in a larger bucket, so sizes can hint at content length to an operator.
6c. **The host-plays option** means the host's own assignment is produced by the same browser that knows every pairing. The interface says so.
7. **Network metadata** (IP, timing) is visible to hosting and network providers; platform log retention was not inspected.
8. **Public counts** are rounded and thresholded, but counters are not differentially private.
8a. **The host's "glass box" shows totals** (for example how many have confirmed), never which person has or has not, because that per-person state would let a host narrow who is giving to whom.

## Zcash and wallets

9. **No real wallet was tested.** Whether Zodl iOS or Android fills in the amount and memo from a scanned Mummer QR is unverified (R01/R02, R12). No wallet can run in the development environment (no Windows build of Zodl; no Android emulator tooling or hardware virtualization; see `docs/INTEGRATION_RESEARCH.md`). What exists instead: Mummer's payment requests are accepted and decoded identically by the **reference Rust `zip321` parser** (`npm run test:crosscheck`), which shows another implementation of the specification agrees, **not** that Zodl does. The UI always offers copy buttons and never claims a scan prefilled anything.
10. **Receivers are validated structurally** (checksum, lengths, ordering), not for curve-point validity.
11. A unified address that also contains a transparent receiver is accepted with a warning.
12. **Mainnet only.** Test-network addresses are refused everywhere.
13. **Exchange rate** comes from a single public price source (CoinGecko by default), cached for 60 seconds; quotes are approximate and expire after ten minutes. If the source is down, no request is shown.

## Platform and operations

14. **Not deployed.** The code is on GitHub (https://github.com/TheWeirdDee/mummer, currently public by the owner's choice), but no Cloudflare account or project was designated, so nothing is running anywhere and no live URL is claimed. Deployment and live verification are pending (`docs/DEPLOYMENT.md`).
15. **Turnstile has not been run against Cloudflare**, and its use inside Mummer's sandboxed, opaque-origin frame is not covered by Cloudflare's documentation (one public report links error 110200 to a sandboxed frame). The ticket flow and the sandbox are tested (ticket logic with a verifier double; the sandbox in a real browser). If the widget fails in the sandbox on first deployment, creating and joining stop working (the human check fails closed) until a design decision is made; see `docs/DEPLOYMENT.md`.
16. **No independent security review**, no penetration test, no formal verification.
17. **Rate limiting relies on `CF-Connecting-IP`**, which is trustworthy only behind Cloudflare.
18. **Local storage** keeps a person's key and token on their device for convenience; "Forget this device" removes it, together with any pending link replacement and local reveal guesses. A link that carries a *different* key than the one saved is never applied silently: the person chooses.
19. **Timezone handling** uses the platform's Intl data; exotic historical zone changes are not special-cased.

## Product scope

20. No native app, no email, no push notifications, no calendar file (F16 optional, not built), no languages other than English, no dark theme.
21. Real-money trial with 4 to 5 consenting people (R12): **not done**. No usage figures or user counts are claimed anywhere.

## Accessibility

22. **Accessibility:** automated checks (axe-core, WCAG 2.2 AA tags) and keyboard tests pass for every route and key state at 390 and 1280 px in Chromium, Firefox and WebKit; **no screen reader has been used** (`docs/ACCESSIBILITY_MANUAL_CHECKLIST.md` lists what a person must verify). Treat WCAG conformance as *targeted and automatically checked*, not certified. Safari reaches links only with Option+Tab, which automation cannot press, so the WebKit skip-link test checks document order and focus instead.
23. **Test-infrastructure failure under load (cause established; one original occurrence not proven identical).** One security test once received an HTTP 500 from a join request in one of seven full runs. Diagnostics added to the error handler then captured the same failure under deliberately heavy load: `TypeError: fetch failed` with underlying cause `connect EADDRINUSE 127.0.0.1:<port>`. The integration harness reaches Miniflare's real D1 over a loopback connection; a full suite opens about 4,000 short-lived connections, each lingering in TIME_WAIT for two minutes on Windows, whose dynamic range is 16,384 ports (13,933 were in TIME_WAIT when it failed). This is a limit of the **test environment**, not of the deployed Worker, which reaches D1 through Cloudflare's binding. A guard in the test harness (`workers/api/test/resilient-d1.ts`) now retries only a connect that failed with EADDRINUSE or EADDRNOTAVAIL (nothing was sent, so a repeat cannot duplicate a write), logs each retry, and never retries anything else. Four consecutive full runs afterwards: 0 retries needed, 0 server errors, all passing. The very first occurrence had no diagnostics, so it is consistent with this cause but **not proven** to be it. Running several full suites in parallel on this machine is not supported: it produces timeouts and `ECONNRESET` failures that the guard deliberately does not retry.
24. **Browser coverage:** Chromium is the reference run (every spec). Firefox and WebKit pass the join, validation, recovery, link-replacement, storage-failure, review-fix, accessibility and browser-security specs and the responsive matrix (see `docs/EVIDENCE.md` for the exact runs). The one spec that does not pass in WebKit is the six-participant full journey (`exchange.spec.ts`): it stalls at a different step on each run, while every shorter spec passes in WebKit, which suggests resource limits with six concurrent browser contexts; the cause was **not** established. No real iOS Safari, Android Chrome or other devices were used.
25. **Workers free-tier budget.** With `run_worker_first = true` every page and asset request is a Worker request, so it is assumed to count against the free plan's 100,000 requests per day (the documentation does not state this outright). Fine for small exchanges; revisit before wide promotion.
26. **Workers Logs** are disabled in `wrangler.toml`, but whether Cloudflare honours that for an existing Worker, and whether invocation logs include client IPs, are unverified (`docs/DEPLOYMENT.md`).
27. **Storage failures:** blocked, full or failing browser storage is covered for opening a link, restoring, and replacing a link. The "keep or use the other link" conflict screen when the chosen link then cannot be stored is implemented (held in memory, fragment kept) but has no automated test, because the situation needs two valid keys and failing writes at once.
