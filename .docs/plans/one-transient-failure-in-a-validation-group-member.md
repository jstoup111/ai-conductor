# Implementation Plan: One transient failure in a validation-group member discards its siblings

**Date:** 2026-09-06
**Design:** .docs/decisions/architecture-review-2026-09-06-one-transient-failure-in-a-validation-group-member.md
**Stories:** .docs/stories/one-transient-failure-in-a-validation-group-member.md
**Conflict check:** Clean as of 2026-09-06 (one cross-spec overlap resolved; see .docs/conflicts/one-transient-failure-in-a-validation-group-member.md)
**Source-Ref:** jstoup111/ai-conductor#1425
**Blocked by:** jstoup111/ai-conductor#2190 (delivers the branch retry budget; PR #2206)

## Summary

> **Amended 2026-09-11 by operator approval for #1425:** NC.3 is accepted with a required regression test: in auto mode, a single validator rechecked by the FINISH fence may retry thrown dispatch failures within its existing resolved budget when its siblings are already done. Publication remains blocked until valid passing evidence exists; exhaustion halts. Story 4 and Task 9 own this bounded extension. No unrelated serial step gains retries.

Make the auto-mode SHIP validation-group join persist the siblings that already passed when one member halts the group with `no-verdict`, so the operator's re-dispatch re-runs only the failed member. Eight tasks: one refactor, three retention tasks, one verification task, three re-dispatch tasks.

## Technical Approach

- **Where.** Everything lives in the built-in validation-group fan-out inside the auto-mode run loop in `src/conductor/src/engine/conductor.ts`: the `allGreen` computation, the `no-verdict` halt block that follows it, and the all-green join that writes member statuses. `group-core.ts` is not touched.
- **Retention predicate (C3).** The join already computes each passing member's objective gate verdict (`computeAndWriteVerdict` → `gateVerdicts`), the `manual_test` FAIL rows, and per-branch handshake failures before it checks for a `no-verdict` outcome. The predicate that decides "this member is truly satisfied this round" is the per-member body of `allGreen`. Task 1 lifts that body into a named per-index closure so the halt block and `allGreen` share one predicate. `inFlightGroupCompletions` (the dispatch-success side-channel used by the signal handlers) is NOT the source: it records `verdict:pass` on dispatch success alone.
- **One atomic commit (C1/C2).** The halt block keeps its order — `writeHaltMarker` first — and then makes ONE `commitStateChanges` call carrying, for every retained member, both its bare key and its synthetic `validation__<member>` key as `done` (the same two keys the all-green join writes) plus the pre-existing `failed`/`last_step` stamping. The state mutation port applies a batch atomically, so there is no window where siblings are `done` without the `failed` stamping. A rejected commit is caught and logged in the shape of `persistSignalCompletionsBestEffort`; `loop_halt` and a terminal `parallel_failure` whose `branch` names the failed member still fire.
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
1. Write failing test in `src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts`: construct the conductor with a state store whose `apply` rejects the halt-block commit; run with a throwing member; assert the HALT marker and `HALT.class` (`needs-human`) exist, `loop_halt` and a terminal `parallel_failure` whose `branch` names the failed member were emitted, and the captured log contains a line naming the failed persist.
2. Verify RED (today the rejection propagates out of the block).
3. Implement: wrap the single commit in a catch that logs via the conductor's logger in the `persistSignalCompletionsBestEffort` shape and continues to `emitLoopHalt` / the terminal `parallel_failure`.
4. Verify GREEN.
5. Commit: "fix(conductor): a failed retention commit still halts the validation group".

**Done when:**
- a test in src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts injects a state store whose apply rejects the retention commit and asserts the HALT marker exists with class `needs-human`, `loop_halt` and a terminal `parallel_failure` whose `branch` names the failed member are both emitted, and the conductor log contains a line naming the failed persist
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
2. Add one test in `src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts` with two passing siblings and one always-throwing member asserting zero `kickback` events, no `.pipeline/remediation.json`, `HALT.class` `needs-human`, and both `loop_halt` and a terminal `parallel_failure` whose `branch` names the failed member.
3. Locate the daemon's HALT-marker resume-gate test (search `HALT` in `src/conductor/test/daemon-*.test.ts`) and cite it as the proof that an uncleared HALT is not re-dispatched.
4. Commit: "test(conductor): validation-group no-verdict halt semantics are unchanged by retention".

**Done when:**
- `npx vitest run src/conductor/test/acceptance/parallel-validation-phase-fan-out-manual-test-prd-.acceptance.test.ts` passes, including the flow-B test (siblings still dispatch, no `remediate` call) and the `classifies a validation-group no-verdict as needs-human` test
- a test in src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts with two passing siblings and one always-throwing member asserts zero `kickback` events, no `.pipeline/remediation.json`, `HALT.class` equal to `needs-human`, and both `loop_halt` and a terminal `parallel_failure` whose `branch` names the failed member emitted
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

### Task 9: Prove bounded FINISH-fence retries preserve the publication gate
**Story:** 4
**Type:** happy-path
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/conductor-finish-publication.test.ts, README.md, docs/guides/running-the-daemon.md
**Dependencies:** 6, 8

**Steps:**
1. Extend the existing finish-publication fixture through the real FINISH fence and serial retry path. Seed satisfied sibling evidence and done bare/synthetic keys, make one validator's evidence non-green, and start at FINISH so the fence itself restages that validator. Inject the runner and publication adapter; no real provider or GitHub call is permitted.
2. For the transient case, make that validator throw once and then write valid passing evidence. Assert dispatches stay within its resolved retry budget, satisfied siblings are not repeated, and publication is never invoked before the valid evidence passes.
3. Add the always-throwing case: assert the exact configured attempt bound, a halt, and zero publication calls. Add or reuse sufficient proof that a success result without valid evidence cannot authorize publication. Bound fixture execution at its publication observation or terminal halt and await cleanup; never use a timeout as the termination mechanism.
4. Correct the retry guard's comment that currently excludes FINISH-fence rechecks. If the new regression exposes a defect, repair only this authorized single-member validation path, preserving retry budgets, other serial exception routing, and objective publication gates. Do not describe source-inferred behavior as tested until these cases run; existing behavior may already satisfy the tests.
5. Update README and the existing daemon guide to describe bounded final-validation crash retries and continued publication gating. Run affected tests through `ai-conductor scoped-run` and the configured typecheck covering tests; commit the bounded repair and its proof.

**Done when:**
1. A FINISH-fence regression test proves a single crashing recheck retries within its configured budget, retains completed siblings, and reaches publication only after valid passing evidence.
2. An always-throwing recheck exhausts its configured budget, halts, and never invokes publication.
3. A successful runner result without valid passing evidence never authorizes publication.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — align retry comment and, only if regression proof requires it, repair the authorized single-member validation path
- src/conductor/test/engine/conductor-finish-publication.test.ts — real fence/retry/publication boundary with injected external adapters
- README.md — operator-visible retry behavior
- docs/guides/running-the-daemon.md — final validation retry behavior and publication requirement

## Task Dependency Graph

> **Amended 2026-09-11 by operator approval for #1425:** NC.3 is accepted with a required regression test: in auto mode, a single validator rechecked by the FINISH fence may retry thrown dispatch failures within its existing resolved budget when its siblings are already done. Publication remains blocked until valid passing evidence exists; exhaustion halts. Story 4 and Task 9 own this bounded extension. No unrelated serial step gains retries.

Task 6 -> Task 9
Task 8 -> Task 9

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
| Story 1 happy: Given a member throws on every attempt up to its resolved `max_retries`, when the join runs, then the loop writes a `needs-human` HALT whose reason names the failed member and its no-verdict reason, records the same `failed`/`last_step` stamping it records today, and emits `loop_halt` and a terminal `parallel_failure` whose `branch` names the failed member. | 5 | "`npx vitest run src/conductor/test/acceptance/parallel-validation-phase-fan-out-manual-test-prd-.acceptance.test.ts` passes, including the flow-B test (siblings still dispatch, no `remediate` call) and the `classifies a validation-group no-verdict as needs-human` test" | diff-local |
| Story 1 happy: Given a member's runner is dead in this way, when its siblings are already in flight, then the siblings still run to their own outcomes before the join halts (no cancellation). | 5 | "`npx vitest run src/conductor/test/acceptance/parallel-validation-phase-fan-out-manual-test-prd-.acceptance.test.ts` passes, including the flow-B test (siblings still dispatch, no `remediate` call) and the `classifies a validation-group no-verdict as needs-human` test" | diff-local |
| Story 1 negative: Given a member settles as `no-verdict`, when the join runs, then no `remediation.json` is synthesized and no `kickback` event is emitted for that round. | 5 | "a test in src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts with two passing siblings and one always-throwing member asserts zero `kickback` events, no `.pipeline/remediation.json`, `HALT.class` equal to `needs-human`, and both `loop_halt` and a terminal `parallel_failure` whose `branch` names the failed member emitted" | diff-local |
| Story 1 negative: Given a member settles as `no-verdict`, when the halt is written, then the halt class is `needs-human`, not `mechanical`, regardless of how many siblings passed. | 5 | "a test in src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts with two passing siblings and one always-throwing member asserts zero `kickback` events, no `.pipeline/remediation.json`, `HALT.class` equal to `needs-human`, and both `loop_halt` and a terminal `parallel_failure` whose `branch` names the failed member emitted" | diff-local |
| Story 1 negative: Given the operator has not cleared the HALT, when the daemon's next scan reaches the feature, then the feature is not re-dispatched. | 5 | "the daemon's existing HALT-marker resume gate test (`src/conductor/test/daemon-resume-gate.test.ts` or its current equivalent) is cited by name in the task's evidence trailer as the proof that an uncleared HALT is not re-dispatched" | diff-local |
| Story 2 happy: Given `prd_audit` and `architecture_review_as_built` produced `verdict: pass` outcomes with satisfied objective gate verdicts and `manual_test` settled as `no-verdict`, when the join halts, then `conduct-state.json` records `prd_audit` and `architecture_review_as_built` as `done` (both their bare keys and their synthetic group-member keys) in the same commit that records the halt's `failed` stamping. | 2 | "a test in src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts drives an auto-mode run where `manual_test` throws on every attempt and `prd_audit`/`architecture_review_as_built` pass with satisfied gate verdicts, and asserts `conduct-state.json` afterward has `prd_audit`, `architecture_review_as_built`, `validation__prd_audit`, and `validation__architecture_review_as_built` all `done` together with the pre-existing `failed` and `last_step` stamping" | diff-local |
| Story 2 happy: Given the halt is written with retained siblings, when an operator inspects `conduct-state.json` after the halt, then the HALT marker, its `needs-human` class, and `last_step` are exactly what they were before this change. | 2 | "the same test asserts the HALT marker body names `manual_test` and its no-verdict reason, `HALT.class` is `needs-human`, and `last_step` equals its pre-change value" | diff-local |
| Story 2 negative: Given a member's dispatch succeeded but the join's objective gate verdict for it is unsatisfied, when a sibling halts the group, then that member is NOT recorded `done`. | 3 | "a test in src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts where `prd_audit` passes dispatch but its objective gate verdict is unsatisfied asserts `prd_audit` and `validation__prd_audit` are not `done` after the halt" | diff-local |
| Story 2 negative: Given `manual_test` dispatched successfully but its results file carries FAIL rows, when a sibling halts the group, then `manual_test` is NOT recorded `done`. | 3 | "a test where `manual_test` passes dispatch with FAIL rows in `.pipeline/manual-test-results.md` while `prd_audit` throws asserts `manual_test` is not `done` after the halt" | diff-local |
| Story 2 negative: Given a member's dispatch succeeded but its verdict-run-identity handshake failed, when a sibling halts the group, then that member is NOT recorded `done`. | 3 | "a test where a passing member's verdict-run-identity handshake fails asserts that member is not `done` after the halt" | diff-local |
| Story 2 negative: Given the member that produced `no-verdict`, when the halt commits, then that member's status is not `done` and its synthetic group-member key is not `done`. | 3 | "every retention test asserts the no-verdict member and its synthetic group-member key are not `done`" | diff-local |
| Story 2 negative: Given the state commit that would retain siblings throws, when the join halts, then the HALT marker is still written, `loop_halt` and a terminal `parallel_failure` whose `branch` names the failed member are still emitted, and the failure to persist is logged loudly. | 4 | "a test in src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts injects a state store whose apply rejects the retention commit and asserts the HALT marker exists with class `needs-human`, `loop_halt` and a terminal `parallel_failure` whose `branch` names the failed member are both emitted, and the conductor log contains a line naming the failed persist" | diff-local |
| Story 2 negative: Given a process crash between the halt marker write and the state commit, when the feature is next read, then the state is either the pre-halt state or the complete post-halt state (siblings `done` and the `failed` stamping together), never siblings `done` without the `failed` stamping. | 2 | "the same test asserts the retained `done` keys and the `failed` stamping arrive in one `commitStateChanges` call (one state-store apply observed between the HALT marker write and `loop_halt`), so a crash can never leave siblings `done` without the `failed` stamping" | diff-local |
| Story 3 happy: Given a halted feature whose state records two members `done` and one member not `done`, when the operator clears the HALT and the daemon re-dispatches, then the group round dispatches only the not-`done` member and, on its pass, joins all-green and continues the tail. | 6 | "a test in src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts seeds `conduct-state.json` with `prd_audit` and `architecture_review_as_built` `done` (bare and synthetic keys) and `manual_test` `failed`, clears the HALT, runs the conductor in auto mode, and asserts the step runner was invoked exactly once, for `manual_test`" | diff-local |
| Story 3 happy: Given the re-dispatched member throws once and passes on its next attempt within its resolved `max_retries` (the #2190 budget), when the join runs, then the round joins all-green with no halt. | 6 | "a second test lets the re-dispatched member throw once and pass on its next attempt and asserts two dispatches for that member and no `loop_halt`" | diff-local |
| Story 3 happy: Given the re-dispatched member passes, when the join commits, then every member is `done` and the group step is `done`, indistinguishable from a round in which all three passed together. | 6 | "a third test asserts the post-join `conduct-state.json` step statuses for the three members and their synthetic keys are identical to those produced by a run in which all three passed together" | diff-local |
| Story 3 negative: Given a retained `done` member, when a kickback to `build` occurs before the re-dispatch, then that member is restaged to `stale` and is dispatched again in the next group round. | 7 | "a test in src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts seeds a retained `done` member, applies a kickback to `build` through the existing skip-preserving restage helper, and asserts the member reads `stale` and is dispatched in the next group round" | diff-local |
| Story 3 negative: Given a retained `done` member, when the feature is rebased and the post-rebase invalidation flags that member's gate surface, then the member is restaged and dispatched again. | 8 | "a test in src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts seeds a retained `done` member, runs the post-rebase invalidation for a file-changing rebase that touches the member's gate surface, and asserts the member is restaged and dispatched in the next group round" | diff-local |
| Story 3 negative: Given a retained `done` member whose on-disk verdict no longer satisfies its gate at FINISH, when the finish publication fence runs, then that member is reported non-green and publication does not proceed. | 8 | "a test in src/conductor/test/engine/conductor-finish-publication.test.ts seeds a member `done` with an on-disk gate verdict that is unsatisfied at FINISH and asserts `nonGreenFinishValidators` reports that member and publication does not proceed" | diff-local |
| Story 3 negative: Given the re-dispatched member fails again after its full budget, when the join halts, then the previously retained members stay `done` and the halt names only the member that failed. | 7 | "a test where the re-dispatched member throws on every attempt asserts the previously retained members remain `done` after the second halt and the HALT body names only the failed member" | diff-local |

| Story 4 happy: Given the FINISH fence rechecks one validator while its siblings remain done, when that validator throws once and then supplies valid passing evidence within its existing retry budget, then only that validator is retried and publication is reached only after its evidence passes. | 9 | "A FINISH-fence regression test proves a single crashing recheck retries within its configured budget, retains completed siblings, and reaches publication only after valid passing evidence." | diff-local |
| Story 4 negative: Given the FINISH fence rechecks one validator that throws on every attempt, when its existing retry budget is exhausted, then the run halts and publication is never invoked. | 9 | "An always-throwing recheck exhausts its configured budget, halts, and never invokes publication." | diff-local |
| Story 4 negative: Given a FINISH-fence recheck returns success without valid passing evidence, when publication is considered, then publication remains blocked. | 9 | "A successful runner result without valid passing evidence never authorizes publication." | diff-local |

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic

## Verify-Claims Ledger — operator amendment — 2026-09-11

- [verified] The FINISH fence marks a non-green validator stale and returns to its dispatch; the serial exception guard checks for done sibling synthetic keys (`conductor.ts`, current source).
- [verified] The guard comment excludes FINISH-fence rechecks, contradicting the approved extension.
- [inferred, 80%] That source path retries thrown rechecks; the audit did not execute this case. Task 9 must establish the actual behavior and repair it if needed.
- Confirmed input: operator approved bounded retries with regression proof that publication stays blocked until validation passes. No pending load-bearing assumption: passing this proof is required, not presumed.

### Task rem-as-built-rem-ab1-1: src/conductor/src/engine/conductor.ts:7612-7622 — in the validation-group no-verdict branch, after emitLoopHalt and in place of the former `step_failed`, emitTracked a terminal `parallel_failure` { step: step.name, branch: noVerdictMember.name, error: haltReason } so EventPersister closes `parallel:<entry>` with its activeInterval; keep `loop_halt` exactly as Tasks 4 and 5 require; no group-level `step_failed` is emitted (story amended 2026-09-14)
**Gate:** as-built
**Rationale:** REMEDIABLE, conforming implementation drift under APPROVED adr-2026-08-12-execution-lifecycle-completeness-for-timing D1 (confidence 97%, verified): the no-verdict route opens `parallel_started` at src/conductor/src/engine/conductor.ts:7226-7230 but emits only `step_failed` at :7613-7622, which EventPersister (event-persister.ts:89-108,124-139) and computeTimingRollup (timing-rollup.ts:61-76) both classify as a step terminal, so the persisted `parallel:<entry>` interval never closes; the fix is determinable from the evidence (emit the existing terminal `parallel_failure` shape that already closes the group at :7840 and in closeOpenExecutions at :2124-2129) and needs no architecture decision, so `build` rather than `architecture_review`. No active-plan task's Done when admits a group lifecycle terminal (Tasks 2, 4 and 5 require only `loop_halt` + `step_failed`), so this is new build work, not `existing-task`. Regression guard: Task 4 and Task 5 Done-when coverage (`loop_halt` and exactly one `step_failed` still emitted, HALT class needs-human, zero kickback) must survive and their assertions at the acceptance test :156 and :191 are kept unchanged. Orphan sweep: once the group closes via `parallel_failure`, the branch-added validation fallback in emitExecutionEvent (conductor.ts:2028-2034, commits 08d5124fe/2621f4a43) is no longer reached by any path — no other group-block exit emits `step_failed` — so it is reverted to the pre-branch `step:${event.step}` key in the same task, and the conductor.test.ts 'does not let %s close a non-validation parallel execution' test stays as its coverage. Found-and-excluded siblings: the prd-audit projection-halt, plan-gap-halt and over-scope-halt exits (conductor.ts:7630-7666) and the as-built needs-human halt (:7880-7895) also return without a group terminal, but they are pre-existing, untouched by this feature, and admitted by no plan task, so they are not repaired here.
**Governing clause:** adr-2026-08-12-execution-lifecycle-completeness-for-timing decision 1
**Done when:**
- adr-2026-08-12-execution-lifecycle-completeness-for-timing decision 1 is satisfied by this task.

### Task rem-as-built-rem-ab1-2: src/conductor/src/engine/conductor.ts:2028-2034 — revert the now-orphaned validation fallback in emitExecutionEvent's terminalKey so `step_completed`/`step_failed` select `step:${event.step}` again; keep the conductor.test.ts 'does not let %s close a non-validation parallel execution' test green unchanged
**Gate:** as-built
**Rationale:** REMEDIABLE, conforming implementation drift under APPROVED adr-2026-08-12-execution-lifecycle-completeness-for-timing D1 (confidence 97%, verified): the no-verdict route opens `parallel_started` at src/conductor/src/engine/conductor.ts:7226-7230 but emits only `step_failed` at :7613-7622, which EventPersister (event-persister.ts:89-108,124-139) and computeTimingRollup (timing-rollup.ts:61-76) both classify as a step terminal, so the persisted `parallel:<entry>` interval never closes; the fix is determinable from the evidence (emit the existing terminal `parallel_failure` shape that already closes the group at :7840 and in closeOpenExecutions at :2124-2129) and needs no architecture decision, so `build` rather than `architecture_review`. No active-plan task's Done when admits a group lifecycle terminal (Tasks 2, 4 and 5 require only `loop_halt` + `step_failed`), so this is new build work, not `existing-task`. Regression guard: Task 4 and Task 5 Done-when coverage (`loop_halt` and exactly one `step_failed` still emitted, HALT class needs-human, zero kickback) must survive and their assertions at the acceptance test :156 and :191 are kept unchanged. Orphan sweep: once the group closes via `parallel_failure`, the branch-added validation fallback in emitExecutionEvent (conductor.ts:2028-2034, commits 08d5124fe/2621f4a43) is no longer reached by any path — no other group-block exit emits `step_failed` — so it is reverted to the pre-branch `step:${event.step}` key in the same task, and the conductor.test.ts 'does not let %s close a non-validation parallel execution' test stays as its coverage. Found-and-excluded siblings: the prd-audit projection-halt, plan-gap-halt and over-scope-halt exits (conductor.ts:7630-7666) and the as-built needs-human halt (:7880-7895) also return without a group terminal, but they are pre-existing, untouched by this feature, and admitted by no plan task, so they are not repaired here.
**Governing clause:** adr-2026-08-12-execution-lifecycle-completeness-for-timing decision 1
**Done when:**
- adr-2026-08-12-execution-lifecycle-completeness-for-timing decision 1 is satisfied by this task.

### Task rem-as-built-rem-ab1-3: src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts — add a no-verdict halt test wired to a real EventPersister on a temp events.jsonl (pattern: loop-halt-reaches-persisted-spine.acceptance.test.ts) asserting exactly one terminal `parallel_failure` for the entry carrying `activeInterval`, zero `step_failed`, and computeTimingRollup reporting no open executions for that ledger
**Gate:** as-built
**Rationale:** REMEDIABLE, conforming implementation drift under APPROVED adr-2026-08-12-execution-lifecycle-completeness-for-timing D1 (confidence 97%, verified): the no-verdict route opens `parallel_started` at src/conductor/src/engine/conductor.ts:7226-7230 but emits only `step_failed` at :7613-7622, which EventPersister (event-persister.ts:89-108,124-139) and computeTimingRollup (timing-rollup.ts:61-76) both classify as a step terminal, so the persisted `parallel:<entry>` interval never closes; the fix is determinable from the evidence (emit the existing terminal `parallel_failure` shape that already closes the group at :7840 and in closeOpenExecutions at :2124-2129) and needs no architecture decision, so `build` rather than `architecture_review`. No active-plan task's Done when admits a group lifecycle terminal (Tasks 2, 4 and 5 require only `loop_halt` + `step_failed`), so this is new build work, not `existing-task`. Regression guard: Task 4 and Task 5 Done-when coverage (`loop_halt` and exactly one `step_failed` still emitted, HALT class needs-human, zero kickback) must survive and their assertions at the acceptance test :156 and :191 are kept unchanged. Orphan sweep: once the group closes via `parallel_failure`, the branch-added validation fallback in emitExecutionEvent (conductor.ts:2028-2034, commits 08d5124fe/2621f4a43) is no longer reached by any path — no other group-block exit emits `step_failed` — so it is reverted to the pre-branch `step:${event.step}` key in the same task, and the conductor.test.ts 'does not let %s close a non-validation parallel execution' test stays as its coverage. Found-and-excluded siblings: the prd-audit projection-halt, plan-gap-halt and over-scope-halt exits (conductor.ts:7630-7666) and the as-built needs-human halt (:7880-7895) also return without a group terminal, but they are pre-existing, untouched by this feature, and admitted by no plan task, so they are not repaired here.
**Governing clause:** adr-2026-08-12-execution-lifecycle-completeness-for-timing decision 1
**Done when:**
- adr-2026-08-12-execution-lifecycle-completeness-for-timing decision 1 is satisfied by this task.

### Task rem-as-built-rem-ab2-1: src/conductor/src/engine/conductor.ts:9081-9102 and :12287-12297 — extract one private helper (auto mode AND the built-in validation group has another member whose `validation__<member>` is `done`) from the retry wrapper's inline retainedSiblingExists guard, use it in that wrapper unchanged in behavior, and gate the width-one synthetic `validation__<member>` completion write on the same helper so non-auto serial validation writes only the bare key
**Gate:** as-built
**Rationale:** REMEDIABLE, conforming implementation drift under APPROVED adr-2026-07-10-validation-group-join D1 and its 2026-09-11 amendment plus the auto-mode addendum (confidence 98%, verified): the width-one completion block at src/conductor/src/engine/conductor.ts:12287-12297 writes `validation__<member> = done` whenever getGroupForStep maps the step (steps.ts:344-373), with no `this.mode === 'auto'` or retained-sibling check, so interactive/default foreground runs (index.ts:1535-1545) acquire durable group state the ADR leaves untouched; the correct scope is already stated verbatim by the amendment and already implemented by the retry wrapper's guard at :9081-9102, so no architecture decision is needed and `build` applies. No active-plan Done when admits the non-auto restriction (Task 6 only requires the synthetic keys in the auto redispatch), so this is new build work. Matched pair: the retry wrapper's inline `retainedSiblingExists` predicate (:9084-9095) and the completion write must agree on the same exception, so both are derived from one helper in the same task rather than duplicating the predicate. Regression guard: Task 6's auto-mode redispatch coverage (acceptance test :349-369 asserting `validation__manual_test` done, and the S3.3 fresh-run equivalence comparison at :307-339) and Task 9's FINISH-fence retry proof (conductor-finish-publication.test.ts:241-380) must stay green unchanged, since both run in auto mode with retained siblings. Sweep: no other site writes a `validation__*` key outside the width-2+ join (:7681-7694) and the no-verdict retention commit (:7591-7606), both of which are already auto-only group paths.
**Governing clause:** adr-2026-07-10-validation-group-join decision 1
**Done when:**
- adr-2026-07-10-validation-group-join decision 1 is satisfied by this task.

### Task rem-as-built-rem-ab2-2: src/conductor/test/engine/conductor-finish-publication.test.ts — add an it.each over interactive and default foreground modes that completes a serial validation member successfully and asserts no `validation__*` key is written to conduct-state.json, plus an auto-mode case with no retained sibling asserting the same; keep the existing auto retained-sibling redispatch and FINISH-fence retry assertions unchanged
**Gate:** as-built
**Rationale:** REMEDIABLE, conforming implementation drift under APPROVED adr-2026-07-10-validation-group-join D1 and its 2026-09-11 amendment plus the auto-mode addendum (confidence 98%, verified): the width-one completion block at src/conductor/src/engine/conductor.ts:12287-12297 writes `validation__<member> = done` whenever getGroupForStep maps the step (steps.ts:344-373), with no `this.mode === 'auto'` or retained-sibling check, so interactive/default foreground runs (index.ts:1535-1545) acquire durable group state the ADR leaves untouched; the correct scope is already stated verbatim by the amendment and already implemented by the retry wrapper's guard at :9081-9102, so no architecture decision is needed and `build` applies. No active-plan Done when admits the non-auto restriction (Task 6 only requires the synthetic keys in the auto redispatch), so this is new build work. Matched pair: the retry wrapper's inline `retainedSiblingExists` predicate (:9084-9095) and the completion write must agree on the same exception, so both are derived from one helper in the same task rather than duplicating the predicate. Regression guard: Task 6's auto-mode redispatch coverage (acceptance test :349-369 asserting `validation__manual_test` done, and the S3.3 fresh-run equivalence comparison at :307-339) and Task 9's FINISH-fence retry proof (conductor-finish-publication.test.ts:241-380) must stay green unchanged, since both run in auto mode with retained siblings. Sweep: no other site writes a `validation__*` key outside the width-2+ join (:7681-7694) and the no-verdict retention commit (:7591-7606), both of which are already auto-only group paths.
**Governing clause:** adr-2026-07-10-validation-group-join decision 1
**Done when:**
- adr-2026-07-10-validation-group-join decision 1 is satisfied by this task.

### Task rem-as-built-rem-ab3-1: src/conductor/src/engine/conductor.ts:9117-9129 and :12319-12329 — delete the unreachable retained-sibling catch branch (restore the plain rethrow) and the width-one synthetic validation__<member> completion write with their comments; keep hasRetainedValidationSibling for the :7243-7246 group-entry guard; Task 6, Task 9 and rem-as-built-rem-ab2-2 tests stay green unchanged, and any test that reached a deleted branch only through non-production construction is re-pointed to the group path in this task with its assertions kept
**Gate:** as-built
**Rationale:** REMEDIABLE implementation drift, confidence 98% verified: the exception-to-retry adapter at src/conductor/src/engine/conductor.ts:9117-9129 and the synthetic completion write at :12319-12329 both require hasRetainedValidationSibling, but the group-entry guard at :7243-7246 diverts every production state satisfying that predicate into the group branch (retry via group-core.ts:543-585, completion at conductor.ts:7721-7737), so neither serial branch is reachable; the correct fix is to remove them, and no architecture decision is involved. No active-plan Done when admits the removal: rem-as-built-rem-ab2-1 introduced the gating, so restaging it would recreate the dead code. Regression guard: Task 6 redispatch and throw-once-then-pass coverage, Task 9 FINISH-fence bounded-retry and publication-gate coverage (conductor-finish-publication.test.ts), and rem-as-built-rem-ab2-2's no-validation__-key serial assertions all run through or assert against the group path and must stay green unchanged. Orphan sweep: hasRetainedValidationSibling stays because the :7243-7246 guard still calls it; the two serial-path comments that describe the removed behavior (above :9111 and :12310-12318) go in the same task. Found and excluded: the non-blocking internal-flow drift in the feature component and sequence diagrams is not admitted by any plan task and is not repaired here.
**Governing clause:** Task rem-as-built-rem-ab2-1
**Parent task:** rem-as-built-rem-ab2-1
**Done when:**
- Task rem-as-built-rem-ab2-1 is satisfied by this task.

### Task rem-as-built-rem-ab4-1: src/conductor/src/engine/conductor.ts:8404-8410 — in the validation-group finally, before removePhaseMarker, emit one terminal parallel_failure { step: step.name, branch: 'conductor', error: 'validation group round exited without a join terminal' } through emitExecutionEvent when openExecutions still holds parallel:<step.name> and closingExecutions does not, so every halt exit listed in AB-4 closes the group exactly once and the no-verdict, as-built and all-green terminals are never duplicated
**Gate:** as-built
**Rationale:** REMEDIABLE conforming drift under APPROVED adr-2026-08-12-execution-lifecycle-completeness-for-timing decision 1, confidence 98% verified: the retained width-one guard at src/conductor/src/engine/conductor.ts:7243-7246 opens parallel_started at :7265-7269, but the auth-park (:7417-7426), cached-login (:7448-7466), permission-denial (:7474-7497), PRD-audit projection/PLAN_GAP/OVER_SCOPE (:7666-7701), validation-gap/remediation-decision (:8253-8264, :8328-8337) and manual-test no-op/cap (:8062-8064 via :6663-6673, :6716-6726) exits return without parallel_completed or terminal parallel_failure, and the group finalizer at :8404-8410 only clears the phase marker. The ADR is not in conflict and the terminal shape already exists (closeOpenExecutions :2134-2139), so this is build, not architecture_review. Close the class at one site: the finalizer emits one terminal parallel_failure when parallel:<entry> is still open and not already closing, so every listed exit is covered and already-terminated routes (no-verdict :7653-7658, as-built :7875-7881, all-green :7733-7737) are not duplicated. The same finalizer necessarily closes the identical width-2+ exits; that is one mechanism, not a separate widening. No active-plan Done when admits a group terminal on these exits (rem-as-built-rem-ab1-1 covers only the no-verdict branch), so this is new work, not existing-task. Regression guard: rem-as-built-rem-ab1-1 and rem-as-built-rem-ab1-3 coverage (exactly one terminal parallel_failure naming the failed member, loop_halt kept) and Task 4/5 halt-semantics coverage must stay green unchanged.
**Governing clause:** adr-2026-08-12-execution-lifecycle-completeness-for-timing decision 1
**Done when:**
- adr-2026-08-12-execution-lifecycle-completeness-for-timing decision 1 is satisfied by this task.

### Task rem-as-built-rem-ab4-2: src/conductor/test/acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts — add an it.each over retained width-one rounds (prd_audit and architecture_review_as_built done, manual_test restaged) that exit through permission denial, a PLAN_GAP halt and the manual-test cap, wired to a real EventPersister on a temp events.jsonl, asserting exactly one terminal parallel_failure for parallel:<entry> carrying activeInterval and computeTimingRollup reporting no open executions; add one assertion that the no-verdict and all-green rounds still emit exactly one group terminal; keep the rem-as-built-rem-ab1-3 persisted-spine test unchanged
**Gate:** as-built
**Rationale:** REMEDIABLE conforming drift under APPROVED adr-2026-08-12-execution-lifecycle-completeness-for-timing decision 1, confidence 98% verified: the retained width-one guard at src/conductor/src/engine/conductor.ts:7243-7246 opens parallel_started at :7265-7269, but the auth-park (:7417-7426), cached-login (:7448-7466), permission-denial (:7474-7497), PRD-audit projection/PLAN_GAP/OVER_SCOPE (:7666-7701), validation-gap/remediation-decision (:8253-8264, :8328-8337) and manual-test no-op/cap (:8062-8064 via :6663-6673, :6716-6726) exits return without parallel_completed or terminal parallel_failure, and the group finalizer at :8404-8410 only clears the phase marker. The ADR is not in conflict and the terminal shape already exists (closeOpenExecutions :2134-2139), so this is build, not architecture_review. Close the class at one site: the finalizer emits one terminal parallel_failure when parallel:<entry> is still open and not already closing, so every listed exit is covered and already-terminated routes (no-verdict :7653-7658, as-built :7875-7881, all-green :7733-7737) are not duplicated. The same finalizer necessarily closes the identical width-2+ exits; that is one mechanism, not a separate widening. No active-plan Done when admits a group terminal on these exits (rem-as-built-rem-ab1-1 covers only the no-verdict branch), so this is new work, not existing-task. Regression guard: rem-as-built-rem-ab1-1 and rem-as-built-rem-ab1-3 coverage (exactly one terminal parallel_failure naming the failed member, loop_halt kept) and Task 4/5 halt-semantics coverage must stay green unchanged.
**Governing clause:** adr-2026-08-12-execution-lifecycle-completeness-for-timing decision 1
**Done when:**
- adr-2026-08-12-execution-lifecycle-completeness-for-timing decision 1 is satisfied by this task.
