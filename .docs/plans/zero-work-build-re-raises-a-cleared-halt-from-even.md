# Implementation Plan: BUILD settles without a dispatch when no work is owed

**Date:** 2026-11-15
**Design:** `.docs/decisions/adr-2026-11-15-build-settles-without-dispatch-when-no-work-is-owed.md`
**Stories:** `.docs/stories/zero-work-build-re-raises-a-cleared-halt-from-even.md`
**Conflict check:** Clean as of 2026-11-15

## Summary

Adds one engine check that decides whether BUILD has work owed, settles BUILD without a provider
session when it has none, gives the build-stall remediation a `no-work-owed` outcome that the
engine confirms with the same check, and passes earlier halt reasons to that remediation. 19 tasks.

## Technical Approach

All engine paths below are under `src/conductor/src/engine/` unless they start at the repo root.

- **The check.** A new module `no-work-owed.ts` exports one function. It returns `no-work-owed`,
  or `work-present` with the reasons it found. It calls `checkStepCompletion` for `build` with the
  conductor's full completion context, then reads four obligations for the execution child: an open
  remediation case that `isBuildEligibleActionCase` accepts (`remediation-case-store.ts`,
  `remediation-case-effects.ts`); a hosted taskless obligation (`hostCarriesTasklessObligation` in
  `routing/host-region-entry.ts`, given the current route record); a pending repair authorization
  (`pendingRepair` on the ledger from `readKickbackLedger`, read at the same scope the conductor's
  existing pending-repair readers use); and a gate kickback pending against BUILD (the ledger entry
  the conductor's `pendingBuildKickbackGate` closure reads). A reader that throws or returns an
  unreadable result yields `work-present`. The check reads and never writes; it does not call
  `durableBuildReviewRetryContext`, which marks a work order attempted.
- **The verdict.** `GateVerdict.outcome` in `gate-verdicts.ts` gains the value `no-work-owed`, and
  the verdict gains an origin field with the values `dispatch-boundary` and `stall-remediation`.
  `computeAndWriteVerdict` accepts both through its options.
- **The dispatch-boundary settle.** In the conductor's step loop, beside the existing
  `acceptance_specs` `no-owned-criteria` settle, a BUILD that is not `done` or `skipped`, is not
  the `--from` target, and is not in an operator round runs the check. On `no-work-owed` it writes
  the verdict, saves the step `done`, emits `gate_verdict` and `step_completed` with
  `unmetered: true`, and continues the loop.
  *Pattern basis:* the `acceptance_specs` `no-owned-criteria` settle. Preserve: the settle runs
  before a step attempt opens; it uses `computeAndWriteVerdict` and `saveConductorStepStatus`; it
  emits the same two events; it charges nothing. Allowed variation: the condition and the outcome
  value. Search hints: `no-owned-criteria` in `conductor.ts`; `unmetered: true`.
- **The stall outcome.** `REMEDIATION_DISPOSITIONS` gains `no-work-owed`.
  `validateRemediationPlan` in `remediation-plan-contract.ts` accepts it only when
  `projection.source` is `build-stall`, with a `stall:` reference and no tasks. `planRemediation`
  returns a new outcome kind for it. The build-stall branch of the retry loop runs the check: on
  agreement it settles as above with origin `stall-remediation`; on disagreement it sets the retry
  hint to an engine-written sentence naming the check's reasons and resumes BUILD the way a `route`
  to `build` does. The round is already charged before `planRemediation` is called.
- **Earlier halt reasons.** A new module `earlier-halt-reasons.ts` reads the event ledger at
  `FEATURE_EVENT_LOG_PATH`, keeps `loop_halt` entries whose `step` and `child` match, drops
  repeats, and returns at most five, most recent first. A missing file or a malformed line yields
  what could be read. The build-stall branch appends them to the remediation dispatch context under
  a heading that says they are no longer in force.
  *Pattern basis:* `readBaseAdvanceHistory` in `test-suite-remediation.ts`. Preserve: missing file
  gives an empty list; malformed lines are skipped. Search hint: `FEATURE_EVENT_LOG_PATH`.
- **Policy text.** `skills/remediate/SKILL.md` and `agents/remediation-planner.md` state when the
  `no-work-owed` verdict applies and how earlier halt reasons are weighed.
- **Sequencing.** The check and the verdict come first. The dispatch-boundary settle and its
  negative paths follow. The stall outcome needs the contract change and the check. The halt-reason
  input is independent of the settle.

Test conventions: conductor tests follow `src/conductor/test/engine/acceptance-child-scope.test.ts`
and `src/conductor/test/engine/stacked-region-events.test.ts`: a temp git repo, a `Conductor` built
with a `stepRunner` whose `run` is a mock, provider dispatches counted from that mock's calls,
events read through `EventPersister` from `.pipeline/events.jsonl`, and verdicts read with
`readVerdict`. Read `.agents/skills/write-tests/SKILL.md` before writing any test.

## Prerequisites

- jstoup111/ai-conductor#3658 is merged. It amends `adr-2026-07-10-daemon-stall-remediation` and
  moves remediation inputs into the child region.

## Tasks

### Task 1: The no-work-owed check reports no work when BUILD is complete and nothing is owed
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing unit tests in `src/conductor/test/engine/no-work-owed.test.ts` that call the check with injected readers.
2. Verify RED.
3. Implement `src/conductor/src/engine/no-work-owed.ts`: call the completion reader for `build`; when it reports not done, return `work-present` with the completion reason; otherwise read the four obligations and return `no-work-owed` only when none is present.
4. Verify GREEN.
5. Commit: "feat: add the no-work-owed check for BUILD".

**Done when:**
- [test] A test where the completion reader reports done and every obligation reader reports nothing asserts the check in `no-work-owed.ts` returns `no-work-owed`.
- [test] A test where the completion reader reports not done with a reason asserts the check returns `work-present` and that its reasons include that completion reason verbatim.
- [test] A test asserts the check passes the active child and the plan path to the completion reader, and calls it for the step `build`.
- [test] A test asserts the check performs no write: no file under the temp project root is created or modified by a call.

**Files likely touched:**
- `src/conductor/src/engine/no-work-owed.ts` — new module
- `src/conductor/test/engine/no-work-owed.test.ts` — new tests

**Dependencies:** none

### Task 2: The check reports work present for each obligation and for unreadable state
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing unit tests in `src/conductor/test/engine/no-work-owed.test.ts`, one per obligation, each with the completion reader reporting done. Build the open-case fixture through the production `RemediationCaseStore`: an applied action case whose task is complete and that has no closure judgement recorded.
2. Verify RED.
3. Implement the four obligation reads and the unreadable rule in `src/conductor/src/engine/no-work-owed.ts`.
4. Verify GREEN.
5. Commit: "feat: no-work-owed check counts each obligation as work".

**Done when:**
- [test] A test with an open case that `isBuildEligibleActionCase` accepts in the child's case store, written through `RemediationCaseStore` with its task complete and no closure judgement, asserts the check returns `work-present` naming the case id.
- [test] A test with a route record for which `hostCarriesTasklessObligation` is true for the host asserts the check returns `work-present` naming the taskless obligation.
- [test] A test with a kickback ledger that carries `pendingRepair` asserts the check returns `work-present` naming the pending repair receipt id.
- [test] A test with a kickback ledger entry for a gate that has no prior verdict asserts the check returns `work-present` naming that gate.
- [test] A test where one obligation reader throws, and a test where the case store read returns a not-ok result, each assert the check returns `work-present` with a reason that says the state was unreadable.

**Files likely touched:**
- `src/conductor/src/engine/no-work-owed.ts` — obligation reads
- `src/conductor/test/engine/no-work-owed.test.ts` — obligation tests

**Dependencies:** Task 1

### Task 3: The BUILD verdict can record the no-work-owed outcome and its origin
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/gate-verdicts.test.ts`.
2. Verify RED.
3. Implement: widen `GateVerdict.outcome` in `src/conductor/src/engine/gate-verdicts.ts` to include `no-work-owed`; add the origin field with the values `dispatch-boundary` and `stall-remediation`; let `computeAndWriteVerdict` take both through its options and write them.
4. Verify GREEN.
5. Commit: "feat: BUILD verdict records the no-work-owed outcome".

**Done when:**
- [test] A test calls `computeAndWriteVerdict` for `build` with the outcome `no-work-owed` and the origin `dispatch-boundary`, then asserts `readVerdict` returns a satisfied verdict carrying that outcome and that origin.
- [test] A test calls it with the origin `stall-remediation` and asserts `readVerdict` returns that origin.
- [test] A test calls `computeAndWriteVerdict` for `build` with no outcome option and asserts the stored verdict has no outcome and no origin field.

**Files likely touched:**
- `src/conductor/src/engine/gate-verdicts.ts` — outcome value, origin field, options
- `src/conductor/test/engine/gate-verdicts.test.ts` — outcome tests

**Dependencies:** none

### Task 4: The step loop settles a stacked child's BUILD when no work is owed
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing conductor tests in `src/conductor/test/engine/conductor-no-work-owed-settle.test.ts`, following the harness in `src/conductor/test/engine/stacked-region-events.test.ts`: a two-child feature, child 1 with every planned task complete through real `Task:`-trailered commits, BUILD `pending`, and no obligations.
2. Verify RED.
3. Implement in `src/conductor/src/engine/conductor.ts`, beside the `acceptance_specs` `no-owned-criteria` settle: for BUILD that is not `done` or `skipped`, run the check from `no-work-owed.ts`; on `no-work-owed` write the verdict with the origin `dispatch-boundary`, save the step `done`, emit `gate_verdict` and `step_completed` with `unmetered: true`, and continue. Follow that precedent: the settle runs before a step attempt opens and charges nothing.
4. Verify GREEN.
5. Commit: "feat: settle BUILD without a dispatch when no work is owed".

**Done when:**
- [test] A test runs the `Conductor` for child 1 and asserts child 1's BUILD status is `done`, the step runner mock received no call for `build`, and its first call is for the child's next gate.
- [test] The same test asserts the persisted event ledger holds a `gate_verdict` for `build` and a `step_completed` for `build` with `unmetered: true`, and that `readVerdict` for child 1's BUILD returns the outcome `no-work-owed` with the origin `dispatch-boundary`.
- [test] The same test asserts no `.pipeline/HALT` file exists, no `kickback` event is on the ledger, and the kickback ledger and the run's remediation round count are unchanged from before the run.
- [test] The same test asserts no retry attempt was opened for BUILD: the ledger holds no `step_started` and no `step_retry` event for `build`.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — dispatch-boundary settle
- `src/conductor/test/engine/conductor-no-work-owed-settle.test.ts` — new tests

**Dependencies:** Tasks 2, 3

### Task 5: A flat feature settles the same way, and a repeated dispatch settles once
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing conductor tests in `src/conductor/test/engine/conductor-no-work-owed-settle.test.ts` for a feature with no children, and for a feature whose BUILD verdict file already records `no-work-owed` while its BUILD status is still `in_progress`.
2. Verify RED.
3. Implement any change the flat path needs in `src/conductor/src/engine/conductor.ts`; the settle must not depend on an active child.
4. Verify GREEN.
5. Commit: "feat: no-work-owed settle covers flat features and re-entry".

**Done when:**
- [test] A test runs the `Conductor` on a feature with no children and no work owed and asserts BUILD is `done` and the step runner mock received no call for `build`.
- [test] A test starts with a stored BUILD verdict of `no-work-owed` and BUILD status `in_progress`, runs the `Conductor`, and asserts BUILD is `done`, the verdict outcome is `no-work-owed`, and the step runner mock received no call for `build`.
- [test] The same re-entry test runs the `Conductor` a second time and asserts the event ledger holds exactly one `gate_verdict` and exactly one `step_completed` for `build`, and no provider dispatch event for `build`, across both runs.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — flat-path settle
- `src/conductor/test/engine/conductor-no-work-owed-settle.test.ts` — flat and re-entry tests

**Dependencies:** Task 4

### Task 6: BUILD is dispatched when a task is pending, a case is open, or an obligation is hosted
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing conductor tests in `src/conductor/test/engine/conductor-no-work-owed-negatives.test.ts`, one fixture per case.
2. Verify RED: each test fails only if the settle from Task 4 wrongly applies; confirm each by temporarily forcing the check to return `no-work-owed`.
3. Implement nothing new unless a test shows the settle applying; fix the condition in `src/conductor/src/engine/conductor.ts` if so.
4. Verify GREEN.
5. Commit: "test: BUILD dispatches when work is owed".

**Done when:**
- [test] A test with one planned task pending asserts the step runner mock received a call for `build` and `readVerdict` for BUILD carries no `no-work-owed` outcome.
- [test] A test with all tasks complete and an open build-eligible remediation case with a published work order asserts the step runner mock received a call for `build` whose prompt carries that case's work order.
- [test] A test with all tasks complete and a routed host that carries a taskless obligation asserts the step runner mock received a call for `build` whose prompt carries the obligation's retry hint.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — condition fix if needed
- `src/conductor/test/engine/conductor-no-work-owed-negatives.test.ts` — new tests

**Dependencies:** Task 4

### Task 7: A pending repair or a pending gate kickback leaves the existing guards in charge
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing conductor tests in `src/conductor/test/engine/conductor-no-work-owed-negatives.test.ts`. Model the pending-repair fixture on `src/conductor/test/engine/conductor-remediation-noop-guard.test.ts` and the no-op-cycle fixture on the "refuses an exact no-op kickback cycle" test in `src/conductor/test/engine/conductor-kickback-transition.test.ts`.
2. Verify RED as in Task 6.
3. Implement nothing new unless a test shows the settle applying.
4. Verify GREEN.
5. Commit: "test: no-work-owed settle yields to the kickback guards".

**Done when:**
- [test] A test with all tasks complete and a pending repair authorization asserts BUILD's verdict carries no `no-work-owed` outcome and the run ends in the kickback no-op guard's HALT whose text contains "remediation produced no dispatchable build work".
- [test] A test with all tasks complete, a failed gate pending against BUILD, and a prior no-movement build outcome on the same tree asserts BUILD's verdict carries no `no-work-owed` outcome and the run ends in the no-op-cycle refusal's HALT.
- [test] A test clears the kickback no-op guard's HALT through `dispatchHaltClearCommand`, runs the `Conductor` again with the same gate still failing, and asserts the run ends in a `needs-human` HALT again and the step runner mock received at most one call for `build` across the second run.

**Files likely touched:**
- `src/conductor/test/engine/conductor-no-work-owed-negatives.test.ts` — guard tests

**Dependencies:** Task 4

### Task 8: Unreadable or incomplete completion state never settles BUILD
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing conductor tests in `src/conductor/test/engine/conductor-no-work-owed-negatives.test.ts`, one fixture per case.
2. Verify RED as in Task 6.
3. Implement nothing new unless a test shows the settle applying.
4. Verify GREEN.
5. Commit: "test: incomplete completion state never settles BUILD".

**Done when:**
- [test] A test with a missing task status file, and a test with a task status file that is not valid JSON, each assert the step runner mock received a call for `build` and BUILD is not `done` before that call.
- [test] A test with a plan file that is missing, and a test with a plan that has no parseable tasks, each assert BUILD's verdict carries no `no-work-owed` outcome and the run takes the existing empty-plan path, observed as the same terminal state the run reaches with the settle disabled.
- [test] A test with all tasks complete and the `.pipeline/halt-user-input-required` marker present asserts BUILD's verdict carries no `no-work-owed` outcome and the marker is handled by the existing stall path, observed as a `build_stall` event with the reason `halt_marker`.
- [test] A test whose task status rows all read `completed` while the branch holds no commit for those tasks asserts BUILD's verdict carries no `no-work-owed` outcome.
- [test] A test with all tasks complete and an uncommitted file in the worktree asserts the step runner mock received a call for `build` and BUILD is not `done` before that call.

**Files likely touched:**
- `src/conductor/test/engine/conductor-no-work-owed-negatives.test.ts` — completion-state tests

**Dependencies:** Task 4

### Task 9: An explicit instruction dispatches BUILD even when no work is owed
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing conductor tests in `src/conductor/test/engine/conductor-no-work-owed-negatives.test.ts`: one with `fromStep: 'build'`, one entering an operator round's host.
2. Verify RED.
3. Implement in `src/conductor/src/engine/conductor.ts`: skip the check when BUILD is the `--from` target or when the current route record's kind is `operator`.
4. Verify GREEN.
5. Commit: "feat: explicit BUILD instructions bypass the no-work-owed settle".

**Done when:**
- [test] A test constructs the `Conductor` with `fromStep: 'build'` on a feature with no work owed and asserts the step runner mock received a call for `build`.
- [test] A test enters an operator round's host with no work owed and asserts the step runner mock received a call for `build`.
- [test] Both tests assert BUILD's verdict carries no `no-work-owed` outcome before the dispatch.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — explicit-instruction bypass
- `src/conductor/test/engine/conductor-no-work-owed-negatives.test.ts` — bypass tests

**Dependencies:** Task 4

### Task 10: A revalidate round settles BUILD and runs its other queued gates
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing conductor tests in `src/conductor/test/engine/routing/conductor-revalidate-no-work-owed.test.ts`, following the revalidate harness in `src/conductor/test/engine/routing/conductor-routed-verify-green.test.ts`: a closed child with a queued revalidation entry whose gates are `build` and `test_suite`, every task complete, no obligations.
2. Verify RED.
3. Implement: if the step-loop settle from Task 4 is not reached for a routed revalidate host, add the same settle at the point where that host's BUILD is selected in `src/conductor/src/engine/conductor.ts`. Leave `enterHostRegion` in `src/conductor/src/engine/routing/host-region-entry.ts` returning no no-op settle for revalidate rounds.
4. Verify GREEN.
5. Commit: "feat: revalidate rounds settle a BUILD with no work owed".

**Done when:**
- [test] A test runs the `Conductor` into the revalidate round and asserts the step runner mock received no call for `build`, received a call for `test_suite`, and the child's revalidation queue entry is acknowledged after the gates pass, observed as a `child_revalidated` event with the status `passed`.
- [test] A test with a revalidate round that has no items, a child whose 88 planned tasks are all complete, and an event ledger seeded with an earlier `loop_halt` for that child's BUILD asserts the step runner mock received no call for `build` and no `.pipeline/HALT` file exists.
- [test] The first test asserts `readVerdict` for the child's BUILD returns the outcome `no-work-owed`.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — revalidate-host settle if a second call site is needed
- `src/conductor/test/engine/routing/conductor-revalidate-no-work-owed.test.ts` — new tests

**Dependencies:** Task 4

### Task 11: A revalidate round still dispatches BUILD when work appears, and region entry is unchanged
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing conductor tests in `src/conductor/test/engine/routing/conductor-revalidate-no-work-owed.test.ts`.
2. Verify RED as in Task 6.
3. Implement nothing new unless a test shows the settle applying.
4. Verify GREEN.
5. Commit: "test: revalidate rounds dispatch BUILD when work is owed".

**Done when:**
- [test] A test where BUILD settled as `no-work-owed` and `test_suite` then fails asserts BUILD is not settled a second time, and the step runner mock received a call for `build` whose prompt carries the `test_suite` failure as its hint.
- [test] A variant of that test with a prior no-movement build outcome on the same tree asserts the run ends in the no-op-cycle refusal's HALT and BUILD is not settled a second time.
- [test] A test with a revalidate round for a child with one planned task pending asserts the step runner mock received a call for `build`.
- [test] A test calls `enterHostRegion` for a revalidate host with every task complete and asserts it returns `entered`, not `derived-already-complete`, writes no HALT, leaves the host's BUILD status not `done` and stores no `no-work-owed` verdict; the test then runs the `Conductor` and asserts the `no-work-owed` verdict is stored only once the step loop reaches BUILD.
- [test] A test enters an audit round whose host has every routed task complete and asserts the host takes the `derived-already-complete` exit, observed as a `routed_repair_phase` event with that reason, and that no verdict carries the outcome `no-work-owed`.

**Files likely touched:**
- `src/conductor/test/engine/routing/conductor-revalidate-no-work-owed.test.ts` — negative tests

**Dependencies:** Task 10

### Task 12: The remediation plan contract accepts no-work-owed for a build stall only
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/remediation-plan-contract.test.ts`, and update the exact vocabulary expectations there and in `src/conductor/test/engine/remediation-projection.test.ts`.
2. Verify RED.
3. Implement: add `no-work-owed` to `REMEDIATION_DISPOSITIONS`; in `validateRemediationPlan` in `src/conductor/src/engine/remediation-plan-contract.ts` accept it only when `projection.source` is `build-stall`, with a `stall:` reference and no tasks; map an accepted plan to a new `planRemediation` outcome kind in `src/conductor/src/engine/conductor.ts`.
4. Verify GREEN.
5. Commit: "feat: remediation plan contract accepts no-work-owed for build stalls".

**Done when:**
- [test] A test asserts `validateRemediationPlan` accepts a plan whose disposition is `no-work-owed` with a `stall:` reference and no tasks when the projection source is `build-stall`.
- [test] A test asserts `validateRemediationPlan` rejects the same disposition for each of the projection sources `validation-group`, `prd-audit`, `as-built` and `finish-verification`.
- [test] A test asserts `validateRemediationPlan` rejects a `no-work-owed` plan that carries tasks.
- [test] A conductor test asserts that a rejected `no-work-owed` plan from a non-stall source yields the `planRemediation` outcome kind `none`, the engine's planner-fault outcome, with a reason stating the plan contract rejected the plan, and that no step status changes to `done`.
- [test] A conductor test asserts that an accepted build-stall `no-work-owed` plan yields the new `planRemediation` outcome kind and not `route`, `halt` or `none`.

**Files likely touched:**
- `src/conductor/src/engine/remediation-plan-contract.ts` — disposition rule
- `src/conductor/src/engine/artifacts.ts` — disposition constant if it lives beside the halt categories
- `src/conductor/src/engine/conductor.ts` — `planRemediation` outcome kind
- `src/conductor/test/engine/remediation-plan-contract.test.ts` — contract tests
- `src/conductor/test/engine/remediation-projection.test.ts` — vocabulary expectation
- `src/conductor/test/engine/conductor-stall-no-work-owed.test.ts` — outcome-kind tests

**Dependencies:** none

### Task 13: A confirmed no-work-owed stall verdict settles BUILD with no HALT
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing conductor tests in `src/conductor/test/engine/conductor-stall-no-work-owed.test.ts`: a daemon-mode run where the BUILD session writes the halt marker on a child with no work owed and the remediate session returns a `no-work-owed` plan.
2. Verify RED.
3. Implement in the build-stall branch of `src/conductor/src/engine/conductor.ts`: on the new outcome kind, run the check from `no-work-owed.ts`; on `no-work-owed` write the verdict with the origin `stall-remediation`, save BUILD `done`, emit `gate_verdict` and `step_completed` with `unmetered: true`, and leave the retry loop for the next gate.
4. Verify GREEN.
5. Commit: "feat: a confirmed no-work-owed stall verdict settles BUILD".

**Done when:**
- [test] A test asserts that after the halt-marker stall and the `no-work-owed` plan, BUILD is `done`, no `.pipeline/HALT` file exists, and the step runner mock's next call after `remediate` is for the next gate.
- [test] The same test asserts `readVerdict` for BUILD returns the outcome `no-work-owed` with the origin `stall-remediation`.
- [test] The same test asserts the engine accepted the plan: no `planRemediation` fault is recorded and no `loop_halt` event is on the ledger.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — stall-branch settle
- `src/conductor/test/engine/conductor-stall-no-work-owed.test.ts` — settle tests

**Dependencies:** Tasks 4, 12

### Task 14: A contradicted no-work-owed verdict resumes BUILD, and the other stall outcomes are unchanged
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing conductor tests in `src/conductor/test/engine/conductor-stall-no-work-owed.test.ts`.
2. Verify RED.
3. Implement in the build-stall branch of `src/conductor/src/engine/conductor.ts`: when the check returns `work-present`, set the retry hint to an engine-written sentence listing the check's reasons and resume BUILD the way a `route` to `build` does, adding no charge beyond the round already charged before `planRemediation`.
4. Verify GREEN.
5. Commit: "feat: a contradicted no-work-owed verdict resumes BUILD".

**Done when:**
- [test] A test with a halt-marker stall on a child with one planned task pending and a `no-work-owed` plan asserts BUILD is not `done`, the step runner mock's next `build` call carries a hint naming the pending task id, and exactly one remediation round was charged for that stall.
- [test] A test repeats that contradicted verdict until `MAX_KICKBACKS_PER_GATE` rounds are charged and asserts the next halt-marker stall ends in a HALT whose first line is the stall question.
- [test] A test with a `no_task_progress` stall and a `no-work-owed` plan asserts BUILD is not `done`, the next `build` call carries a hint naming the pending work, and the run writes no HALT from that remediation outcome.
- [test] A test with a halt-marker stall and a remediation result in the halt category `unanswerable` asserts the run ends in a HALT whose first line is the stall question, as before this change.
- [test] A test with a halt-marker stall on a child with no work owed and a remediation result that routes to `build` with an answer asserts the next `build` call carries that answer as its hint and BUILD is not settled as `no-work-owed`.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — contradicted-verdict resume
- `src/conductor/test/engine/conductor-stall-no-work-owed.test.ts` — negative tests

**Dependencies:** Task 13

### Task 15: A reader returns the earlier halt reasons for one step and child
**Story:** Story 4
**Type:** infrastructure

**Steps:**
1. Write failing unit tests in `src/conductor/test/engine/earlier-halt-reasons.test.ts` against seeded ledger files.
2. Verify RED.
3. Implement `src/conductor/src/engine/earlier-halt-reasons.ts`: read the ledger at `FEATURE_EVENT_LOG_PATH`, keep `loop_halt` entries whose `step` and `child` match the arguments, drop repeated reasons, and return at most five, most recent first. Follow `readBaseAdvanceHistory`: a missing file gives an empty list and a malformed line is skipped.
4. Verify GREEN.
5. Commit: "feat: read earlier halt reasons for a step and child".

**Done when:**
- [test] A test seeds `loop_halt` entries for children 3 and 4 and for the steps `build` and `test_suite`, and asserts the reader called for `build` and child 3 returns only child 3's `build` reasons.
- [test] A test with no ledger file, and a test whose ledger holds a line that is not valid JSON between two valid entries, assert the reader returns an empty list and the two valid reasons respectively, and does not throw.
- [test] A test seeds twenty matching entries, eighteen with identical text, and asserts the reader returns each distinct reason once.
- [test] A test seeds eight distinct matching reasons and asserts the reader returns the five most recent.
- [test] A test for a feature with no children asserts the reader called with no child returns the `build` reasons that carry no child.

**Files likely touched:**
- `src/conductor/src/engine/earlier-halt-reasons.ts` — new module
- `src/conductor/test/engine/earlier-halt-reasons.test.ts` — new tests

**Dependencies:** none

### Task 16: The stall remediation receives the earlier halt reasons, labelled as no longer in force
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing conductor tests in `src/conductor/test/engine/conductor-stall-earlier-halts.test.ts`: a daemon-mode halt-marker stall with a seeded ledger, capturing the dispatch context passed to the `remediate` step.
2. Verify RED.
3. Implement in the build-stall branch of `src/conductor/src/engine/conductor.ts`: call the reader from `earlier-halt-reasons.ts` for `build` and the active region child, and append its result to the remediation dispatch context under a heading that says these halt reasons were cleared and are no longer in force. Append nothing when the list is empty.
4. Verify GREEN.
5. Commit: "feat: pass earlier halt reasons to the stall remediation".

**Done when:**
- [test] A test with two earlier `loop_halt` entries for child 3's BUILD asserts the `remediate` dispatch context for child 3's stall lists both reasons under a heading stating they are no longer in force.
- [test] A test whose ledger holds earlier `loop_halt` entries only for child 4 and for `test_suite` asserts the `remediate` dispatch context for child 3's BUILD stall lists no earlier halt reasons.
- [test] A test with no ledger file, and a test with a malformed ledger line, each assert the `remediate` step is still dispatched and its context carries the stall question unchanged and lists no earlier halt reasons.
- [test] A test with twenty earlier entries, eighteen identical, asserts the dispatch context lists each distinct reason once and no more than five.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — append earlier halt reasons to the stall context
- `src/conductor/test/engine/conductor-stall-earlier-halts.test.ts` — new tests

**Dependencies:** Task 15

### Task 17: The remediate policy directs how a repeated cleared halt is judged
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing assertions in `src/conductor/test/engine/remediate-skill-contract.test.ts` on the text of `skills/remediate/SKILL.md` and `agents/remediation-planner.md`.
2. Verify RED.
3. Implement: in the gap-plan judgment guidance of `skills/remediate/SKILL.md` and the calibration section of `agents/remediation-planner.md`, state the policy. Keep judgment prose only; add no output-format heading, field rule or disposition table, which `test/test_provider_skill_contracts.sh` rejects.
4. Verify GREEN, and run `test/test_provider_skill_contracts.sh`.
5. Commit: "feat: remediate policy covers no-work-owed and cleared halts".

**Done when:**
- [test] A test asserts both files direct that a stall question repeating a cleared halt reason, where planned work remains, is routed to `build` with an answer saying the halt was cleared and the planned work continues.
- [test] A test asserts both files direct the `no-work-owed` verdict for a stall question that repeats a cleared halt reason when BUILD has no work owed.
- [test] A test asserts both files direct that when an open remediation case still supports the question, the fitting halt category is used and `no-work-owed` is not.
- `test/test_provider_skill_contracts.sh` exits 0.

**Files likely touched:**
- `skills/remediate/SKILL.md` — judgment guidance
- `agents/remediation-planner.md` — calibration
- `src/conductor/test/engine/remediate-skill-contract.test.ts` — policy assertions

**Dependencies:** Task 12

### Task 18: Clearing a halt on a BUILD with no work owed advances the child
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write a failing conductor test in `src/conductor/test/engine/conductor-no-work-owed-halt-clear.test.ts`: child 3 of a stacked feature with BUILD `in_progress`, a `needs-human` `.pipeline/HALT`, every task complete and no open case. Clear the halt by calling `dispatchHaltClearCommand` from `src/conductor/src/engine/halt-clear-cli.ts`, then run the `Conductor`.
2. Verify RED.
3. Implement nothing new unless the settle from Task 4 is not reached after a cleared halt; fix the condition in `src/conductor/src/engine/conductor.ts` if so.
4. Verify GREEN.
5. Commit: "test: halt clear advances a BUILD with no work owed".

**Done when:**
- [test] A test clears the HALT through `dispatchHaltClearCommand`, runs the `Conductor`, and asserts child 3's BUILD is `done`, the step runner mock received no call for `build`, and its first call is for child 3's next gate.
- [test] The same test asserts `dispatchHaltClearCommand` is the only command it invokes, and that the bytes of `.pipeline/children/3/conduct-state.json` are identical before the clear and immediately before the `Conductor` runs.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — condition fix if needed
- `src/conductor/test/engine/conductor-no-work-owed-halt-clear.test.ts` — new test

**Dependencies:** Task 4

### Task 19: A cleared halt with pending work dispatches BUILD, and an uncleared halt dispatches nothing
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-no-work-owed-halt-clear.test.ts`.
2. Verify RED as in Task 6 for the first case; the second case asserts existing behavior and must pass with the settle in place.
3. Implement nothing new unless a test shows a regression.
4. Verify GREEN.
5. Commit: "test: halt clear negatives for the no-work-owed settle".

**Done when:**
- [test] A test with a planned task pending clears the HALT through `dispatchHaltClearCommand`, runs the `Conductor`, and asserts the step runner mock received a call for `build` and BUILD was not `done` before that call.
- [test] A test with a `needs-human` HALT left in place and no work owed asserts the daemon's `isHalted` park-gate in `src/conductor/src/engine/daemon-deps.ts` reports the feature halted, that the dispatch function is not invoked for it, and that child 3's BUILD status is unchanged.

**Files likely touched:**
- `src/conductor/test/engine/conductor-no-work-owed-halt-clear.test.ts` — negative tests

**Dependencies:** Task 18

## Optional Task Dependency Graph

```
1 → 2 ─┐
3 ─────┴→ 4 ─┬→ 5
             ├→ 6
             ├→ 7
             ├→ 8
             ├→ 9
             ├→ 10 → 11
             ├→ 18 → 19
12 ──────────┴→ 13 → 14
12 → 17
15 → 16
```

## Integration Points

- After Task 4: a stacked child with no work owed passes BUILD through the conductor with no provider session.
- After Task 10: a revalidate round with BUILD queued runs only its other gates.
- After Task 13: a moot stall question ends without a HALT through the conductor's stall branch.
- After Task 16: the stall remediation's dispatch context carries the earlier halt reasons.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-11-15-build-settles-without-dispatch-when-no-work-is-owed#D1 | task | task-1, task-2 | asserts the check in `no-work-owed.ts` returns `no-work-owed` |
| adr-2026-11-15-build-settles-without-dispatch-when-no-work-is-owed#D2 | task | task-4, task-5 | asserts child 1's BUILD status is `done`, the step runner mock received no call for `build`, and its first call is for the child's next gate |
| adr-2026-11-15-build-settles-without-dispatch-when-no-work-is-owed#D3 | task | task-9 | asserts the step runner mock received a call for `build` |
| adr-2026-11-15-build-settles-without-dispatch-when-no-work-is-owed#D4 | task | task-10, task-11 | asserts the step runner mock received no call for `build`, received a call for `test_suite`, and the child's revalidation queue entry is acknowledged after the gates pass |
| adr-2026-11-15-build-settles-without-dispatch-when-no-work-is-owed#D5 | task | task-3, task-4 | asserts the persisted event ledger holds a `gate_verdict` for `build` and a `step_completed` for `build` with `unmetered: true` |
| adr-2026-11-15-build-settles-without-dispatch-when-no-work-is-owed#D6 | task | task-12, task-17 | asserts `validateRemediationPlan` accepts a plan whose disposition is `no-work-owed` with a `stall:` reference and no tasks when the projection source is `build-stall` |
| adr-2026-11-15-build-settles-without-dispatch-when-no-work-is-owed#D7 | task | task-13, task-14 | asserts BUILD is not `done`, the step runner mock's next `build` call carries a hint naming the pending task id, and exactly one remediation round was charged for that stall |
| adr-2026-11-15-build-settles-without-dispatch-when-no-work-is-owed#D8 | task | task-15, task-16 | asserts the `remediate` dispatch context for child 3's stall lists both reasons under a heading stating they are no longer in force |
| adr-2026-11-15-build-settles-without-dispatch-when-no-work-is-owed#D9 | task | task-18 | asserts `dispatchHaltClearCommand` is the only command it invokes |
| adr-2026-11-15-build-settles-without-dispatch-when-no-work-is-owed#D10 | task | task-7 | asserts BUILD's verdict carries no `no-work-owed` outcome and the run ends in the kickback no-op guard's HALT |
| adr-2026-07-10-daemon-stall-remediation#D1 | existing | none | The conductor's stall branch already captures the marker content with `writeStallQuestionEvidence` in `task-progress.ts` before the marker is cleared; this feature leaves that capture unchanged |
| adr-2026-07-10-daemon-stall-remediation#D2 | task | task-16 | assert the `remediate` step is still dispatched and its context carries the stall question unchanged |
| adr-2026-07-10-daemon-stall-remediation#D3 | task | task-14 | asserts the next `build` call carries that answer as its hint and BUILD is not settled as `no-work-owed` |
| adr-2026-07-10-daemon-stall-remediation#D4 | task | task-13, task-14 | asserts that after the halt-marker stall and the `no-work-owed` plan, BUILD is `done`, no `.pipeline/HALT` file exists |
| adr-2026-07-10-daemon-stall-remediation#D5 | existing | none | The conductor's stall branch already calls `writeStallHalt` with the question on a dispatch failure, a `none` outcome and budget exhaustion; a rejected `no-work-owed` plan reaches the same `none` branch |
| adr-2026-07-10-daemon-stall-remediation#D6 | task | task-14 | asserts the next halt-marker stall ends in a HALT whose first line is the stall question |
| adr-2026-07-10-daemon-stall-remediation#D7 | task | task-12, task-17 | asserts `validateRemediationPlan` rejects the same disposition for each of the projection sources `validation-group`, `prd-audit`, `as-built` and `finish-verification` |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
