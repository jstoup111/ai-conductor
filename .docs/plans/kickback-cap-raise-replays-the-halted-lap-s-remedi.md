# Implementation Plan: Kickback cap halts at the remediation→build transition (#2753)

**Date:** 2026-09-29
**Stories:** .docs/stories/kickback-cap-raise-replays-the-halted-lap-s-remedi.md
**Conflict check:** Clean as of 2026-09-29

## Summary

A consumed `kickback-budget raise` currently spends its first lap re-auditing unchanged code, because every remediation cap halt fires inside the audit round, before the repair reaches the plan. This plan moves the prd_audit lap cap, the plan-growth cap and the as-built lap cap to the build dispatch boundary. /remediate runs, and its tasks are appended, committed and made pending. The lap and growth are charged when build dispatches, all or nothing, so a raise resumes straight into build on the same tasks. The plan has 12 tasks.

## Technical Approach

- **One durable pending charge.** An optional `pendingRepair` record on the version-1 kickback ledger (`src/conductor/src/engine/kickback-ledger.ts`) holds a receipt id, the per-gate lap and growth charges, and the task ids. It is written in the append's ledger lease and removed by the settlement that charges it, so "charged and still pending" cannot be represented. Absent means none, with no version bump. A malformed record fails closed, scoped to the prd_audit and as-built gates and the growth record (adr-2026-08-31-kickback-ledger-read-fails-closed D1/D3).
- **Settlement at the build boundary.** `stepLoop` in `src/conductor/src/engine/conductor.ts` already has a pre-dispatch boundary every `planRemediation` caller reaches: after the operator-park boundary and before build is saved `in_progress`. The durable build_review retry-context check there is the precedent: it halts before build and leaves build not done. The settlement runs there only when a pending record exists, and after any pre-dispatch refusal, so a refused dispatch charges nothing. It follows `settleRemediationRound`'s check-then-charge-under-one-lease pattern and reuses `recordRemediationGateLap` and `recordGrowth`, so `plan_growth` still reaches the event spine. It adds no event type and no halt class.
- **`planRemediation` stops enforcing caps.** The #2755 pre-remediate check and the three post-remediate cap exits go. Their halt text, `recordKickbackCapEvidence` and recovery hint move to the settlement unchanged. Over-scope routing, /remediate dispatch, admission, the single appender, `seedTaskStatus` and the plan commit stay where they are.
- **Existing-task rounds.** prd_audit and as-built existing-task rounds keep their restage in `src/conductor/src/engine/repair-restage.ts` but record a lap-only pending charge keyed by the repair obligation id, instead of charging at restage. coverage_binding keeps charging at restage.
- **Growth derivation.** `readGrowth` subtracts the pending record's task ids. Otherwise appended but uncharged tasks would be reclassified as authored, refunding allowance and inflating the 25% denominator.
- **Resume.** A halt at the boundary leaves build not done. The daemon's existing raise consumption clears the halt, resume re-enters the first non-done step (build), and the re-kick's BUILD pre-verify, which is gated on `build === 'done'`, routes it as repair work. Tasks 9 and 10 pin that path with tests and fix only what the tests expose.
- **Sequencing.** Ledger primitives (Tasks 1–4) come first, then the append-side change (Task 5), then the boundary (Task 6), then the paths that depend on the boundary (Tasks 7–12).

## Prerequisites

- The companion story PR that rewords the shipped kickback-cap stories to the build-transition timing merges together with this spec.

## Tasks

### Task 1: Pending-repair ledger record with fail-closed validation
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/kickback-ledger.test.ts` for an optional `pendingRepair` record on the version-1 kickback ledger: absent reads as no pending repair; a well-formed record (receipt id, per-gate lap and growth charges keyed by `prd_audit` and `architecture_review_as_built`, task ids) round-trips; a present but malformed record makes the prd_audit lap, as-built lap and growth allowances read as exhausted while other gate entries keep their own budgets.
2. Verify RED.
3. Implement the type and its validator in `src/conductor/src/engine/kickback-ledger.ts` beside the existing `pendingAsBuiltRemediationFindings` validation. Follow that field's shape: optional, absent reads as empty, no schema version bump. Unlike that field, a malformed `pendingRepair` does not invalidate the whole ledger; scope its invalidity to the prd_audit and as-built gates and the growth record (adr-2026-08-31-kickback-ledger-read-fails-closed D1/D3). Make `readRemediationGateAppendBudget` in `src/conductor/src/engine/conductor.ts` report those allowances as exhausted in that case.
4. Verify GREEN and commit.

**Done when:**
- `readKickbackLedger` treats a ledger with no `pendingRepair` field as having no pending repair and round-trips a well-formed `pendingRepair` record with its receipt id, per-gate lap and growth charges, and task ids, as asserted in the kickback-ledger tests.
- A present but malformed `pendingRepair` record makes `readRemediationGateAppendBudget` report the prd_audit lap, the architecture_review_as_built lap and the growth allowance as exhausted, while a build_review gate entry in the same ledger still reads its unchanged budget.

**Files:** src/conductor/src/engine/kickback-ledger.ts; src/conductor/src/engine/conductor.ts; src/conductor/test/engine/kickback-ledger.test.ts

**Dependencies:** none

### Task 2: Record and discard the pending repair without charging
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/kickback-ledger.test.ts` for `recordPendingRepair` and `discardPendingRepair`.
2. Verify RED.
3. Implement both in `src/conductor/src/engine/kickback-ledger.ts` under the existing kickback-ledger lease (`withKickbackLedgerLease`). `recordPendingRepair` stores the charges without touching `gates.<gate>.laps` or `growth`; a second call with the same receipt id is an idempotent no-op; a call with a different receipt while one is recorded throws, so the caller halts rather than overwriting an unsettled repair. `discardPendingRepair` removes the record and charges nothing.
4. Verify GREEN and commit.

**Done when:**
- `recordPendingRepair` writes the pending record under the kickback-ledger lease and leaves every gate's `laps` and `growth.added` unchanged, as asserted in the kickback-ledger tests.
- A second `recordPendingRepair` call with the same receipt id leaves exactly one pending record with unchanged charges, so a replay records no second pending charge.
- `discardPendingRepair` removes the pending record without changing any gate's `laps` or `growth.added`.

**Files:** src/conductor/src/engine/kickback-ledger.ts; src/conductor/test/engine/kickback-ledger.test.ts

**Dependencies:** 1

### Task 3: Settle the pending repair all or nothing
**Story:** 2
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/kickback-ledger.test.ts` for `settlePendingRepair(projectRoot, budgets)`: within allowance it charges every gate its lap and growth and removes the record in one lease; with any gate exhausted it charges nothing, keeps the record, and returns the first exhausted gate and allowance; with no record it returns `none`.
2. Verify RED.
3. Implement it in `src/conductor/src/engine/kickback-ledger.ts`, modelled on `settleRemediationRound`'s check-then-charge under one lease (receipt plus `lapCap`). Reuse `recordRemediationGateLap` and `recordGrowth` so `plan_growth` is still emitted on the event spine; add no new event type.
4. Verify GREEN and commit.

**Done when:**
- With every charged gate within its allowance, `settlePendingRepair` advances each gate's `laps` by exactly one and `growth.added` and `growth.byGate` by that gate's appended task count, emits `plan_growth`, and removes the pending record in one ledger lease.
- With any charged gate's lap or growth allowance exhausted, `settlePendingRepair` changes no gate's `laps` or `growth` values, keeps the pending record, and returns the exhausted gate and allowance.
- After a successful settlement, a second `settlePendingRepair` call finds no pending record and charges no lap or growth a second time.
- For a lap-only existing-task charge, `settlePendingRepair` advances that gate's `laps` by one and leaves `growth.added` unchanged.

**Files:** src/conductor/src/engine/kickback-ledger.ts; src/conductor/test/engine/kickback-ledger.test.ts

**Dependencies:** 2

### Task 4: Exclude pending tasks from the authored growth count
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/kickback-ledger.test.ts`: with a pending record naming appended tasks, `readGrowth` excludes them from `authored` with and without a stored growth record, and the 25% cap denominator is unchanged by them; `rem-` tasks that predate the growth record and are not named by the pending record still count as authored.
2. Verify RED.
3. In `src/conductor/src/engine/kickback-ledger.ts`, make `deriveGrowthFromActivePlan` and the reconciliation in `readGrowth` subtract the task ids named by the pending record. Key exclusion on the record's task ids, never on the `rem-` prefix.
4. Verify GREEN and commit.

**Done when:**
- With a pending record naming appended tasks, `readGrowth` returns an `authored` count that excludes those tasks and a `remaining` allowance computed as if they were not yet added, both with a stored growth record and with none.
- With no prior growth record, the authored count and the 25 percent cap computed by `prdAuditAppendCap` are unchanged by tasks named in the pending record.
- Earlier `rem-` prefixed plan tasks that the pending record does not name still count toward `authored`; exclusion keys on the pending record's task ids, never on the task-id prefix.

**Files:** src/conductor/src/engine/kickback-ledger.ts; src/conductor/test/engine/kickback-ledger.test.ts

**Dependencies:** 1

### Task 5: Append the repair and record the pending charge instead of halting at the cap
**Story:** 1
**Story:** 3
**Type:** happy-path

**Steps:**
1. Rewrite the #2755 RED test in `src/conductor/test/prd-audit-kickback.test.ts` and add tests to `src/conductor/test/engine/conductor-kickback-transition.test.ts`: with the prd_audit lap exhausted, `planRemediation` still dispatches /remediate, appends and commits the admitted tasks, seeds them pending, records the pending charge, and routes to build; a round within its allowance records the pending charge and leaves laps and growth unchanged; an append failure records nothing; an unreadable ledger halts fail-closed before append.
2. Verify RED.
3. In `src/conductor/src/engine/conductor.ts`: remove the `prdAuditLapCapHaltBeforeRemediate` call and method, and remove the three post-remediate cap exits (prd_audit lap/growth, as-built lap/growth, shared growth). Keep the budget reads for building the charges. After a successful append, replace `recordRemediationGateAppend` with `recordPendingRepair` (receipt = a fresh engine-issued id). Keep `appendRemediationTasks`, `recordAppendedRemediationTaskIds`, `seedTaskStatus`, the plan commit, and the over-scope routing that runs before /remediate unchanged.
4. Verify GREEN and commit.

**Done when:**
- With the prd_audit lap exhausted and FIXABLE findings, `planRemediation` dispatches remediate, appends and commits the admitted tasks, and returns a build route with no kickback-cap halt before or during the remediation round, as asserted in the rewritten prd-audit-kickback test.
- After that round, `.pipeline/task-status.json` lists every appended remediation task as pending with the same id and title remediate wrote, and the ledger holds a pending record naming those task ids.
- After an in-allowance append, the prd_audit gate's `laps` and `growth.added` are unchanged until build dispatches.
- When `appendRemediationTasks` fails, no pending record is written and every gate's `laps` and `growth` values are unchanged.
- With an unreadable kickback ledger, the round halts fail-closed before `appendRemediationTasks` runs, and no task is appended and no pending record is written.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/prd-audit-kickback.test.ts; src/conductor/test/engine/conductor-kickback-transition.test.ts

**Dependencies:** 2

### Task 6: Settle or halt at the build dispatch boundary
**Story:** 1
**Story:** 2
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-kickback-transition.test.ts` driving the conductor step loop into build with a pending record: within allowance, build dispatches and the charges settle; with an exhausted lap or growth allowance (prd_audit, as-built, or one gate of a mixed round), no build dispatch, a kickback-cap halt naming the allowance and every finding with a fresh halt generation, nothing charged, build persisted as not done; with a malformed pending record, no build dispatch.
2. Verify RED.
3. In `src/conductor/src/engine/conductor.ts` `stepLoop`, add the settlement at the pre-dispatch boundary for `step.name === 'build'`: after the operator-park boundary, after any pre-dispatch refusal, and before build is saved `in_progress`. Follow the existing durable build_review retry-context check at that boundary: write the halt with `writeHaltMarker`, persist state, and call `emitLoopHalt`, leaving build not done. Move the halt text, `recordKickbackCapEvidence` call and `renderKickbackRecoveryHint` from the removed `planRemediation` exits so the halt names the gate, the allowance and every finding exactly as before.
4. Verify GREEN and commit.

**Done when:**
- For a prd_audit round with an exhausted lap, a prd_audit round whose admitted tasks exceed the remaining plan-growth allowance, and an as-built REMEDIABLE round with an exhausted lap, the round's tasks are appended and pending and the step loop then writes a kickback-cap HALT before build is dispatched whose text names respectively the prd_audit lap, the growth allowance or the as-built lap allowance and every finding with a new `Kickback halt generation` that `recordKickbackCapEvidence` stores.
- At that halt, the persisted conduct state records build as not done, the appended tasks stay pending in task-status, and no gate's `laps` or `growth` value changes.
- In a mixed prd_audit and as-built round where only the as-built lap is exhausted, the halt fires at the build transition and neither gate's `laps` nor `growth` changes.
- After a consumed raise that is still too small, or that targets the other gate, the build boundary halts kickback-cap again with a new halt generation, charges nothing, and does not dispatch build.
- With a malformed pending record, the build boundary halts kickback-cap reading the prd_audit, as-built and growth allowances as exhausted, and does not dispatch build.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/engine/conductor-kickback-transition.test.ts

**Dependencies:** 3, 5

### Task 7: Existing-task rounds register a lap-only pending charge
**Story:** 3
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/repair-restage.test.ts` and `src/conductor/test/engine/conductor-kickback-transition.test.ts`: a prd_audit or as-built existing-task round re-stages its bound tasks pending and records a lap-only pending charge whose receipt is the repair obligation id, with no lap charged at restage; replaying admission for the same obligation records no second charge; at an exhausted lap the round re-stages and then halts at the build transition with no lap charged; a coverage_binding reopen still charges its lap at restage and records no pending charge.
2. Verify RED.
3. In `src/conductor/src/engine/repair-restage.ts` `admitAndRestageRepair`, skip the restage lap charge (`settleRemediationRound`) only when the obligation's source gate is prd_audit or architecture_review_as_built; for those sources `src/conductor/src/engine/conductor.ts` records the lap-only pending charge using the obligation id as receipt. Leave the coverage_binding path unchanged (adr-2026-09-06-reopened-task-resolution D10).
4. Verify GREEN and commit.

**Done when:**
- A prd_audit existing-task round re-stages its bound tasks pending in task-status and records a lap-only pending charge keyed by the repair obligation id, with no lap charged at restage.
- When build dispatches after that round, the gate's `laps` advances by one and `growth.added` is unchanged.
- Re-running admission for the same repair obligation leaves one pending charge, and only one lap is charged when build dispatches.
- With the gate lap exhausted, the existing-task round re-stages its bound tasks pending and the build boundary halts kickback-cap with no lap charged.
- A coverage_binding existing-task reopen charges its lap at restage through `settleRemediationRound` as before and writes no pending record.

**Files:** src/conductor/src/engine/repair-restage.ts; src/conductor/src/engine/conductor.ts; src/conductor/test/engine/repair-restage.test.ts; src/conductor/test/engine/conductor-kickback-transition.test.ts

**Dependencies:** 3, 6

### Task 8: The route-into-no-op guard discards the pending repair
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/conductor-remediation-noop-guard.test.ts`: when the adr-2026-07-13 D1 route-into-no-op guard halts after an append, the halt is needs-human with unchanged text, the pending record is discarded, no lap or growth is charged, and a later build dispatch settles nothing for it.
2. Verify RED.
3. In `src/conductor/src/engine/conductor.ts`, call `discardPendingRepair` on the guard's needs-human exit before writing the halt.
4. Verify GREEN and commit.

**Done when:**
- When the route-into-no-op guard fires after an append, the conductor writes a needs-human halt with its existing text and `discardPendingRepair` removes the pending record.
- After that halt, no gate's `laps` or `growth` has changed, and a later build dispatch finds no pending record and charges nothing.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/engine/conductor-remediation-noop-guard.test.ts

**Dependencies:** 2, 5

### Task 9: A consumed raise resumes straight into build
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-kickback-transition.test.ts` (conductor resume) and `src/conductor/test/engine/daemon-rekick.test.ts` (daemon authorization consumption) using the halt produced by Task 6: after a consumed prd_audit raise, the next dispatched step is build on the pending tasks and no validation-group member dispatches before build completes; with no raise, or a raise bound to an older halt generation, the feature stays halted and nothing dispatches.
2. Verify RED.
3. Fix whatever the tests expose in `src/conductor/src/engine/conductor.ts` resume entry (`findResumeIndex` and the verdict clamp) so resume lands on build. Expected: no change to `consumeResumeAuthorizations` beyond test coverage.
4. Verify GREEN and commit.

**Done when:**
- After a consumed prd_audit raise, the resumed conductor dispatches build first, builds the pending remediation tasks, and dispatches no prd_audit, manual_test or architecture_review_as_built step before that build completes.
- With no raise recorded, the daemon leaves the feature halted with HALT.class kickback-cap and dispatches neither build nor any audit gate.
- With a raise bound to an older halt generation, `consumeResumeAuthorizations` leaves the authorization unconsumed and the feature halted, and build is not dispatched.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/engine/conductor-kickback-transition.test.ts; src/conductor/test/engine/daemon-rekick.test.ts

**Dependencies:** 6

### Task 10: Rebase-first resume builds before re-opened gates
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-rekick.test.ts` for a feature halted at the build transition with pending tasks, resumed after a raise: with a changed rebase and with a no-op rebase, the re-kick routes to build rather than pre-verifying a completed BUILD; the re-opened gates follow build.
2. Verify RED.
3. Fix only what the tests expose in `src/conductor/src/engine/daemon-rekick.ts` or `src/conductor/src/engine/conductor.ts`. The BUILD pre-verify is gated on `build === 'done'`, and Task 6 persists build as not done.
4. Verify GREEN and commit.

**Done when:**
- With a changed resume rebase, the re-kick dispatches build on the pending remediation tasks before any re-opened gate.
- With a no-op resume rebase, the resumed feature dispatches build on the pending remediation tasks.
- For that halted feature, the re-kick does not log build re-verified mechanically, does not skip the build dispatch, and writes no completed BUILD evidence unavailable halt.
- When the rebase re-opens coverage_binding, test_suite, build_review, prd_audit and architecture_review_as_built, none of them dispatches before build completes.

**Files:** src/conductor/src/engine/daemon-rekick.ts; src/conductor/src/engine/conductor.ts; src/conductor/test/engine/daemon-rekick.test.ts

**Dependencies:** 6

### Task 11: Halts without a planned repair and scope decisions keep today's behavior
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing or pinning tests in `src/conductor/test/engine/conductor-kickback-transition.test.ts`: a remediation plan with no recognized disposition halts needs-human with unchanged text and no pending record; an undecided OVER_SCOPE finding next to FIXABLE findings halts on the scope decision before remediate and appends nothing, and a kickback-budget raise cannot clear it; accepted-only OVER_SCOPE with FIXABLE findings proceeds to the new transition behavior; build_review, test_suite and manual_test kickbacks settle no pending charge and keep their accounting.
2. Verify RED where behavior changed; keep existing assertions where it did not.
3. Fix only what the tests expose in `src/conductor/src/engine/conductor.ts`.
4. Verify GREEN and commit.

**Done when:**
- A remediation plan with no recognized disposition halts needs-human with its existing class and text before any append, and no pending record is written.
- With an undecided OVER_SCOPE finding alongside FIXABLE findings, the conductor halts on the scope decision before remediate is dispatched and appends no remediation task.
- For a halt on an undecided or a refused OVER_SCOPE finding, `consumeResumeAuthorizations` does not clear it after a kickback-budget raise, and remediate is not dispatched.
- With all OVER_SCOPE findings accepted and FIXABLE findings remaining, the round appends its tasks, records the pending charge, and routes to build.
- For a build_review, test_suite or manual_test kickback into build, the build boundary settles no prd_audit or as-built pending charge and those gates' existing counters are unchanged.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/engine/conductor-kickback-transition.test.ts

**Dependencies:** 5, 6

### Task 12: Charge the repair when build dispatches
**Story:** 2
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-kickback-transition.test.ts` driving the conductor step loop into build with an in-allowance pending record: the charges land at that dispatch, a mixed round charges both gates in one settlement, and re-dispatching the same build after a retry or a conductor restart charges nothing again.
2. Verify RED.
3. Complete the success branch of the build-boundary settlement from Task 6 in `src/conductor/src/engine/conductor.ts`: call `settlePendingRepair` and proceed to dispatch only when it charged or found no record. Because settlement removes the record in the same lease that charges it, a re-dispatch finds nothing to charge.
4. Verify GREEN and commit.

**Done when:**
- After an in-allowance prd_audit round and after an in-allowance as-built round, that gate's `laps` and `growth.added` are unchanged until the step loop dispatches build, and at that dispatch they advance by exactly one lap and by the appended task count.
- With both prd_audit and as-built allowances available in a mixed round, build dispatches and each gate's `laps` advances by one and its `growth.added` and `growth.byGate` advance by its appended task count in the same settlement.
- When the same build step is re-dispatched after a retry or after a conductor restart, no gate's `laps` or `growth` value advances a second time.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/engine/conductor-kickback-transition.test.ts

**Dependencies:** 6

## Task Dependency Graph

```text
Task 1 <- none
Task 2 <- Task 1
Task 3 <- Task 2
Task 4 <- Task 1
Task 5 <- Task 2
Task 6 <- Task 3, Task 5
Task 7 <- Task 3, Task 6
Task 8 <- Task 2, Task 5
Task 9 <- Task 6
Task 10 <- Task 6
Task 11 <- Task 5, Task 6
Task 12 <- Task 6
```

## Integration Points

- After Task 6: a remediation round with an exhausted allowance halts at the build boundary through the real conductor step loop.
- After Task 9: the daemon's raise consumption resumes the halted feature straight into build.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a feature whose prd_audit lap allowance is exhausted and whose audit reports FIXABLE findings, when the remediation round runs, then remediate is dispatched, its admitted tasks are appended to the plan and committed, and the feature halts with class kickback-cap before build is dispatched. | 5, 6 | "With the prd_audit lap exhausted and FIXABLE findings, `planRemediation` dispatches remediate, appends and commits the admitted tasks, and returns a build route with no kickback-cap halt before or during the remediation round, as asserted in the rewritten prd-audit-kickback test." | diff-local |
| Story 1 happy: Given that halt, when the plan task status is read, then every appended remediation task is present as pending with the same id and title remediate wrote, and the build step is recorded as not done. | 5, 6 | "After that round, `.pipeline/task-status.json` lists every appended remediation task as pending with the same id and title remediate wrote, and the ledger holds a pending record naming those task ids." | diff-local |
| Story 1 happy: Given that halt and a consumed kickback-budget raise for prd_audit, when the feature next dispatches, then the first step dispatched is build, the pending remediation tasks are the tasks it builds, and prd_audit, manual_test and architecture_review_as_built are not dispatched before that build completes. | 9 | "After a consumed prd_audit raise, the resumed conductor dispatches build first, builds the pending remediation tasks, and dispatches no prd_audit, manual_test or architecture_review_as_built step before that build completes." | diff-local |
| Story 1 negative: Given an exhausted prd_audit lap allowance, when the remediation round is evaluated, then no halt fires before remediate is dispatched, and the halt fires only at the build transition after the append is committed. | 5, 6 | "With the prd_audit lap exhausted and FIXABLE findings, `planRemediation` dispatches remediate, appends and commits the admitted tasks, and returns a build route with no kickback-cap halt before or during the remediation round, as asserted in the rewritten prd-audit-kickback test." | diff-local |
| Story 1 negative: Given the halted feature with no raise recorded, when the daemon evaluates it for dispatch, then it stays halted with class kickback-cap and neither build nor any audit gate is dispatched. | 9 | "With no raise recorded, the daemon leaves the feature halted with HALT.class kickback-cap and dispatches neither build nor any audit gate." | diff-local |
| Story 1 negative: Given the halted feature and a raise bound to an older halt generation, when the daemon evaluates the authorization, then the authorization is not consumed and the feature stays halted without dispatching build. | 9 | "With a raise bound to an older halt generation, `consumeResumeAuthorizations` leaves the authorization unconsumed and the feature halted, and build is not dispatched." | diff-local |
| Story 2 happy: Given a prd_audit round whose admitted tasks exceed the remaining plan-growth allowance, when the round runs, then the tasks are appended and pending and the feature halts kickback-cap at the build transition naming the growth allowance and every finding. | 5, 6 | "For a prd_audit round with an exhausted lap, a prd_audit round whose admitted tasks exceed the remaining plan-growth allowance, and an as-built REMEDIABLE round with an exhausted lap, the round's tasks are appended and pending and the step loop then writes a kickback-cap HALT before build is dispatched whose text names respectively the prd_audit lap, the growth allowance or the as-built lap allowance and every finding with a new `Kickback halt generation` that `recordKickbackCapEvidence` stores." | diff-local |
| Story 2 happy: Given an as-built REMEDIABLE round whose lap allowance is exhausted, when the round runs, then its tasks are appended and pending and the feature halts kickback-cap at the build transition naming the as-built lap allowance. | 5, 6 | "For a prd_audit round with an exhausted lap, a prd_audit round whose admitted tasks exceed the remaining plan-growth allowance, and an as-built REMEDIABLE round with an exhausted lap, the round's tasks are appended and pending and the step loop then writes a kickback-cap HALT before build is dispatched whose text names respectively the prd_audit lap, the growth allowance or the as-built lap allowance and every finding with a new `Kickback halt generation` that `recordKickbackCapEvidence` stores." | diff-local |
| Story 2 happy: Given a mixed prd_audit and as-built round where both allowances are available, when build dispatches, then both gates are charged their lap and growth together and build runs. | 12 | "With both prd_audit and as-built allowances available in a mixed round, build dispatches and each gate's `laps` advances by one and its `growth.added` and `growth.byGate` advance by its appended task count in the same settlement." | diff-local |
| Story 2 negative: Given a mixed prd_audit and as-built round where only the as-built lap is exhausted, when build would dispatch, then the feature halts kickback-cap and neither gate's lap nor growth is charged. | 6 | "In a mixed prd_audit and as-built round where only the as-built lap is exhausted, the halt fires at the build transition and neither gate's `laps` nor `growth` changes." | diff-local |
| Story 2 negative: Given a growth-cap halt and a consumed growth raise too small for the pending tasks, when build would dispatch, then the feature halts kickback-cap again with a new halt generation and nothing is charged. | 6 | "After a consumed raise that is still too small, or that targets the other gate, the build boundary halts kickback-cap again with a new halt generation, charges nothing, and does not dispatch build." | diff-local |
| Story 2 negative: Given a growth-cap halt and a consumed raise for the wrong gate, when build would dispatch, then the feature halts kickback-cap again on the still-exhausted allowance and build is not dispatched. | 6 | "After a consumed raise that is still too small, or that targets the other gate, the build boundary halts kickback-cap again with a new halt generation, charges nothing, and does not dispatch build." | diff-local |
| Story 3 happy: Given a remediation round within its allowances, when its tasks are appended, then the gate's laps and the growth added count are unchanged until build dispatches, and at that dispatch they advance by one lap and by the appended task count. | 3, 5, 12 | "After an in-allowance prd_audit round and after an in-allowance as-built round, that gate's `laps` and `growth.added` are unchanged until the step loop dispatches build, and at that dispatch they advance by exactly one lap and by the appended task count." | diff-local |
| Story 3 happy: Given an existing-task disposition round, when build dispatches, then the gate's laps advance by one and the growth added count does not change. | 7 | "When build dispatches after that round, the gate's `laps` advances by one and `growth.added` is unchanged." | diff-local |
| Story 3 happy: Given a halted repair with appended uncharged tasks, when the plan-growth allowance is read, then the authored count excludes those tasks and the remaining allowance is computed as if they were not yet added. | 4 | "With a pending record naming appended tasks, `readGrowth` returns an `authored` count that excludes those tasks and a `remaining` allowance computed as if they were not yet added, both with a stored growth record and with none." | diff-local |
| Story 3 happy: Given an existing-task round whose gate lap allowance is exhausted, when the round runs, then its bound tasks are re-staged pending and the feature halts kickback-cap at the build transition with no lap charged. | 7 | "With the gate lap exhausted, the existing-task round re-stages its bound tasks pending and the build boundary halts kickback-cap with no lap charged." | diff-local |
| Story 3 negative: Given a charged repair whose build has dispatched, when the same build step is re-dispatched after a retry or restart, then the lap and growth are not charged a second time. | 3, 12 | "When the same build step is re-dispatched after a retry or after a conductor restart, no gate's `laps` or `growth` value advances a second time." | diff-local |
| Story 3 negative: Given a halted repair with appended uncharged tasks and no prior growth record, when growth is derived from the active plan, then the appended tasks are not counted as authored and the 25 percent growth denominator is unchanged by them. | 4 | "With no prior growth record, the authored count and the 25 percent cap computed by `prdAuditAppendCap` are unchanged by tasks named in the pending record." | diff-local |
| Story 3 negative: Given a remediation round whose append fails, when the round completes, then no pending charge is recorded and the laps and growth values are unchanged. | 5 | "When `appendRemediationTasks` fails, no pending record is written and every gate's `laps` and `growth` values are unchanged." | diff-local |
| Story 3 negative: Given a plan that already contained rem- prefixed tasks before this feature's growth record existed, when growth is derived with a pending repair recorded, then those earlier tasks still count as authored and only the tasks named by the pending charge are excluded. | 4 | "Earlier `rem-` prefixed plan tasks that the pending record does not name still count toward `authored`; exclusion keys on the pending record's task ids, never on the task-id prefix." | diff-local |
| Story 3 negative: Given an unreadable kickback ledger, when a remediation round would append, then the feature halts fail-closed and no task is appended and no pending charge is recorded. | 5 | "With an unreadable kickback ledger, the round halts fail-closed before `appendRemediationTasks` runs, and no task is appended and no pending record is written." | diff-local |
| Story 3 negative: Given a kickback ledger whose pending repair record is present but malformed, when build would dispatch or a budget is read, then the prd_audit, as-built and growth allowances read as exhausted and build is not dispatched. | 1, 6 | "With a malformed pending record, the build boundary halts kickback-cap reading the prd_audit, as-built and growth allowances as exhausted, and does not dispatch build." | diff-local |
| Story 3 negative: Given an existing-task round replayed after a crash, when admission runs again for the same repair obligation, then no second pending charge is recorded and only one lap is charged at build dispatch. | 7 | "Re-running admission for the same repair obligation leaves one pending charge, and only one lap is charged when build dispatches." | diff-local |
| Story 4 happy: Given a raised cap halt whose resume rebase changes code, when the re-kick applies rebase verdicts, then build is dispatched on the pending remediation tasks before any re-opened gate. | 10 | "With a changed resume rebase, the re-kick dispatches build on the pending remediation tasks before any re-opened gate." | diff-local |
| Story 4 happy: Given a raised cap halt whose resume rebase is a no-op, when the feature resumes, then build is dispatched on the pending remediation tasks. | 10 | "With a no-op resume rebase, the resumed feature dispatches build on the pending remediation tasks." | diff-local |
| Story 4 negative: Given a raised cap halt with pending remediation tasks, when the rebase re-kick evaluates build, then it does not report build re-verified mechanically, does not skip the build dispatch, and does not halt with completed BUILD evidence unavailable. | 10 | "For that halted feature, the re-kick does not log build re-verified mechanically, does not skip the build dispatch, and writes no completed BUILD evidence unavailable halt." | diff-local |
| Story 4 negative: Given a raised cap halt whose resume rebase re-opens coverage_binding, test_suite, build_review, prd_audit and architecture_review_as_built, when the feature resumes, then none of those gates dispatches before build completes. | 10 | "When the rebase re-opens coverage_binding, test_suite, build_review, prd_audit and architecture_review_as_built, none of them dispatches before build completes." | diff-local |
| Story 5 happy: Given a remediation round that halts needs-human before appending, such as a remediation plan with no recognized disposition, when the halt is written, then no pending charge is recorded and the halt class and text are unchanged from today. | 11 | "A remediation plan with no recognized disposition halts needs-human with its existing class and text before any append, and no pending record is written." | diff-local |
| Story 5 happy: Given a prd_audit report with an undecided OVER_SCOPE finding alongside FIXABLE findings, when the round runs, then the feature halts on the scope decision before remediate is dispatched and no remediation task is appended. | 11 | "With an undecided OVER_SCOPE finding alongside FIXABLE findings, the conductor halts on the scope decision before remediate is dispatched and appends no remediation task." | diff-local |
| Story 5 happy: Given a prd_audit report whose OVER_SCOPE findings are all accepted and FIXABLE findings remain, when the round runs, then remediation proceeds under the new transition behavior. | 11 | "With all OVER_SCOPE findings accepted and FIXABLE findings remaining, the round appends its tasks, records the pending charge, and routes to build." | diff-local |
| Story 5 negative: Given a halt for an undecided or refused OVER_SCOPE finding, when an operator runs a kickback-budget raise, then the raise does not clear that halt and remediate is not dispatched. | 11 | "For a halt on an undecided or a refused OVER_SCOPE finding, `consumeResumeAuthorizations` does not clear it after a kickback-budget raise, and remediate is not dispatched." | diff-local |
| Story 5 negative: Given a build_review, test_suite or manual_test kickback, when build dispatches, then no prd_audit or as-built pending charge is settled and those gates' existing accounting is unchanged. | 11 | "For a build_review, test_suite or manual_test kickback into build, the build boundary settles no prd_audit or as-built pending charge and those gates' existing counters are unchanged." | diff-local |
| Story 5 negative: Given the route-into-no-op guard fires after an append, when the halt is written, then it is a needs-human halt as today, the pending repair is discarded without charging any lap or growth, and a later build dispatch settles nothing for it. | 8 | "After that halt, no gate's `laps` or `growth` has changed, and a later build dispatch finds no pending record and charges nothing." | diff-local |
| Story 5 negative: Given a coverage_binding existing-task reopen, when its tasks are re-staged, then its lap is charged at restage exactly as today and no pending repair is recorded for it. | 7 | "A coverage_binding existing-task reopen charges its lap at restage through `settleRemediationRound` as before and writes no pending record." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D1 | no-change | none | Stories remain the prd_audit authority; this change moves only where remediation caps are enforced. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D2 | no-change | none | The prd_audit run rule is unchanged; no step skip or track rule is touched. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D3 | no-change | none | The PASS, FIXABLE, PLAN_GAP and OVER_SCOPE grade set and its schema are unchanged. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D4 | no-change | none | Over-scope judgement and its decision routing run before remediate exactly as today (Task 11 pins the ordering). |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D5 | task | task-6 | For a prd_audit round with an exhausted lap, a prd_audit round whose admitted tasks exceed the remaining plan-growth allowance, and an as-built REMEDIABLE round with an exhausted lap, the round's tasks are appended and pending and the step loop then writes a kickback-cap HALT before build is dispatched whose text names respectively the prd_audit lap, the growth allowance or the as-built lap allowance and every finding with a new `Kickback halt generation` that `recordKickbackCapEvidence` stores. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D6 | task | task-1 | `readKickbackLedger` treats a ledger with no `pendingRepair` field as having no pending repair and round-trips a well-formed `pendingRepair` record with its receipt id, per-gate lap and growth charges, and task ids, as asserted in the kickback-ledger tests. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D7 | no-change | none | PLAN_GAP routing halts plan-gap before any remediation append and is untouched. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D8 | no-change | none | Recorded findings projection into the verdict artifact and shipped record is unchanged. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D1 | no-change | none | The as-built REMEDIABLE and DESIGN classification is unchanged. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D2 | no-change | none | Admission of REMEDIABLE findings against governing clauses is unchanged. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D3 | no-change | none | Admission still runs through planRemediation and the single appender; only the charge point moves. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D4 | task | task-6 | For a prd_audit round with an exhausted lap, a prd_audit round whose admitted tasks exceed the remaining plan-growth allowance, and an as-built REMEDIABLE round with an exhausted lap, the round's tasks are appended and pending and the step loop then writes a kickback-cap HALT before build is dispatched whose text names respectively the prd_audit lap, the growth allowance or the as-built lap allowance and every finding with a new `Kickback halt generation` that `recordKickbackCapEvidence` stores. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D5 | task | task-5 | With the prd_audit lap exhausted and FIXABLE findings, `planRemediation` dispatches remediate, appends and commits the admitted tasks, and returns a build route with no kickback-cap halt before or during the remediation round, as asserted in the rewritten prd-audit-kickback test. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D6 | no-change | none | Verdict-artifact projection, lifecycle terminals and the remediation kill switch are unchanged. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D7 | existing | none | planRemediation already writes pendingAsBuiltRemediationFindings on a successful append or existing-task binding and clears them on projection; the amendment only moves the lap authorization to dispatch, which Task 6 and Task 12 own. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D8 | no-change | none | The consolidated manual_test FAIL merge keeps primacy; the pending charge registers only on the bounded route. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D9 | task | task-7 | When build dispatches after that round, the gate's `laps` advances by one and `growth.added` is unchanged. |
| adr-2026-09-06-reopened-task-resolution#D1 | no-change | none | Repair obligations stay in engine-state.json with the same shape; the pending charge reuses their ids as receipts. |
| adr-2026-09-06-reopened-task-resolution#D2 | task | task-7 | Re-running admission for the same repair obligation leaves one pending charge, and only one lap is charged when build dispatches. |
| adr-2026-09-06-reopened-task-resolution#D3 | no-change | none | Engine-state writers keep the single serialized read-modify-write seam; the pending charge lives in the kickback ledger. |
| adr-2026-09-06-reopened-task-resolution#D4 | no-change | none | Reopened-task resolution against the saved boundary is unchanged. |
| adr-2026-09-06-reopened-task-resolution#D5 | no-change | none | The bounded post-reopen commit range is unchanged. |
| adr-2026-09-06-reopened-task-resolution#D6 | no-change | none | Resolver, seeding and task-close integration are unchanged. |
| adr-2026-09-06-reopened-task-resolution#D7 | no-change | none | Scope acceptance is still applied before a repair is actionable (Task 11 pins accepted-only routing). |
| adr-2026-09-06-reopened-task-resolution#D8 | no-change | none | Completed repairs still return to their governing review with the existing no-progress and lap bounds. |
| adr-2026-09-06-reopened-task-resolution#D9 | no-change | none | Remediation eligibility, gate ownership and plan-growth accounting semantics are preserved; only the charge point moves. |
| adr-2026-09-06-reopened-task-resolution#D10 | task | task-7 | A coverage_binding existing-task reopen charges its lap at restage through `settleRemediationRound` as before and writes no pending record. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] Every task has a falsifiable Done when block
- [ ] Dependencies are explicit and acyclic

### Task rem-as-built-rem-adr-ab-kcr5-1: conductor.ts:10415 — before settleBuildPendingRepair at the final BUILD admission, when a kickback into build is active read readBuildOutcome and refuse on sameNoOpCycle(latestBuildOutcome(store), { gate, treeHash, verdict, rung }) only on a definite match (null tree or any differing component dispatches normally), halting with composeBuildOutcomeHaltReason via writeHaltMarker needs-human (HaltClass unchanged per D6), persisting build not done and charging no pending repair; add build-outcome-stamp.test.ts or conductor-kickback-transition.test.ts cases for match-refuses-without-settlement, moved-tree dispatches, null-tree dispatches, and higher-rung dispatches, keeping existing Task 6/9/12 settlement and resume assertions green
**Gate:** as-built
**Rationale:** adr-2026-08-05-build-settle-outcome-stamp D3 (APPROVED) requires a definite-match pre-dispatch refusal before re-entering build under an active kickback, but sameNoOpCycle/latestBuildOutcome/composeBuildOutcomeHaltReason (build-outcome.ts:95-122) have no production caller and the final BUILD admission at conductor.ts:10414-10415 (settleBuildPendingRepair) dispatches the pending-repair resume without it; this is conforming implementation drift with a determinable fix, so it routes to build, and no existing Task 6/9/10 Done-when admits the refusal, so one task is appended. Excluded: the stale feature/legacy remediation diagrams named in the drift notes are sealed architecture artifacts owned by DECIDE and are non-blocking here, so no task edits them.
**Governing clause:** adr-2026-08-05-build-settle-outcome-stamp decision 3
**Done when:**
- adr-2026-08-05-build-settle-outcome-stamp decision 3 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-adr-ab-kcr5-1 is complete.
