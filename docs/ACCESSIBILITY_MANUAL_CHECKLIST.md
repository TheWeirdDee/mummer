# Manual accessibility verification still required

**No screen reader has been used on Mummer.** What exists is automated: axe-core (WCAG 2.0, 2.1 and 2.2 A and AA tags plus best practices) on every route and key state at 390 and 1280 px in Chromium, Firefox and WebKit, and scripted keyboard tests (skip link, visible focus, dialog focus trap and return, ARIA tabs, the phone menu, route-change focus, 200% text). Automated checks find a fraction of real barriers. They cannot tell whether announcements make sense, whether the reading order is natural, or whether the copy is understandable when spoken.

Windows Narrator is installed on the development machine but cannot be operated or listened to from the automation environment, so it was not used. Treat WCAG 2.2 AA as **targeted and automatically checked, not certified**.

## What a person needs to do

Use **NVDA with Firefox or Chrome** on Windows, **VoiceOver with Safari** on iPhone and Mac, and **TalkBack with Chrome** on Android. For each, work through the journeys below with the screen off or eyes closed where practical, and record what was announced, what was confusing and what was impossible.

| # | Journey | What to listen and look for |
|---|---|---|
| 1 | Landing page to "Start an exchange" | Landmarks and headings give a usable outline; the skip link is reachable and works; the "Menu" button announces its expanded state on a phone |
| 2 | Create form with deliberate mistakes | The error summary is announced when it appears; each link in it moves focus to the right field; field errors are read with the field; the date fields are operable |
| 3 | Save-your-admin-link screen | The warning is read before the link; "Show" and "Hide" state is announced; pasting the link back and the confirm button are clear; nothing reads the secret aloud unless asked |
| 4 | Join wizard (all four steps) | Step progress is announced; the address check result ("looks like a valid shielded address" or the reason it is refused) is announced without moving focus; the review step is understandable |
| 5 | Host dashboard and the draw review | The people list, remove buttons ("Remove Ada") and dialogs; focus returns to the opener when a dialog closes; the "names are drawn" result is announced |
| 6 | Member page after the draw | The three tabs follow the tabs pattern (arrow keys, one tab stop); the recipient's name, wishlist and shielded address tail are read in a sensible order; the payment QR has a useful text alternative and the copy buttons work without it |
| 7 | "I sent it" and "I received this gift" | Dialog wording is clear; the confirmation result is announced; the notice that these are self-reports is read |
| 8 | Reveal day | The audience choice, the irreversible-action dialog, and the list of reveals and confirmations |
| 9 | Link replacement, backup, leaving, forgetting this device | Each dialog says what will happen; after replacement, the new link is announced and reachable |
| 10 | Recovery and the conflict screen | The two choices are distinguishable when read aloud |
| 11 | Tables (privacy, evidence, wallet guide) at phone width | The stacked cards still read as label then value; row and column relationships survive |
| 12 | Error states | An offline banner, an expired quote, a refused address: each is announced and has a way forward |

Also check, independently of a screen reader: pinch-zoom is not blocked; text resizes to 200% without loss; Windows High Contrast / forced colors; reduced-motion; and use with only a keyboard on a desktop browser **other** than Chromium (Safari needs Option+Tab to reach links, which the automated WebKit test cannot press).

## How to record the result

Add the findings to `docs/EVIDENCE.md` under a dated heading with the tool and version (for example "NVDA 2025.x, Firefox 1xx"), list each journey as passed, passed with issues (describe) or blocked, and file defects with the journey number. Update `docs/KNOWN_LIMITATIONS.md` item on accessibility only after at least NVDA and VoiceOver have been done.
