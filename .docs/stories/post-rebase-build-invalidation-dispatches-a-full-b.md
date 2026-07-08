**Status:** Accepted

# Stories: Post-rebase gate-first mechanical re-verify (#420)

**Track:** technical (no PRD — criteria derive from
`adr-2026-07-08-post-rebase-gate-first-mechanical-reverify.md`, APPROVED, and review conditions
C1–C3). All behavior is daemon-mode: the non-daemon rebase step forces a `noop` outcome and
never reaches the invalidation branch.

---

## Story 1: Evidence-intact build gate is confirmed mechanically — no build dispatch

As a daemon operator, I want a file-changing finish-time rebase to confirm the build gate from
git evidence instead of re-dispatching the build agent, so a routine concurrent-merge rebase
costs ~1–2 minutes and zero LLM tokens instead of ~45–60 minutes.

### Acceptance Criteria

#### Happy Path
- Given a daemon build whose plan tasks are all evidence-complete (git evidence trailers
  present and path-corroborated) and a finish-time rebase that applies cleanly but changes
  code/test paths, when the rebase step applies its verdicts, then the build gate's verdict is
  recomputed from the mechanical predicate and written `satisfied: true` with a fresh
  `checkedAt` and a reason stating it was re-verified mechanically after a file-changing rebase
  (C2 — a stale untouched verdict file is not acceptable).
- Given the same conditions, when the loop resumes after the rebase step, then the build step
  is NOT dispatched (its runner is never invoked on this lap) and the loop proceeds to the
  remaining unsatisfied gates.
- Given the same conditions, when verdicts are applied, then a structured
  `rebase_gate_reverified` event for `build` (recording that dispatch was skipped) is emitted
  to the event log (C2).

#### Negative Paths
- Given the rebase outcome is `noop` or `changelog_resolved` (docs-only), when verdicts are
  applied, then no pre-verify runs and no gate is invalidated — identical to today (FR-4
  preserved).
- Given the mechanical pre-verify itself throws (e.g. plan file unreadable, git command fails
  mid-derivation), when the rebase step applies its verdicts, then the build gate is written
  `satisfied: false` with `kickback: { from: 'rebase' }` exactly as today — an erroring
  pre-verify NEVER confirms a gate (fail-closed).

### Done When
- [ ] `test/integration/rebase-loop.test.ts` evidence-intact case asserts `buildRuns === 1`
      after a file-changing rebase (inverted from today's pinned `=== 2`).
- [ ] `.pipeline/gates/build.json` after the lap contains `satisfied: true`, a `checkedAt`
      newer than the rebase, and a mechanical-re-verify reason string.
- [ ] `events.jsonl` contains a `rebase_gate_reverified` event for `build` on that lap.
- [ ] A unit test makes the injected pre-verify throw and asserts the written build verdict is
      `satisfied: false` with `kickback.from === 'rebase'`.

---

## Story 2: Genuinely-pending work after a rebase still dispatches the build agent

As a daemon operator, I want the build agent still dispatched whenever the mechanical gate
finds unresolved plan tasks after a file-changing rebase, so the gate-first optimization never
ships un-built work (the fail-closed invariant of Phase 9.0 FR-5/FR-6 is unchanged).

### Acceptance Criteria

#### Happy Path
- Given a file-changing rebase and a plan containing at least one task with no git evidence
  trailer (genuinely incomplete), when the rebase step applies its verdicts, then the build
  gate is written `satisfied: false` with `kickback: { from: 'rebase', evidence: <changed
  paths> }` and the loop re-dispatches the build agent — byte-for-byte today's behavior.

#### Negative Paths
- Given a task whose evidence trailer exists but fails path corroboration (trailer commit
  touches none of the task's plan paths), when the pre-verify derives completion, then that
  task does not count as resolved and the build gate is invalidated and dispatched (the
  existing evidence bar is not lowered by this feature).
- Given a forged `task-status.json` marking all tasks completed but no evidence stamps in the
  sidecar, when the pre-verify runs, then the gate does not pass (H6/H7 sidecar-only trust is
  unchanged) and build is dispatched.

### Done When
- [ ] `test/integration/rebase-loop.test.ts` keeps a case pinning `buildRuns === 2` when a plan
      task has no evidence post-rebase (C3).
- [ ] The written verdict in that case carries `kickback.from === 'rebase'` with the
      changed-paths evidence string, unchanged in shape from today.

---

## Story 3: Non-tree-attesting gates are always invalidated by a file-changing rebase

As a daemon operator, I want `build_review` and `manual_test` (when it ran) unconditionally
invalidated by a file-changing rebase, so gates whose predicates cannot attest the rebased tree
are never confirmed from stale same-session artifacts.

### Acceptance Criteria

#### Happy Path
- Given a file-changing rebase where the build pre-verify passes, when verdicts are applied,
  then `build_review` and (if it ran) `manual_test` are still written `satisfied: false` with
  `kickback: { from: 'rebase' }` and re-run on the lap — only `build` is eligible for
  mechanical confirmation.

#### Negative Paths
- Given a pre-rebase `.pipeline/manual-test-results.md` written earlier in the SAME daemon
  session (mtime fresh, latest attempt all PASS), when the rebase changes code paths, then
  manual_test is invalidated anyway — the session-fresh clean results file must NOT satisfy the
  gate on this lap without a re-run.
- Given manual_test was skipped for the feature, when verdicts are applied, then manual_test is
  not kicked back (today's `ranManualTest` behavior preserved) while `build_review` still is.

### Done When
- [ ] Integration case asserts `build_review` re-runs (its runner invoked) on an
      evidence-intact lap where build was skipped.
- [ ] Integration/unit case asserts manual_test's verdict is `satisfied: false` after a
      file-changing rebase despite a fresh all-PASS results file from the same session.
- [ ] Unit test on `applyRebaseVerdicts` pins the kicked-back set: `['build_review']` or
      `['build_review','manual_test']` when the pre-verify passes, plus `'build'` when it fails.

---

## Story 4: Review-kickback rework is never short-circuited by the pre-verify

As a daemon operator, I want the mechanical pre-verify to exist ONLY inside the rebase
invalidation path, so a review-requested rework (kickback from `build_review` or any
non-rebase step) is never cancelled by a still-passing evidence derivation — the loop must not
oscillate (review fails → build skipped → review fails …).

### Acceptance Criteria

#### Happy Path
- Given `build_review` writes a kickback verdict re-opening `build` (`kickback.from ===
  'build_review'`) while build's git evidence still derives complete, when the loop re-enters,
  then the build agent IS dispatched for the rework — no mechanical pre-check intercepts a
  non-rebase kickback anywhere in the loop.

#### Negative Paths
- Given a lap where a rebase invalidation and a review kickback both exist for build (rebase
  writes its verdict, then a review kickback overwrites it), when the loop selects build, then
  the dispatch happens — the pre-verify result from the rebase path never masks the later
  review kickback (last-writer verdict is authoritative, unchanged selector semantics).

### Done When
- [ ] Existing review-kickback loop tests pass unchanged (no modification to their
      expectations).
- [ ] A regression test constructs evidence-complete build state plus a `build_review`
      kickback and asserts the build runner is invoked.

---

## Story 5: Selective reset and fail-closed default wiring

As a maintainer of the conductor engine, I want `advanceTail` to reset `done → pending` only
for the steps actually kicked back, and callers without the injected pre-verify capability to
get today's behavior byte-identically, so the optimization cannot corrupt loop state or change
behavior in tests/legacy paths.

### Acceptance Criteria

#### Happy Path
- Given the build pre-verify passed (build not in the returned `kickedBack` list), when
  `advanceTail` processes the rebase outcome, then build's step status remains `done` and only
  the actually-kicked-back steps are reset to `pending` and re-emitted as kickback events (C1
  — no hardcoded `['build','build_review','manual_test']` reset).

#### Negative Paths
- Given `applyRebaseVerdicts` is called WITHOUT the pre-verify capability (unit tests, any
  legacy caller), when a file-changing rebase outcome is applied, then all of today's targets
  (`build`, `build_review`, + `manual_test` if it ran) are invalidated unconditionally —
  absence of the capability fail-closes to current behavior.
- Given the pre-verify passed for build, when `advanceTail` re-emits kickback events, then no
  kickback event is emitted for build (event stream must match the actual kicked-back set — no
  phantom kickbacks in `daemon.log` forensics).

### Done When
- [ ] Unit test: `advanceTail` (or its extracted helper) leaves build `done` and resets exactly
      the `kickedBack` list from `applyRebaseVerdicts`.
- [ ] Unit test: `applyRebaseVerdicts` without the capability invalidates the full target set
      (existing `test/engine/rebase.test.ts` expectations remain green unchanged).
- [ ] Event-stream assertion: kickback events on an evidence-intact lap name only
      `build_review`/`manual_test`, never `build`.
