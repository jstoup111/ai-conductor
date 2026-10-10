# Implementation Plan: Validation-group member with a stale verdict artifact re-dispatches instead of remediating

**Date:** 2026-10-09
**Design:** none (technical track, Tier S — see `.docs/track/validation-group-member-with-a-stale-verdict-artif.md`)
**Stories:** .docs/stories/validation-group-member-with-a-stale-verdict-artif.md
**Conflict check:** Not required (Tier S)

## Summary

Make the SHIP validation group honor adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity D5
("a missing or prior-identity artifact is scored `absent` → rerun within the existing step-retry
budget; on exhaustion the halt is `needs-human` and carries the artifact and identities"). Today the
group path runs the post-dispatch handshake only after the branch has already settled `verdict:
pass`, so a handshake failure becomes an unsatisfied gate and is routed into gap remediation. Four
tasks: a verification hook in the branch attempt loop, the validation-group wiring that feeds the
existing handshake into it, the exhaustion halt, and the preserved genuine-failure and
verification-off paths.

## Technical Approach

- **Verified current behavior (local main `e6b56fe3da`).**
  - `runGroupBranchInner` (`src/conductor/src/engine/group-core.ts`, the `if (result.success)` arm) returns `makeVerdictOutcome("pass", …)` on the first successful runner result. Nothing there inspects the verdict artifact.
  - The validation group's `onMemberEvent` handler (`src/conductor/src/engine/conductor.ts`, the `event.phase === 'result'` arm inside `dispatchGroupRound`) calls `stampVerdictRunIdentity` then `verdictDispatchHandshake` and stores any failure in `branchHandshakeFailures`. That handler runs from `runGroupBranch`'s single exit point, after the outcome is already final.
  - At the join, a `verdict: pass` member with a recorded handshake failure gets `{ satisfied: false, reason: handshake.reason }` as its gate verdict. It is not `no-verdict`, so it skips the no-verdict halt and falls through to the remediation paths. That is the #2553 failure.
  - `verdictDispatchHandshake` returns `undefined` on success. Every non-`undefined` return carries `routeClass: 'absent'`, for all three steps and also in its `catch` arm. `classifyRetryDecision` (`src/conductor/src/engine/artifacts.ts`) already maps `absent` to `rerun` on the serial path.
- **Selected design (approach B in the track marker).** Add an optional dependency to `BranchExecutorDeps`: `verifyDispatch?: (result: StepRunResult, attempt: number) => Promise<string | undefined>`. In `runGroupBranchInner`, when `result.success` is true and there is no deterministic fault, call `verifyDispatch` before returning `verdict: pass`.
  - `undefined` → return `verdict: pass` as today.
  - A string → an ordinary failed attempt. Set `lastOutput` to that string and call `onRetry` when `attempt < maxRetries`, then `continue`, exactly as the generic `success: false` path does.
  - The hook throws → treat it the same way, using the error message, the way a runner throw is treated.
  - Budget exhaustion falls out as the existing `makeNoVerdictOutcome(lastOutput || "retries exhausted", …)`.
  - This keeps one attempt budget (the member's resolved `max_retries` passed in as `maxRetries`), so runner failures and handshake failures share it.
- **Pattern-source:** the existing `success: false` tail of `runGroupBranchInner` (`lastOutput = …; if (attempt < maxRetries) onRetry(...)`). Reuse it rather than adding a second retry shape. Rate-limit, auth, park, and permission handling are untouched: they key on unsuccessful results, and the hook runs only on success.
- **Conductor wiring.**
  - In the validation group's `runGroupBranch` deps (not the DSL `runParallelGroupViaCore` path, which is out of scope), pass `verifyDispatch` for members where `isVerdictRunIdentityStep(member.name)` holds.
  - The hook runs, for the success path, `stampVerdictRunIdentity(member, branchRunIds.get(member))` then `verdictDispatchHandshake(member, branchRunIds.get(member), branchDispatchStartedAt.get(member), result.output)`. It sets or deletes `branchHandshakeFailures` as today. The `result` event arm keeps the same stamp-and-handshake observation for every non-`verdict: pass` terminal outcome, so D3's "observation on every terminal outcome" is preserved.
  - It returns `handshake.reason` only when `this.verifyArtifacts` is true and the handshake is non-`undefined`; otherwise it returns `undefined`. Verification-off (mocked-dispatch) mode therefore keeps today's dispatch-success-only semantics, matching `memberSatisfiedAtJoin`'s existing `verifyArtifacts` gate.
  - `branchDispatchStartedAt` is already reset on every `dispatch` phase event, so each retry gets its own freshness floor.
  - The branch run id stays one per member per round. This is safe: the engine stamps the sidecar itself, the generic path's freshness is the per-dispatch mtime floor, and the typed `prd_audit`/as-built results are accepted only when present and complete for that id. A retry therefore cannot be blessed by an earlier attempt's incomplete output.
- **Telemetry stays on the spine.** No new event variant (`.agents/skills/event-spine/SKILL.md`: this is not a new channel). The validation group's `onRetry` currently emits `step_retry` with `reason: 'group member <m> retry'`. When `branchHandshakeFailures` holds an entry for that member, it now emits `group member <m> retry: <handshake reason>`. That is an additive string on an existing field.
- **Join is unchanged.** A member that exhausts its budget now settles `no-verdict`. The join's existing no-verdict arm then:
  - writes the `needs-human` HALT `Validation group "<step>" halted: branch "<m>" produced no-verdict after <N> attempts (<handshake reason>).`;
  - stamps the member `failed`;
  - retains satisfied siblings (#1425);
  - emits `loop_halt` and `parallel_failure`;
  - and never reaches `planRemediation`.

  The join's existing `branchHandshakeFailures` guards stay as defense in depth.

## Prerequisites

- None.

## Tasks

### Task 1: Branch attempt loop consults a post-success verification hook
**Story:** Story 3 (negative path 2); foundation for Stories 1 and 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/group-core.test.ts` (new `describe("group-core: runGroupBranch post-success verification")`):
   - (a) A runner that succeeds twice, with `verifyDispatch` returning `'no current verdict'` then `undefined` and `maxRetries` 3, settles `verdict: pass` after exactly 2 runner calls and exactly 1 `onRetry` observation.
   - (b) `verifyDispatch` always returning `'no current verdict'` with `maxRetries` 2 settles `no-verdict` with reason `'no current verdict'` after exactly 2 runner calls.
   - (c) A runner returning `{ success: false }`, then success with `verifyDispatch` → `'no current verdict'`, then success with `undefined`, under `maxRetries` 2, settles `no-verdict` after exactly 2 runner calls. Runner failures and verification failures share one budget.
   - (d) `verifyDispatch` throwing `new Error('verify crashed')` on every attempt with `maxRetries` 1 settles `no-verdict` with reason `'verify crashed'` and does not reject.
   - (e) With no `verifyDispatch`, a successful runner settles `verdict: pass` after one call (unchanged).
2. Verify RED.
3. Implement: add the optional `verifyDispatch` member, with a doc comment, to `BranchExecutorDeps`. In `runGroupBranchInner`'s `if (result.success)` arm, await it inside try/catch before returning the pass outcome. On a string or a throw, set `lastOutput` and call `onRetry` when `attempt < maxRetries`, then `continue`. Follow the pattern of the existing `success: false` tail and do not add a second retry shape.
4. Verify GREEN; commit "feat(group-core): re-dispatch a branch whose successful dispatch fails verification".

**Done when:**
- [test] `group-core.test.ts` asserts that `runGroupBranch` with a `verifyDispatch` that fails once then passes settles `verdict: pass` after exactly two runner calls and one `onRetry` observation.
- [test] `group-core.test.ts` asserts that an always-failing `verifyDispatch` with `maxRetries` 2 settles `no-verdict` whose reason equals the hook's returned string after exactly two runner calls.
- [test] `group-core.test.ts` asserts that a runner failure followed by a verification failure under `maxRetries` 2 settles `no-verdict` after exactly two runner calls, so the total dispatches never exceed the single budget.
- [test] `group-core.test.ts` asserts that a throwing `verifyDispatch` settles `no-verdict` with the thrown message and the returned promise resolves rather than rejects, and that omitting `verifyDispatch` keeps the one-call `verdict: pass` result.

**Files likely touched:**
- `src/conductor/src/engine/group-core.ts` — `BranchExecutorDeps.verifyDispatch`; success-arm verification in `runGroupBranchInner`
- `src/conductor/test/engine/group-core.test.ts` — post-success verification cases

**Dependencies:** none

### Task 2: Validation group feeds the verdict handshake into the branch and re-dispatches on absence
**Story:** Story 1 (happy paths 1–2; negative paths 1–2)
**Type:** happy-path

**Steps:**
1. Write failing tests in a new `src/conductor/test/engine/validation-group-handshake-retry.test.ts`. Seed the three validators the way `acceptance/one-transient-failure-in-a-validation-group-member.acceptance.test.ts` does (`seedValidators`, `writePrdAuditPass`, `writeAsBuiltApproval`, `MT_PASS`). Run a daemon, `verifyArtifacts: true` `Conductor` from `manual_test`, with `maxRetries: 3` and a recording `stepRunner`.
   - (a) `prd_audit`'s first dispatch returns `{ success: true }` without writing its typed verdict, and its second writes a passing verdict. Assert the recorded dispatches contain `prd_audit` exactly twice and `manual_test` and `architecture_review_as_built` exactly once each. Assert every member and group-member key is `done`, no `.pipeline/HALT` exists, no `remediate` dispatch was recorded, and no `kickback` event was emitted.
   - (b) Parametrize the stale-then-fresh scenario over `manual_test` (the first dispatch leaves a results file whose mtime predates the dispatch), `prd_audit`, and `architecture_review_as_built` (the first dispatch writes no as-built verdict). Assert that a `step_retry` event for that member is emitted and that its `reason` contains `post-dispatch verdict write handshake failed` for `manual_test`, or `produced no verdict` for the two typed members.
   - (c) A `prd_audit` runner returning `{ success: false }` on every attempt still has `verdictDispatchHandshake` invoked for `prd_audit` at branch settlement (spy on the conductor instance), so unsuccessful terminal outcomes keep their handshake observation.
2. Verify RED.
3. Implement in `src/conductor/src/engine/conductor.ts` inside `dispatchGroupRound`:
   - Pass `verifyDispatch` for `isVerdictRunIdentityStep(member.name)` members. It runs `stampVerdictRunIdentity` then `verdictDispatchHandshake` with `branchRunIds`, `branchDispatchStartedAt`, and `result.output`, and sets or deletes `branchHandshakeFailures`.
   - Return the handshake reason only when `this.verifyArtifacts` is true.
   - Keep the `onMemberEvent` `result` arm's stamp/handshake observation for every terminal outcome other than `verdict: pass` (no-verdict, mechanical fault, permission denied, parked), so adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity D3's "observation on every terminal outcome" still holds. Skip it only for `verdict: pass`, whose final attempt the hook has already observed. Keep its `inFlightGroupCompletions` bookkeeping.
   - In the group's `onRetry`, append `: <reason>` to the `step_retry` reason when `branchHandshakeFailures` has the member.
4. Verify GREEN, and confirm the existing `one-transient-failure-in-a-validation-group-member` acceptance tests and `conductor-groups-and-signals.test.ts` still pass. Commit "fix(conductor): re-dispatch validation-group members whose dispatch wrote no current verdict".

**Done when:**
- [test] `validation-group-handshake-retry.test.ts` asserts that with a stale-then-fresh `prd_audit`, the step runner records `prd_audit` exactly twice and `manual_test` and `architecture_review_as_built` exactly once each, so no sibling is dispatched a second time.
- [test] The same test asserts that the join commits every member and `validation__<member>` key `done`, and that no `.pipeline/HALT` file exists after `run()`.
- [test] The same test asserts that the step runner recorded no `remediate` dispatch and the event emitter observed no `kickback` event in that run.
- [test] The same file asserts that a `prd_audit` whose runner returns `{ success: false }` on every attempt still has `verdictDispatchHandshake` invoked for it at settlement, preserving the D3 observation on a non-success terminal outcome.
- [test] The parametrized test asserts that for each of `manual_test`, `prd_audit`, and `architecture_review_as_built`, the stale first dispatch causes exactly one extra dispatch of that member and a `step_retry` event for that member whose `reason` contains the handshake failure text.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — `verifyDispatch` wiring in `dispatchGroupRound`; `result` event arm observes non-pass outcomes only; `step_retry` reason
- `src/conductor/test/engine/validation-group-handshake-retry.test.ts` — new conductor-level tests

**Dependencies:** Task 1

### Task 3: Exhausted handshake budget halts needs-human naming the handshake failure
**Story:** Story 2 (happy paths 1–2; negative paths 1–2)
**Type:** negative-path

**Steps:**
1. Write failing tests in `validation-group-handshake-retry.test.ts`.
   - (a) With `maxRetries: 2`, `prd_audit` returns `{ success: true }` on every dispatch without writing a verdict, and its siblings write passing evidence. Assert:
     - `prd_audit` was dispatched exactly 2 times;
     - `.pipeline/HALT` contains `branch "prd_audit" produced no-verdict after 2 attempts` and `produced no verdict`;
     - `.pipeline/HALT.class` is `needs-human`;
     - state has `prd_audit` = `failed`, and both `manual_test`/`validation__manual_test` and `architecture_review_as_built`/`validation__architecture_review_as_built` are `done`;
     - no `remediate` dispatch was recorded and no `kickback` event was emitted;
     - `readKickbackLedger(dir)` returns no `prd_audit` gate entry before or after the run.
   - (b) The same scenario with `maxRetries: 1`. Assert exactly one `prd_audit` dispatch, then a `needs-human` HALT containing `produced no verdict`.
2. Verify RED. If Task 2 already delivers this through the existing no-verdict join arm, the tests pass immediately and this task commits only the tests.
3. Implement only what fails: the no-verdict join arm must receive the handshake reason as `NoVerdictOutcome.reason`, which comes from Task 1's `lastOutput`.
4. Verify GREEN; commit "test(conductor): handshake-exhausted validation member halts naming the missing verdict".

**Done when:**
- [test] `validation-group-handshake-retry.test.ts` asserts that an always-unwritten `prd_audit` under `maxRetries` 2 is dispatched exactly twice and the `.pipeline/HALT` text names `prd_audit`, `after 2 attempts`, and `produced no verdict`.
- [test] The same test asserts that `.pipeline/HALT.class` reads `needs-human`, and, via a spy on the conductor's `commitStateChanges`, that the one commit recording `prd_audit` `failed` also records both siblings' bare and `validation__` keys `done` (same state commit).
- [test] The same test asserts zero `remediate` dispatches, zero `kickback` events, and that `readKickbackLedger` shows no `prd_audit` gate entry after the run.
- [test] The `maxRetries` 1 variant asserts exactly one `prd_audit` dispatch followed by a `needs-human` HALT whose text contains `produced no verdict`.

**Files likely touched:**
- `src/conductor/test/engine/validation-group-handshake-retry.test.ts` — exhaustion cases
- `src/conductor/src/engine/conductor.ts` — only if the no-verdict halt does not already carry the reason

**Dependencies:** Task 2

### Task 4: Genuine gate failures still remediate; verification-off mode is unchanged
**Story:** Story 3 (happy path 1; negative path 1)
**Type:** negative-path

**Steps:**
1. Write failing tests in `validation-group-handshake-retry.test.ts`.
   - (a) With `verifyArtifacts: true`, `prd_audit`'s single dispatch writes a current, complete verdict whose gate is unsatisfied (a failing criterion, as in the existing PRD-audit remediation tests). Assert `prd_audit` is dispatched exactly once and the step runner then records a `remediate` dispatch.
   - (b) With `verifyArtifacts: false` and `maxRetries: 3`, `prd_audit` returns `{ success: true }` without writing a verdict. Assert it is dispatched exactly once and the group joins with `parallel_completed` as before this change.
2. Verify RED (b fails if the hook ignores `verifyArtifacts`). If both pass after Task 2, commit only the tests.
3. Implement only what fails: the `verifyArtifacts` gate in the Task 2 hook.
4. Verify GREEN; commit "test(conductor): genuine validation gaps still remediate; verification-off group unchanged".

**Done when:**
- [test] `validation-group-handshake-retry.test.ts` asserts that a fresh, complete, unsatisfied `prd_audit` verdict yields exactly one `prd_audit` dispatch followed by a recorded `remediate` dispatch from the join.
- [test] The same file asserts that with `verifyArtifacts: false`, a `prd_audit` dispatch that writes no verdict is dispatched exactly once and the round emits `parallel_completed`, unchanged from the pre-change dispatch-success-only semantics.

**Files likely touched:**
- `src/conductor/test/engine/validation-group-handshake-retry.test.ts` — genuine-failure and verification-off cases
- `src/conductor/src/engine/conductor.ts` — only if the `verifyArtifacts` gate is missing

**Dependencies:** Task 2

## Task Dependency Graph

```
Task 1 ──▶ Task 2 ──┬──▶ Task 3
                    └──▶ Task 4
```

## Integration Points

- After Task 2: the production entry point `Conductor.run()` reaches the SHIP validation group, whose `runGroupBranch` calls now consult the engine's post-dispatch handshake inside each member's attempt loop.
- After Task 3: the join's existing no-verdict halt carries the handshake reason to `.pipeline/HALT`.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given artifact verification is on and a member's resolved retry budget is at least 2, when that member's first dispatch settles successfully but fails the handshake and its second dispatch writes a current passing verdict, then that member is dispatched exactly twice, each sibling is dispatched exactly once, and the group joins all-green with every member `done` and no HALT written. | 2 | "the step runner records `prd_audit` exactly twice and `manual_test` and `architecture_review_as_built` exactly once each" | diff-local |
| Story 1 happy: Given the same first-dispatch handshake failure, for each of `manual_test`, `prd_audit`, and `architecture_review_as_built`, when the member is re-dispatched, then a `step_retry` event is emitted for that member whose `reason` contains the handshake failure text. | 2 | "a `step_retry` event for that member whose `reason` contains the handshake failure text" | diff-local |
| Story 1 negative: Given a member's dispatch failed the handshake and its re-dispatch then passed, when the round settles, then no remediation planner (`remediate`) dispatch occurs and no `kickback` event is emitted for that round. | 2 | "the step runner recorded no `remediate` dispatch and the event emitter observed no `kickback` event in that run" | diff-local |
| Story 1 negative: Given a member's dispatch failed the handshake while its siblings passed theirs, when the member is re-dispatched, then no sibling is dispatched a second time. | 2 | "so no sibling is dispatched a second time" | diff-local |
| Story 2 happy: Given artifact verification is on and every dispatch of `prd_audit` settles successfully but fails the handshake, when its resolved retry budget of N attempts is spent, then the loop writes a `needs-human` HALT whose reason names `prd_audit`, the attempt count N, and the handshake failure text, and `prd_audit` is recorded `failed`. | 3 | "the one commit recording `prd_audit` `failed`" | diff-local |
| Story 2 happy: Given that halt, when its siblings' dispatches passed with satisfied gate verdicts, then those siblings are recorded `done` (bare and group-member keys) in the same state commit, as for any other no-verdict member. | 3 | "also records both siblings' bare and `validation__` keys `done` (same state commit)" | diff-local |
| Story 2 negative: Given the handshake-exhausted halt, when the round settles, then no remediation planner (`remediate`) dispatch occurs, no `kickback` event is emitted, and the kickback ledger records no new entry for `prd_audit`. | 3 | "zero `remediate` dispatches, zero `kickback` events, and that `readKickbackLedger` shows no `prd_audit` gate entry after the run" | diff-local |
| Story 2 negative: Given a member whose resolved retry budget is 1, when its only dispatch fails the handshake, then it is not re-dispatched and the loop halts `needs-human` naming the handshake failure. | 3 | "exactly one `prd_audit` dispatch followed by a `needs-human` HALT whose text contains `produced no verdict`" | diff-local |
| Story 3 happy: Given artifact verification is on and `prd_audit`'s first dispatch writes a current verdict (handshake passes) whose gate is unsatisfied, when the join runs, then `prd_audit` is dispatched exactly once and the join dispatches the remediation planner (`remediate`) as it does today. | 4 | "exactly one `prd_audit` dispatch followed by a recorded `remediate` dispatch from the join" | diff-local |
| Story 3 negative: Given artifact verification is off (the mocked-dispatch mode), when a member's dispatch settles successfully and its handshake would fail, then the member is dispatched exactly once and the join's outcome is unchanged from today. | 4 | "is dispatched exactly once and the round emits `parallel_completed`, unchanged from the pre-change dispatch-success-only semantics" | diff-local |
| Story 3 negative: Given a member's runner result is unsuccessful (not a handshake failure), when the branch retries it, then the retry counts against the same single retry budget, so the total dispatches of that member never exceed its resolved `max_retries`. | 1 | "so the total dispatches never exceed the single budget" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
