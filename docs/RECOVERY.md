# Recovery, revocation and deletion

Mummer has no accounts, so recovery is limited to what the architecture can truthfully support. The rule is: **never promise recovery that is cryptographically impossible.**

| Situation | What happens | Implemented and tested |
|---|---|---|
| Admin link lost, **before** the draw | No recovery. Profiles are sealed to a key that existed only in the host's browser. Create a new exchange and re-invite (no money was held). A passphrase backup made earlier restores access. | Backup restore (`recovery.spec.ts`); `Open your admin link` screen |
| Admin link lost, **after** the draw | Same. The host can no longer manage the exchange. Participants can still use their own links and the exchange expires on schedule. | |
| Member link lost, before the draw | Open the invite link and join again with new credentials; the host removes the old entry (frees the name). | Remove/leave, name reuse tests |
| Member link lost, after the draw | Assignment is sealed to a key that no longer exists. **Not recoverable** without a backup. The host can flag the exchange for manual resolution, or redraw from scratch if no payment activity has started. | Redraw reset and flag tests |
| Member backup | Passphrase-protected (argon2id + secretbox), made in the browser. Wrong passphrase and tampering are indistinguishable by design. | Round-trip, wrong passphrase, tamper (`crypto.test.ts`, `recovery.spec.ts`) |
| Member link **compromised** | **Replace my link**: new key pair and token, assignment re-sealed to the new key by the member's browser, old token invalid immediately. Anything already read cannot be un-read. The page then requires the new link to be saved and verified. | `payments-reveal.test.ts` (including a concurrent double rotation), `recovery.spec.ts` |
| Host token compromised | An attacker with only the token can close, delete or remove people but cannot read profiles (needs the host key). Delete or close the exchange. | Authorization matrix |
| Participant removed or leaves, before the draw | Row deleted; name available again. | |
| Participant removed or leaves, after the draw | Token revoked, assignment deleted, the exchange becomes `needs_resolution`. Mummer cannot identify whose recipient is now without a giver: the group sorts it out (for example the host sends a backup gift). The host sees only the flag. | `join-draw.test.ts` |
| Missed gift | A recipient can report "Something's wrong" (a count only). Resolution is outside Mummer. | Acknowledgment tests |
| Exchange abandoned | Auto-deleted 30 days after the reveal date. | Retention tests |
| Exchange deleted by host | All rows removed in one cascade; links stop working. | Flow and glass-box tests |
| Expired exchange | Treated as nonexistent and purged on access and by the daily job. | `groups.test.ts` |

## What cannot be recovered

- A lost key with no backup (member or host).
- Any information a leaked link already exposed.
- Screenshots, wallet history and blockchain records.
- Funds sent to a wrong or substituted address (shielded payments are final).
