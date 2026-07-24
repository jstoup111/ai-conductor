# Implementation Plan: build_review fresh-base grading + bounded scope-verdict disposition

**Date:** 2026-07-23
**Design:** technical track (no PRD) — `.docs/track/build-review-grades-plan-vs-diff-against-a-stale-o.md`
**Stories:** `.docs/stories/build-review-grades-plan-vs-diff-against-a-stale-o.md`
**Complexity:** `.docs/complexity/build-review-grades-plan-vs-diff-against-a-stale-o.md` (Tier M)
**Architecture:** `.docs/architecture/2026-07-23-build-review-fresh-base-and-verdict-disposition.md`
**ADR:** `.docs/decisions/adr-2026-07-23-build-review-fresh-base-disposition.md` (APPROVED)
**Conflicts:** `.docs/conflicts/build-review-grades-plan-vs-diff-against-a-stale-o.md` (CLEAN)

## Summary

Make build_review grade against a verified-fresh default-branch base (A), and give
scope FAILs a deterministic, hard-bounded disposition — invalidate-and-regrade once
when the verdict graded a stale view, kick to build when the content persists, HALT
with evidence on a second stale detection (B). The engine never mutates git history
in this path. 10 tasks.

## Tasks

### Task 1: Extract shared fresh-base resolver from rebase.ts
Refactor `resolveBase`'s default-branch derivation + fetch into an exported seam
(`resolveFreshBase(git, {probeOnly?})`) reused by both the rebase path and grading.
Behavior of the rebase path stays byte-identical (pin with existing tests).
**Files likely touched:** `src/conductor/src/engine/rebase.ts`,
`src/conductor/test/engine/rebase-resolution.test.ts`
**Dependencies:** none

### Task 2: ls-remote freshness probe
Add the probe: compare `refs/remotes/origin/<default>` to `git ls-remote origin
<default>`; expose `{trackingRefSha, remoteHeadSha, fresh}`. Fail-soft to
`{fresh:false, remoteHeadSha:null}` on any git/network error (Story 2 negative).
**Files likely touched:** `src/conductor/src/engine/rebase.ts` (or new
`fresh-base.ts`), unit tests
**Dependencies:** 1

### Task 3: Wire fresh base into assembleBuildReviewInputs
On stale probe → fetch → recompute merge-base against the refreshed ref; on
no-remote/probe failure → current local behavior + one advisory log. Return the
base evidence alongside the diff. (Stories 1, 2)
**Files likely touched:** `src/conductor/src/engine/build-review-inputs.ts`, its tests
**Dependencies:** 2

### Task 4: Base-freshness telemetry event
Emit `build_review_base` `{mergeBase, trackingRefSha, remoteHeadSha, fresh}` per
grading; render a dim daemon-log line. Never throws. (Story 7)
**Files likely touched:** `src/conductor/src/types/events.ts`,
`src/conductor/src/engine/step-runners.ts`, `src/conductor/src/daemon-cli.ts`
**Dependencies:** 3

### Task 5: Two-repo stale-ref regression fixture
Fixture reproducing the incident: bare "remote" advances past the clone's tracking
ref; feature branch rebased onto the true remote head; assert the graded diff under
Task 3 contains only branch commits (RED against pre-fix behavior).
**Files likely touched:** `src/conductor/test/fixtures/git-repo.ts`,
`src/conductor/test/engine/build-review-inputs.test.ts` (or acceptance test)
**Dependencies:** 3

### Task 6: Disposition classifier on build_review scope FAIL
In the conductor's build_review FAIL branch, before any rework routing: re-probe,
recompute the fresh diff, classify `stale-mirage` (graded base ≠ fresh merge-base
AND flagged content absent from fresh diff) vs `genuine` (content persists). Pure
function + wiring; no history mutation (Story 6 asserts pre/post HEAD identity).
**Files likely touched:** `src/conductor/src/engine/conductor.ts`, new
`src/conductor/src/engine/build-review-disposition.ts`, unit tests
**Dependencies:** 3

### Task 7: Invalidate-and-regrade path (once)
On `stale-mirage`: remove the verdict artifact (must NOT be preservable by the #817
code-stamp path — pinned test), skip rework dispatch, re-run build_review with fresh
inputs. Persist a per-feature-session regrade counter in
`.pipeline/build-review-regrade.json`. (Story 3)
**Files likely touched:** `src/conductor/src/engine/conductor.ts`,
`src/conductor/src/engine/build-review-disposition.ts`, `artifacts.ts` (verdict
removal helper), tests
**Dependencies:** 6

### Task 8: Hard bound + HALT evidence
Second stale detection in one feature-session → HALT whose body carries graded-base
sha, fresh-base sha, flagged paths, and regrade count. Counter resets with a fresh
feature-session (Story 4 both paths). Genuine FAILs route to build rework unchanged
(Story 5) — add an ordering pin that disposition runs before any #569-style
remediation routing for this step.
**Files likely touched:** `src/conductor/src/engine/conductor.ts`, tests
**Dependencies:** 7

### Task 9: Conductor-level integration specs
End-to-end over the fixture: (a) stale-mirage FAIL → no rework dispatch → regrade →
PASS; (b) regrade consumed + second stale → HALT; (c) genuine scope FAIL → build
rework as today; (d) offline degrade grades with local ref. (Stories 3-6 acceptance)
**Files likely touched:** `src/conductor/test/acceptance/…`, fixture reuse from Task 5
**Dependencies:** 8, 5

### Task 10: Docs + CHANGELOG
`docs/daemon-operations.md` (new HALT reason + regrade semantics),
`src/conductor/README.md` (grading base guarantee), CHANGELOG `[Unreleased]` →
Fixed/Added. No CLI/schema/hook surface change → no migration block (internal-only;
release-gate waiver only if the classifier flags `hook wiring` spuriously).
**Files likely touched:** `docs/daemon-operations.md`, `src/conductor/README.md`,
`CHANGELOG.md`
**Dependencies:** 9

## Task Dependency Graph

```
1 → 2 → 3 → {4, 5, 6}
6 → 7 → 8 → 9 (also ← 5) → 10
```
