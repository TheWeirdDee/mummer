# Known limitations

Plain statements of what Mummer does **not** do or has **not** verified. The product copy repeats the user-relevant ones.

## Product and privacy

1. **The draw is run by the host's browser (trusted-host).** A host can see or record pairings. Not host-blind. (F14 not built.)
2. **No independent payment proof.** "Sent" and "received" are self-reports. Mummer cannot inspect a shielded payment and has no viewing key. (F15 not built.)
3. **No company-funded mode.** Zodl iOS rejects multi-recipient requests; a funding design needs its own privacy review. (F13 not built.)
4. **Small groups leak by deduction.** Four people can narrow the cycle; five or more is recommended.
5. **A giver knows their recipient** and a recipient may infer their giver from timing, amount or a note.
6. **Address substitution by a malicious operator or database writer** is possible because sealed boxes are anonymous. Ask recipients to confirm arrival.
7. **Network metadata** (IP, timing) is visible to hosting and network providers; platform log retention was not inspected.
8. **Public counts** are rounded and thresholded, but counters are not differentially private.

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
18. **Local storage** keeps a person's key and token on their device for convenience; "Forget this device" removes it.
19. **Timezone handling** uses the platform's Intl data; exotic historical zone changes are not special-cased.

## Product scope

20. No native app, no email, no push notifications, no calendar file (F16 optional, not built), no languages other than English, no dark theme.
21. Real-money trial with 4 to 5 consenting people (R12): **not done**. No usage figures or user counts are claimed anywhere.

## Accessibility

22. Automated checks (axe-core, WCAG 2.2 AA tags) and keyboard tests pass for every route and key state at 390 and 1280 px; **no manual screen-reader pass** was performed on real assistive technology. Treat WCAG conformance as *targeted and automatically checked*, not certified.
