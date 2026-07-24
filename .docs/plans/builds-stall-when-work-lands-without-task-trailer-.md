# Implementation Plan: Commit-movement liveness floor (builds stall when work lands without Task: trailer stamps)

**Date:** 2026-07-23
**Design:** `.docs/architecture/builds-stall-when-work-lands-without-task-trailer-.md` · ADR `adr-2026-07-23-commit-movement-liveness-floor` (APPROVED)
**Stories:** `.docs/stories/builds-stall-when-work-lands-without-task-trailer-.md` (Accepted, 6 stories)
**Conflict check:** Clean as of 2026-07-23 (degrading pair 5 operator-accepted)

## Summary

15 tasks add a commit-movement liveness floor to the build stall breaker, route
budget-exhausted-but-working builds to `build_review`, and demote the attributed-task count to
advisory — so a build with real committed work can never terminally HALT as `no_task_progress`,
while genuine wedges keep today's exact remediation → HALT path.

## Technical Approach

All behavior changes live inside `Conductor.run()`'s build-step retry loop
(`src/conductor/src/engine/conductor.ts`, `while (attempt < stepMaxRetries)` at ~:3149):

- **Per-attempt SHA baseline:** a new `let headShaAttemptStart` captured at the top of each
  attempt and rolled at loop bottom, exactly like `resolvedTasksBefore`. The per-step
  `headShaBeforeBuild` const (~:3054) is untouched — it stays on zero-work telemetry duty.
  Verified: reusing it would credit attempt N with attempt 1's commits (it is captured outside
  the loop).
- **Liveness floor:** the breaker's classification (~:3768-3778) gains a conjunct — `stalled =
  'no_task_progress'` only when the count is pinned AND `headShaAttemptEnd ===
  headShaAttemptStart`. Count pinned + HEAD moved emits a new `unattributed_progress` event and
  falls through to the normal retry path (consuming budget — it does NOT feed the #280 bypass,
  which stays keyed on count movement). A `currentCommitSha` failure treats HEAD as unmoved
  (fail-closed: missing data can cause a stall, never fabricate liveness).
- **Exhaustion routing:** at the retry-exhaustion tail, if any attempt moved HEAD, the step
  exits through the SAME success path the `completion.done` check uses (one advance seam — C1),
  with a routed-reason recording the unresolved ids; `build_review` (sole authority) judges the
  diff, FAIL kicks back bounded by the existing `MAX_KICKBACKS_PER_GATE`.
- **Sequencing:** tests-first per task (RED→GREEN inside each). Behavior tasks 1-12, parity 13,
  invariant 14, docs/CHANGELOG last (15). Bare-numeric task ids.

**Merge-contention advisory (overlap scan):** `conductor.ts` is touched by ~24 unmerged spec
branches (nearest seams: `fresh-build-dispatch-halts-immediately-with-attrib`,
`global-dispatch-circuit-breaker-park-a-feature-aft`). No story-level conflicts (see conflict
report pair 7), but rebases of this feature should re-verify the breaker region line anchors
rather than assuming them.

**Repo release note:** VERSION stays untouched pre-v1 — CHANGELOG `[Unreleased]` entry only.

## Prerequisites

None — no migration, no config, no new dependency. Existing test harness for the conductor
loop (see `src/conductor/test/acceptance/trailer-union-build-completion.acceptance.test.ts`
for the closest fixture style).

## Tasks

### Task 1: `unattributed_progress` event type
**Story:** Story 1 — "an `unattributed_progress` event is emitted"
**Type:** infrastructure

**Steps:**
1. Write failing test: `progress-event-coverage.test.ts` asserts the event union accepts
   `{type: 'unattributed_progress', step, attempt, resolvedCount, headBefore, headAfter}` and
   the persister/renderer paths tolerate it (coverage suite pattern).
2. Verify RED.
3. Implement: add the event to the union in `types/events.ts` with the five fields.
4. Verify GREEN.
5. Commit: "events: add unattributed_progress to the build event union"

**Files:**
- src/conductor/src/types/events.ts — new union member
- src/conductor/test/progress-event-coverage.test.ts — coverage assertion

**Wired-into:** none (inert until src/conductor/src/engine/conductor.ts) — emitted by Task 3
**Dependencies:** none

### Task 2: RED — count pinned + HEAD moved must not classify as a stall
**Story:** Story 1 happy paths 1-2 (the 20-commit/3-trailer regression shape)
**Type:** happy-path

**Steps:**
1. Write failing acceptance test in
   `src/conductor/test/acceptance/builds-stall-when-work-lands-without-task-trailer-.acceptance.test.ts`:
   fixture drives the build retry loop where each attempt lands a real commit but the
   resolved-task count stays pinned (sparse trailers — model the live worktree shape); asserts
   (a) no attempt sets `no_task_progress`, (b) no "resolved tasks stayed at" HALT file is
   written, (c) an `unattributed_progress` event is emitted per pinned-count-moved-HEAD attempt.
2. Verify RED (today: attempt 2 classifies `no_task_progress`).
3. No implementation in this task — RED lands with the fixture committed and the spec marked
   `.skip`-free but expected-failing per the repo's RED convention.
4. Commit: "test(engine): RED — committed-but-unattributed work must not classify as build stall"

**Files:**
- src/conductor/test/acceptance/builds-stall-when-work-lands-without-task-trailer-.acceptance.test.ts — new fixture + assertions

**Wired-into:** none (no new production surface)
**Dependencies:** 1

### Task 3: GREEN — per-attempt SHA baseline + liveness-floor conjunct + event emission
**Story:** Story 1 (all happy paths), Story 2 happy path
**Type:** happy-path

**Steps:**
1. In `Conductor.run()`'s build retry loop: capture `headShaAttemptStart` at attempt top;
   capture attempt-end SHA where the breaker classifies; add the conjunct
   (`… && headUnmoved`) to the `no_task_progress` branch; emit `unattributed_progress` via
   `emitTracked` on the pinned-count/moved-HEAD path; roll the baseline at loop bottom beside
   `resolvedTasksBefore`.
2. Verify Task 2's test passes GREEN; existing breaker tests still pass.
3. Commit: "engine: liveness floor — no_task_progress requires pinned HEAD this attempt"

**Files:**
- src/conductor/src/engine/conductor.ts — retry-loop baseline + classification conjunct + emit

**Wired-into:** src/conductor/src/engine/conductor.ts#run
**Dependencies:** 2

### Task 4: C2 regression — commit-then-wedge still stalls (per-attempt granularity proof)
**Story:** Story 2 negative paths
**Type:** negative-path

**Steps:**
1. Write failing-under-wrong-impl test: attempt 1 lands one commit, attempts 2..N land none
   with count pinned; assert attempts 2+ classify `no_task_progress` and the build reaches
   remediation → HALT as today. Constructed so a per-step-baseline implementation (comparing
   against `headShaBeforeBuild`) would keep every attempt "live" and FAIL this test.
2. Verify GREEN under Task 3's per-attempt implementation.
3. Add assertion that per-step `headShaBeforeBuild` call sites are unchanged (zero-work seam
   still receives the step-entry SHA).
4. Commit: "test(engine): C2 — one early commit cannot blind wedge detection"

**Files:**
- src/conductor/test/acceptance/builds-stall-when-work-lands-without-task-trailer-.acceptance.test.ts — commit-then-wedge fixture

**Wired-into:** none (no new production surface)
**Dependencies:** 3

### Task 5: SHA-read failure is fail-closed
**Story:** Story 1 negative path 3
**Type:** negative-path

**Steps:**
1. Write failing test: inject `currentCommitSha` failure (non-repo dir or stubbed git error)
   for baseline and/or endpoint; assert the attempt classifies exactly as it would with
   unmoved HEAD (stall still reachable; liveness never fabricated).
2. Implement: treat null/error SHA as "unmoved" in the floor conjunct.
3. Verify GREEN.
4. Commit: "engine: sha-read failure degrades to today's stall behavior (fail-closed)"

**Files:**
- src/conductor/src/engine/conductor.ts — null-SHA handling in the floor
- src/conductor/test/acceptance/builds-stall-when-work-lands-without-task-trailer-.acceptance.test.ts — git-failure case

**Wired-into:** same as Task 3
**Dependencies:** 3

### Task 6: halt_marker precedence and #280 bypass untouched
**Story:** Story 1 negative path 2, happy path 3; Story 5 negative paths 1-2
**Type:** negative-path

**Steps:**
1. Write tests: (a) halt marker present + HEAD moved ⇒ `stalled = 'halt_marker'` (marker wins);
   (b) count moved ⇒ #280 bypass fires exactly as today (floor adds no interference — run the
   existing #280 suite unmodified plus one explicit moved-count-moved-HEAD case).
2. Verify both pass against Task 3's implementation (expected: no code change; if either fails,
   fix the classification ordering).
3. Commit: "test(engine): halt-marker precedence + progress-bypass invariance under the floor"

**Files:**
- src/conductor/test/acceptance/builds-stall-when-work-lands-without-task-trailer-.acceptance.test.ts — precedence + bypass cases

**Wired-into:** none (no new production surface)
**Dependencies:** 3

### Task 7: RED — budget exhaustion with real work must route to build_review
**Story:** Story 3 happy path 1
**Type:** happy-path

**Steps:**
1. Write failing test: budget exhausts (all attempts pinned count, every attempt moved HEAD);
   assert (a) step advances to `build_review`, (b) NO terminal `no_task_progress` HALT file,
   (c) routed-reason names the unresolved plan ids.
2. Verify RED (today: terminal HALT with "resolved tasks stayed at").
3. Commit: "test(engine): RED — exhausted budget with real commits routes to the authority"

**Files:**
- src/conductor/test/acceptance/builds-stall-when-work-lands-without-task-trailer-.acceptance.test.ts — exhaustion-routing fixture

**Wired-into:** none (no new production surface)
**Dependencies:** 3

### Task 8: GREEN — routing branch at the retry-exhaustion tail (single advance seam)
**Story:** Story 3 happy path 1 · condition C1
**Type:** happy-path

**Steps:**
1. Implement: track `anyAttemptMovedHead` across the loop; at the exhaustion tail, when true,
   exit through the SAME success path the `completion.done` check uses (no second advance
   code path), recording a routed-reason (`routed: unresolved [ids] after N attempts with
   commit movement`) into the step evidence.
2. Verify Task 7 GREEN.
3. Commit: "engine: route exhausted-but-working builds to build_review via the completion seam"

**Files:**
- src/conductor/src/engine/conductor.ts — exhaustion-tail routing branch

**Wired-into:** src/conductor/src/engine/conductor.ts#run
**Dependencies:** 7

### Task 9: C1 identity test — routed advance ≡ gate advance
**Story:** Story 3 happy path 2 · condition C1
**Type:** negative-path

**Steps:**
1. Write test: run one fixture to `completion.done` advance and one to routed advance; assert
   persisted step state (state file entry, gate bookkeeping, next-step scheduling) is
   identical between the two.
2. Verify GREEN (if not, Task 8's branch is using a divergent path — fix there).
3. Commit: "test(engine): C1 — one advance seam, identity-asserted"

**Files:**
- src/conductor/test/acceptance/builds-stall-when-work-lands-without-task-trailer-.acceptance.test.ts — advance-identity case

**Wired-into:** none (no new production surface)
**Dependencies:** 8

### Task 10: No-movement exhaustion keeps today's remediation → HALT path
**Story:** Story 3 negative path 1; Story 5 happy paths 1-2
**Type:** negative-path

**Steps:**
1. Write test: budget exhausts with zero commits across attempts; assert the #569 remediation
   prompt synthesis shape (`Build stall: no forward progress (resolved X → Y tasks).
   Completion gate: <reason>.`), the terminal HALT reason shape ("build stalled: no task
   progress…"), and that no routing to build_review occurs.
2. Verify GREEN against existing behavior (expected: no code change).
3. Commit: "test(engine): genuine wedge preserved — remediation and HALT shapes unchanged"

**Files:**
- src/conductor/test/acceptance/builds-stall-when-work-lands-without-task-trailer-.acceptance.test.ts — wedge-preservation case

**Wired-into:** none (no new production surface)
**Dependencies:** 8

### Task 11: Kickback bound on routed builds
**Story:** Story 3 negative paths 2-3
**Type:** negative-path

**Steps:**
1. Write test: routed build reaches build_review; stub a FAIL verdict; assert kickback fires
   and repeated route→FAIL cycles stop at `MAX_KICKBACKS_PER_GATE` (no infinite loop); include
   the no-op-commit gaming shape (empty commits each attempt ⇒ routed ⇒ FAIL ⇒ bounded).
2. Verify GREEN (expected: existing kickback machinery; fix only if the routed entry bypasses
   the counter).
3. Commit: "test(engine): routed builds inherit the kickback bound"

**Files:**
- src/conductor/test/acceptance/builds-stall-when-work-lands-without-task-trailer-.acceptance.test.ts — kickback-bound + gaming cases

**Wired-into:** none (no new production surface)
**Dependencies:** 8

### Task 12: C3 end-to-end — untouched plan task surfaces at the authority
**Story:** Story 4 (all criteria)
**Type:** negative-path

**Steps:**
1. Write e2e test: plan of N tasks, commits covering 1..N-1, nothing for task N; build routes
   forward (movement present); stub the build_review grader to inspect its input and return
   FAIL naming task N; assert the kickback re-dispatch context carries the gap AND the
   routed-reason listed task N as unresolved (routing is explicit, never silent).
2. Verify GREEN.
3. Commit: "test(engine): C3 — routing-only is never always-pass"

**Files:**
- src/conductor/test/acceptance/builds-stall-when-work-lands-without-task-trailer-.acceptance.test.ts — C3 e2e case

**Wired-into:** none (no new production surface)
**Dependencies:** 8

### Task 13: Consumer parity — re-kick eligibility and kickback baselines
**Story:** Story 6 happy path 2
**Type:** negative-path

**Steps:**
1. Write parity tests over mixed fixtures (rows-only / trailers-only / mixed): assert
   `countResolvedTasks` values observed by `daemon-cli.ts` re-kick eligibility (:435) and the
   kickback-escalation baselines (`conductor.ts:1922/:1945`) are identical pre/post this
   feature (no signature or semantics change to the fold).
2. Verify GREEN (expected: no code change — this pins it).
3. Commit: "test(engine): countResolvedTasks consumer parity under the floor"

**Files:**
- src/conductor/test/acceptance/builds-stall-when-work-lands-without-task-trailer-.acceptance.test.ts — parity cases

**Wired-into:** none (no new production surface)
**Dependencies:** 3

### Task 14: Executable invariant — no stall classification without pinned HEAD
**Story:** Story 6 negative path 2; Story 1
**Type:** negative-path

**Steps:**
1. Write invariant test sweeping the fixture suite: every recorded `no_task_progress`
   classification in the suite's runs carries pinned-HEAD evidence (attempt start == end);
   any future call site that classifies on count alone fails this test.
2. Verify GREEN.
3. Commit: "test(engine): invariant — count alone can never kill a build"

**Files:**
- src/conductor/test/acceptance/builds-stall-when-work-lands-without-task-trailer-.acceptance.test.ts — invariant sweep

**Wired-into:** none (no new production surface)
**Dependencies:** 4, 5, 6, 10

### Task 15: Contract text + CHANGELOG (docs track the feature, same PR)
**Story:** Story 6 happy path 3, negative path 1
**Type:** infrastructure

**Steps:**
1. Update `skills/pipeline/SKILL.md`, `docs/daemon-operations.md`, `src/conductor/README.md`:
   one consistent statement — attributed count = advisory routing/telemetry; commit movement =
   liveness authority; `build_review` = completion authority. Remove/rewrite any residual
   claim that the count alone halts builds (grep-audit `no task progress`/`resolved tasks`
   phrasing across docs).
2. Add CHANGELOG `[Unreleased]` → Fixed entry. Do NOT touch VERSION (pre-v1 rule).
3. Run `test/test_harness_integrity.sh` (repo validation gate).
4. Commit: "docs: count is advisory, movement is liveness, build_review is authority"

**Files:**
- skills/pipeline/SKILL.md — contract text
- docs/daemon-operations.md — stall/halt semantics
- src/conductor/README.md — engine behavior note
- CHANGELOG.md — [Unreleased] Fixed entry

**Wired-into:** none (no new production surface)
**Dependencies:** 3, 8, 14

## Task Dependency Graph

```
1 ──▶ 2 ──▶ 3 ──▶ 4 ──┐
            ├──▶ 5 ──┤
            ├──▶ 6 ──┼──▶ 14 ──▶ 15
            ├──▶ 13  │
            └──▶ 7 ──▶ 8 ──▶ 9
                       ├──▶ 10 ──▶ 14
                       ├──▶ 11
                       └──▶ 12
(15 also depends on 8; 14 gathers 4,5,6,10)
```

## Integration Points

- After Task 3: the false-stall class is dead in-engine — the Task 2 regression fixture (the
  live halted-worktree shape) runs clean end-to-end.
- After Task 8: full routing behavior observable — exhausted-but-working builds reach
  build_review in a fixture run.
- After Task 12: the complete authority loop (route → FAIL → kickback) is demonstrated e2e.

## Verification

- [ ] All happy path criteria covered: S1→T2/T3, S2→T3/T4, S3→T7/T8/T9, S4→T12, S5→T6/T10, S6→T13/T15
- [ ] All negative path criteria covered: S1→T5/T6, S2→T4, S3→T10/T11, S4→T12, S5→T6/T10 (+C4 in conflict report), S6→T14/T15
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies explicit and acyclic (graph above)
- [ ] Every task carries Files, Wired-into, Dependencies lines
