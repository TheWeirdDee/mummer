# Build review — 27 October 2026

Reviewed the current working tree, including the pre-existing uncommitted changes. No application code was changed. Findings below distinguish directly observable code defects from concurrency defects inferred from the SQL and request ordering. This is a source review, not a claim that every possible execution path has been verified. Generated bundles, dependency implementations and large reference-vector data are outside the manual review scope.

## Verification

- `npm run typecheck`: passed across the workspaces.
- `npm run build`: passed; Vite transformed 203 modules.
- `npm test -- packages --maxWorkers=1`: 7 files, 176 tests passed.
- `npm run test:unit`: failed with `No projects matched the filter "packages"`.
- Full `npm test`: initial sandbox run could not start Vite child processes (`spawn EPERM`). An unrestricted run was interrupted after stalling; a single-worker rerun reported 20 skipped security tests and stalled without a final summary. It was interrupted. Neither run establishes an integration-test pass or a product-level test failure.
- Browser tests, Rust cross-checks, deployment and real-wallet integration were not run during this review.

## High priority

### 1. Recipient-only reveals leak through the host's glass box

Location: `workers/api/src/routes/groups.ts:432`, `:471`; compare `workers/api/src/routes/members.ts:326`.

The regular reveals endpoint filters recipient-only rows to the giver and recipient. The host-only glass-box endpoint queries every reveal and returns `reveals.results` unchanged, including giver and recipient IDs and the audience. The dashboard prints this response verbatim. A giver choosing “Only the person I gave to” therefore exposes the pair to the host too. The trusted-host draw does not justify a separate endpoint violating an explicit audience choice.

Reproduce: create a recipient-only reveal, request `/api/groups/:gid/reveals` as the host (pair hidden), then request `/api/groups/:gid/glassbox` with the same token (pair exposed).

Fix: share audience filtering between endpoints or omit private reveal rows from the host view. Test the glass box after a private reveal, not just the normal listing endpoint.

### 2. Link replacement can race the draw and strand an assignment

Location: `workers/api/src/routes/members.ts:227–242`.

Inferred concurrency defect: the rotation handler checks whether an assignment exists before its transaction. A pre-draw rotation can observe no assignment, then the host commits a draw using the old public key, then rotation updates the public key and token without re-sealing that newly created assignment. Incrementing `members_version` afterward cannot invalidate a draw that already committed. The browser discards the old secret, and the replacement key cannot decrypt the assignment.

Fix: make the rotation compare-and-swap also require the observed group/draw version and assignment existence. Refuse and retry if either changed. Include the draw version in post-draw replacement requests so an old bundle cannot overwrite a newly drawn one.

### 3. Payment writes are not pinned to the phase/version checked earlier

Location: `workers/api/src/routes/members.ts:149–156`, `:168–213`.

Inferred concurrency defect: `requirePaymentPhase` validates a previously loaded group, but the sent and acknowledgment SQL does not require the same current draw version or a still-open payment phase. A request can authenticate during draw 1, pause, and continue after a reset and draw 2. A delayed sent request can mark the new assignment sent; a delayed acknowledgment can update the new recipient commitment using a reference checked against the old commitment. A close between validation and mutation likewise does not prevent the write.

Fix: put group state, current draw version, and current member eligibility into the mutation predicates in the same batch. Check affected-row counts and return a conflict for stale requests. For acknowledgments, also pin the commitment/version actually checked.

### 4. Failed browser storage during link replacement can lose access

Location: `apps/web/src/pages/member/Account.tsx:63–70`; `apps/web/src/lib/session.ts:120`; `apps/web/src/lib/credentialRecovery.ts:30–32`.

`saveRotation` silently ignores storage failure. After the server invalidates the old token, Account clears the pending record before calling `saveCredentials`, whose boolean result is ignored. Reloading credentials then reads the old record or no record, with no in-memory replacement passed to the page. Pending recovery also clears its only fallback without checking that credentials were saved.

Trigger: blocked storage, exhausted quota, or storage becoming unavailable between the probe and write. The old saved link is invalidated and the new key may never be displayed or retained.

Fix: require a confirmed pending write before invalidating the old token, retain pending data until final persistence succeeds, and pass replacement credentials through memory/fragment when persistence is unavailable.

## Medium priority

### 5. Payment requests remain usable for revoked recipients

Location: `apps/web/src/pages/member/Payment.tsx:75–84`; `workers/api/src/routes/groups.ts:131`.

The roster intentionally retains revoked members. Payment's integrity check finds the recipient by ID and checks their name, address commitment and budget, but never their status. After a recipient leaves or is removed, their giver continues to see the same payment QR and wallet link. The resolution notice explicitly says a displayed assignment still works, which can encourage payment into an exchange that needs repair.

Fix: refuse payment requests for recipients whose status is no longer `assigned`; show a specific instruction to resolve the affected gift with the host.

### 6. Leaving during a concurrent draw can report success without removing anyone

Location: `workers/api/src/routes/members.ts:99–109`.

Inferred concurrency defect: the pre-draw removal branch chooses its behavior using the old group state. Its DELETE correctly requires the group still be open/locked, but the batch result is ignored and `{ exception: false }` is returned even when a concurrent draw made the DELETE affect zero rows. Self-leave then forgets browser credentials even though membership and the assignment remain active. A false `member_removed` audit event can also be written.

Fix: check the DELETE's affected-row count, condition the audit event on success, and either return a conflict or retry removal using the actual post-draw state.

### 7. Clearing the reveal date throws before form validation can report it

Location: `apps/web/src/pages/CreateGroup.tsx:60–64`, `:75–77`; `packages/shared/src/time.ts:92`.

The form uses `noValidate`. An empty reveal date reaches `daysBetween(today, revealDate)`, which throws `RangeError('Invalid date')`. `validate()` runs before the submission handler's try/catch, so no validation summary or friendly message is produced. An invalid/cleared join date can also reach `daysBetween` in the reveal-gap check.

Reproduce: open `/new`, clear Reveal date, and submit.

Fix: validate both dates with `isValidDate` first and skip all date arithmetic until both are valid.

### 8. Backup/link recovery fails when browser storage is unavailable

Location: `apps/web/src/pages/Recover.tsx:20–23`; related conflict path `apps/web/src/lib/useCredentials.ts:97–101`.

Recovery ignores a false return from `saveCredentials` and navigates to a URL without the secret fragment. With storage blocked, the destination cannot load the credentials that were just recovered. The conflict handler similarly strips the incoming fragment even if saving the chosen link failed.

Fix: preserve credentials in the destination fragment or in memory when saving fails. Only strip a fragment after successful persistence or an explicit in-memory handoff.

### 9. The unit-test npm command selects a nonexistent Vitest project

Location: `package.json:19`; `vitest.config.ts:3`.

Confirmed by execution: `npm run test:unit` runs `vitest run --project packages`, but the config declares no named projects. It exits before running any tests.

Fix: use `vitest run packages` or configure a named `packages` project. Direct package filtering passed all 176 tests in this review.

### 10. Closed exchanges still accept reveal confirmations

Location: `workers/api/src/routes/members.ts:302–312`; compare `apps/web/src/pages/admin/AdminPage.tsx:315`, `:361`.

The confirm-reveal route authenticates the recipient and immediately updates the row. It never checks that the group is open for activity. A recipient can POST confirmation after the host closes the exchange, despite the dashboard promising that closing makes it read-only and prevents confirmations.

Fix: enforce the closed-state rule in the route and atomically in its UPDATE predicate, consistently with other member mutations.

### 11. Reveal copy promises recipient consent that the listing does not enforce

Location: `apps/web/src/pages/member/Reveal.tsx:136`; `workers/api/src/routes/members.ts:326`.

The UI says a reveal is only shown as agreed by both people once the recipient confirms. Group-audience reveals are actually listed immediately, regardless of `recipient_confirmed_day`. Another option explicitly describes this immediate visibility, so the interface contradicts itself.

Fix: choose the intended consent rule. Either withhold public visibility until confirmation or clearly explain that the giver publishes an unconfirmed claim immediately. Keep all explanatory text consistent with that choice.

## Lower priority

### 12. Removing someone in draw review guarantees a stale-version retry

Location: `apps/web/src/pages/admin/DrawPanel.tsx:53`, `:136–143`; `workers/api/src/routes/members.ts:104–106`.

The host loads `membersVersion` with profiles. Removing a candidate increments the server version, but the client only filters its candidates and exclusions; it does not reload that version. Its next draw is therefore refused with `draw_mismatch`, even when no other member changed. The mismatch handler reloads profiles, so this is recoverable but adds an avoidable failure to a normal workflow.

Fix: reload profiles after successful removal before enabling Draw again.

## Remaining validation gaps

- Add deterministic interleaving tests for draw versus rotation, reset versus sent/ack, and draw versus leave. Existing duplicate-request tests do not establish these cross-operation invariants.
- Add browser coverage for blocked/full storage during restore, credential conflict resolution and replacement, and for cleared date fields.
- Add privacy coverage for every host-visible response after a recipient-only reveal.
- Complete the integration and browser suites on a working D1/Miniflare environment before treating this review as release validation.
- The repository itself records that live wallet scanning, real shielded payments, production Turnstile and deployment have not been verified. Those remain integration gaps; a successful local build does not resolve them.

Recommended order: fix the private-reveal exposure, protect the atomic draw/payment/credential invariants, and preserve replacement keys on storage failure; then address the remaining workflow and test-command defects.
