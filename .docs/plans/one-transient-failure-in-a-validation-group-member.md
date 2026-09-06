# Implementation Plan: One transient failure in a validation-group member discards its siblings

**Date:** 2026-09-06
**Design:** .docs/decisions/architecture-review-2026-09-06-one-transient-failure-in-a-validation-group-member.md
**Stories:** .docs/stories/one-transient-failure-in-a-validation-group-member.md
**Conflict check:** Clean as of 2026-09-06 (one cross-spec overlap resolved; see .docs/conflicts/one-transient-failure-in-a-validation-group-member.md)
**Source-Ref:** jstoup111/ai-conductor#1425
**Blocked by:** jstoup111/ai-conductor#2190 (delivers the branch retry budget; PR #2206)

## Summary

Make the auto-mode SHIP validation-group join persist the siblings that already passed when one member halts the group with `no-verdict`, so the operator's re-dispatch re-runs only the failed member. Eight tasks: one refactor, three retention tasks, one verification task, three re-dispatch tasks.

## Technical Approach

- **Where.** Everything lives in the built-in validation-group fan-out inside the auto-mode run loop in `src/conductor/src/engine/conductor.ts`: the `allGreen` computation, the `no-verdict` halt block that follows it, and the all-green join that writes member statuses. `group-core.ts` is not touched.
- **Retention predicate (C3).** The join already computes each passing member's objective gate verdict (`computeAndWriteVerdict` → `gateVerdicts`), the `manual_test` FAIL rows, and per-branch handshake failures before it checks for a `no-verdict` outcome. The predicate that decides "this member is truly satisfied this round" is the per-member body of `allGreen`. Task 1 lifts that body into a named per-index closure so the halt block and `allGreen` share one predicate. `inFlightGroupCompletions` (the dispatch-success side-channel used by the signal handlers) is NOT the source: it records `verdict:pass` on dispatch success alone.
- **One atomic commit (C1/C2).** The halt block keeps its order — `writeHaltMarker` first — and then makes ONE `commitStateChanges` call carrying, for every retained member, both its bare key and its synthetic `validation__<member>` key as `done` (the same two keys the all-green join writes) plus the pre-existing `failed`/`last_step` stamping. The state mutation port applies a batch atomically, so there is no window where siblings are `done` without the `failed` stamping. A rejected commit is caught and logged in the shape of `persistSignalCompletionsBestEffort`; `loop_halt` and `step_failed` still fire.
- **Why the re-dispatch then skips them.** `resolveGroupMembership` already treats `getStepStatus(state, member) === 'done'` as already satisfied and excludes it from `dispatchable`; `markDownstreamStale` flips `done → stale` on any kickback or rebase invalidation; and `nonGreenFinishValidators` re-validates every member from disk at FINISH. None of those change. Tasks 6–8 prove the retained `done` flows through each of them.
- **Halt stamping is unchanged.** Today the block writes `[step.name]: 'failed'` where `step.name` is the loop's current step (the group's entry member) and `last_step: step.name`. Keep it byte-for-byte; the tests assert it.
- **Budget.** The branch retry budget (`runGroupBranch(…, resolved.max_retries)`) arrives with #2190; this feature is blocked by it and Task 6's retry test relies on it.
- **Local test pattern.** The acceptance file `src/conductor/test/acceptance/parallel-validation-phase-fan-out-manual-test-prd-.acceptance.test.ts` already has the fixtures this work needs: `seedToValidators(dir, statePath, overrides)` seeds a state at the validators, `makeConductor(dir, statePath, runner, events)` builds an auto-mode conductor with a fake `StepRunner`, and a throwing `run` for one member models a dead validator. New tests go in a feature-named sibling file and reuse those helpers (import or copy the two helpers; do not edit the existing file's tests). Search hints: `seedToValidators`, `makeConductor`, `'parvalid-crash-'`.

## Prerequisites

- PR #2206 (#2190) merged, so the branch budget is real; the daemon's dependency gate enforces this via the GitHub `blocked_by` link on #1425.

## Tasks

### Task 1: Name the per-member join-satisfaction predicate
**Story:** 2
**Type:** refactor

**Steps:**
1. In the validation-group join, lift the inline body of `allGreen`'s callback into a named closure `memberSatisfiedAtJoin(idx)` in the same scope (pass outcome; when `verifyArtifacts`: `gateVerdicts.get(member.name)?.satisfied`, no `branchHandshakeFailures` entry, and for `manual_test` empty `manualTestFailRows`).
2. Make `allGreen` call it: `outcomes.every((_, idx) => memberSatisfiedAtJoin(idx))`.
3. Run the existing fan-out acceptance file; it must pass unchanged.
4. Commit: "refactor(conductor): name the validation-group per-member satisfaction predicate".

**Done when:**
- `allGreen` in the validation-group join is computed as `outcomes.every((o, idx) => memberSatisfiedAtJoin(idx))` where `memberSatisfiedAtJoin` is a named closure holding the former inline body (pass outcome; when `verifyArtifacts`: gate verdict satisfied, no handshake failure, and for `manual_test` no FAIL rows)
- `npx vitest run src/conductor/test/acceptance/parallel-validation-phase-fan-out-manual-test-prd-.acceptance.test.ts` passes with no test edits
- the diff touches only src/conductor/src/engine/conductor.ts and changes no observable behavior

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — extract the predicate; no behavior change

**Dependencies:** none

### Task 2: Persist satisfied siblings in the no-verdict halt commit
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test in a new `src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts` (reuse `seedToValidators`/`makeConductor` from the existing fan-out acceptance file — search `seedToValidators`, `'parvalid-crash-'`): `manual_test` throws on every attempt, `prd_audit` and `architecture_review_as_built` write passing artifacts; after `run()`, assert both members and both `validation__*` synthetic keys are `done`, the pre-existing `failed`/`last_step` stamping is present, `HALT.class` is `needs-human`, and the HALT body names `manual_test`. Spy on the state store (or `commitStateChanges`) and assert exactly one apply between the HALT marker write and `loop_halt`.
2. Verify RED (siblings are not `done` today).
3. Implement: in the no-verdict block, after `writeHaltMarker`, build `retained` from `membership.dispatchable` filtered by `memberSatisfiedAtJoin(idx)` and `idx !== noVerdictIdx`; write `retained[member] = 'done'` and `retained[`${builtinGroup.name}__${member}`] = 'done'`; spread it into the SAME `commitStateChanges` call that writes `[step.name]: 'failed', last_step`. Rewrite the block's leading comment to state the rule.
4. Verify GREEN.
5. Commit: "fix(conductor): retain satisfied siblings when a validation-group member halts with no-verdict".

**Done when:**
- a test in src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts drives an auto-mode run where `manual_test` throws on every attempt and `prd_audit`/`architecture_review_as_built` pass with satisfied gate verdicts, and asserts `conduct-state.json` afterward has `prd_audit`, `architecture_review_as_built`, `validation__prd_audit`, and `validation__architecture_review_as_built` all `done` together with the pre-existing `failed` and `last_step` stamping
- the same test asserts the retained `done` keys and the `failed` stamping arrive in one `commitStateChanges` call (one state-store apply observed between the HALT marker write and `loop_halt`), so a crash can never leave siblings `done` without the `failed` stamping
- the same test asserts the HALT marker body names `manual_test` and its no-verdict reason, `HALT.class` is `needs-human`, and `last_step` equals its pre-change value
- the comment above the no-verdict block no longer says siblings are not marked `done`; it states the retention rule and its predicate

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — retention in the no-verdict halt block; comment rewrite
- src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts — new acceptance file

**Dependencies:** 1

### Task 3: Never retain a member the join did not validate
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts`: (a) `prd_audit` returns success but writes no passing artifact (gate verdict unsatisfied) while `manual_test` throws → `prd_audit` not `done`; (b) `manual_test` returns success with FAIL rows in `.pipeline/manual-test-results.md` while `prd_audit` throws → `manual_test` not `done`; (c) a passing member whose verdict-run-identity handshake is forced to fail → not `done`; (d) in every case the no-verdict member and its synthetic key are not `done`.
2. Verify RED where the Task 2 implementation is wider than the predicate; otherwise these lock the predicate in.
3. Implement any predicate narrowing needed (no new predicate; the Task 1 closure is the only source).
4. Verify GREEN.
5. Commit: "test(conductor): validation-group retention excludes unvalidated members".

**Done when:**
- a test in src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts where `prd_audit` passes dispatch but its objective gate verdict is unsatisfied asserts `prd_audit` and `validation__prd_audit` are not `done` after the halt
- a test where `manual_test` passes dispatch with FAIL rows in `.pipeline/manual-test-results.md` while `prd_audit` throws asserts `manual_test` is not `done` after the halt
- a test where a passing member's verdict-run-identity handshake fails asserts that member is not `done` after the halt
- every retention test asserts the no-verdict member and its synthetic group-member key are not `done`

**Files likely touched:**
- src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts — negative retention tests
- src/conductor/src/engine/conductor.ts — only if the predicate needs narrowing

**Dependencies:** 2

### Task 4: A rejected retention commit never skips the halt
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing test in `src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts`: construct the conductor with a state store whose `apply` rejects the halt-block commit; run with a throwing member; assert the HALT marker and `HALT.class` (`needs-human`) exist, `loop_halt` and `step_failed` were emitted, and the captured log contains a line naming the failed persist.
2. Verify RED (today the rejection propagates out of the block).
3. Implement: wrap the single commit in a catch that logs via the conductor's logger in the `persistSignalCompletionsBestEffort` shape and continues to `emitLoopHalt` / `step_failed`.
4. Verify GREEN.
5. Commit: "fix(conductor): a failed retention commit still halts the validation group".

**Done when:**
- a test in src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts injects a state store whose apply rejects the retention commit and asserts the HALT marker exists with class `needs-human`, `loop_halt` and `step_failed` are both emitted, and the conductor log contains a line naming the failed persist
- the failure handling is a catch-and-log in the shape of `persistSignalCompletionsBestEffort`, not a rethrow; the run returns normally after the halt

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — catch-and-log around the halt-block commit
- src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts — rejection test

**Dependencies:** 2

### Task 5: Verify the halt itself is unchanged
**Story:** 1
**Type:** verification

**Steps:**
1. Run `src/conductor/test/acceptance/parallel-validation-phase-fan-out-manual-test-prd-.acceptance.test.ts` and confirm the flow-B test and the `classifies a validation-group no-verdict as needs-human` test pass against the Task 2–4 code.
2. Add one test in `src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts` with two passing siblings and one always-throwing member asserting zero `kickback` events, no `.pipeline/remediation.json`, `HALT.class` `needs-human`, and both `loop_halt` and `step_failed`.
3. Locate the daemon's HALT-marker resume-gate test (search `HALT` in `src/conductor/test/daemon-*.test.ts`) and cite it as the proof that an uncleared HALT is not re-dispatched.
4. Commit: "test(conductor): validation-group no-verdict halt semantics are unchanged by retention".

**Done when:**
- `npx vitest run src/conductor/test/acceptance/parallel-validation-phase-fan-out-manual-test-prd-.acceptance.test.ts` passes, including the flow-B test (siblings still dispatch, no `remediate` call) and the `classifies a validation-group no-verdict as needs-human` test
- a test in src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts with two passing siblings and one always-throwing member asserts zero `kickback` events, no `.pipeline/remediation.json`, `HALT.class` equal to `needs-human`, and both `loop_halt` and `step_failed` emitted
- the daemon's existing HALT-marker resume gate test (`src/conductor/test/daemon-resume-gate.test.ts` or its current equivalent) is cited by name in the task's evidence trailer as the proof that an uncleared HALT is not re-dispatched

**Files likely touched:**
- src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts — one halt-semantics test

**Verify-only:** yes

**Dependencies:** 4

### Task 6: Re-dispatch runs only the member that failed
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts`: (a) seed state with `prd_audit`/`architecture_review_as_built` `done` (bare + `validation__*` keys) and `manual_test` `failed`, no HALT files, run in auto mode with a passing runner, assert the runner was called exactly once (for `manual_test`), every member and synthetic key is `done`, and `parallel_completed` lists only `manual_test`; (b) same seed, runner throws once for `manual_test` then passes, assert two `manual_test` dispatches and no `loop_halt`; (c) compare the three members' and synthetic keys' post-join statuses against a fresh all-green run and assert equality.
2. Verify RED/GREEN (a and c may already pass via `resolveGroupMembership`; b requires the #2190 budget — this feature is blocked on it).
3. Implement nothing new unless (a) fails; the retained `done` must flow through `resolveGroupMembership` unchanged.
4. Commit: "test(conductor): re-dispatch after a retained validation-group halt runs only the failed member".

**Done when:**
- a test in src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts seeds `conduct-state.json` with `prd_audit` and `architecture_review_as_built` `done` (bare and synthetic keys) and `manual_test` `failed`, clears the HALT, runs the conductor in auto mode, and asserts the step runner was invoked exactly once, for `manual_test`
- the same test asserts the round joins all-green: every member and synthetic key is `done`, a `parallel_completed` event lists the dispatched branch, and the loop advances past the group
- a second test lets the re-dispatched member throw once and pass on its next attempt and asserts two dispatches for that member and no `loop_halt`
- a third test asserts the post-join `conduct-state.json` step statuses for the three members and their synthetic keys are identical to those produced by a run in which all three passed together

**Files likely touched:**
- src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts — re-dispatch tests

**Dependencies:** 2

### Task 7: A kickback restages a retained member; a second failure keeps the rest
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts`: (a) seed a retained `done` member, apply a kickback to `build` through the existing skip-preserving restage helper (search `filterRestageChanges` and the validation-group kickback site), assert the member reads `stale` and is dispatched in the next round; (b) seed two retained `done` members and one `failed`, let the re-dispatched member throw on every attempt, assert after the halt the two members are still `done` and the HALT body names only the failed member.
2. Verify RED/GREEN (a is expected to pass through `markDownstreamStale` today; b exercises the Task 2 predicate on a re-dispatch round).
3. Implement nothing new unless a test fails.
4. Commit: "test(conductor): retained validation-group members restage on kickback and survive a second halt".

**Done when:**
- a test in src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts seeds a retained `done` member, applies a kickback to `build` through the existing skip-preserving restage helper, and asserts the member reads `stale` and is dispatched in the next group round
- a test where the re-dispatched member throws on every attempt asserts the previously retained members remain `done` after the second halt and the HALT body names only the failed member

**Files likely touched:**
- src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts — kickback and second-halt tests

**Dependencies:** 6

### Task 8: Rebase invalidation and the finish fence still catch a stale retained member
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing test in `src/conductor/test/engine/conductor-finish-publication.test.ts`: seed `prd_audit` `done` with an on-disk gate verdict that is unsatisfied at FINISH; assert `nonGreenFinishValidators` lists `prd_audit` and the publication path does not proceed (reuse that file's existing fence fixtures — search `nonGreenFinishValidators`).
2. Write failing test in `src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts`: seed a retained `done` member, run the post-rebase invalidation for a file-changing rebase touching that member's gate surface (search `post-rebase` invalidation entry used by the existing `post-rebase-build-invalidation` acceptance tests), assert the member is restaged and dispatched in the next round.
3. Verify RED/GREEN (both are expected to pass against existing machinery; they pin it for a retained `done`).
4. Implement nothing new unless a test fails.
5. Commit: "test(conductor): retained validation-group members are re-validated by rebase invalidation and the finish fence".

**Done when:**
- a test in src/conductor/test/engine/conductor-finish-publication.test.ts seeds a member `done` with an on-disk gate verdict that is unsatisfied at FINISH and asserts `nonGreenFinishValidators` reports that member and publication does not proceed
- a test in src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts seeds a retained `done` member, runs the post-rebase invalidation for a file-changing rebase that touches the member's gate surface, and asserts the member is restaged and dispatched in the next group round

**Files likely touched:**
- src/conductor/test/engine/conductor-finish-publication.test.ts — finish fence test
- src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts — rebase invalidation test

**Dependencies:** 2

## Task Dependency Graph

```
1 ─▶ 2 ─┬─▶ 3
        ├─▶ 4 ─▶ 5
        ├─▶ 6 ─▶ 7
        └─▶ 8
```

## Integration Points

- After Task 2: an auto-mode run with one dead validator halts and leaves the green siblings `done` — observable end-to-end through `conductor.run()` in auto mode (the daemon's entry point) and `conduct-state.json`.
- After Task 6: clearing the HALT and re-running dispatches only the failed member and joins all-green.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-07-10-validation-group-join#D1 | no-change | none | Membership resolution (`resolveGroupMembership`, tier/track/config skip rules, entry-point selection) is not edited; retention only writes statuses for members that were dispatched this round. |
| adr-2026-07-10-validation-group-join#D2 | task | task-2, task-5 | a test in src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts drives an auto-mode run where `manual_test` throws on every attempt and `prd_audit`/`architecture_review_as_built` pass with satisfied gate verdicts, and asserts `conduct-state.json` afterward has `prd_audit`, `architecture_review_as_built`, `validation__prd_audit`, and `validation__architecture_review_as_built` all `done` together with the pre-existing `failed` and `last_step` stamping |
| adr-2026-07-10-validation-group-join#D3 | no-change | none | The no-verdict path never reaches the consolidated-kickback branch, and the per-gate self-heal budgets (`MAX_KICKBACKS_PER_GATE`, `manualTestSelfHeals`, `remediationRounds`) are not read or written by the retention commit. |
| adr-2026-07-10-validation-group-join#D4 | task | task-6 | a third test asserts the post-join `conduct-state.json` step statuses for the three members and their synthetic keys are identical to those produced by a run in which all three passed together |
| adr-2026-07-10-validation-group-join#D5 | task | task-2 | the same test asserts the retained `done` keys and the `failed` stamping arrive in one `commitStateChanges` call (one state-store apply observed between the HALT marker write and `loop_halt`), so a crash can never leave siblings `done` without the `failed` stamping |

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a member throws on every attempt up to its resolved `max_retries`, when the join runs, then the loop writes a `needs-human` HALT whose reason names the failed member and its no-verdict reason, records the same `failed`/`last_step` stamping it records today, and emits `loop_halt` and `step_failed`. | 5 | "`npx vitest run src/conductor/test/acceptance/parallel-validation-phase-fan-out-manual-test-prd-.acceptance.test.ts` passes, including the flow-B test (siblings still dispatch, no `remediate` call) and the `classifies a validation-group no-verdict as needs-human` test" | diff-local |
| Story 1 happy: Given a member's runner is dead in this way, when its siblings are already in flight, then the siblings still run to their own outcomes before the join halts (no cancellation). | 5 | "`npx vitest run src/conductor/test/acceptance/parallel-validation-phase-fan-out-manual-test-prd-.acceptance.test.ts` passes, including the flow-B test (siblings still dispatch, no `remediate` call) and the `classifies a validation-group no-verdict as needs-human` test" | diff-local |
| Story 1 negative: Given a member settles as `no-verdict`, when the join runs, then no `remediation.json` is synthesized and no `kickback` event is emitted for that round. | 5 | "a test in src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts with two passing siblings and one always-throwing member asserts zero `kickback` events, no `.pipeline/remediation.json`, `HALT.class` equal to `needs-human`, and both `loop_halt` and `step_failed` emitted" | diff-local |
| Story 1 negative: Given a member settles as `no-verdict`, when the halt is written, then the halt class is `needs-human`, not `mechanical`, regardless of how many siblings passed. | 5 | "a test in src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts with two passing siblings and one always-throwing member asserts zero `kickback` events, no `.pipeline/remediation.json`, `HALT.class` equal to `needs-human`, and both `loop_halt` and `step_failed` emitted" | diff-local |
| Story 1 negative: Given the operator has not cleared the HALT, when the daemon's next scan reaches the feature, then the feature is not re-dispatched. | 5 | "the daemon's existing HALT-marker resume gate test (`src/conductor/test/daemon-resume-gate.test.ts` or its current equivalent) is cited by name in the task's evidence trailer as the proof that an uncleared HALT is not re-dispatched" | diff-local |
| Story 2 happy: Given `prd_audit` and `architecture_review_as_built` produced `verdict: pass` outcomes with satisfied objective gate verdicts and `manual_test` settled as `no-verdict`, when the join halts, then `conduct-state.json` records `prd_audit` and `architecture_review_as_built` as `done` (both their bare keys and their synthetic group-member keys) in the same commit that records the halt's `failed` stamping. | 2 | "a test in src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts drives an auto-mode run where `manual_test` throws on every attempt and `prd_audit`/`architecture_review_as_built` pass with satisfied gate verdicts, and asserts `conduct-state.json` afterward has `prd_audit`, `architecture_review_as_built`, `validation__prd_audit`, and `validation__architecture_review_as_built` all `done` together with the pre-existing `failed` and `last_step` stamping" | diff-local |
| Story 2 happy: Given the halt is written with retained siblings, when an operator inspects `conduct-state.json` after the halt, then the HALT marker, its `needs-human` class, and `last_step` are exactly what they were before this change. | 2 | "the same test asserts the HALT marker body names `manual_test` and its no-verdict reason, `HALT.class` is `needs-human`, and `last_step` equals its pre-change value" | diff-local |
| Story 2 negative: Given a member's dispatch succeeded but the join's objective gate verdict for it is unsatisfied, when a sibling halts the group, then that member is NOT recorded `done`. | 3 | "a test in src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts where `prd_audit` passes dispatch but its objective gate verdict is unsatisfied asserts `prd_audit` and `validation__prd_audit` are not `done` after the halt" | diff-local |
| Story 2 negative: Given `manual_test` dispatched successfully but its results file carries FAIL rows, when a sibling halts the group, then `manual_test` is NOT recorded `done`. | 3 | "a test where `manual_test` passes dispatch with FAIL rows in `.pipeline/manual-test-results.md` while `prd_audit` throws asserts `manual_test` is not `done` after the halt" | diff-local |
| Story 2 negative: Given a member's dispatch succeeded but its verdict-run-identity handshake failed, when a sibling halts the group, then that member is NOT recorded `done`. | 3 | "a test where a passing member's verdict-run-identity handshake fails asserts that member is not `done` after the halt" | diff-local |
| Story 2 negative: Given the member that produced `no-verdict`, when the halt commits, then that member's status is not `done` and its synthetic group-member key is not `done`. | 3 | "every retention test asserts the no-verdict member and its synthetic group-member key are not `done`" | diff-local |
| Story 2 negative: Given the state commit that would retain siblings throws, when the join halts, then the HALT marker is still written, `loop_halt` and `step_failed` are still emitted, and the failure to persist is logged loudly. | 4 | "a test in src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts injects a state store whose apply rejects the retention commit and asserts the HALT marker exists with class `needs-human`, `loop_halt` and `step_failed` are both emitted, and the conductor log contains a line naming the failed persist" | diff-local |
| Story 2 negative: Given a process crash between the halt marker write and the state commit, when the feature is next read, then the state is either the pre-halt state or the complete post-halt state (siblings `done` and the `failed` stamping together), never siblings `done` without the `failed` stamping. | 2 | "the same test asserts the retained `done` keys and the `failed` stamping arrive in one `commitStateChanges` call (one state-store apply observed between the HALT marker write and `loop_halt`), so a crash can never leave siblings `done` without the `failed` stamping" | diff-local |
| Story 3 happy: Given a halted feature whose state records two members `done` and one member not `done`, when the operator clears the HALT and the daemon re-dispatches, then the group round dispatches only the not-`done` member and, on its pass, joins all-green and continues the tail. | 6 | "a test in src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts seeds `conduct-state.json` with `prd_audit` and `architecture_review_as_built` `done` (bare and synthetic keys) and `manual_test` `failed`, clears the HALT, runs the conductor in auto mode, and asserts the step runner was invoked exactly once, for `manual_test`" | diff-local |
| Story 3 happy: Given the re-dispatched member throws once and passes on its next attempt within its resolved `max_retries` (the #2190 budget), when the join runs, then the round joins all-green with no halt. | 6 | "a second test lets the re-dispatched member throw once and pass on its next attempt and asserts two dispatches for that member and no `loop_halt`" | diff-local |
| Story 3 happy: Given the re-dispatched member passes, when the join commits, then every member is `done` and the group step is `done`, indistinguishable from a round in which all three passed together. | 6 | "a third test asserts the post-join `conduct-state.json` step statuses for the three members and their synthetic keys are identical to those produced by a run in which all three passed together" | diff-local |
| Story 3 negative: Given a retained `done` member, when a kickback to `build` occurs before the re-dispatch, then that member is restaged to `stale` and is dispatched again in the next group round. | 7 | "a test in src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts seeds a retained `done` member, applies a kickback to `build` through the existing skip-preserving restage helper, and asserts the member reads `stale` and is dispatched in the next group round" | diff-local |
| Story 3 negative: Given a retained `done` member, when the feature is rebased and the post-rebase invalidation flags that member's gate surface, then the member is restaged and dispatched again. | 8 | "a test in src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts seeds a retained `done` member, runs the post-rebase invalidation for a file-changing rebase that touches the member's gate surface, and asserts the member is restaged and dispatched in the next group round" | diff-local |
| Story 3 negative: Given a retained `done` member whose on-disk verdict no longer satisfies its gate at FINISH, when the finish publication fence runs, then that member is reported non-green and publication does not proceed. | 8 | "a test in src/conductor/test/engine/conductor-finish-publication.test.ts seeds a member `done` with an on-disk gate verdict that is unsatisfied at FINISH and asserts `nonGreenFinishValidators` reports that member and publication does not proceed" | diff-local |
| Story 3 negative: Given the re-dispatched member fails again after its full budget, when the join halts, then the previously retained members stay `done` and the halt names only the member that failed. | 7 | "a test where the re-dispatched member throws on every attempt asserts the previously retained members remain `done` after the second halt and the HALT body names only the failed member" | diff-local |

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic
