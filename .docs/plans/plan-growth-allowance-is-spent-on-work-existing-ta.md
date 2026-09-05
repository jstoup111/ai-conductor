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

### Task rem-as-built-rem-ab1-1: src/conductor/src/engine/conductor.ts:4336-4447 — wrap the entire append sub-block (the `if (planPath) { ... }` append / pending-finding persist / re-seed / git-add / git-commit branch AND its `else` no-plan-path warning) in `if (allTasks.length > 0)`, so an existing-task-only round never calls appendRemediationTasks at conductor.ts:4337, never renames over .docs/plans/<slug>.md via conductor.ts:13131, and never runs `git add` / `git commit -- <planPath>`; leave the outer guard at conductor.ts:4248, the budget reads and cap terminals at conductor.ts:4246-4336, and `appendAttempted` at conductor.ts:4244 unchanged so the gate lap still records. Add a fixture beside the existing Task 3 routing tests in src/conductor/src/engine/conductor.test.ts that writes an uncommitted edit into the plan before an all-existing-task round and asserts the round still routes to build with the plan bytes unchanged AND the git index untouched (`git diff --cached --quiet -- <planPath>` clean, no 'chore(plan)' commit); keep the existing byte-identical-plan and growth-unchanged assertions unmodified
**Gate:** as-built
**Rationale:** Conforming implementation drift inside approved plan Task 3 (step 3: existing-task gaps 'never enter allTasks or the append path'; Done-when: 'the appender is never called for them'), and the as-built Resolution states no superseding ADR is required — so adr-2026-08-25 D9 stays authoritative and this is code repair, not an architecture change. Verified 99% against HEAD a78b47f: the outer guard at src/conductor/src/engine/conductor.ts:4248 admits an existing-task-only round (asBuiltTasks/prdAuditTasks non-empty, allTasks empty), and the `if (planPath)` append sub-block then runs unconditionally — appendRemediationTasks at conductor.ts:4337 replaces .docs/plans/<slug>.md through the temp-file rename at conductor.ts:13131 with zero tasks, and the `git add` / conditional `git commit -- <planPath>` at conductor.ts:4409-4437 can stage and commit an unrelated pre-existing plan edit under 'chore(plan): record appended remediation tasks'. This is the same substance as the report's DIAGRAM_DRIFT note (.docs/architecture/plan-growth-allowance-is-spent-on-work-existing-ta.md:19,40 and .docs/architecture/sequences/plan-growth-allowance-is-spent-on-work-existing-ta.md:29) and is closed by the same fix, so no separate task is emitted for it. Class sweep: the budget reads and every cap terminal at conductor.ts:4246-4336 must STAY reachable for existing-task rounds (Story 4 lap charging, plan Task 4), so only the append/plan-write/git-commit branch narrows; the orphan of that same guard is its `else` no-plan-path warning at conductor.ts:4441-4447, which must narrow with it or fire spuriously on every zero-task round; `appendAttempted` at conductor.ts:4244 already initialises true when allTasks is empty, so the D1 no-op guard and the ledger write are unaffected. No coverage is dropped: the byte-identical-plan and growth-unchanged assertions plan Task 3 already delivered stay and become behavioural rather than incidental.
**Governing clause:** Task 3
**Parent task:** 3
**Done when:**
- Task 3 is satisfied by this task.

### Task rem-as-built-rem-ab2-1: src/conductor/src/engine/conductor.ts:4045-4110 — admit an existing-task gap only when its id matches a currently validated prd-audit FIXABLE or as-built REMEDIABLE finding: hoist the `prdAuditAdmits`/`asBuiltAdmits` computation (conductor.ts:4079-4080) above the plan read and binding resolution at conductor.ts:4047-4078, and when neither admits, `if (asBuiltCapEnforced) unexpectedAsBuiltGapIds.add(gap.id);` then `continue` before any binding is resolved, recorded in resolvedExistingTaskIdsByGapId, or pushed to admittedGaps — unconditionally, with no `(prdAuditValidated || asBuiltValidated)` precondition, so the build-stall (conductor.ts:10404) and finish-verification (conductor.ts:10817) callers can never reach this route; factor the ownership predicate duplicated at conductor.ts:4124-4125 into one shared helper used by both branches and comment why the two drop guards differ; leave the sealed-artifact / publication / halt arms of the early-continue at conductor.ts:4088-4110 untouched. Also scope the skill contract to the same two gates in skills/remediate/SKILL.md where the existing-task disposition is described (valid only for a current prd_audit FIXABLE or as-built REMEDIABLE finding, never for a build_stall question or a finish failure), per plan Task 10, and run test/test_harness_integrity.sh. Add fixtures asserting (a) an existing-task gap matching no validated finding is dropped with no binding, no re-stage and no BUILD rewind, (b) that id under an enforced as-built round halts needs-human naming it via unexpectedAsBuiltGapIds (conductor.ts:4160-4185), and (c) an existing-task gap arriving with neither gate validated is likewise not admitted; leave the existing gate-owned admission tests unchanged
**Gate:** as-built
**Rationale:** Conforming implementation drift admitted by approved plan Task 3 (step 3: 'ensure the as-built exact-match finding accounting counts them admitted'), plan Task 8 (Done-when: 'the existing-task route is unreachable when a FAIL is present') and plan Task 10 (Done-when: the skill text names the ownership test); adr-2026-08-25 decision 9 already fixes the prd-audit-FIXABLE / as-built-REMEDIABLE two-gate boundary, so no architectural decision is open and the fix direction is to conform code to D9, not to amend it. Verified 95% against HEAD a78b47f: conductor.ts:4067-4084 resolves bindings and records them in resolvedExistingTaskIdsByGapId (conductor.ts:4076) before ownership is computed at conductor.ts:4079-4080, then falls into the unconditional early-continue at conductor.ts:4088-4110, so a gap owned by neither validated gate is still pushed to admittedGaps, re-stages plan tasks (conductor.ts:4574 -> 12718-12752) and rewinds BUILD; an unknown as-built id also escapes `unexpectedAsBuiltGapIds`, which is populated only in the appending branch at conductor.ts:4128. Named tension, deliberately not assumed away: the operator's 2026-09-04 NC.1 accept recorded in the cleared prd-audit halt approved the build-stall/finish widening as scope, and the as-built report rules that acceptance cannot satisfy ADR compliance; if the operator wants the widening kept, that is a D9 amendment through architecture_review, and this task does not presume it. Matched pair named and unified rather than half-edited: the ownership predicate at conductor.ts:4079-4080 duplicates the appending branch's at conductor.ts:4124-4125 — derive both from one shared helper so they cannot drift, and comment why the drop guards differ (the appending branch is conditioned on `(prdAuditValidated || asBuiltValidated)` for older direct callers, while D9 scopes existing-task to the two gates only, so its guard is unconditional). Class sweep: the same early-continue at conductor.ts:4088-4110 also carries the sealed-artifact, publication and `halt` dispositions — those are found and deliberately EXCLUDED because plan Task 8's Done-when requires their handling to stay unchanged and no plan task admits changing them. No coverage is removed: the gate-owned admission tests in conductor.test.ts stay green.
**Governing clause:** adr-2026-08-25-as-built-remediable-findings-bounded-build-route decision 9
**Done when:**
- adr-2026-08-25-as-built-remediable-findings-bounded-build-route decision 9 is satisfied by this task.

### Task rem-as-built-rem-ab3-1: src/conductor/src/engine/conductor.ts — sample the D2 no-op baseline BEFORE the existing-task re-stage and consume it in one place: immediately ahead of restageExistingRemediationTaskStatuses at conductor.ts:4574 capture treeHash + countResolvedTasks and store them on a single conductor field (e.g. `this.pendingNoOpBaseline`), then have captureKickbackToBuildContext at conductor.ts:5935 use that field in place of its own sampling when set and clear it after writing the ledger — do NOT edit the individual call sites (conductor.ts:7197, :7589, :10531, :10593, :10756, :10867), so the baseline has exactly one producer and one consumer and cannot drift; leave the manual_test/build_review/finish capture sites (conductor.ts:6070, :7442, :10355, :8757) and classifyBuildProgress's strict-inequality contract at kickback-escalation.ts:38-41 unchanged. Add the sensitive Task 7 regression in src/conductor/src/engine/conductor.test.ts: an existing-task lap whose following BUILD re-completes the re-staged rows against a byte-identical tree must classify 'no-work' and escalate rather than admit another lap — the test must fail against the current post-restage sampling
**Gate:** as-built
**Rationale:** Conforming implementation drift admitted by approved plan Task 7 ('keep termination armed'; Done-when: 'Escalation test proves a zero-progress existing-task lap escalates instead of looping'), which the as-built Resolution confirms needs no ADR change. Verified 97% against HEAD a78b47f: planRemediation re-stages bound rows to `pending` at conductor.ts:4574 (helper conductor.ts:12718, setting pending at :12748) BEFORE it returns, while captureKickbackToBuildContext (conductor.ts:5935) samples the D2 baseline only afterwards from every post-route caller. countResolvedTasks counts completed/skipped rows (src/conductor/src/engine/task-progress.ts:84), so the next BUILD re-completing those same rows raises resolvedAfter above the depressed post-restage baseline and classifyBuildProgress returns 'did-work' on a byte-identical tree (src/conductor/src/engine/kickback-escalation.ts:38-41), bypassing the required no-op escalation. Matched-pair/class sweep: the defect is capture ORDERING shared by every capture site that can follow a planRemediation route (conductor.ts:7197, :7589, :10531, :10593, :10756, :10867), so the fix must not edit one site — it threads ONE pre-restage baseline from planRemediation through the single captureKickbackToBuildContext helper, leaving zero caller-side duplication that could drift and no site-enumeration to get wrong. The manual_test (conductor.ts:6070, :7442), build_review (conductor.ts:10355) and finish (conductor.ts:8757) capture sites do not follow planRemediation and are unaffected by a baseline that is only set on the existing-task route. No coverage is removed and classifyBuildProgress's strict-inequality contract is preserved unchanged; this restores the escalation sensitivity plan Task 7 owes rather than replacing any assertion.
**Governing clause:** Task 7
**Parent task:** 7
**Done when:**
- Task 7 is satisfied by this task.
