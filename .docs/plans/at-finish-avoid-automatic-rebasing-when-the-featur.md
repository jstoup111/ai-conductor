# Implementation Plan: Mergeability-first daemon finish

**Date:** 2026-07-30
**Design:** `.docs/specs/2026-07-30-mergeability-first-finish.md`
**Stories:** `.docs/stories/mergeability-first-finish.md`
**Architecture:** `.docs/decisions/adr-2026-07-30-finish-only-mergeability-gate.md`
**Conflict check:** Clean as of 2026-07-30

## Summary

Add a finish-only, read-only prospective merge classifier before the existing automatic rebase.
Clean merges preserve feature history and gate evidence; conflicts and unknown results continue
through the existing rebase/resolver. Re-kick remains mandatory play-forward. Eleven scoped TDD
tasks implement and wire the behavior.

## Technical Approach

- Add an injected tri-state classifier in `engine/rebase.ts` that runs the installed Git
  prospective-merge plumbing in quiet mode and maps exit `0` to `clean`, exit `1` to `conflicting`,
  and every other result/throw to `indeterminate`.
- Extend `PerformRebaseOpts` with an explicit finish policy flag. Only `runRebaseStep` supplies it;
  `resumeRebaseFirst` keeps the default mandatory-rebase behavior.
- Add `mergeable_skip` to the existing outcome union. Return it after the active-rebase guard, base
  resolution, and already-current check, but before protected-seal preflight, pre-tree snapshots,
  evidence translation, or `git rebase`.
- Treat `mergeable_skip` as a satisfied integration outcome with no invalidation, translation,
  rebaseline, or kickback. Record completion and emit a dedicated typed event.
- Keep conflict/indeterminate behavior byte-for-byte on the existing actual-rebase path.
- Use injected unit tests for result mapping and call order, real temporary Git repositories only
  where Git merge/rebase semantics are the subject, and bounded targeted conductor fixtures for
  finish wiring.

## Prerequisites

- Git provides the documented `merge-tree --write-tree --quiet` exit-status contract.
- Existing protected-seal, evidence translation, rebase resolver, and re-kick behavior remain
  unchanged outside the new finish-only branch.
- Ordinary tests use no GitHub, LLM, network, daemon, tmux, or shared checkout state.

## Tasks

### Task 1: Add the prospective-merge tri-state classifier

**Story:** Story 1 — assess mergeability before history rewriting; clean/conflict/error result
classification.
**Type:** happy-path

**Steps:**
1. Write failing injected-runner unit tests asserting the exact quiet prospective-merge argv and
   `clean`, `conflicting`, and `indeterminate` mappings for exit statuses `0`, `1`, and other.
2. Verify the tests fail because the classifier does not exist.
3. Implement the exported classifier and semantic result type without parsing stdout/stderr.
4. Verify the focused unit tests pass.
5. Commit with message: `feat(rebase): classify prospective mergeability`

**Files:**
- `src/conductor/src/engine/rebase.ts`
- `src/conductor/test/engine/rebase.test.ts`

**Wired-into:** `src/conductor/src/engine/rebase.ts#performRebase`

**Dependencies:** none

### Task 2: Add an explicit finish-only policy and mergeable-skip outcome

**Story:** Story 2 — preserve a feature that can merge cleanly.
**Type:** happy-path

**Steps:**
1. Write a failing injected-runner test where the feature is behind, the finish policy is enabled,
   and the classifier is clean; assert the result is `mergeable_skip` and no rebase argv runs.
2. Verify RED.
3. Add the explicit `PerformRebaseOpts` policy and `RebaseOutcome.mergeable_skip` branch after
   already-current detection and before rebase-only preflight.
4. Verify GREEN and that callers without the policy retain existing behavior.
5. Commit with message: `feat(rebase): skip mergeable finish rebases`

**Files:**
- `src/conductor/src/engine/rebase.ts`
- `src/conductor/test/engine/rebase.test.ts`

**Wired-into:** `src/conductor/src/engine/rebase.ts#performRebase`

**Dependencies:** Task 1

### Task 3: Prove a clean skip does not mutate Git state

**Story:** Story 1 — prove the assessment is non-mutating.
**Type:** negative-path

**Steps:**
1. Create a failing real-local-Git test with a feature behind its base by a disjoint commit; snapshot
   feature ref, HEAD, index tree, worktree diff, commit list, and status before the call.
2. Verify RED because finish policy does not yet satisfy the full immutability contract.
3. Adjust only the finish skip path needed to make the prospective merge read-only.
4. Assert every snapshot is unchanged and no temporary rebase state exists.
5. Commit with message: `test(rebase): prove mergeable skip is non-mutating`

**Files:**
- `src/conductor/src/engine/rebase.ts`
- `src/conductor/test/engine/rebase.test.ts`

**Wired-into:** same as Task 2

**Dependencies:** Task 2

### Task 4: Route prospective conflicts into existing rebase recovery

**Story:** Story 4 — recover automatically from a reported conflict.
**Type:** negative-path

**Steps:**
1. Write a failing real-local-Git test whose prospective merge conflicts; assert the existing rebase
   starts and returns the established conflict outcome rather than `mergeable_skip`.
2. Verify RED.
3. Implement the conflicting branch as fall-through to the existing seal/rebase/resolver path,
   without duplicating recovery logic.
4. Verify GREEN alongside existing resolver success and exhaustion tests.
5. Commit with message: `fix(rebase): preserve conflict recovery after merge check`

**Files:**
- `src/conductor/src/engine/rebase.ts`
- `src/conductor/test/engine/rebase.test.ts`
- `src/conductor/test/engine/rebase-resolution.test.ts`

**Wired-into:** same as Task 2

**Dependencies:** Task 2

### Task 5: Fail closed on indeterminate assessment

**Story:** Story 5 — fail closed when mergeability is indeterminate.
**Type:** negative-path

**Steps:**
1. Write failing injected-runner tests for an unexpected exit status, thrown runner, and disappearing
   target; assert none returns `mergeable_skip`.
2. Verify RED.
3. Route every indeterminate classifier result into the existing protected preflight and rebase
   path; preserve its unexpected-failure HALT conversion at callers.
4. Verify GREEN and exact no-skip assertions.
5. Commit with message: `fix(rebase): fail closed on unknown mergeability`

**Files:**
- `src/conductor/src/engine/rebase.ts`
- `src/conductor/test/engine/rebase.test.ts`

**Wired-into:** same as Task 2

**Dependencies:** Task 2

### Task 6: Keep active or incomplete rebase state authoritative

**Story:** Story 9 — never skip an incomplete rebase.
**Type:** negative-path

**Steps:**
1. Extend the paused-rebase and staged-without-continue regression tests with a spy proving the
   prospective-merge command is never reached.
2. Verify the new assertions fail until classifier call order is guarded.
3. Place/retain the active-rebase guard ahead of base-current and mergeability classification.
4. Verify both regressions return the existing fail-closed conflict outcome.
5. Commit with message: `test(rebase): keep paused state ahead of mergeability`

**Files:**
- `src/conductor/src/engine/rebase.ts`
- `src/conductor/test/integration/rebase-loop.test.ts`

**Wired-into:** same as Task 2

**Dependencies:** Task 2

### Task 7: Preserve verdicts, completion, seal, and evidence on skip

**Story:** Story 7 — leave protected artifacts and evidence untouched.
**Type:** happy-path

**Steps:**
1. Write failing tests asserting `mergeable_skip` produces a satisfied rebase verdict with empty
   kickback/reverify arrays, records the step done, and invokes neither translation nor seal
   rebaseline capabilities.
2. Verify RED.
3. Extend shared verdict/completion handling for the additive outcome and keep the return before all
   rebase-only mutation seams.
4. Verify GREEN alongside existing changed-rebase invalidation and rebaseline tests.
5. Commit with message: `feat(rebase): preserve evidence on mergeable skip`

**Files:**
- `src/conductor/src/engine/rebase.ts`
- `src/conductor/test/engine/rebase.test.ts`
- `src/conductor/test/engine/rebase-translate-acceptance.test.ts`
- `src/conductor/test/acceptance/protected-artifact-seal-rebaseline-976.acceptance.test.ts`

**Wired-into:** same as Task 2

**Dependencies:** Tasks 2, 3

### Task 8: Wire mergeability skipping into normal finish

**Story:** Story 3 — preserve downstream verification after a mergeable skip.
**Type:** infrastructure

**Steps:**
1. Write a bounded failing conductor integration test starting at the engine-native rebase step with
   all unrelated gates pre-resolved; assert a clean-behind branch reaches finish without SHA rewrite
   or downstream dispatch.
2. Verify RED and terminate the fixture at the finish observation boundary.
3. Pass the explicit mergeability policy only from `runRebaseStep`.
4. Verify GREEN with the targeted conductor fixture and existing finish-tail ordering tests.
5. Commit with message: `feat(conductor): enable mergeability-first finish`

**Files:**
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/test/integration/rebase-loop.test.ts`
- `src/conductor/test/integration/rebase-tail-preserve.test.ts`

**Wired-into:** `src/conductor/src/engine/conductor.ts#runRebaseStep`

**Dependencies:** Tasks 2, 7

### Task 9: Prove re-kick always performs play-forward rebase

**Story:** Story 6 — preserve re-kick play-forward.
**Type:** negative-path

**Steps:**
1. Write a failing re-kick integration test where the advanced base is prospectively mergeable and
   contains a commit required by the pending-gate fixture; assert that commit enters the worktree
   before retry and `mergeable_skip` is impossible.
2. Verify RED against any leaked shared-policy default.
3. Keep `resumeRebaseFirst` on the default mandatory-rebase policy; make caller intent explicit if
   the type/API requires it.
4. Verify GREEN with existing re-kick conflict resolver tests.
5. Commit with message: `test(rekick): preserve mandatory base play-forward`

**Files:**
- `src/conductor/src/engine/daemon-rekick.ts`
- `src/conductor/test/engine/daemon-rekick.test.ts`
- `src/conductor/test/integration/rebase-loop.test.ts`

**Wired-into:** `src/conductor/src/engine/daemon-rekick.ts#resumeRebaseFirst`

**Dependencies:** Tasks 2, 8

### Task 10: Emit and render a distinct mergeable-skip outcome

**Story:** Story 8 — explain the integration outcome to operators.
**Type:** happy-path

**Steps:**
1. Write failing type/event/formatter tests distinguishing mergeable skip from already-current,
   changed rebase, auto-resolved CHANGELOG, and conflict HALT.
2. Verify RED.
3. Add the typed event, event-emitter branch, daemon formatter line, and audit-trail classification.
4. Verify GREEN across event emission, renderer, and audit completeness tests.
5. Commit with message: `feat(events): report mergeable rebase skips`

**Files:**
- `src/conductor/src/types/events.ts`
- `src/conductor/src/engine/rebase.ts`
- `src/conductor/src/daemon-cli.ts`
- `src/conductor/test/engine/rebase.test.ts`
- `src/conductor/test/engine/daemon-render.test.ts`
- `src/conductor/test/integration/audit-trail-completeness.integration.test.ts`

**Wired-into:** `src/conductor/src/engine/rebase.ts#emitRebaseEvent, src/conductor/src/daemon-cli.ts#renderEvent`

**Dependencies:** Tasks 2, 7

### Task 11: Preserve local-base fallback under finish policy

**Story:** Story 5 — fail closed when local-base mergeability is indeterminate.
**Type:** negative-path

**Steps:**
1. Add a failing real-local-Git fixture with no remote where the configured local base advanced but
   is prospectively mergeable; assert finish returns mergeable-skip without network access.
2. Add the paired conflicting local-base case and assert it enters actual rebase recovery.
3. Implement only any base-ref threading needed for the classifier to use the already-resolved local
   target.
4. Verify both cases pass alongside existing no-remote rebase coverage.
5. Commit with message: `test(rebase): cover mergeability without a remote`

**Files:**
- `src/conductor/src/engine/rebase.ts`
- `src/conductor/test/integration/rebase-loop.test.ts`

**Wired-into:** same as Task 8

**Dependencies:** Tasks 4, 5, 8

## Task Dependency Graph

```text
Task 1
  └─ Task 2
      ├─ Task 3 ─┬─ Task 7 ─┬─ Task 8 ─┬─ Task 9
      │          │          │          └─ Task 11
      │          │          └─ Task 10
      │          └───────────── Task 11
      ├─ Task 4 ─────────────── Task 11
      ├─ Task 5 ─────────────── Task 11
      └─ Task 6
```

## Integration Points

- After Task 2: the new finish policy can produce a typed mergeable-skip outcome.
- After Task 7: the outcome is safe for gate completion and preserves protected/evidence state.
- After Task 8: normal finish uses mergeability-first behavior through a production caller.
- After Task 9: re-kick’s distinct play-forward contract is pinned against policy leakage.
- After Task 10: operators and the event audit can distinguish the new outcome.

## Story Coverage

| Story / requirement | Covered by tasks |
|---|---|
| Story 1 / FR-1 | 1, 3, 6, 11 |
| Story 2 / FR-2 | 2, 3, 8, 11 |
| Story 3 / FR-3 | 7, 8 |
| Story 4 / FR-4 | 4 |
| Story 5 / FR-5 | 5, 11 |
| Story 6 / FR-6 | 8, 9 |
| Story 7 / FR-7 | 3, 7 |
| Story 8 / FR-8 | 10 |
| Story 9 / FR-9 | 6 |

## Verification

- [x] Every happy-path criterion maps to at least one task.
- [x] Every negative-path criterion maps to at least one task.
- [x] No task is a terminal catch-all validation task.
- [x] Tasks use injected boundaries or isolated real-local-Git fixtures at the narrowest credible
      level.
- [x] Every task declares dependencies and an architecture-derived production wiring contract.
- [x] Dependencies are acyclic.
- [x] Eleven tasks stay below the 21-task scope warning.

## Verify-Claims Ledger

### Claims

- [verified] `performRebase` is the shared actual-rebase primitive and accepts injectable options.
- [verified] `runRebaseStep` and `resumeRebaseFirst` are the two production callers.
- [verified] Seal verification and translation occur after the already-current return seam.
- [verified] Rebase outcomes flow through shared verdict, completion, event, and daemon rendering
  surfaces.
- [verified] Existing tests provide isolated real-Git and bounded conductor fixture patterns.

### Assumptions

- [load-bearing] The finish caller should opt into mergeability skipping while re-kick retains the
  default mandatory-rebase policy.
  - **Status: APPROVED by operator and recorded in the APPROVED replacement ADR**
- [load-bearing] Git exit status alone is the classifier authority.
  - **Status: APPROVED in the ADR; verified against installed Git documentation**

### Verdict

CLEAR
