# Implementation Plan: Restore conflict remediation for shipped pull requests

**Date:** 2026-07-30
**Design:** `.docs/specs/2026-07-30-autoresolve-conflict-remediation-deadlock-737.md`
**Architecture:** `.docs/decisions/adr-2026-07-30-shipped-pr-conflict-remediation-ownership.md`
**Stories:** `.docs/stories/autoresolve-conflict-remediation-deadlock-737.md`
**Conflict check:** Clean as of 2026-07-30 (`.docs/conflicts/2026-07-30-autoresolve-conflict-remediation-deadlock-737.md`)

## Summary

Restores automatic remediation for shipped watched conflicts, including retained-worktree cases,
and makes the mergeable sweep the truthful per-cycle arbiter between conflict and CI repair. The
plan has 18 small TDD tasks covering typed disposition, retry-safe escalation, daemon wiring,
self-host activation, and the existing branch-publication safety chain.

## Technical Approach

1. **Replace boolean eligibility with an exhaustive disposition.** `autoresolve.ts` will expose a
   `ConflictDisposition` union with `dispatch`, `defer`, `already-escalated`, and `escalate`
   variants. In-flight ownership and cooldown map to `defer`; a sticky label maps to
   `already-escalated`; attempt exhaustion and enabled-but-missing verification map to `escalate`;
   deliberate opt-out maps to a non-mutating manual-resolution `defer`. The retained build-worktree
   filesystem probe and its injected `AutoresolveFs` dependency are removed. Verified shipped-watch
   enrollment remains the ownership boundary.

2. **Make the sweep the only per-cycle conflict arbiter.** `mergeable-sweep.ts` will consume the
   disposition for every non-draft `CONFLICTING` watched candidate, emit exactly one conflict
   outcome, and bump attempt state only for `dispatch`. `escalate` invokes a dedicated escalation
   adapter without consuming an attempt; `defer` and `already-escalated` perform no external
   mutation. Conflicting candidates are never added to the normal CI-repair candidate list, while
   `ci-fix.ts` retains its defensive conflict-precedence gate for direct callers.

3. **Complete actionable escalation before making it sticky.** A new confirmation-returning
   marked-comment operation in `pr-labels.ts` will distinguish confirmed create/update from an
   indeterminate lookup or failed write. Unlike the existing best-effort `upsertComment`, it will
   not create after an indeterminate lookup. `autoresolve.ts#escalate` will confirm the comment
   containing stage, reason, and recovery action first, then remove `mergeable` and apply
   `needs-remediation`. The existing label helper will report write success while remaining
   backward-compatible for callers that ignore the result. Escalation returns a typed result so
   the sweep reports retryable failure accurately.
   Comment failure leaves the label unapplied; label failure leaves the already-confirmed marked
   comment available for an idempotent later retry. No persisted escalation lifecycle is added.

4. **Wire compatibility and self-host activation.** `daemon-cli.ts#runDaemonMode` will emit one
   startup warning when effective CI repair remains active after preflight while autoresolve is
   inactive, and will pass the typed classifier/escalation adapters into the sweep. This
   repository's existing `mergeable_autoresolve` block is enabled with a root-relative command that
   runs `npm --prefix src/conductor test` and `bash test/test_harness_integrity.sh`. No schema or
   new dependency is required.

5. **Pin the safety chain rather than redesign it.** Existing isolated `resolve-«slug»` worktrees,
   work-preservation checks, current-base proof, repository verification, and lease-protected push
   stay authoritative. Integration tests connect verified ship enrollment through sweep arbitration
   and prove remote movement still publishes nothing. Automatic merge remains absent.

Documentation is owned by this repository's `maintain-documentation` custom step and is not
represented as plan tasks.

## Prerequisites

- No migration, package, service, or new configuration key.
- Before every task commit, run `test/test_harness_integrity.sh` as required by this repository.
- Unit, integration, and acceptance tests must use injected/fake GitHub and process boundaries;
  only an explicitly named smoke test may execute a real binary path.

## Tasks

### Task 1: Define the exhaustive conflict disposition
**Story:** Story 2 AC-1; Story 4 AC-1
**Type:** infrastructure

**Steps:**
1. Write failing table tests asserting the classifier returns the four named disposition variants with required reasons and exhaustive type narrowing.
2. Verify the tests fail (RED).
3. Implement `ConflictDisposition` and `classifyConflictDisposition` in `autoresolve.ts`, replacing the boolean result without changing dispatch behavior yet.
4. Verify the focused tests pass (GREEN).
5. Run the repository commit gate and commit with message: "refactor(autoresolve): classify conflict dispositions".

**Files:** `src/conductor/src/engine/autoresolve.ts`, `src/conductor/test/engine/autoresolve.test.ts`
**Wired-into:** `src/conductor/src/engine/mergeable-sweep.ts#sweepMergeableLabels`
**Dependencies:** none

### Task 2: Dispatch despite retained completed-feature evidence
**Story:** Story 1 AC-1, AC-2, and both negative paths
**Type:** happy-path

**Steps:**
1. Replace the old failing-worktree expectation with tests proving a watched shipped conflict returns `dispatch` whether `.worktrees/«slug»` is present or absent, while merged, closed, unknown, and sticky cases remain non-dispatching.
2. Verify the retained-worktree case fails (RED).
3. Remove Gate 6, `AutoresolveFs`, and the daemon-cli filesystem injection from conflict classification.
4. Verify focused eligibility and worktree-isolation tests pass (GREEN).
5. Run the repository commit gate and commit with message: "fix(autoresolve): stop treating retained evidence as build ownership".

**Files:** `src/conductor/src/engine/autoresolve.ts`, `src/conductor/src/daemon-cli.ts`, `src/conductor/test/engine/autoresolve.test.ts`, `src/conductor/test/engine/autoresolve-guards.test.ts`
**Wired-into:** `src/conductor/src/engine/mergeable-sweep.ts#sweepMergeableLabels`, `src/conductor/src/daemon-cli.ts#runDaemonMode`
**Dependencies:** 1

### Task 3: Classify transient ownership and cooldown without attempt burn
**Story:** Story 2 AC-2, AC-3, and their negative paths
**Type:** negative-path

**Steps:**
1. Write failing tests for process-wide in-flight ownership and active cooldown returning `defer` with concrete reasons, leaving entry counters and sticky state unchanged across repeated evaluations.
2. Verify the tests fail (RED).
3. Map the existing serial and cooldown gates to `defer`; preserve current later-cycle eligibility when each condition clears.
4. Verify focused classifier and in-flight tests pass (GREEN).
5. Run the repository commit gate and commit with message: "fix(autoresolve): make transient conflict deferrals non-consuming".

**Files:** `src/conductor/src/engine/autoresolve.ts`, `src/conductor/test/engine/autoresolve.test.ts`, `src/conductor/test/engine/autoresolve-inflight.test.ts`
**Wired-into:** same as Task 1
**Dependencies:** 1

### Task 4: Classify sticky, exhausted, unavailable, and inactive modes
**Story:** Story 3 AC-1 and AC-1 negative; Story 6 AC-2, AC-3 and their negative paths; Story 4 AC-2
**Type:** negative-path

**Steps:**
1. Write failing tests asserting: `needs-remediation` returns `already-escalated`; exhausted attempts and enabled autoresolve without a non-empty suite command return `escalate` with stage/reason/recovery action; deliberate opt-out returns a manual-resolution `defer` and never `escalate`.
2. Verify the tests fail (RED).
3. Implement those disposition branches before any attempt state is changed.
4. Verify focused tests pass (GREEN).
5. Run the repository commit gate and commit with message: "feat(autoresolve): classify terminal and inactive conflict outcomes".

**Files:** `src/conductor/src/engine/autoresolve.ts`, `src/conductor/test/engine/autoresolve.test.ts`
**Wired-into:** same as Task 1
**Dependencies:** 1, 3

### Task 5: Dispatch exactly one conflict owner and persist the attempt first
**Story:** Story 1 AC-1; Story 2 AC-1, AC-2
**Type:** happy-path

**Steps:**
1. Write failing sweep integration tests in which `dispatch` starts the first eligible conflict, observes its incremented attempt/timestamp, and a second eligible conflict gets a concrete `defer` disposition without dispatch.
2. Verify the tests fail (RED).
3. Change `AutoresolveDispatchOpts` to accept the typed classifier and make the sweep exhaustively handle `dispatch`, retaining bump-before-mutation and one-per-repository serialization.
4. Verify focused sweep integration tests pass (GREEN).
5. Run the repository commit gate and commit with message: "feat(sweep): dispatch from typed conflict dispositions".

**Files:** `src/conductor/src/engine/mergeable-sweep.ts`, `src/conductor/test/integration/mergeable-sweep-autoresolve.test.ts`
**Wired-into:** `src/conductor/src/daemon-cli.ts#runDaemonMode`
**Dependencies:** 1, 2, 3, 4

### Task 6: Keep defer and already-escalated cycles mutation-free
**Story:** Story 2 AC-1, AC-3 and negatives; Story 3 AC-2
**Type:** negative-path

**Steps:**
1. Write failing sweep tests that run ten unchanged cycles for `defer` and `already-escalated`, asserting zero dispatch/escalation calls, unchanged attempts, and one explicit conflict disposition per cycle.
2. Verify the tests fail (RED).
3. Add the non-mutating switch branches and their operator-visible disposition logs without using the existing cross-cycle log-suppression cache.
4. Verify focused tests pass (GREEN).
5. Run the repository commit gate and commit with message: "fix(sweep): preserve non-mutating conflict dispositions".

**Files:** `src/conductor/src/engine/mergeable-sweep.ts`, `src/conductor/test/engine/mergeable-sweep.test.ts`, `src/conductor/test/integration/mergeable-sweep-autoresolve.test.ts`
**Wired-into:** same as Task 5
**Dependencies:** 5

### Task 7: Route terminal dispositions without consuming an attempt
**Story:** Story 3 AC-1; Story 6 AC-3
**Type:** happy-path

**Steps:**
1. Write a failing sweep test where an `escalate` disposition calls the injected escalation adapter with stage/reason/recovery action, never calls dispatch, and leaves `resolveAttempts` and `lastResolveAt` unchanged.
2. Verify the test fails (RED).
3. Add the escalation adapter to `AutoresolveDispatchOpts` and handle its typed result as newly escalated or retryable escalation failure.
4. Verify the focused test passes (GREEN).
5. Run the repository commit gate and commit with message: "feat(sweep): route terminal conflict escalation before dispatch".

**Files:** `src/conductor/src/engine/mergeable-sweep.ts`, `src/conductor/test/engine/mergeable-sweep.test.ts`
**Wired-into:** `src/conductor/src/engine/autoresolve.ts#escalate`, `src/conductor/src/daemon-cli.ts#runDaemonMode`
**Dependencies:** 4, 5

### Task 8: Exclude every conflicting candidate from normal CI repair
**Story:** Story 4 AC-1 and AC-1 negative
**Type:** negative-path

**Steps:**
1. Write failing tests for a pull request that is both `CONFLICTING` and checks-failed, covering each conflict disposition and asserting zero CI candidate dispatch and no `ciFixAttempts` burn.
2. Verify the tests fail (RED).
3. Prevent conflicting entries from entering `failedCandidates` and emit the conflict disposition as the sole normal-cycle owner outcome.
4. Verify sweep tests pass and the direct `ci-fix.ts` conflict-precedence test remains green unchanged (GREEN).
5. Run the repository commit gate and commit with message: "fix(sweep): keep conflicting PRs out of CI repair".

**Files:** `src/conductor/src/engine/mergeable-sweep.ts`, `src/conductor/test/engine/mergeable-sweep.test.ts`, `src/conductor/test/integration/mergeable-sweep-ci-fix.test.ts`, `src/conductor/test/engine/ci-fix.test.ts`
**Wired-into:** same as Task 5
**Dependencies:** 6, 7

### Task 9: Reset successful conflict state and defer remaining CI work to the next cycle
**Story:** Story 6 AC-1 and AC-1 negative
**Type:** happy-path

**Steps:**
1. Write a failing two-cycle integration test: cycle one refreshes a conflicting checks-failed PR and resets `resolveAttempts` without CI dispatch; cycle two sees it non-conflicting and dispatches ordinary CI repair for remaining failure.
2. Verify the test fails (RED).
3. Preserve success reset while making candidate collection and cycle ordering prevent same-cycle CI repair.
4. Verify the two-cycle integration test passes (GREEN).
5. Run the repository commit gate and commit with message: "fix(sweep): hand refreshed PRs to CI repair on a later cycle".

**Files:** `src/conductor/src/engine/mergeable-sweep.ts`, `src/conductor/test/integration/mergeable-sweep-autoresolve.test.ts`, `src/conductor/test/integration/mergeable-sweep-ci-fix.test.ts`
**Wired-into:** same as Task 5
**Dependencies:** 8

### Task 10: Confirm a new or existing marked actionable comment
**Story:** Story 3 AC-1, AC-2
**Type:** infrastructure

**Steps:**
1. Write failing fake-GitHub tests that a missing marker creates one tagged comment and an existing parseable marker patches that same comment, returning a typed confirmed result in both cases.
2. Verify the tests fail (RED).
3. Add a strict confirmation-returning marked-comment operation beside `upsertComment`, sharing marker parsing but not changing existing callers.
4. Verify focused tests pass (GREEN).
5. Run the repository commit gate and commit with message: "feat(pr-labels): confirm marked escalation comments".

**Files:** `src/conductor/src/engine/pr-labels.ts`, `src/conductor/test/engine/pr-labels.test.ts`
**Wired-into:** `src/conductor/src/engine/autoresolve.ts#escalate`
**Dependencies:** none

### Task 11: Fail closed on indeterminate comment lookup or update
**Story:** Story 3 AC-3 negative
**Type:** negative-path

**Steps:**
1. Write failing tests for lookup failure, malformed matched URL, create failure, and patch failure; each returns failure, never throws, and never performs a fallback create when comment existence is indeterminate.
2. Verify the tests fail (RED).
3. Implement the strict failure branches and greppable reasons while leaving legacy `upsertComment` semantics unchanged.
4. Verify focused strict-helper and legacy-upsert tests pass (GREEN).
5. Run the repository commit gate and commit with message: "fix(pr-labels): avoid unproven escalation-comment creation".

**Files:** `src/conductor/src/engine/pr-labels.ts`, `src/conductor/test/engine/pr-labels.test.ts`
**Wired-into:** same as Task 10
**Dependencies:** 10

### Task 12: Make autoresolve escalation comment-first and label-last
**Story:** Story 3 AC-1, AC-3; Story 7 AC-1
**Type:** happy-path

**Steps:**
1. Rewrite the failing escalation tests to assert call order: confirm current comment with pull request, stage, reason, and recovery action; only on confirmation remove `mergeable` and add `needs-remediation`; return a typed escalated result.
2. Verify the tests fail (RED).
3. Update the existing label helper to report success/failure without changing its best-effort behavior for current callers; update `autoresolve.ts#escalate` to use the strict comment operation, apply the label last, and return `escalated` or `retryable` with the failed stage.
4. Verify focused escalation and logging tests pass (GREEN).
5. Run the repository commit gate and commit with message: "fix(autoresolve): make actionable escalation sticky last".

**Files:** `src/conductor/src/engine/autoresolve.ts`, `src/conductor/src/engine/pr-labels.ts`, `src/conductor/test/engine/autoresolve-escalate.test.ts`, `src/conductor/test/engine/autoresolve-logging.test.ts`, `src/conductor/test/engine/pr-labels.test.ts`
**Wired-into:** `src/conductor/src/engine/autoresolve.ts#escalate`, `src/conductor/src/engine/mergeable-sweep.ts#sweepMergeableLabels`
**Dependencies:** 10, 11

### Task 13: Retry partial escalation without duplicates or attempt burn
**Story:** Story 3 AC-2, AC-3 and all negative paths
**Type:** negative-path

**Steps:**
1. Write failing multi-cycle tests for comment failure, comment success plus label failure, and ten unchanged sticky cycles; assert later retry patches the same marker, labels are idempotent, no fallback duplicate is created, and resolve attempts stay unchanged.
2. Verify the tests fail (RED).
3. Thread the typed escalation result through the sweep so failures remain retryable and completed sticky state becomes `already-escalated` on later cycles.
4. Verify focused escalation/sweep tests pass (GREEN).
5. Run the repository commit gate and commit with message: "fix(autoresolve): converge partial escalation exactly once".

**Files:** `src/conductor/src/engine/autoresolve.ts`, `src/conductor/src/engine/mergeable-sweep.ts`, `src/conductor/test/engine/autoresolve-escalate.test.ts`, `src/conductor/test/engine/mergeable-sweep.test.ts`
**Wired-into:** same as Task 12
**Dependencies:** 7, 12

### Task 14: Derive the once-per-startup compatibility diagnostic
**Story:** Story 4 AC-2 and AC-2 negative
**Type:** negative-path

**Steps:**
1. Write failing table tests for effective CI repair active/inactive crossed with autoresolve active/inactive; only active-CI plus inactive-autoresolve returns the loud manual-resolution diagnostic.
2. Verify the tests fail (RED).
3. Add a pure compatibility-message helper used once after CI-fix preflight and config resolution.
4. Verify focused tests pass (GREEN).
5. Run the repository commit gate and commit with message: "feat(daemon): diagnose inactive conflict remediation at startup".

**Files:** `src/conductor/src/daemon-cli.ts`, `src/conductor/test/engine/daemon-cli.test.ts`
**Wired-into:** `src/conductor/src/daemon-cli.ts#runDaemonMode`
**Dependencies:** none

### Task 15: Wire typed conflict arbitration and escalation into daemon startup
**Story:** Story 1; Story 2; Story 3; Story 4; Story 7 AC-1
**Type:** infrastructure

**Steps:**
1. Write failing source-wiring and focused daemon tests asserting `runDaemonMode` supplies classifier, dispatch, and escalation callbacks; uses post-preflight effective CI activation for the single startup warning; and supplies no worktree-existence eligibility dependency.
2. Verify the tests fail (RED).
3. Replace daemon-cli's boolean autoresolve adapter with the typed callbacks and emit the compatibility diagnostic exactly once before sweep startup.
4. Verify daemon wiring, preflight, and sweep tests pass (GREEN).
5. Run the repository commit gate and commit with message: "feat(daemon): wire conflict dispositions and compatibility preflight".

**Files:** `src/conductor/src/daemon-cli.ts`, `src/conductor/test/daemon-cli-ci-fix-wiring.test.ts`, `src/conductor/test/engine/daemon-cli.test.ts`, `src/conductor/test/engine/ci-fix-preflight.test.ts`
**Wired-into:** `src/conductor/src/daemon-cli.ts#runDaemonMode`
**Dependencies:** 2, 5, 7, 8, 13, 14

### Task 16: Enable autoresolve with both repository verification suites
**Story:** Story 5 AC-1; Story 4 AC-2
**Type:** infrastructure

**Steps:**
1. Write a failing self-host config test asserting autoresolve is enabled and its existing `suiteCommand` runs the conductor aggregate suite followed by harness integrity from the repository root.
2. Verify the test fails (RED).
3. Add the existing `mergeable_autoresolve` block to `.ai-conductor/config.yml` with `enabled: true` and `npm --prefix src/conductor test && bash test/test_harness_integrity.sh`.
4. Verify config parsing and the structural command assertion pass (GREEN).
5. Run the repository commit gate and commit with message: "chore(daemon): enable verified conflict autoresolution".

**Files:** `.ai-conductor/config.yml`, `src/conductor/test/engine/self-host-config.test.ts`
**Wired-into:** `src/conductor/src/daemon-cli.ts#runDaemonMode`
**Dependencies:** 15

### Task 17: Pin verified-ship enrollment through retained-worktree dispatch
**Story:** Story 1 AC-1, AC-2 and both negative paths; architecture high-impact ordering risk
**Type:** happy-path

**Steps:**
1. Add a failing acceptance/integration scenario proving only a verified ship enrolls the watch, a retained completed-feature worktree survives, and the next conflicting sweep dispatches; a false/unverified ship and an unwatched branch dispatch nothing.
2. Verify the scenario fails (RED).
3. Adjust only the enrollment-to-classifier wiring needed to preserve verified ship → watch enrollment → processed marking → later sweep ordering.
4. Verify the acceptance scenario and existing false-ship guard tests pass (GREEN).
5. Run the repository commit gate and commit with message: "test(daemon): pin shipped-watch conflict ownership end to end".

**Files:** `src/conductor/src/engine/daemon-runner.ts`, `src/conductor/test/acceptance/autoresolve-conflict-remediation-deadlock-737.acceptance.test.ts`, `src/conductor/test/engine/daemon-runner.test.ts`
**Wired-into:** `src/conductor/src/engine/daemon-runner.ts#makeRunFeature`, `src/conductor/src/daemon-cli.ts#runDaemonMode`
**Dependencies:** 15, 16

### Task 18: Preserve publication safety, terminal logs, and operator-only merge
**Story:** Story 5 AC-1, AC-2 and negatives
**Story:** Story 7 AC-1, AC-2 and negatives
**Type:** negative-path

**Steps:**
1. Extend the acceptance/integration scenario with three failing cases: remote branch movement during remediation, failed preservation/base/suite proof, and successful refresh. Assert the first two publish nothing and produce one stage/reason outcome; success uses lease publication, leaves the PR open, and issues no merge command.
2. Verify the new assertions fail where cross-seam coverage is missing (RED).
3. Thread typed outcome logging through the existing resolution result without weakening work-preservation, current-base, suite, or force-with-lease gates.
4. Verify autoresolve lease, worktree lifecycle, logging, and acceptance tests pass (GREEN).
5. Run the repository commit gate and commit with message: "test(autoresolve): preserve safe publication and human merge authority".

**Files:** `src/conductor/src/engine/autoresolve.ts`, `src/conductor/test/acceptance/autoresolve-conflict-remediation-deadlock-737.acceptance.test.ts`, `src/conductor/test/integration/autoresolve-lease-publish.test.ts`, `src/conductor/test/engine/autoresolve-lease.test.ts`, `src/conductor/test/engine/autoresolve-logging.test.ts`
**Wired-into:** `src/conductor/src/engine/mergeable-sweep.ts#sweepMergeableLabels`
**Dependencies:** 9, 13, 17

## Task Dependency Graph

```text
1 ─┬─> 2 ───────────────┐
   ├─> 3 ─> 4 ──────────┼─> 5 ─> 6 ──────┐
   │                    │        └─> 7 ───┼─> 8 ─> 9 ───────────────┐
10 ─> 11 ─> 12 ─────────┘             │                         │
                 └────────────> 13 <───┘                         │
14 ────────────────────────────────────────────────> 15 ─> 16 ─> 17 ─> 18
2,5,7,8,13 ────────────────────────────────────────> 15
9,13 ────────────────────────────────────────────────────────────> 18
```

## Integration Points

- After Task 5: the sweep can dispatch from the typed conflict domain and persist attempt state.
- After Task 8: each conflicting candidate has one owner and cannot enter normal CI repair.
- After Task 13: terminal escalation is actionable, sticky-last, retryable, and duplicate-safe.
- After Task 15: production daemon startup uses the new classifier, escalation adapter, and warning.
- After Task 17: verified ship enrollment and retained-worktree dispatch are proven across seams.
- After Task 18: the complete hands-off flow is covered through safe publication and operator handoff.

## Acceptance-Criteria Coverage

| Story criterion | Tasks |
|---|---|
| Story 1 AC-1 / negative | 2, 5, 17 |
| Story 1 AC-2 / negative | 2, 17 |
| Story 2 AC-1 / negative | 1, 5, 6, 7 |
| Story 2 AC-2 / negative | 3, 5, 6 |
| Story 2 AC-3 / negative | 3, 6 |
| Story 3 AC-1 / negative | 4, 7, 12 |
| Story 3 AC-2 / negative | 6, 10, 13 |
| Story 3 AC-3 / negative | 11, 12, 13 |
| Story 4 AC-1 / negative | 5, 8, 9, 15 |
| Story 4 AC-2 / negative | 4, 14, 15, 16 |
| Story 5 AC-1 / negative | 16, 18 |
| Story 5 AC-2 / negative | 18 |
| Story 6 AC-1 / negative | 9 |
| Story 6 AC-2 / negative | 3, 4 |
| Story 6 AC-3 / negative | 4, 6, 7, 13 |
| Story 7 AC-1 / negative | 7, 12, 18 |
| Story 7 AC-2 / negative | 18 |

## Verification

- [ ] Every happy and negative acceptance criterion maps to at least one task.
- [ ] Each production surface carries a repo-relative `Wired-into:` call site derived from the architecture review.
- [ ] Dependencies are explicit and acyclic; 18 tasks remain within the normal planning range.
- [ ] Focused tests, `npm --prefix src/conductor test`, and `test/test_harness_integrity.sh` pass.
- [ ] No test performs a real GitHub, LLM, or other third-party call.
- [ ] The configured autoresolve command runs both required repository suites before publication.
