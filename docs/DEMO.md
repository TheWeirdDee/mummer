# Demo, judge walkthrough and submission materials

**Nothing here has been published, posted or submitted.** A demo video has been recorded from the real app on the staging deployment (see [`DEMO_VIDEO.md`](DEMO_VIDEO.md) for how it was made, what it shows and what it does not). There is no real-wallet recording and no recording of the production site. The plan below is the original production plan; where the recorded video differs from it, `DEMO_VIDEO.md` is the accurate description.

## Honest status the demo must respect

| Beat | Can be filmed from this repository today | Needs |
|---|---|---|
| Create, join, address checking, draw, assignment with QR, copy details, "I sent it", confirm with reference, reveal, redacted server view, delete | **Yes**, against a local or deployed instance, using the test-vector address fixtures (clearly not real wallets) | Nothing |
| Zodl scanning the QR; memo and amount arriving; recipient reading the memo | **No** | Two physical phones with Zodl, funded with a small amount of real ZEC, signing by the wallet owner, and the owner's explicit approval of a maximum amount and fees (PRD live-money policy) |
| "A real group finished" | **No** | A consenting group of 4 to 5 |

If the wallet beats are not filmed, say so on screen and in the description: *"Wallet scanning has not been verified on real devices."* Never composite, mock, or simulate Zodl or explorer footage.

## Judge walkthrough (under five minutes, no money needed)

1. Open the live app (or `npm run dev` / the E2E server locally). Read the landing page: what it is, what it can't hide.
2. **Create** an exchange (about $25, reveal in a week). Note the trusted-host acknowledgement. Save the admin link by pasting it back.
3. Open the invite link in **four more browser profiles** (or use `tests/e2e/exchange.spec.ts`, which does this automatically). Join with the sample shielded addresses from the official ZIP 316 vectors (`packages/zcash/test/vectors/unified_address.json`, rows with a `u1…` address). Try pasting `t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs`: it is refused with a reason.
4. As host, **Review people and draw**. Notice the page never shows the pairings.
5. As each participant, open the private link: recipient, wishlist, **QR**, separate **address / amount / memo** copy fields, quote expiry, and the "before you approve in your wallet" checklist. Mark sent; confirm receipt on the recipient's page, with and without the memo reference.
6. Host: **What Mummer's server stores**: sealed blobs and fingerprints only. Run `npm test` and `npx playwright test` to see the leakage, authorization and journey tests pass.
7. Read **Evidence and limits** (in the app) and `docs/KNOWN_LIMITATIONS.md`. Everything unverified is listed.

## 90-second video plan (real captures only)

| Time | Scene | On screen | Source |
|---|---|---|---|
| 0:00-0:10 | Problem | "A Secret Santa payment shouldn't publicly show who paid whom." | Landing hero |
| 0:10-0:20 | Create + disclosure | Create form; trusted-host notice | Real screen capture |
| 0:20-0:35 | Join + address validation | Wizard; transparent address refused with a reason; valid address accepted | Real capture (test-vector address) |
| 0:35-0:45 | Draw | Host review; "this page never shows the pairings"; what the host can see | Real capture |
| 0:45-0:65 | Payment request | Assignment, QR, copy fields, checklist | Real capture. **Wallet scan footage only if the live-money gate is passed and the owner approves; otherwise state the limitation** |
| 0:65-0:75 | Acknowledgment | "I received this gift" with the label "This is your own report" | Real capture |
| 0:75-0:85 | Evidence | Redacted server view; test results; limits page | Real capture |
| 0:85-0:90 | End card | Name, live link (if deployed), repository, "Wallet scanning not yet verified on real devices" | Title card |

Production notes: capture at 1920x1080 from a clean browser profile at 125% zoom; blur nothing in the app because no real secrets are shown (private links are hidden by default, addresses are test vectors). Fonts are Anton, Newsreader, Inter and IBM Plex Mono (all OFL, in `apps/web` dependencies). Palette: paper `#F2ECDF`, ink `#17140F`, wax `#9E2B25`, pine `#1E3A2F`, gold `#B8913A`. Captions must work with sound off. Allowed claims are those in `docs/PRIVACY.md`; banned: "anonymous", "untraceable", "verified payment", "even the host can't see".

The PRD's Remotion scene tables remain a valid optional edit plan; use only screen recordings that exist.

## Short description (about 40 words)

Mummer organizes a Secret Santa where each gift is a shielded Zcash payment sent from the giver's own wallet. Names are drawn in the host's browser, assignments are sealed to each giver, and Mummer never holds money or sees addresses in the clear.

## Detailed description

Mummer is a noncustodial Secret Santa organizer built around shielded Zcash. A host creates an exchange and shares one invite link. Each participant picks a nickname, adds a wishlist and pastes a fresh shielded receiving address, which Mummer validates with a ZIP 316 decoder checked against the official test vectors. The host's browser draws a single-cycle assignment, seals each person's assignment to their own key, and sends only sealed data and one-way fingerprints to the server. Givers see a ZIP 321 payment request with an exact amount, a memo reference and copy fallbacks; their wallet makes the payment. Recipients say whether it arrived; Mummer labels that as a self-report, never as verification. On reveal day, givers may choose to unmask to the recipient or the group.

What it does not do, stated openly: the host's browser can see the pairings (trusted-host draw); payments are not independently verified; wallet scanning has not been tested on real devices; no company-funded mode; no independent security review. See `docs/KNOWN_LIMITATIONS.md` and the in-app evidence page.

## Submission checklist (manual steps stay with the owner)

- [ ] Choose and authorize the repository and deploy destination (none was designated).
- [ ] Deploy per `docs/DEPLOYMENT.md` and complete the post-deployment verification, including the first real Turnstile run.
- [ ] Decide whether to run the real-wallet and real-group gates (R01, R02, R12); record redacted evidence in `docs/EVIDENCE.md` only if they are actually run.
- [ ] Confirm the ZECATHON deadline, timezone, build-window and bounty-overlap rules with the organizer (R05).
- [ ] Review the video against the allowed/banned claims; publish and submit manually.
