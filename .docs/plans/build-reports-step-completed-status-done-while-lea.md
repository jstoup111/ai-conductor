# Implementation Plan: Uncommitted-work floor under BUILD completion (#1270)

**Date:** 2026-08-03
**Issue:** jstoup111/ai-conductor#1270
**Design:** `.docs/decisions/adr-2026-08-03-uncommitted-work-floor-under-build-completion.md` (APPROVED)
**Review:** `.docs/decisions/architecture-review-2026-08-03-uncommitted-work-floor-under-build-completion.md` (APPROVED)
**Architecture:** `.docs/architecture/build-reports-step-completed-status-done-while-lea.md`
**Stories:** .docs/stories/build-reports-step-completed-status-done-while-lea.md
**Stories status:** Accepted; S1–S8
**Complexity:** `.docs/complexity/build-reports-step-completed-status-done-while-lea.md`
**Conflict check:** CLEAR as of 2026-08-03 (`.docs/conflicts/build-reports-step-completed-status-done-while-lea.md`) — one HIGH coordination note with in-flight #1227
**Track/Tier:** technical · M

## Summary

Make an uncommitted working tree a blocking condition on BUILD completion, enforced at **both**
paths to `step_completed status:done`: the `build` completion predicate and the budget-exhaustion
escape. The condition is observed through one optional injected probe on `CompletionContext`,
built once in `completionCtx` exactly like the four probes already there. A dirty tree returns an
ordinary completion miss, so the existing retry/hint/kickback machinery makes the common case
self-healing. Plus one additive, reader-less cleanliness field on suite evidence. 13 tasks.

## Technical Approach

- **`artifacts.ts`** gains `worktreeStatus?: () => Promise<string | null>` on `CompletionContext`
  (beside `getHeadSha`/`isHeadPushed`/`wiringProbe`/`fullSuiteInspect`, `:886-913`) and one small
  exported helper — `uncommittedPathsOrNull(ctx)` — that owns the entire fail direction: probe
  absent ⇒ `null`, probe throws ⇒ `null`, probe returns empty ⇒ `null`, non-empty ⇒ the parsed
  path list. Both enforcement sites consume that helper so their behavior cannot drift (S6).
  The `build` predicate (`:1747-1938`) consults it **after** the existing task-resolution check
  and returns `{ done: false, missing: 'uncommitted', reason }`, reusing the unresolved-task
  reason's 3-name-plus-count truncation.
- **`conductor.ts`** injects the probe in `completionCtx` (`:1191-1364`) as a closure over
  `this.git`/`this.projectRoot` running `git status --porcelain --untracked-files=all`; guards the
  `anyAttemptMovedHead` escape (`:5640-5680`) with the same helper so a dirty tree HALTs instead of
  routing; and adds an `uncommitted` branch to `buildRetryHint` (`:8038-8102`) keyed on the new
  `missing` classification.
- **`full-suite-evidence.ts` / `full-suite-verifier.ts`** gain one additive optional boolean on the
  pass and fail evidence shapes, written at the two fingerprint-time sites (`:649`, `:799`),
  omitted when undeterminable. Validators accept absence. **No reader is added and no freshness
  semantics change** — the content fingerprint remains the sole authority.
- **Sequencing:** probe + helper first (T1–T2), predicate consumption (T3–T5), the escape guard
  and its regression proof (T6–T8) — the highest-risk work, deliberately mid-plan with tests
  bracketing it — then hint (T9), parity/no-op pins (T10), the rebase closure pin (T11), the
  evidence field (T12), and contract/doc sync (T13).
- Tests live in the existing homes: `src/conductor/test/engine/artifacts.test.ts`,
  `…/engine/conductor.test.ts`, `…/engine/full-suite-evidence.test.ts`. Per
  `.agents/skills/write-tests/SKILL.md`, real local git repos are used only where git semantics
  are the subject (the probe itself); every conductor-level assertion is made at the narrowest
  seam that owns the behavior, not through a full `Conductor.run()`.

## Prerequisites

None. Every primitive exists (`worktreeStatus` in `worktree-shared.ts:80-82` as the shape
precedent, the four existing probe injections, `CompletionResult.missing`, `buildRetryHint`). No
migration, no config key, no new dependency. Per repo policy this branch writes **no** `VERSION`
and **no** `CHANGELOG.md`; the PR declares `Release-Disposition: note` / `Fixed` / `patch`.

## Task Dependency Graph

```
T1 ──┬─ T2 ──┬─ T3 ── T4 ── T5
     │       │
     │       ├─ T6 ── T7 ── T8
     │       │
     │       ├─ T9
     │       ├─ T10
     │       └─ T11
     └─ T12 (independent)
T3,T6,T9,T12 ─────────────── T13
```

## Tasks

### Task 1: Working-tree probe type + fail-direction helper
**Story:** S1
**Type:** happy-path
**Dependencies:** none
**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/engine/artifacts.test.ts`

**Steps:**
1. Write failing tests for `uncommittedPathsOrNull(ctx)`: probe absent ⇒ null; probe resolving `''` ⇒ null; probe resolving `null` ⇒ null; probe throwing ⇒ null; probe resolving porcelain text ⇒ parsed path list preserving order.
2. Verify RED (export does not exist).
3. Add `worktreeStatus?: () => Promise<string | null>` to `CompletionContext`, documented with the same fail-open contract wording as `getHeadSha` (`artifacts.ts:886-891`). Implement and export `uncommittedPathsOrNull`, parsing porcelain lines into paths (handling the `XY path` and rename `orig -> new` forms).
4. Verify GREEN.
5. Commit: "feat(engine): add worktreeStatus probe and uncommitted-paths helper"

### Task 2: Inject the probe in completionCtx
**Story:** S1
**Type:** happy-path
**Dependencies:** T1
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor.test.ts`

**Steps:**
1. Write a failing test asserting a context built by `completionCtx` carries a `worktreeStatus` probe that, against a real temp git repo with one modified tracked file and one untracked non-ignored file, returns a porcelain string naming both — and returns `''` when only gitignored paths differ.
2. Verify RED.
3. Inject `worktreeStatus` in `completionCtx` as a closure running `git status --porcelain --untracked-files=all` via `this.git` in `this.projectRoot`, returning `null` on any git error.
4. Verify GREEN.
5. Commit: "feat(engine): inject worktreeStatus into the completion context"

### Task 3: Build predicate withholds completion on a dirty tree
**Story:** S2
**Type:** happy-path
**Dependencies:** T2
**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/engine/artifacts.test.ts`

**Steps:**
1. Write failing tests: with all plan tasks resolved and a probe reporting `src/a.ts` modified, the `build` predicate returns `done:false`, `missing:'uncommitted'`, and a reason naming `src/a.ts`; with seven dirty paths the reason names three and reports the remaining count.
2. Verify RED (predicate currently returns done).
3. Add the conjunct after the task-resolution check, using `uncommittedPathsOrNull` and the existing truncation format.
4. Verify GREEN.
5. Commit: "fix(engine): build completion withholds handoff while the worktree is dirty"

### Task 4: Predicate check-ordering is pinned
**Story:** S2
**Type:** negative-path
**Dependencies:** T3
**Files:** `src/conductor/test/engine/artifacts.test.ts`

**Steps:**
1. Write failing tests asserting precedence with a dirty tree present in every case: halt marker ⇒ halt reason; unresolvable/empty plan ⇒ plan reason; unresolved tasks ⇒ unresolved-task reason. The uncommitted reason appears only when all earlier branches pass.
2. Verify RED where ordering is not yet guaranteed; adjust placement if any assertion fails.
3. Verify GREEN.
4. Commit: "test(engine): pin build-predicate check ordering against the dirty-tree conjunct"

### Task 5: Probe-absent contexts behave exactly as today
**Story:** S6
**Type:** negative-path
**Dependencies:** T3
**Files:** `src/conductor/test/engine/artifacts.test.ts`

**Steps:**
1. Write failing tests: a context with no probe and all tasks resolved ⇒ `done:true`; a probe that throws ⇒ `done:true`; a probe returning `null` ⇒ `done:true`; a probe returning non-empty ⇒ `done:false`.
2. Verify RED/GREEN as appropriate.
3. Add a regression assertion that `verifyArtifacts:false` mocked-dispatch flows consult no probe.
4. Commit: "test(engine): pin fail-open-on-absence, fail-closed-on-dirt"

### Task 6: Guard the budget-exhaustion escape
**Story:** S3
**Type:** happy-path
**Dependencies:** T2
**Files:** `src/conductor/src/engine/conductor.ts`

**Steps:**
1. Write a failing test at the narrowest seam owning the escape: budget exhausted, `anyAttemptMovedHead` true, probe reporting a dirty tree ⇒ the escape does not set `succeeded`.
2. Verify RED.
3. Guard the `anyAttemptMovedHead` branch (`conductor.ts:5640-5680`) with `uncommittedPathsOrNull`; when dirty, skip the route and fall through to the halt path. Clean or indeterminate ⇒ route exactly as today.
4. Verify GREEN.
5. Commit: "fix(engine): exhaustion escape refuses to route an uncommitted worktree"

### Task 7: Regression proof for the exact #1270 bypass shape
**Story:** S3
**Type:** negative-path
**Dependencies:** T6
**Files:** `src/conductor/test/engine/conductor.test.ts`

**Steps:**
1. Write a failing test constructing the precise bypass: an early attempt commits (moving HEAD), the final attempt leaves tracked files modified, the retry budget exhausts. Assert **no** `step_completed` event with `status:'done'` is emitted for `build`, and that `build_review` is never dispatched.
2. Verify RED against a pre-Task-6 build to prove the test would have caught the original defect.
3. Verify GREEN.
4. Add the mirror-image parity test: same shape but a clean tree ⇒ routes to `build_review` with `build_routed_reason` recorded unchanged.
5. Commit: "test(engine): regression proof for the dirty-tree completion bypass"

### Task 8: HALT reason leads with the uncommitted paths
**Story:** S3
**Type:** happy-path
**Dependencies:** T6
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor.test.ts`

**Steps:**
1. Write a failing test: a dirty-tree exhaustion halt's marker body leads with the offending paths, not the generic "retries exhausted" text.
2. Verify RED.
3. Add the reason into the existing terminal reason-selection ladder (`conductor.ts:6480-6497`) at a precedence that does not displace an already-written halt marker.
4. Verify GREEN, and assert the no-commit-movement dirty case still takes the pre-existing remediation-then-HALT path with exactly one halt marker written.
5. Commit: "feat(engine): halt reason names uncommitted paths"

### Task 9: Retry hint steers the next dispatch to commit
**Story:** S5
**Type:** happy-path
**Dependencies:** T2
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor.test.ts`

**Steps:**
1. Write failing tests: a miss classified `missing:'uncommitted'` produces a hint naming the paths and instructing the session to commit them; every other miss classification produces today's text byte-for-byte.
2. Verify RED.
3. Add the `uncommitted` branch to `buildRetryHint` (`conductor.ts:8038-8102`).
4. Verify GREEN.
5. Commit: "feat(engine): retry hint names the paths a dirty build must commit"

### Task 10: A no-op build still completes
**Story:** S4
**Type:** negative-path
**Dependencies:** T2
**Files:** `src/conductor/test/engine/artifacts.test.ts`

**Steps:**
1. Write failing tests: all tasks resolved with an empty porcelain result ⇒ `done:true`; tasks resolved by a prior attempt's commits with a clean tree ⇒ `done:true`; a worktree whose only residue is gitignored `.pipeline/` state ⇒ reads clean and completes.
2. Verify GREEN (these should pass once T3 is correct — any RED here indicates the conjunct is over-broad).
3. Add the false-positive guard: an untracked-but-gitignored file never blocks.
4. Commit: "test(engine): a no-op build and gitignored residue still complete"

### Task 11: Pin the post-rebase closure path against autostash
**Story:** S7
**Type:** negative-path
**Dependencies:** T3
**Files:** `src/conductor/test/engine/conductor.test.ts`, `docs/reference/steps.md`

**Steps:**
1. Write a test exercising the post-rebase build closure check (`conductor.ts:7651`) after a rebase whose `--autostash` reapplied changes, leaving tracked files modified. Assert the resulting behavior explicitly.
2. If the assertion shows the closure path now blocks where it previously advanced, decide and implement the deliberate behavior (block, with the reason naming the paths, is the ADR-consistent default) rather than leaving it incidental.
3. Verify the conflict-halt path is untouched.
4. Record the chosen behavior in `docs/reference/steps.md`'s `build` row.
5. Commit: "test(engine): pin post-rebase build closure against a reapplied autostash"

### Task 12: Suite evidence records worktree cleanliness
**Story:** S8
**Type:** happy-path
**Dependencies:** T1
**Files:** `src/conductor/src/engine/full-suite-evidence.ts`, `src/conductor/src/engine/full-suite-verifier.ts`, `src/conductor/test/engine/full-suite-evidence.test.ts`

**Steps:**
1. Write failing tests: PASS and FAIL evidence each carry the cleanliness boolean; evidence written without the field still validates and is usable (round-trip against a pre-change fixture); an undeterminable cleanliness omits the field rather than defaulting to `true`.
2. Verify RED.
3. Add the additive optional field to the pass and fail shapes and their validators; populate at the two fingerprint-time write sites (`full-suite-verifier.ts:649,799`). Leave `buildPreflightFailEvidence` (`:835`) alone — it has no fingerprint.
4. Verify GREEN, and assert the `test_suite` completion predicate's verdict is unchanged in every case (no reader added).
5. Commit: "feat(engine): record worktree cleanliness on suite evidence"

### Task 13: Contract and documentation sync
**Story:** S7
**Type:** happy-path
**Dependencies:** T3
**Files:** `docs/reference/steps.md`, `docs/explanation/gates.md`, `docs/runbooks/stalled-or-stuck-feature.md`, `skills/pipeline/SKILL.md`, `docs/reference/artifacts.md`

**Steps:**
1. `docs/reference/steps.md` — extend the `build` row's "What satisfies the gate" to include the clean-worktree conjunct, and note the fail-open-on-absence direction.
2. `docs/explanation/gates.md` — amend the "Exhausted but working" paragraph (`:206-222`), whose current text says commit movement alone routes onward; state the clean-tree precondition.
3. `docs/runbooks/stalled-or-stuck-feature.md` — add the "build halted naming uncommitted paths" symptom with its resolution (commit or discard the named paths), since this becomes a reachable operator-visible halt.
4. `skills/pipeline/SKILL.md` — rewrite the prompt-level "Retry Pre-Check" (`:427-431`) to state that the engine now enforces this mechanically, per the repo's deterministic-enforcement principle.
5. `docs/reference/artifacts.md` — note the new suite-evidence field.
6. Run `test/test_harness_integrity.sh` and the full suite; fix any failure before committing.
7. Commit: "docs: uncommitted-work floor under build completion"

## Coverage Check (story → task)

| Story | Tasks |
|---|---|
| S1 | 1, 2 |
| S2 | 3, 4 |
| S3 | 6, 7, 8 |
| S4 | 10 |
| S5 | 9 |
| S6 | 5 |
| S7 | 11, 13 |
| S8 | 12 |

## Validation

- `npm test` (full suite) green.
- `test/test_harness_integrity.sh` green — all 17 numbered checks plus lettered sub-checks.
- Task 7's RED-against-pre-fix step is the acceptance proof that the original #1270 defect is
  actually closed, not merely guarded in the abstract.

## Out of scope

- **#1249** (retained stale `wiring_check` pass across a BUILD repair) — different mechanism; do
  not close it on this work.
- **#1269** (daemon parks on unsatisfied prerequisites rather than re-running them).
- Generalizing the conjunct beyond `build` to `acceptance_specs` or other authoring steps
  (ADR Decision 6).
