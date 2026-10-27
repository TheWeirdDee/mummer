# Copy audit

Every route's headline claims, the evidence behind each, and the wording rules that were applied. The aim is that no sentence the product shows promises more than the code and tests support.

## Wording rules applied everywhere

1. "Shielded" describes the *payment*, never Mummer's database or the pairings.
2. Never "anonymous", "untraceable", "trustless", "verified" or "guaranteed" about the product. A recipient's "I received it" is called a confirmation or a report, never verification or proof.
3. The host-run draw is stated wherever the draw or privacy is discussed: the host's browser runs the draw and could see who draws whom.
4. Nothing says a wallet *will* prefill from a QR. Every payment screen offers copy buttons first-class; the QR is described as "may" and "if your wallet supports it". No wallet is named as compatible beyond "Zodl is the one our guides use".
5. No user, exchange or payment counts are claimed. The public numbers page shows nothing under a threshold.
6. Mummer is never described as a wallet, an exchange, a financial service or custodial.
7. Plain language first; the technical term is introduced after it.

## Routes

| Route | Headline | Main claims | Basis |
|---|---|---|---|
| `/` | "Secret Santa. Private gifts." | Gifts are small amounts of Zcash sent from your own wallet; shielded payments hide who paid whom and how much on the public ledger; Mummer organises the draw and keeps the pairings out of its own database; the host's browser draws the names, so the host could see who draws whom | `docs/PRIVACY_ARCHITECTURE.md`, `docs/THREAT_MODEL.md` |
| `/how-it-works` | "From invite link to unmasking" | Five steps; sealed assignments only the giver opens; reveal is voluntary and consent-gated; "I received it" is one person's report | `docs/API.md`, `exchange.spec.ts` |
| `/privacy` | "Who can see what" | A per-party table (ledger readers, Mummer's server, hosting and network, the host, the giver, the recipient, other members, anyone holding a private link) of what each can see, cannot see, and still might infer; what Mummer stores; what is not promised; retention; how to reduce exposure | `docs/PRIVACY.md`, `docs/THREAT_MODEL.md`; the "still possible" column states timing, amount and guessing leaks |
| `/faq` | "Questions, answered straight" | Fourteen questions: custody (none), what "shielded" means, whether the host can see who drew whom, whether "confirmed" means verified (no), losing or leaking a link, a wallet that does not fill in the amount or memo, a gift that never arrives, company-funded gifts (not offered), retention, why a link must be saved, and that Mummer is not financial or legal advice | `docs/RECOVERY.md`, `docs/KNOWN_LIMITATIONS.md` |
| `/wallet-guide` | "Get ready to give (and receive) a shielded gift" | How to get a wallet and a shielded address, small budgets, never share seed phrases; the wallet table says compatibility is **not verified** | `docs/INTEGRATION_RESEARCH.md` (R01/R02 open) |
| `/evidence` | "What we've checked, and what we haven't" | A claims-and-status table, what the database holds, known limits | `docs/REQUIREMENTS_MATRIX.md`, `docs/KNOWN_LIMITATIONS.md` |
| `/stats` | "The numbers, and only the numbers" | Rounded, thresholded counters only; says when there is not enough data to show anything | `docs/DECISIONS.md` D-21 |
| `/new` | "Start an exchange" | The host must acknowledge that the draw runs in their browser; the admin link is the only way back in | `CreateGroup.tsx`, `validation.spec.ts` |
| `/g/:id` | The exchange's own name | What the host can see; wallet prerequisites; refusals (full, closed, drawn) say why; a host-key mismatch blocks joining and a missing fingerprint is flagged | `JoinGroup.tsx`, `validation.spec.ts` |
| `/g/:id/admin` | The exchange's own name | Host dashboard: progress is counts only; closing, flagging and deleting are explained before they happen; dates can be changed before the draw | `AdminPage.tsx`, `extend.test.ts` |
| `/g/:id/m/:mid` | The exchange's own name | Your assignment, the payment request, "I sent it", "I received it", reveal; "sent" and "received" are described as self-reports | `MemberPage.tsx`, `Payment.tsx`, `Receive.tsx`, `Reveal.tsx` |
| `/recover` | "Lost a link?" | A lost link cannot be recovered by Mummer; restore from a backup or a saved link; the passphrase never leaves the device | `docs/RECOVERY.md`, `recovery.spec.ts` |
| any unknown path | "This mask is empty" | Real 404 | `validation.spec.ts` |

## Corrections made by this audit

| Was | Problem | Now |
|---|---|---|
| "The reference you entered matched." after a confirmation | Could read as the payment having been matched or checked | "Mummer recognises the reference you entered. That doesn't show that any money was sent." |
| Glass-box showed per-person sent and confirmed state to the host | Contradicted the aggregate-only progress promise | Totals only; page copy says per-person states exist but are not shown |
| "Forget it" / "Remove" style short labels on destructive actions | Ambiguous consequences | Buttons say what they do ("Remove my key from this device"); the dialog reminds the person to save a link or backup first because without one they cannot get back in |
| A reveal button read "Yes, that's right" | Unclear what was being confirmed | "Yes, they gave to me" |
| An entity written inside a JavaScript string rendered as raw "&rsquo;" in the received notice | Typographic defect and a sign that other strings could be wrong | Fixed; grep over `apps/web/src` finds no other instance |
| Invite links had no way to detect a swapped host key | Joiners could not tell | The invite carries a fingerprint; copy explains it plainly and flags its absence |
| A wrong link overwrote a saved key silently | Could destroy someone's only key without telling them | A conflict screen asks which key to keep |

| Was | Problem | Now |
|---|---|---|
| "If your assignment is still showing below, it still works." (needs-attention banner) | Encouraged paying someone who had left | "If the person you are giving to has left, you will see that on your gift page and should wait for the host before sending anything." |
| "It is only shown as agreed by both people once the recipient confirms it." (reveal list) | The list shows group reveals immediately, so the sentence was false | "It appears here straight away. The line beside it says whether the recipient has confirmed it yet." |
| Blank date fields reached date arithmetic and produced no message | A form that threw | "Choose the reveal date." / "Choose the last day people can join." |
| (new) Payment for a removed recipient | The request stayed on screen | "<Name> has left or been removed from this exchange, so please don't send this gift. The host will sort it out with the group." |
| (new) Replacement refused because storage is unavailable | n/a | "...your link has NOT been replaced and still works. Allow site storage for this page (or leave private browsing) and try again." |

## Not audited

- Translations (English only).
- Legal review of the privacy or terms wording; the product has no separate terms page.
- Reading-level testing with real users.
- Third-party review of whether the overall tone is understandable to the intended audience.
