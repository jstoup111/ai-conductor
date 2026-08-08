# Implementation Plan: satisfied-by-forged-citation-validation

**Source:** jstoup111/ai-conductor#533 · **Track:** technical · **Tier:** M
**Stories:** `.docs/stories/satisfied-by-forged-citation-validation.md`
**Governing ADR:** `.docs/decisions/adr-2026-07-11-semantic-attribution-verification-lane.md`
(provenance rule extended to the mechanical `satisfied-by` lane; no new ADR — design-conformance)

## Goal

Harden the mechanical evidence lane's `Evidence: satisfied-by <sha>` handler so a
citation stamps a task **only** when the **cited** commit is (1) reachable, (2) an
ancestor of HEAD, (3) non-empty, and (4) — if the task declares `**Files:**` — its diff
overlaps them. Any failure refuses the stamp and emits an audit/log line naming the
citing commit, the cited sha, and the reason. Deterministic, git-derived, no prompt
discipline. All work is TDD (RED before GREEN).

## Anchors (verified in worktree)

- **Defect site:** `src/conductor/src/engine/autoheal.ts:619-643` — the
  `satisfiedByTrailer` branch of `deriveCompletionInternal`. Today: object-existence
  (`git rev-parse --verify <sha>^{commit}`) is the ONLY check before `completed = true`
  (line 629-634). Dangling else-branch at 635-641.
- **Pattern to conform to:** `src/conductor/src/engine/attribution-validate.ts:116-191`
  (`validateCitations`) — reachability → ancestry (`merge-base --is-ancestor`, line 143)
  → non-empty (`diff-tree --quiet`) → path overlap (`fileMatchesPlanPath`).
- **Sibling mechanical rule already correct:** `autoheal.ts:683-717` (`Task:`-trailer
  form) — empty-commit refusal + `filesOverlappingTaskPaths` overlap; Files-gating at
  `695-707`.
- **In-file helpers to reuse:** `filesForCommit(projectRoot, sha)` (`autoheal.ts:896`,
  returns `[]` for empty commits), `filesOverlappingTaskPaths(files, taskPaths)`
  (`autoheal.ts:43`), `fileMatchesPlanPath` (`autoheal.ts:36`). Task's declared paths:
  `planPaths.get(taskId)` (already computed at `autoheal.ts:596`).
- **HEAD for ancestry:** resolvable in `projectRoot` via
  `git merge-base --is-ancestor <sha> HEAD` (execa, `reject:false`), same call shape as
  the existing `rev-parse --verify` at line 624.
- **Test home:** `src/conductor/test/engine/autoheal.test.ts` — existing
  `describe('deriveCompletion Evidence forms')` block (~line 1832) already builds
  plans/commits and calls `deriveCompletion(gitDir, planPath, '', commits, evidence)`.
  The valid-sha and dangling-sha tests (1833, 1903) are the regression anchors.

Run tests from `src/conductor` with `rtk proxy npx vitest run test/engine/autoheal.test.ts`
(repo memory: vitest must run with cwd `src/conductor`, else ~30 false failures).

---

## Task Dependency Graph

```
T1(RED: forged non-ancestor) ─┐
T2(RED: empty + no-overlap + off-branch + backfill) ─┤
                                                      ├─▶ T3(GREEN: ancestry+non-empty+overlap gate) ─▶ T4(regression sweep) ─▶ T5(docs) ─▶ T6(full-file suite + integrity)
```

---

### Task 1 — RED: forged non-ancestor citation must be refused (Story 4)
**Dependencies:** none
**Files:** `src/conductor/test/engine/autoheal.test.ts`
Add a failing test in the `deriveCompletion Evidence forms` describe. Build a plan with
`### Task 24`. Create commit F, capture its sha, then `git checkout -B build <base>` (or
`git reset --hard`) so F is reachable via `git rev-parse --verify F^{commit}` (exit 0)
but **not** an ancestor of HEAD. Add an empty commit `Task: 24` +
`Evidence: satisfied-by <F>`. Assert `result['24'].completed !== true`, no sidecar stamp
for 24, and (if present) `result['24'].auditEntry` names F's short sha with a
non-ancestor reason. Expect RED (today `rev-parse --verify` passes → falsely completed).

### Task 2 — RED: empty-cited, non-overlapping, off-branch refused; backfill still stamps (Stories 2,5,6,7)
**Dependencies:** none
**Files:** `src/conductor/test/engine/autoheal.test.ts`
Add four failing/guard tests in the same describe:
- **empty ancestor cited** (S6): on-branch `--allow-empty` ancestor E; cite it →
  refused, reason *empty*.
- **on-branch no-overlap** (S7): plan Task declares `**Files:** src/engine/target.ts`;
  cited ancestor Y touches only `src/engine/unrelated.ts` → refused, reason *no overlap*.
- **off-branch touching the right file** (S5): non-empty commit X on a side branch (not
  ancestor) touching `src/engine/foo.ts`; cited by a Files-declaring task → refused,
  reason *non-ancestor* (ancestry checked before overlap).
- **legitimate backfill** (S2): Files-declaring task, cited on-branch non-empty ancestor
  W2 that touches the declared file, separately-authored empty backfill commit → still
  `completed`, `evidencedBy === W2` (this one is a GREEN guard — passes after T3).
Expect RED on the three refusal cases (today all falsely complete).

### Task 3 — GREEN: gate the satisfied-by branch on ancestry + non-empty + overlap (Stories 1-7)
**Dependencies:** T1, T2
**Files:** `src/conductor/src/engine/autoheal.ts`
In the `satisfiedByTrailer` branch (`619-643`), after extracting `sha`, replace the
bare `rev-parse --verify`-only gate with the conforming pipeline, short-circuiting to the
existing refuse path (`auditEntry` + `warnOnce`, leave incomplete, `continue`) on first
failure:
1. **Reachability** — keep `git rev-parse --verify ${sha}^{commit}` (exit≠0 →
   *unreachable*, preserves the existing dangling audit line at 635-641).
2. **Ancestry** — `git merge-base --is-ancestor ${sha} HEAD` (exit≠0 → *non-ancestor*).
3. **Non-empty** — `filesForCommit(projectRoot, sha)`; empty (`length === 0`) → *empty*.
4. **Overlap (Files-gated)** — `const taskPaths = planPaths.get(taskId)`; if
   `taskPaths?.size` then require `filesOverlappingTaskPaths(files, taskPaths).length > 0`
   (no overlap → *no file overlap*, name touched files + expected paths). If the task
   declares no Files, skip overlap (mirror `697-704`).
Only when all pass: `completed = true`, `evidencedBy = sha`, and
`evidence.evidenceStamps.set(taskId, { sha, form: 'evidence:satisfied-by' })`. Each
refusal writes `result[taskId].auditEntry` and a `warnOnce` line naming the citing
commit, the cited sha, and the reason. Keep the checks git-derived (no new deps); reuse
the in-file helpers rather than forking `validateCitations`. Run T1/T2 → GREEN.

### Task 4 — Regression sweep: existing satisfied-by/skipped/dangling tests still pass (Stories 3,8)
**Dependencies:** T3
**Files:** `src/conductor/test/engine/autoheal.test.ts`
Run the `deriveCompletion Evidence forms` describe. Confirm the pre-existing tests still
pass under the new gate: `marks task completed with Evidence: satisfied-by <valid sha>`
(Task 7 has no Files → stamps on ancestry+non-empty, Story 3), `marks task skipped`,
`does NOT complete task with dangling satisfied-by sha` (Story 8, unreachable). If the
valid-sha test's cited commit is not an ancestor of HEAD as written, adjust the test
fixture (not the production gate) so the cited work commit is a genuine ancestor —
document the fixture change inline. No production change in this task.

### Task 5 — Docs: CHANGELOG + evidence-gate doc note
**Dependencies:** T3
**Files:** `CHANGELOG.md`, `src/conductor/README.md`
Add a `## [Unreleased] → ### Fixed` CHANGELOG entry (see below). In
`src/conductor/README.md`, extend the evidence-gate / attribution section to state that
the mechanical `Evidence: satisfied-by <sha>` form now requires the cited commit to be an
ancestor of HEAD, non-empty, and (when the task declares Files) overlapping — matching the
judged lane's citation validation. No VERSION bump (frozen). No migration block / waiver:
`autoheal.ts` is internal engine code — it trips none of `CANONICAL_BREAKING_SURFACES`
(`bin/conduct CLI`, `skill symlink targets`, `hook wiring`, `settings.json schema`;
verified in `release-gate.ts:178-208`).

### Task 6 — Verify: full autoheal suite + harness integrity
**Dependencies:** T4, T5
**Files:** `src/conductor/test/engine/autoheal.test.ts`
From `src/conductor`: `rtk proxy npx vitest run test/engine/autoheal.test.ts` (assert via
file/exit code, not a piped tail — pipes mask exit codes). Then from repo root run
`test/test_harness_integrity.sh` and confirm it passes (CHANGELOG `[Unreleased]`
present, VERSION valid semver). Report PASS/FAIL only.

---

## Non-goals / explicitly out of scope

- **No operator-marker escape hatch.** No such grammar exists today (only `satisfied-by`
  / `skipped`); desired outcome #3 is met without one. Adding a bypass to a
  security-critical gate is out of scope (see track doc assumption ledger).
- **No change to the judged lane** (`validateCitations`) or the `Task:`-trailer branch —
  both already enforce the rule.
- **No VERSION bump, no migration block, no release waiver** — internal engine change.
