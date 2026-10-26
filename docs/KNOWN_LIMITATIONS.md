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

9. **No real wallet was tested.** Whether Zodl iOS or Android fills in the amount and memo from a scanned Mummer QR is unverified (R01/R02, R12). The UI always offers copy buttons and never claims a scan prefilled anything.
10. **Receivers are validated structurally** (checksum, lengths, ordering), not for curve-point validity.
11. A unified address that also contains a transparent receiver is accepted with a warning.
12. **Mainnet only.** Test-network addresses are refused everywhere.
13. **Exchange rate** comes from a single public price source (CoinGecko by default), cached for 60 seconds; quotes are approximate and expire after ten minutes. If the source is down, no request is shown.

## Platform and operations

14. **Not deployed.** No Cloudflare project or repository was designated; deployment and live verification are pending (`docs/DEPLOYMENT.md`).
15. **Turnstile has not been run against Cloudflare.** The ticket flow and the sandboxed frame are tested (the ticket logic with a verifier double; the sandbox in a real browser), but no site key or account was available.
16. **No independent security review**, no penetration test, no formal verification.
17. **Rate limiting relies on `CF-Connecting-IP`**, which is trustworthy only behind Cloudflare.
18. **Local storage** keeps a person's key and token on their device for convenience; "Forget this device" removes it, together with any pending link replacement and local reveal guesses. A link that carries a *different* key than the one saved is never applied silently: the person chooses.
19. **Timezone handling** uses the platform's Intl data; exotic historical zone changes are not special-cased.

## Product scope

20. No native app, no email, no push notifications, no calendar file (F16 optional, not built), no languages other than English, no dark theme.
21. Real-money trial with 4 to 5 consenting people (R12): **not done**. No usage figures or user counts are claimed anywhere.

## Accessibility

23. **One unexplained test flake** was seen once in seven full Vitest runs (see `docs/TESTING.md`). Not reproduced; cause unknown.
22. Automated checks (axe-core, WCAG 2.2 AA tags) and keyboard tests pass for every route and key state at 390 and 1280 px; **no manual screen-reader pass** was performed on real assistive technology. Treat WCAG conformance as *targeted and automatically checked*, not certified.
