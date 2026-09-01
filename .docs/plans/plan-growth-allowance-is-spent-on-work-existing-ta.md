# Implementation Plan: existing-task remediation disposition (#2119)

**Date:** 2026-08-31
**Stories:** .docs/stories/plan-growth-allowance-is-spent-on-work-existing-ta.md
**Conflict check:** Clean as of 2026-08-31 (one blocking conflict resolved via companion PR #2122)

## Summary
Adds a non-appending `existing-task` remediation disposition that binds a finding to existing plan task ids, re-stages them for the next dispatch, and charges the gate lap allowance instead of the plan-growth allowance. 10 tasks.

## Technical Approach

- The disposition contract lives in `src/conductor/src/engine/artifacts.ts` beside the `publication` precedent: a new `REMEDIATION_EXISTING_TASK_DISPOSITION = 'existing-task'` constant joins the `RemediationDisposition` union; `remediationDispositionStep` maps it to `build`; `remediationDispositionAppendsToPlan` stays false for it; `readRemediationPlan` admits it fail-closed (a gap with no bound task references is malformed and rejected, mirroring the taskless-build rejection). Bound references travel in the gap's existing `tasks` array as `{id}` entries naming plan task ids.
- Admission happens in the remediation routing block of `src/conductor/src/engine/conductor.ts` (the gap loop near the publication/halt early-continue). Existing-task gaps are admitted like publication gaps — never into `allTasks`, so the growth budget and appender are structurally unreachable for them — but they (a) resolve every bound id against the active plan with `resolvePlanTaskReference` from `plan-task-parse.ts` (annotation stripping included; any unresolvable id → needs-human halt naming the id), (b) count toward the owning gate's lap (`taskCount`) without counting toward `growthTaskCount`, and (c) collect their bound ids for re-staging.
- Re-staging reuses the task-status re-seed seam the appender path uses after append (the pending re-seed near the append call): bound ids present in the task-status file are rewritten to pending before the rewind; an unreadable status file or a bound id missing from it halts needs-human naming the re-stage failure. The mechanism that closes "fail-closed" here: the route returns a halt result instead of the navigate-back result whenever the re-stage write does not complete.
- Budget separation is already structural once existing-task gaps stay out of `allTasks`: `readRemediationGateAppendBudget` receives `taskCount` including existing-task gaps (laps) and `growthTaskCount`/`allTasks` excluding them (growth). The lap-cap halt branch already names the lap budget; the growth branches become unreachable for lap-only rounds, which is the #2119 fix. The D7 pending-findings entry for an existing-task finding is written at successful binding resolution (the same code point where an appending gap's entry is written at append success).
- The D8 guard and the no-op escalation pair are existing conditions on the as-built route; tasks assert they hold for existing-task rounds rather than adding new machinery.
- Local test pattern: the remediation routing tests in `src/conductor/src/engine/conductor.test.ts` and `artifacts.test.ts` build remediation JSON fixtures and drive the routing seam with fakes; new tests follow that fixture style (search hints: existing tests naming `readRemediationPlan`, `kickback-cap`, `publication` disposition). Variation allowed in fixture shape; no real providers.

## Prerequisites
- None (no migrations, no new dependencies).

## Tasks

### Task 1: Widen the disposition contract fail-closed
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests: `readRemediationPlan` admits an `existing-task` gap with non-empty bound ids; rejects one with an empty `tasks` array as malformed; still drops unknown dispositions while keeping the valid existing-task gap in the same plan; `remediationDispositionStep('existing-task') === 'build'`; `remediationDispositionAppendsToPlan('existing-task') === false`.
2. Verify RED.
3. Implement: add `REMEDIATION_EXISTING_TASK_DISPOSITION`, widen the union, the `valid` list in `readRemediationPlan` (with the empty-binding rejection), `remediationDispositionStep`, and leave `remediationDispositionAppendsToPlan` returning false for it — all in one diff per adr-2026-08-06 shape discipline.
4. Verify GREEN; commit.

**Done when:**
- [ ] All five named assertions pass in artifacts tests
- [ ] An existing-task gap with an empty binding list is rejected as malformed, not admitted as a free lap
- [ ] The union, valid list, step map, and append predicate all name existing-task in this task's diff

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts — disposition contract
- src/conductor/src/engine/artifacts.test.ts — contract tests

**Dependencies:** none

### Task 2: Resolve bound ids through the shared resolver at admission
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests in the conductor remediation routing suite: an existing-task gap bound to an id present in the active plan is admitted; a gap bound to an id absent from the plan produces a needs-human halt whose detail names the unresolvable id; a bound reference with a trailing parenthesized annotation resolves after stripping (resolver behavior, no local `Number()` parse).
2. Verify RED.
3. Implement: in the gap admission loop, resolve each existing-task binding with `resolvePlanTaskReference` against the active plan's task-id set; on any failure return a needs-human halt naming the id; on success record the resolved ids on the admitted gap.
4. Verify GREEN; commit.

**Done when:**
- [ ] Admission test proves a resolvable binding is admitted and an unresolvable one halts naming the id
- [ ] Annotation-stripping case passes using the shared resolver
- [ ] No new id-validity parse exists outside resolvePlanTaskReference in this diff

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — admission resolution
- src/conductor/src/engine/conductor.test.ts — admission tests

**Dependencies:** 1

### Task 3: Route existing-task gaps without append or growth
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test reproducing #2119: 8 authored tasks, growth cap 2, three validated as-built REMEDIABLE findings all dispositioned existing-task with resolvable bindings — assert the round routes to build, the appender is never called for them, and the growth record's added/remaining are unchanged.
2. Verify RED.
3. Implement: admit existing-task gaps alongside the publication/halt early-continue so they never enter `allTasks` or the append path; carry them into the admitted-fix set so `earliestRemediationTarget` sees a build-valued step; ensure the as-built exact-match finding accounting counts them admitted.
4. Verify GREEN; commit.

**Done when:**
- [ ] The #2119 reproduction test routes to build instead of halting kickback-cap
- [ ] Growth added/remaining are byte-identical before and after an all-existing-task round
- [ ] A prd_audit FIXABLE existing-task gap takes the same non-appending route in a test

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — routing
- src/conductor/src/engine/conductor.test.ts — routing tests

**Dependencies:** 2

### Task 4: Charge the lap allowance only
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests: an admitted existing-task round increments the owning gate's ledger laps by exactly one; the growth byGate record gains no entry for it; a mixed-gate round charges each gate's own lap.
2. Verify RED.
3. Implement: include existing-task gaps in the gate's `taskCount` (lap consumption) while excluding them from `growthTaskCount` and from the shared-growth pre-check; persist the lap through the existing ledger write.
4. Verify GREEN; commit.

**Done when:**
- [ ] Ledger test proves laps+1 and growth untouched for an existing-task round
- [ ] The shared-growth pre-check does not count existing-task gaps in its requested figure

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — budget accounting
- src/conductor/src/engine/conductor.test.ts — ledger tests

**Dependencies:** 3

### Task 5: Re-stage bound tasks to pending before the rewind
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests: bound tasks marked done in the task-status file are pending after the route and before dispatch; a bound task already pending stays pending and the route proceeds; the re-stage uses the same re-seed write the appender path uses.
2. Verify RED.
3. Implement: after admission and budget checks, rewrite each resolved bound id's status to pending via the existing re-seed seam, then rewind.
4. Verify GREEN; commit.

**Done when:**
- [ ] Test proves done-to-pending transition for every bound id before dispatch
- [ ] Idempotent case (already pending) passes without error

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — re-stage
- src/conductor/src/engine/conductor.test.ts — re-stage tests

**Dependencies:** 3

### Task 6: Fail closed when re-staging cannot complete
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests: an unreadable or missing task-status file at re-stage time yields a needs-human halt naming the re-stage failure and no rewind; a bound id absent from the task-status rows yields the same halt naming the id.
2. Verify RED.
3. Implement: the re-stage helper returns a halt result on any incomplete write or missing row; the route propagates it instead of navigating back. The closed mechanism: rewind is only reachable from the success arm of the re-stage result.
4. Verify GREEN; commit.

**Done when:**
- [ ] Both failure fixtures halt needs-human naming the re-stage defect and never dispatch
- [ ] No code path reaches the rewind without a successful re-stage result in this diff

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — fail-closed re-stage
- src/conductor/src/engine/conductor.test.ts — failure tests

**Dependencies:** 5

### Task 7: Persist the pending finding on binding success and keep termination armed
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests: a successful existing-task binding writes a pending as-built remediation finding entry with the existing fail-closed validation, cleared in the projecting step; a gate at its lap cap halts kickback-cap with detail naming the lap cap figures and not the growth allowance; the no-op capture/check escalation pair remains armed for an existing-task lap (a zero-tree-change lap escalates).
2. Verify RED.
3. Implement: write the D7 entry at binding-resolution success (the non-append authorization event); confirm/wire the lap-cap branch and escalation pair for lap-only rounds.
4. Verify GREEN; commit.

**Done when:**
- [ ] Pending-entry lifecycle test passes (written on resolution success, cleared on projection)
- [ ] Lap-cap halt detail contains the lap figures and no growth-allowance phrase
- [ ] Escalation test proves a zero-progress existing-task lap escalates instead of looping

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — pending entry, cap wording, escalation
- src/conductor/src/engine/conductor.test.ts — lifecycle and cap tests

**Dependencies:** 4

### Task 8: Keep the consolidated round and appending dispositions unchanged
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing/regression tests: a validation-group round carrying a manual_test FAIL never takes the existing-task route (gaps ride the consolidated dispatch, per adr-2026-08-25 D8); a build-dispositioned gap with new tasks still appends, increments growth, and halts on true growth exhaustion; a mixed round (appending + existing-task) charges the appending gaps to growth and the existing-task gaps to laps only; publication and halt gaps in the same round keep their existing handling (finish route, needs-human halt, no append) unchanged.
2. Verify RED where behavior is new (mixed-round attribution); confirm existing tests stay green elsewhere.
3. Implement any attribution fix the mixed-round test exposes; otherwise assert-only.
4. Verify GREEN; commit.

**Done when:**
- [ ] Consolidated-round test proves the existing-task route is unreachable when a FAIL is present
- [ ] Appending-path regression tests pass unmodified except where they asserted the #2119 defect
- [ ] Mixed-round test proves per-budget attribution
- [ ] Publication and halt gaps in a round with existing-task gaps keep their existing handling unchanged

**Files likely touched:**
- src/conductor/src/engine/conductor.test.ts — guard and regression tests
- src/conductor/src/engine/conductor.ts — attribution fixes if exposed

**Dependencies:** 7

### Task 9: Growth-halt wording only when growth was drawn
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing test: construct a round where the only exhausted budget is the lap cap while growth is unspent, and assert no halt text reports a growth-cap exhaustion; assert a genuinely growth-exhausted appending round still emits the existing growth figures and finding list unchanged.
2. Verify RED.
3. Implement: guard the growth-exhaustion halt branches so they are reachable only when the round's appending request actually draws on growth (structurally true after Task 3; this task proves it and fixes any residual branch).
4. Verify GREEN; commit.

**Done when:**
- [ ] No fixture can produce a growth-exhausted halt with zero growth drawn in the round
- [ ] Existing growth-halt wording and finding rendering are unchanged for appending rounds
- [ ] Halt class remains kickback-cap in every new fixture

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — halt branch guards
- src/conductor/src/engine/conductor.test.ts — wording tests

**Dependencies:** 8

### Task 10: Document the disposition in the remediate skill contract
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Update the remediate skill's disposition list: add existing-task with the ownership test (use it only when an existing plan task's Done-when admits the remedy), the requirement to bind real plan task ids, and its exclusion from the append beside the publication rationale.
2. Verify the harness integrity suite passes (skill frontmatter and cross-reference checks).
3. Commit.

**Done when:**
- [ ] The skill text names existing-task, its ownership test, its id-binding requirement, and its append exclusion
- [ ] test/test_harness_integrity.sh passes

**Files likely touched:**
- skills/remediate/SKILL.md — disposition contract

**Verify-only:** no

**Dependencies:** 1

## Task Dependency Graph

```
1 -> 2 -> 3 -> 4 -> 7 -> 8 -> 9
          3 -> 5 -> 6
1 -> 10
```

## Integration Points
- After Task 3: the #2119 reproduction routes end-to-end (no false halt).
- After Task 6: the full kickback delivers pending work to the next dispatch fail-closed.
- After Task 9: halt wording is budget-accurate across all round shapes.

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a Done when block of falsifiable checks
- [ ] Dependencies are explicit and acyclic

### Task rem-prd-audit-rem-s54-1: conductor.ts:4257 and conductor.ts:4281 — render `${prdAuditBudget.growthTaskCount} requested` and `${asBuiltBudget.growthTaskCount} requested` in place of `taskCount` in both growth-exhaustion halt strings (matched pair; change both), leaving the shared-growth exit at conductor.ts:4302 (`allTasks.length`) unchanged; add a fixture for a mixed prd_audit round (1 build gap + 2 existing-task gaps, growth.remaining 0) asserting the halt reads '1 requested', and keep test/engine/conductor.test.ts:679-681's all-appending assertion green
**Gate:** prd-audit
**Rationale:** Implementation drift inside approved plan task 9 ('Growth-halt wording only when growth was drawn', which owns the halt-branch guards and wording for Story 5): src/conductor/src/engine/conductor.ts:4257 and :4281 render `${budget.taskCount} requested`, and taskCount includes existing-task bindings (conductor.ts:4082-4090), so a mixed round overstates the growth draw; only growthTaskCount excludes them (conductor.ts:4233,4246,735). Swept for siblings: the shared-growth exit at conductor.ts:4302 renders allTasks.length, which is the appending set only and is already correct — deliberately excluded. The two rendered figures are a matched pair (prd_audit and as-built branches of the same wording contract) and are fixed in one task. No assertion is removed: task 9's Done-when 'existing growth-halt wording and finding rendering are unchanged for appending rounds' is preserved because growthTaskCount equals taskCount on an all-appending round, and test/engine/conductor.test.ts:679-681 keeps asserting 'growth cap reached (1/1 appended; 1 requested, 0 remaining)'.
**Criterion:** S5.4
**Parent task:** 9
**Done when:**
- S5.4 is satisfied by this task.
