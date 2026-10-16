# Coherence: Build, charge and review a routed fix on the child that hosts it (#3211)

**Plan:** .docs/plans/a-routed-fix-cannot-be-built-charged-and-reviewed-.md
**Stories:** .docs/stories/a-routed-fix-cannot-be-built-charged-and-reviewed-.md
**Track:** technical, so there are no FR rows. **Tier:** L.
**Source-Ref:** jstoup111/ai-conductor#3211

This is spec C of a four-spec delivery (`adr-2026-10-12-routed-whole-feature-repair` decision 18).
Six APPROVED ADRs carry #3211 amendment notes in this change set, so each has an ADR row and every
one of their decisions has a row in the plan's Architecture Obligation Coverage. Every intake
outcome is delivered by this spec; the re-validation, exit and replay-merge pieces moved to #3212
lie outside these outcomes, so no waiver is needed.

## Traceability

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Quote / Notes |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-1, story-3, story-7 | covered | **Built on the host.** A placed fix is appended, built and reviewed on the host child's own branch, and the host's region re-runs. |
| outcome | outcome-2 | story-2 | covered | **Plan stays valid.** Routed remediation tasks carry their child in committed text, and the plan stays valid after every routed append. |
| outcome | outcome-3 | story-4, story-5, story-6 | covered | **Budgets stay feature-wide.** prd_audit and as-built laps and growth keep their per-feature meaning. A routing round settles exactly once, at the host's dispatch, including after a crash or a worktree recreation. |
| outcome | outcome-4 | story-8 | covered | **Verified reroute.** A builder's claim that a prerequisite lives in a later child moves the fix only when the engine verifies the claim. A test failure is never treated as "cannot host". |
| outcome | outcome-5 | story-9 | covered | **N=1 features** remediate exactly as today. |
| story | story-1 | task-48, task-49, task-50, task-47, task-56 | covered | The host's region re-runs with the fix appended on its own branch |
| story | story-2 | task-52, task-54, task-55, task-39 | covered | Routed tasks carry their child in committed text, and the plan stays valid |
| story | story-3 | task-53, task-207 | covered | A routed pass proves the host's acceptance specs green without re-proving RED |
| story | story-4 | task-200, task-60, task-61, task-62, task-63, task-64, task-66, task-67 | covered | A round is charged once, durably, whichever child hosts it |
| story | story-5 | task-65, task-33 | covered | Taskless and FAIL-only rounds are charged at admission, before any routing ref exists |
| story | story-6 | task-202, task-68, task-69, task-70 | covered | Repair obligations resolve on the host's branch |
| story | story-7 | task-72, task-74 | covered | The host's review grades only the repair, under its own allowance |
| story | story-8 | task-204, task-57, task-58, task-59, task-206 | covered | A builder's missing-prerequisite claim moves the fix only when verified |
| story | story-9 | task-201, task-205 | covered | Every new routing write is fenced by the restack journal, and N=1 is untouched |
| task | task-200 | story-4 | covered | Serves story 4. |
| task | task-201 | story-9 | covered | Serves story 9. |
| task | task-202 | story-6 | covered | Serves story 6. |
| task | task-48 | story-1 | covered | Serves story 1. |
| task | task-49 | story-1 | covered | Serves story 1. |
| task | task-50 | story-1 | covered | Serves story 1. |
| task | task-47 | story-1 | covered | Serves story 1. |
| task | task-56 | story-1 | covered | Serves story 1. |
| task | task-52 | story-2 | covered | Serves story 2. |
| task | task-54 | story-2 | covered | Serves story 2. |
| task | task-55 | story-2 | covered | Serves story 2. |
| task | task-39 | story-2 | covered | Serves story 2. |
| task | task-53 | story-3 | covered | Serves story 3. |
| task | task-207 | story-3 | covered | Serves story 3. |
| task | task-60 | story-4 | covered | Serves story 4. |
| task | task-61 | story-4 | covered | Serves story 4. |
| task | task-62 | story-4 | covered | Serves story 4. |
| task | task-63 | story-4 | covered | Serves story 4. |
| task | task-64 | story-4 | covered | Serves story 4. |
| task | task-66 | story-4 | covered | Serves story 4. |
| task | task-65 | story-5 | covered | Serves story 5. |
| task | task-33 | story-5 | covered | Serves story 5. |
| task | task-67 | story-4 | covered | Serves story 4. |
| task | task-68 | story-6 | covered | Serves story 6. |
| task | task-69 | story-6 | covered | Serves story 6. |
| task | task-70 | story-6 | covered | Serves story 6. |
| task | task-72 | story-7 | covered | Serves story 7. |
| task | task-74 | story-7 | covered | Serves story 7. |
| task | task-204 | story-8 | covered | Serves story 8. |
| task | task-57 | story-8 | covered | Serves story 8. |
| task | task-58 | story-8 | covered | Serves story 8. |
| task | task-59 | story-8 | covered | Serves story 8. |
| task | task-206 | story-8 | covered | Serves story 8. |
| task | task-205 | story-9 | covered | Serves story 9. |
| adr | adr-2026-10-12-routed-whole-feature-repair | story-1, story-2, story-3, story-4, story-5, story-6, story-7, story-8, story-9 | covered | Its decision 10 carries a #3211 note (custom-step charging). Decisions 13–15 and decision 9's restack replay merge are delivered by #3212 (its draft Tasks 89–90), as the track marker records; the decision-by-decision mapping is in the plan's Architecture Obligation Coverage, judged under §4f. |
| adr | adr-2026-07-21-engine-owned-acceptance-red-execution | story-3 | covered | #3211 notes on decisions 2 and 5 (verify-green in a routed pass); mapping judged under §4f. |
| adr | adr-2026-08-09-recorded-red-exception-for-remediation | story-3 | covered | #3211 note on its waiver reporting (verify-green is neither a waiver nor an unrecorded green run); mapping judged under §4f. |
| adr | adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class | story-4 | covered | #3211 notes on D2 and D3 (whole-feature cap evidence and authorization in the flat ledger); mapping judged under §4f. |
| adr | adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance | story-3 | covered | #3211 note on decision 1 (optional `mode` field); mapping judged under §4f. |
| adr | adr-2026-07-13-kickback-build-no-op-escalation | story-1, story-6 | covered | #3211 note on D1 (host-entry guard, halt-record carrier); D2 escalation for a routed pass is #3212; mapping judged under §4f. |
| criterion | Story 1 happy: Given round `r1` with host 1 `admitted`, when region entry runs, then the worktree is on `feat/c1/demo` and child 1's `acceptance_specs`, `build`, `test_suite` and `build_review` are restaged pending. | 48 | covered | "leaves `git symbolic-ref --short HEAD` at `feat/c1/demo`" | diff-local |
| criterion | Story 1 happy: Given round `r1` region entry, when the frozen blocks are written, then each block in the feature plan on `feat/c1/demo` is byte-identical to its frozen body, carries `**Child:** 1` and `**Round:** r1`, and the append commit carries a `Round: r1` trailer. | 49 | covered | "is byte-identical to its stored frozen body" | diff-local |
| criterion | Story 1 happy: Given round `r1` region entry, when it completes, then host 1 is `repairing` in the route record, and that transition happened only after the append commit exists. | 49 | covered | "recorded after the append commit and after the task-status seed write" | diff-local |
| criterion | Story 1 happy: Given round `r1` region entry, when it begins, then host 1's base is pinned in the route record as the `closed/c1` SHA before any branch switch or commit. | 48 | covered | "written before the first `git switch` and before any commit in the recorded argv" | diff-local |
| criterion | Story 1 happy: Given a round whose only host is the leaf, when region entry runs, then the leaf's frozen blocks are written on `feat/daemon-demo` and the pinned base is the leaf tip read before the append commit. | 50 | covered | "writes the leaf's frozen blocks on `feat/daemon-demo`" | diff-local |
| criterion | Story 1 happy: Given an audit round whose every routed task for host 1, frozen rem ids and restaged bound ids alike, is already evidence-complete on child 1's tree after region entry, when the no-op guard runs, then the feature halts with outcome `derived-already-complete` on its halt record and no build is dispatched. | 56 | covered | "writes a halt whose record carries outcome `derived-already-complete`" | diff-local |
| criterion | Story 1 happy: Given round `r1` admitted and region entry run, when the events are read, then exactly one `kickback` event and one leaf rewind exist for the round, and region entry emitted neither. | 48 | covered | "records exactly one `kickback` event and one leaf `navigateBack` call" | diff-local |
| criterion | Story 1 negative: Given region entry is replayed after a crash, when a block with the same id and an identical canonical body already exists, then it is accepted and nothing is appended or committed. | 49 | covered | "appends nothing and creates no commit" | diff-local |
| criterion | Story 1 negative: Given region entry, when a block with the same id but a different body exists on `feat/c1/demo`, then the feature halts needs-human naming the id, no commit is made, and no `-2` ordinal id appears. | 50 | covered | "halts needs-human naming that id" | diff-local |
| criterion | Story 1 negative: Given region entry, when the append commit is refused by a pre-commit hook, then the feature halts, host 1 stays `admitted`, and no later region step is dispatched. | 50 | covered | "host 1 stays `admitted`, and the dispatch spy records no later region step" | diff-local |
| criterion | Story 1 negative: Given the worktree has an uncommitted file, when region entry tries to switch to `feat/c1/demo`, then it is refused naming that file, and host 1 stays `admitted`. | 48 | covered | "returns the `switchToChild` dirty-tree refusal naming that file" | diff-local |
| criterion | Story 1 negative: Given region entry would write a rem id that is not in the round's frozen allocation, when the write runs, then it is refused and nothing is appended. | 49 | covered | "a block id absent from the frozen allocation is refused with nothing appended" | diff-local |
| criterion | Story 1 negative: Given a crash after the append commit and before host 1 is `repairing`, when the feature resumes, then each frozen rem id appears exactly once on `feat/c1/demo` and host 1 ends `repairing`. | 47 | covered | "leaves each frozen rem id exactly once on `feat/c1/demo`" | diff-local |
| criterion | Story 1 negative: Given a crash after the base pin and before the switch, when the feature resumes, then the recorded pin is reused unchanged. | 48 | covered | "leaves `entry.pinnedBase` unchanged" | diff-local |
| criterion | Story 1 negative: Given host 1 already `repairing` for `r1`, when the feature resumes in host 1's region, then child 1's region steps are not restaged again and nothing is appended. | 48 | covered | "no rem block is appended to the plan, and no commit is created" | diff-local |
| criterion | Story 1 negative: Given host 1 already `repairing` for `r1` and the worktree checked out on another branch, when the feature resumes, then the worktree is switched to `feat/c1/demo` before any dispatch. | 48 | covered | "switches to `feat/c1/demo` before returning `resume`" | diff-local |
| criterion | Story 1 negative: Given round `r1` region entry where authored `T1` is complete and frozen `rem-prd-audit-T1` is pending, when the no-op guard runs, then it does not halt. | 56 | covered | "does not halt, and host 1 reaches `repairing`" | diff-local |
| criterion | Story 1 negative: Given an N=1 feature, when a remediation block's title drifted from a prior lap, then today's `-2` ordinal renaming still applies. | 50 | covered | "still appends the `-2` ordinal id" | diff-local |
| criterion | Story 2 happy: Given host 1 `repairing` for `r1`, when any commit is made on `feat/c1/demo`, then the commit hook adds `Round: r1` beside the engine-stamped `Task:` trailer. | 52 | covered | "carries both a `Task: <id>` trailer and a `Round: r1` trailer" | diff-local |
| criterion | Story 2 happy: Given a recreated worktree with no `engine-state.json`, when membership of `rem-prd-audit-T1` is checked, then it resolves to child 1 from the committed `**Child:** 1` line. | 54 | covered | "resolves `rem-prd-audit-T1` to child 1 from the committed `**Child:** 1` line" | diff-local |
| criterion | Story 2 happy: Given rem blocks already on `feat/c1/demo` and on the leaf, when a new round allocates work for `T1` and `T3`, then no rem id or ordinal is minted twice across the plans of the stack. | 49 | covered | "leaves no duplicated rem id or ordinal across the two plans" | diff-local |
| criterion | Story 2 happy: Given a recreated worktree whose child holds rem blocks of route round `r1`, when seal rotation is evaluated, then the ids in `r1`'s frozen allocation count as engine-recorded appends and rotation is permitted. | 55 | covered | "accepts the ids in `routes/r1`'s frozen allocation" | diff-local |
| criterion | Story 2 happy: Given round `r1` routes owner-1 task `T1` to host 2, when `conduct task done T1` runs on `feat/c2/demo`, then it succeeds and marks `T1` done in the flat task status through host 2's execution projection. | 39 | covered | "marks `T1` done in the flat `.pipeline/task-status.json`" | diff-local |
| criterion | Story 2 happy: Given round `r1` routes `T1` to host 2, when a commit on `feat/c2/demo` carries `Task: T1`, then the membership hook accepts it. | 39 | covered | "with a commit message carrying `Task: T1` exits 0" | diff-local |
| criterion | Story 2 negative: Given no marker, or a commit on a branch other than the marker's host branch, when the commit hook runs, then no `Round:` trailer is added and the message equals today's output. | 52 | covered | "the hook adds no `Round:` trailer" | diff-local |
| criterion | Story 2 negative: Given a commit message that already carries `Round: r1`, when the hook runs, then the message keeps exactly one `Round:` trailer. | 52 | covered | "keeps exactly one `Round:` trailer" | diff-local |
| criterion | Story 2 negative: Given an N=1 feature, when a commit goes through the installed hook under a recording git shim, then no command names `refs/conductor/demo/routes`, `repairing` or `revalidate`, and the message equals today's output. | 52 | covered | "records, via `withGitArgvShim`, no git command naming" | diff-local |
| criterion | Story 2 negative: Given the `appendedRemediationTaskChildren` cache disagrees with the committed `Child:` line, when membership is checked, then it follows the `Child:` line and the rebuilt cache matches it. | 54 | covered | "membership resolves child 1 and the rebuilt cache records child 1" | diff-local |
| criterion | Story 2 negative: Given a rem task with neither a committed `Child:` line nor a cache entry, when a commit names it, then the commit is refused as unreadable membership. | 54 | covered | "exits non-zero with an unreadable-membership message naming the task" | diff-local |
| criterion | Story 2 negative: Given a rem id in neither the recorded appends nor any route record's frozen allocation, when seal rotation is evaluated, then rotation is refused. | 55 | covered | "still returns `engine-append-unvouched`" | diff-local |
| criterion | Story 2 negative: Given round `r1` routes `T1` to host 2, when a commit on `feat/c2/demo` carries `Task: T3`, then the membership hook refuses it naming `T3`. | 39 | covered | "with a commit carrying `Task: T3` exits non-zero and names `T3`" | diff-local |
| criterion | Story 3 happy: Given routing on and child 1 closing with a RED marker, when `closeChild` runs, then `refs/conductor/demo/red/c1` is created pointing at a blob holding the digest of child 1's RED evidence. | 53 | covered | "creates `refs/conductor/demo/red/c1` pointing at a blob of the marker's digest" | diff-local |
| criterion | Story 3 happy: Given host 1's routed pass passes verify-green, when the event log is read, then the `acceptance_red` event has `state` `satisfied` and `mode` `verify-green`, never a fresh RED proof or a waiver. | 207 | covered | "emits `acceptance_red` with `state` `satisfied`, `mode` `verify-green` and no `viaException` field" | diff-local |
| criterion | Story 3 happy: Given host 1's routed pass with a present RED marker that has no provenance (a legacy marker), when `acceptance_specs` runs, then verify-green runs and the legacy marker is not a refusal. | 207 | covered | "runs verify-green (its `acceptance_red` carries `mode` `verify-green`)" | diff-local |
| criterion | Story 3 happy: Given host 1's routed pass with `.pipeline/children/1/acceptance-specs-red.json` absent after a worktree recreation, when `acceptance_specs` runs, then it runs child 1's existing specs in verify-green mode and reads the digest from `red/c1`. | 207 | covered | "reads the digest from `refs/conductor/demo/red/c1`" | diff-local |
| criterion | Story 3 happy: Given a child closed before this change with no `red/c1` ref, when its routed pass runs acceptance on passing specs, then the step completes without a refusal. | 207 | covered | "completes without a refusal when no `red/c1` ref exists" | diff-local |
| criterion | Story 3 negative: Given host 1's routed pass, when `acceptance_specs` runs, then the RED self-heal is never invoked and no `missing` RED refusal is recorded. | 207 | covered | "records no `selfHealAcceptanceRed` call and no `missing` RED refusal" | diff-local |
| criterion | Story 3 negative: Given host 1's routed pass, when one of child 1's existing acceptance specs fails, then `acceptance_specs` fails for host 1's region and is not re-run as a RED self-heal. | 207 | covered | "fails `acceptance_specs` for host 1's region with no `selfHealAcceptanceRed` call when one of child 1's specs fails" | diff-local |
| criterion | Story 3 negative: Given `red/c1` already exists with the same digest because a closure is resumed after a crash, when `closeChild` runs again, then it succeeds and the blob is unchanged. | 53 | covered | "a resumed `closeChild` succeeds and the blob SHA is unchanged" | diff-local |
| criterion | Story 3 negative: Given `red/c1` already exists with a different digest, when `closeChild` runs, then it is refused and the existing blob is unchanged. | 53 | covered | "`closeChild` returns `refused` and the blob SHA is unchanged" | diff-local |
| criterion | Story 3 negative: Given routing off, when `closeChild` runs, then no `red/c<k>` ref is written. | 53 | covered | "with routing off, or with no RED marker, no `red/c1` ref exists after `closeChild`" | diff-local |
| criterion | Story 3 negative: Given a child with no owned criteria and so no RED marker, when it closes, then no `red/c<k>` ref is written, and its later routed pass runs verify-green without a refusal. | 53, 207 | covered | "when the child has no RED marker" | diff-local |
| criterion | Story 3 negative: Given host 1's routed pass with a present RED marker whose digest differs from `red/c1`, when `acceptance_specs` runs, then the step fails naming the digest mismatch. | 207 | covered | "fails naming the digest mismatch" | diff-local |
| criterion | Story 3 negative: Given an N=1 feature, when `acceptance_specs` runs, then today's RED lifecycle applies unchanged. | 207 | covered | "every existing acceptance-RED lifecycle test (marker present, absent and without provenance) passes unchanged" | diff-local |
| criterion | Story 4 happy: Given a round with 1 new rem task for host 1 and 1 for the leaf, when host 1's BUILD dispatch occurs, then before the provider is dispatched one `prd_audit` lap and growth 2 are charged in the route record's receipt with a settlement id, and the flat ledger records them under that id. | 60 | covered | "the flat ledger records one `prd_audit` lap and growth 2 under `settlementReceipts` for that id" | diff-local |
| criterion | Story 4 happy: Given that settled round, when a later BUILD dispatch for the round's current host occurs, then only an acknowledgement is recorded, and the ledger's laps and growth are unchanged. | 60 | covered | "records only an `acks` entry" | diff-local |
| criterion | Story 4 happy: Given one round admitting a `prd_audit` FIXABLE and an as-built REMEDIABLE, when host 1 dispatches, then one lap is charged to each gate and their growth once, in one settlement. | 60 | covered | "under one settlement id" | diff-local |
| criterion | Story 4 happy: Given a stacked feature's first ledger record, when growth is read, then `authored` is stored as 12 from the sealed plan, and it stays 12 after rem blocks exist only on child 1's plan. | 66 | covered | "stores `authored` 12 from the sealed plan" | diff-local |
| criterion | Story 4 happy: Given rem blocks pending only on child 1's plan, when growth is read before settlement, then the pending-task exclusion takes those ids from the frozen allocation. | 66 | covered | "`pendingAllocationTaskIds` returns exactly `['rem-prd-audit-T1']` and `readGrowth` excludes it" | diff-local |
| criterion | Story 4 happy: Given a worktree recreated after settlement, when the feature resumes, then settled laps, growth and taskless counters are rebuilt from the round receipts, and the ledger has no `pendingRepair` field. | 67 | covered | "rebuilds the `prd_audit` laps, growth and the `manual_test` counter from the receipts" | diff-local |
| criterion | Story 4 happy: Given a worktree recreated while an as-built round is open, when as-built runs again, then its prior-findings input includes the pending findings read from the route record. | 67 | covered | "includes the pending findings read from `routes/r1`" | diff-local |
| criterion | Story 4 happy: Given a routed round, when its life from admission to settlement is traced, then the receipt settlement is the only durable `prd_audit` lap charge. | 60 | covered | "the receipt settlement is the only change to the `prd_audit` lap count" | diff-local |
| criterion | Story 4 negative: Given a crash after the settlement compare-and-swap and before the ledger write, when the feature resumes and dispatches, then the ledger is reconciled by settlement id and the lap is charged exactly once. | 62 | covered | "applies the `prd_audit` lap exactly once, keyed by the receipt's settlement id" | diff-local |
| criterion | Story 4 negative: Given a crash before the settlement compare-and-swap, when host 1 dispatches again, then the round is charged exactly once. | 62 | covered | "the next host 1 dispatch charges the round exactly once" | diff-local |
| criterion | Story 4 negative: Given the `prd_audit` lap cap already used, when round `r1` reaches host 1's dispatch, then settlement is refused, the receipt stays unsettled, the allocation stays pending, no provider is dispatched, and the feature halts with HALT.class `kickback-cap`. | 63 | covered | "settlement returns `exhausted`, the receipt stays unsettled" | diff-local |
| criterion | Story 4 negative: Given that cap halt, when the flat feature ledger is read, then it holds typed `laps` cap evidence for `prd_audit` with a halt generation, and child 1's ledger holds none. | 63 | covered | "holds typed `laps` cap evidence for `prd_audit` with a halt generation" | diff-local |
| criterion | Story 4 negative: Given that cap halt, when the operator runs `kickback-budget raise --gate prd_audit` and the feature resumes, then the same receipt settles on the same frozen tasks, and no new route record or rem id is written. | 64 | covered | "settles the same receipt, the frozen allocation is byte-identical" | diff-local |
| criterion | Story 4 negative: Given a joined round, when the as-built lap cap or the effective growth cap is exhausted while the `prd_audit` lap is available, then neither gate is charged and no provider is dispatched. | 63 | covered | "neither gate is charged and the provider dispatch spy is never called" | diff-local |
| criterion | Story 4 negative: Given a malformed route record or receipt, when settlement reads it, then the budget is treated as exhausted and the feature halts. | 63 | covered | "makes settlement return `exhausted` and the feature halts" | diff-local |
| criterion | Story 4 negative: Given the current host is child 1, when child 2's BUILD dispatch tries to settle, then settlement is refused and nothing is written. | 61 | covered | "returns `not-current-host`, the receipt blob SHA is unchanged" | diff-local |
| criterion | Story 4 negative: Given two settlement attempts for the same round racing to the compare-and-swap, when both complete, then exactly one charge and one settlement id are recorded, and the loser records an acknowledgement. | 61 | covered | "record exactly one settlement id" | diff-local |
| criterion | Story 4 negative: Given the settlement compare-and-swap loses to an outbox drain that changed the record without settling it, when settlement re-reads, then it retries the whole operation rather than acknowledging, and halts needs-human naming the round after 3 failed attempts. | 61 | covered | "is retried rather than acknowledged" | diff-local |
| criterion | Story 4 negative: Given a restack journal opens between the settlement read and its compare-and-swap, when the transaction runs, then nothing is charged and the feature halts. | 61 | covered | "a journal opened between the read and the CAS returns `halted`" | diff-local |
| criterion | Story 4 negative: Given a stored `authored` of `0` against a sealed plan with 12 authored tasks, when growth is read, then it fails closed rather than re-deriving. | 66 | covered | "makes `readGrowth` throw rather than re-derive" | diff-local |
| criterion | Story 4 negative: Given `kickback-budget raise --gate prd_audit` while host 1 is the execution child, when it runs, then the raise is written to the flat feature ledger and child 1's ledger is unchanged. | 64 | covered | "with host 1 the execution child, `kickback-budget raise --gate prd_audit` writes the raise to `.pipeline/kickback-ledger.json`" | diff-local |
| criterion | Story 4 negative: Given an N=1 feature, when it remediates, then the existing growth and settlement behaviour passes unchanged. | 66, 205 | covered | "growth and settlement cases" | diff-local |
| criterion | Story 5 happy: Given a three-child stack, when a standalone `manual_test` FAIL is routed to child 2, then only the `manual_test` counter is charged, in the round receipt, and no `prd_audit` or as-built charge is made. | 65 | covered | "creates a record whose receipt holds `taskless.manual_test` 1" | diff-local |
| criterion | Story 5 happy: Given a three-child stack, when a validation-group join whose only failure is `manual_test` is routed, then it is charged the same way and its FAIL rows ride the host's retry hint. | 65 | covered | "host 2's stored `retryHint` contains the FAIL rows" | diff-local |
| criterion | Story 5 happy: Given a three-child stack, when a post-region custom step `lint-docs` kicks back and is routed to child 1, then no task is appended, today's durable tree-keyed kickback counter for the re-opened gate is bumped once, and the round receipt echoes that charge under `lint-docs` without charging it again. | 33 | covered | "`bumpKickbackGateInLedger` is called exactly once for the re-opened gate" | diff-local |
| criterion | Story 5 happy: Given a taskless round is admitted, when its admission is traced, then the counter bump, then the round's single `kickback` event, then the cap check occur in that order. | 65 | covered | "then exactly one `kickback` event for the round, then the cap check" | diff-local |
| criterion | Story 5 happy: Given a taskless round is admitted, when the caller returns from admission, then it emits no second `kickback` event for the round. | 65 | covered | "no `kickback` event after admission returns" | diff-local |
| criterion | Story 5 happy: Given a worktree recreated after a taskless round, when the feature resumes, then the `manual_test` counter is rebuilt from the round receipts. | 67 | covered | "the `manual_test` counter from the receipts" | diff-local |
| criterion | Story 5 negative: Given the `manual_test` counter at `MAX_KICKBACKS_PER_GATE`, when a stacked FAIL is admitted, then the feature halts with today's exhausted self-heal reason, and neither a route record nor `refs/conductor/demo/repairing` exists. | 65 | covered | "halts with today's exhausted self-heal reason" | diff-local |
| criterion | Story 5 negative: Given the re-opened gate's kickback counter at `MAX_KICKBACKS_PER_GATE` on the current tree, when `lint-docs` kicks back again, then the feature halts with today's `kickback ping-pong` reason and no route record exists. | 33 | covered | "halts with today's `kickback ping-pong` reason and no `routes/` ref exists" | diff-local |
| criterion | Story 5 negative: Given a `manual_test` taskless round, when its charge is recorded, then no gate entry in the kickback ledger changes. | 65 | covered | "the flat ledger's gate entries are byte-identical before and after a routed `manual_test` round" | diff-local |
| criterion | Story 5 negative: Given an N=1 feature, when `manual_test` FAILs or a custom step kicks back, then today's `manual_test` self-heal counter and today's durable custom-step kickback ledger apply unchanged. | 65, 33 | covered | "an N=1 `manual_test` FAIL uses today's self-heal counter with no routing ref read" | diff-local |
| criterion | Story 6 happy: Given an `existing-task` repair of `T1` hosted by child 1 in a round without FAIL rows, when region entry runs, then the obligation's boundary is `feat/c1/demo` at its tip on entry with a tree-hash baseline, and `T1` is restaged before child 1's BUILD dispatch. | 69 | covered | "writes an obligation with branch `feat/c1/demo`, head the tip at entry and the entry tree hash" | diff-local |
| criterion | Story 6 happy: Given that obligation, when a commit with `Task: T1` lands on `feat/c1/demo` after the boundary, then `T1` resolves. | 70 | covered | "resolves `T1` through `task-progress.ts` reading `head..tip(feat/c1/demo)`" | diff-local |
| criterion | Story 6 happy: Given that obligation, when the task-status rows are restored from trailers while the leaf is checked out, then `T1`'s row is restored from the trailer on `feat/c1/demo`. | 70 | covered | "restores `T1`'s row from a trailer on `feat/c1/demo` while `feat/daemon-demo` is checked out" | diff-local |
| criterion | Story 6 happy: Given a recreated worktree with no `engine-state.json` while host 1 is `repairing`, when the feature resumes, then the obligation is rebuilt from the route record with the same branch, boundary and admission key. | 69 | covered | "resume rebuilds the obligation from `routes/r1` with the same branch, boundary and admission key" | diff-local |
| criterion | Story 6 happy: Given an N=1 feature, when an obligation is admitted, then it carries no branch, and resolution behaves as today. | 68 | covered | "has no `branch` field" | diff-local |
| criterion | Story 6 negative: Given that obligation, when a pre-boundary commit with `Task: T1` exists on `feat/c1/demo`, then it does not resolve `T1`. | 70 | covered | "a pre-boundary commit with `Task: T1` on `feat/c1/demo` does not resolve `T1`" | diff-local |
| criterion | Story 6 negative: Given that obligation, when a commit with `Task: T1` lands on the leaf, then it does not resolve the obligation. | 70 | covered | "a commit with `Task: T1` on the leaf does not resolve the obligation" | diff-local |
| criterion | Story 6 negative: Given a crash between obligation admission and restage, when the feature resumes, then the admission key `(roundId, findingId, taskIds)` reuses the same obligation, and exactly one exists. | 68 | covered | "reuses the same obligation" | diff-local |
| criterion | Story 6 negative: Given a mixed round with FAIL rows and an `existing-task` gap on `T2`, when region entry runs, then the obligation is admitted but `T2` is not restaged. | 69 | covered | "the restage spy records no call for `T2`" | diff-local |
| criterion | Story 6 negative: Given a route record whose `existing-task` item has no bound task ids, when it is read, then it is rejected as malformed and the feature halts. | 63, 200 | covered | "including an `existing-task` item with no `taskIds`" | diff-local |
| criterion | Story 6 negative: Given an obligation boundary on `feat/c1/demo` rewritten by a restack, when trailers are read, then the rewrite is followed and only post-boundary commits resolve `T1`. | 70 | covered | "is followed through rewrite translation" | diff-local |
| criterion | Story 6 negative: Given an obligation record whose branch is not a valid branch name, when it is parsed, then it is rejected. | 68 | covered | "rejects a record whose `branch` is `feat/../x`" | diff-local |
| criterion | Story 7 happy: Given host 1 `repairing`, when `build_review` runs, then its base kind is `routed-repair`, its base is the pinned `closed/c1` SHA, and only commits made after that base are graded. | 72 | covered | "returns `baseKind: 'routed-repair'` and a base equal to `entry.pinnedBase`" | diff-local |
| criterion | Story 7 happy: Given host 1's routed pass, when testQuality materialises pre-change content, then it restores from the same pinned base as the review. | 72 | covered | "receive `mergeBase` equal to `entry.pinnedBase`" | diff-local |
| criterion | Story 7 happy: Given host 1's routed pass at child 1's cumulative `build_review` bound, when `build_review` fails, then the round's `routedRepairCredit` grants one more lap and the feature does not halt. | 74 | covered | "consumes `routedRepairCredit` for `r1` on the next FAIL and the feature does not halt" | diff-local |
| criterion | Story 7 happy: Given the credit was granted, when the event log is read, then the `routed_repair_phase` event for `repairing` carries `credit: true`. | 74 | covered | "carries `credit: true`" | diff-local |
| criterion | Story 7 negative: Given host 1 already used its `routedRepairCredit`, when `build_review` fails again, then the feature halts needs-human with a reason naming child 1. | 74 | covered | "halts with HALT.class `needs-human` and a reason naming child 1" | diff-local |
| criterion | Story 7 negative: Given child 1's parent closure moves after region entry, when the routed pass's `build_review` runs, then its base is unchanged. | 72 | covered | "leaves the routed pass's base unchanged" | diff-local |
| criterion | Story 7 negative: Given a `feature-repair` restack while a round is open, when refunds are computed, then no convergence refund is granted. | 74 | covered | "`creditBuildReviewConvergence` grants no refund" | diff-local |
| criterion | Story 7 negative: Given the credit was granted, when child 1's ledger is read, then `convergenceCreditReceipts` and its other per-child caps are unchanged. | 74 | covered | "`convergenceCreditReceipts` and other per-child caps are byte-identical" | diff-local |
| criterion | Story 7 negative: Given an N=1 feature or a non-routed child pass, when `build_review` runs, then today's base kinds apply. | 72 | covered | "still returns its existing base kind" | diff-local |
| criterion | Story 8 happy: Given host 1 mid-repair with two builder commits stamped `Round: r1`, when the builder returns `blocked-by-prerequisite` with symbols `parseB` naming child 2, and `parseB` is absent at `closed/c1` and present at `closed/c2`, then one transaction pins the rejected tip, resets `feat/c1/demo` to `closed/c1`, moves the marker to child 2, records the fallback and re-targets the open obligations. | 58, 206 | covered | "pins the old tip at `refs/conductor/demo/rejected/r1/1`, moves `feat/c1/demo` to `closed/c1` and moves the marker to host 2" | diff-local |
| criterion | Story 8 happy: Given that verified reroute, when the worktree sync completes, then the checked-out tree equals `closed/c1`, host 1 is `rerouted`, child 2 is `admitted`, and child 2's region entry writes the same rem ids and bodies with `**Child:** 2`. | 59 | covered | "leaves the checked-out tree equal to `closed/c1`'s tree" | diff-local |
| criterion | Story 8 happy: Given that verified reroute, when the round's receipt is read, then no lap or growth was charged a second time. | 59 | covered | "the receipt's laps and growth are byte-identical to their pre-reroute values" | diff-local |
| criterion | Story 8 happy: Given that verified reroute, when the event log is read, then one `remediation_rerouted` event names the round, child 1 and child 2. | 58 | covered | "exactly one persisted `remediation_rerouted` event names `r1`" | diff-local |
| criterion | Story 8 happy: Given that verified reroute, when `refs/conductor/demo/rejected/r1/1` is read, then it equals the pre-reroute `feat/c1/demo` tip. | 58 | covered | "equals the pre-reroute tip" | diff-local |
| criterion | Story 8 happy: Given host 2 claims `src/c.ts` is missing and names the leaf, when the claim is verified against the leaf tip, then the host moves to the leaf. | 57, 59 | covered | "moves the host to the leaf" | diff-local |
| criterion | Story 8 happy: Given host 1 whose only commits past `closed/c1` are stamped `Round: r1` or are halt-record-only, when a verified claim arrives, then the reroute proceeds. | 58, 206 | covered | "with only stamped and halt-record-only commits it proceeds" | diff-local |
| criterion | Story 8 happy: Given an operator commit made through the hook on `feat/c1/demo` while the marker names host 1, when a verified reroute resets the branch, then that commit stays reachable at `rejected/r1/1` and the `remediation_rerouted` event names that ref. | 58 | covered | "an operator commit made through the hook stays reachable at that ref after the reset" | diff-local |
| criterion | Story 8 negative: Given host 1, when the builder claims `parseB` is missing but `parseB` is present at `closed/c1`, then the claim is rejected, the attempt counts against child 1's region caps, and the host stays 1. | 57, 206 | covered | "returns `unverified`, child 1's region attempt counter records one failed attempt" | diff-local |
| criterion | Story 8 negative: Given host 2, when the builder names child 1, then the claim is refused because child 1 is not above the host, and no ref moves. | 57 | covered | "for host 2 naming child 1 it returns `refused-not-above`" | diff-local |
| criterion | Story 8 negative: Given a verified claim naming child 2, when child 2's closure holds `parseB` but lacks another prerequisite input of the work order, then the claim is rejected and counts as a failed attempt. | 57, 206 | covered | "when `closed/c2` lacks another prerequisite input it returns `unverified`" | diff-local |
| criterion | Story 8 negative: Given host 1's branch holds an unstamped operator commit past `closed/c1`, when a verified claim arrives, then the reroute is refused needs-human naming that commit and nothing is reset. | 58 | covered | "the reroute halts needs-human naming that commit and nothing is reset" | diff-local |
| criterion | Story 8 negative: Given a restack journal that is not terminal, when a verified claim arrives, then the reroute is refused needs-human and no ref moves. | 58 | covered | "with a non-terminal journal" | diff-local |
| criterion | Story 8 negative: Given the destination child is not `pending`, when a verified claim names it, then the reroute is refused needs-human and no ref moves. | 58 | covered | "a non-`pending` destination" | diff-local |
| criterion | Story 8 negative: Given the reroute transaction, when another writer changes the marker or the host branch between read and write, then nothing moves and the feature halts needs-human naming the round. | 58 | covered | "naming the round on a failed compare-and-swap" | diff-local |
| criterion | Story 8 negative: Given a crash after the reroute transaction and before the worktree sync, when the feature resumes, then the sync completes before any admission or dispatch and the tree ends at `closed/c1`. | 59 | covered | "completes the sync before any `admitRound` or dispatch" | diff-local |
| criterion | Story 8 negative: Given the worktree sync fails, when the feature resumes, then the round stays `reroute-moved` and no admission or dispatch happens until the sync succeeds. | 59 | covered | "leaves the phase `reroute-moved` and records no admission or dispatch" | diff-local |
| criterion | Story 8 negative: Given a round already rerouted from child 1 to child 2, when child 2's builder makes a verified claim naming the leaf, then the host becomes the leaf, and a later claim from the leaf is refused. | 59 | covered | "a later claim from the leaf host returns `refused-not-above`" | diff-local |
| criterion | Story 8 negative: Given a routed build returns a malformed structured result, when it is handled, then it counts as a failed attempt on the host region's caps. | 57, 206 | covered | "a malformed claim records one failed attempt on the host region's counter" | diff-local |
| criterion | Story 8 negative: Given a routed build returns no structured result, when it is handled, then no claim is made and the build is processed as today. | 57 | covered | "no claim is recorded" | diff-local |
| criterion | Story 8 negative: Given an N=1 feature or a non-routed build, when the builder is dispatched, then no structured result is requested. | 204 | covered | "an N=1 or non-routed build dispatch requests no structured result" | diff-local |
| criterion | Story 9 happy: Given no restack journal or a terminal one, when region entry, settlement and the reroute run, then each writes through the single fenced routing transaction carrying a `verify` of the journal ref. | 205, 201 | covered | "with no journal and with a terminal `applied` journal" | diff-local |
| criterion | Story 9 happy: Given an N=1 feature with routing on, when a full remediation lap runs under a recording git shim, then no git command names `routes`, `repairing` or `revalidate`. | 205 | covered | "records no git command naming `routes`, `repairing` or `revalidate`" | diff-local |
| criterion | Story 9 happy: Given routing off on a three-child stack, when a whole-feature gate fails, then remediation behaves exactly as before this spec. | 205 | covered | "equal to the routing-off fixtures recorded from the pre-change path" | diff-local |
| criterion | Story 9 negative: Given a restack journal in state `moved`, when region entry, settlement or the reroute tries to write, then each is refused and `routes/r1` stays at its prior blob. | 205 | covered | "each returns a refusal leaving `routes/r1` at its prior blob" | diff-local |
| criterion | Story 9 negative: Given a restack journal created between a writer's read and its transaction, when the transaction runs, then it fails on the journal `verify` and nothing is written. | 201 | covered | "fails on the journal `verify` line" | diff-local |
| criterion | Story 9 negative: Given a fixture that writes a `routes/` ref outside the route-record store, when the structural check runs, then it fails. | 201 | covered | "fails on a fixture source file that writes" | diff-local |

## Judgement record

- **Coverage (plan §7a).** Fresh subagents judged every criterion row against only its cited
  `Done when` checks.
  - Round 1 passed 112 of 124. Rounds 2 and 3 re-judged the revised claims until all passed.
  - After the achievability fixes, rounds 4 and 5 re-judged every claim citing a changed task.
  - Every refusal was fixed as the judge stated. None was argued away.
- **Achievability and ADR mapping (§4g, §4f).** Two opus judges found no `fail`. They left 10
  rows unsettled and found 7 wrong or partial obligation mappings. The plan was revised:
  - Task 53 was split into Task 53 and Task 207. Task 207 makes the completion predicate a pure
    read of a result keyed by round, host and tip. It adds the skipped, errored and zero-executed
    failures, and requires no `viaException` field.
  - New Task 206 calls the reroute on a verified claim. Unverified and malformed claims consume
    the existing `defaults.max_retries` attempt loop.
  - Task 74 writes the `routedRepairCredit`.
  - Task 205's golden cell turns the setting on.
  - Task 60's trace covers a leaf-only round.
  - Tasks 63 and 64 record growth cap evidence and test a growth raise.
  - Task 72 checks evidence binding.
  - Task 66 pins `pendingAllocationTaskIds` to the frozen allocation.
  - The obligation rows for engine-owned D3 and D5, lifecycle D2, routed D4, D5, D9, D10, D11,
    D16 and D18, no-op D2 and budget-recovery D5 were corrected.

  An opus re-judge confirmed every change, and its last four notes were applied verbatim.
- **Moved to #3212 during this check:** decision 9's restack replay merge (#3212 draft Tasks
  89–90). It is recorded in the track marker and the architecture review's Scope.
- **Operator decisions in this DECIDE pass:**
  - full spec C scope, with the re-validation pieces moved to #3212;
  - approach A, as the ADR approved it;
  - a scope exception over a further split;
  - the conflict resolutions B1–B3, D1–D7 and R1–R3, with amendment notes on six ADRs.
