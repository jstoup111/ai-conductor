# Implementation Plan: Autoheal path-corroboration bounded dirname pass (#707)

**Date:** 2026-07-20
**Design/ADR:** `.docs/decisions/adr-2026-07-20-bounded-dirname-path-corroboration.md` (APPROVED)
**Stories:** `.docs/stories/autoheal-path-corroboration-rejects-valid-build-co.md` (7, Accepted)
**Conflict check:** Clean (PASS) as of 2026-07-20 — `.docs/conflicts/autoheal-path-corroboration-rejects-valid-build-co.md`
**Tier:** Medium · **Track:** technical

## Summary
Adds a bounded dirname/subsystem branch to autoheal path-corroboration so a commit carrying a
valid `Task: N` trailer whose files sit in the same immediate directory as a plan-declared path
is credited (stamped `trailer-dirname`), instead of stalling at `no_task_progress`. 11 tasks,
all inside `autoheal.ts` + its tests + the harness release-gate files. The semantic judge lane is
untouched.

## Technical Approach
Single change site: `src/conductor/src/engine/autoheal.ts`. Today `filesOverlappingTaskPaths`
returns the list of files matching a task path via `fileMatchesPlanPath` (exact `f===p` or suffix
`f.endsWith('/'+p)`). We (a) add a pure predicate `fileDirMatchesPlanPath(file, planPath)` that is
true iff the file's immediate parent directory equals the plan path's immediate parent directory
(after stripping `./`), and (b) change corroboration so `deriveCompletion` tries exact/suffix
overlap first and, only on a miss, tries the bounded dirname overlap — while remembering *which*
branch produced the satisfying commit so the stamp form can be `trailer` (exact/suffix) vs
`trailer-dirname` (dirname). `EvidenceStamp.form` is a free `string` (task-evidence.ts:18), so no
type change is needed. The full-miss path (pre-existing `semantic-verified` stamp honored, else
audit + `warnOnce` reject) and the judge lane are unchanged. The bound (immediate parent dir only,
never ancestor/repo-root) is what keeps #445's inheritance false-positive closed.

Sequencing: implement the predicate (Task 1) → thread branch-aware overlap through the crediting
loop (Task 2) → stamp form (Task 3), each RED-first with its own test task interleaved; then the
dedicated non-regression/interaction test tasks (Tasks 4–9); then the harness release-gate tasks
(10–11).

## Prerequisites
- None. The change lives inside `deriveCompletion`, already wired at `conductor.ts:3219`.

## Tasks

### Task 1: Add bounded immediate-parent-dir predicate
**Story:** "Credit a subsystem-local commit via the bounded dirname pass" (happy) + "Bound the dirname match…" (#445 bound)
**Type:** happy-path
**Steps:**
1. Write failing unit test: `fileDirMatchesPlanPath('src/e/a.ts','src/e/conductor.ts')===true`; `('src/cli.ts','src/e/conductor.ts')===false`; `('README.md','src/e/conductor.ts')===false`; `('./src/e/a.ts','src/e/conductor.ts')===true` (leading `./` stripped).
2. Verify RED.
3. Implement `fileDirMatchesPlanPath(file, planDeclaredPath)`: strip leading `./` on both, compare `dirname()` for exact equality. No ancestor/prefix logic. A plan path with no directory component (bare basename) has dirname `.`; a file with no directory also has dirname `.` — treat two `.` dirnames as a match ONLY when neither has a parent (documented; covered by Task 6 repo-root test to ensure a top-level file does NOT match a nested plan path).
4. Verify GREEN.
5. Commit: "feat(autoheal): bounded immediate-parent-dir corroboration predicate (#707)"
**Files:** `src/conductor/src/engine/autoheal.ts`
**Wired-into:** `src/conductor/src/engine/autoheal.ts#filesOverlappingTaskPaths` (consumed in Task 2)
**Dependencies:** none

### Task 2: Branch-aware corroboration (exact/suffix first, then bounded dirname)
**Story:** "Credit a subsystem-local commit…" (happy) + "Preserve exact and suffix corroboration unchanged"
**Type:** happy-path
**Steps:**
1. Write failing test driving `deriveCompletion` on a fixture repo: a `Task: N` commit touching a same-immediate-dir (non-exact) file marks task N `completed`; an exact/suffix commit still completes and short-circuits before the dirname pass.
2. Verify RED.
3. Implement: add a helper (e.g. `corroborationMatch(filesInCommit, taskPaths): 'exact-suffix' | 'dirname' | null`) — return `'exact-suffix'` when `filesOverlappingTaskPaths` (existing exact/suffix) is non-empty; else return `'dirname'` when any commit file `fileDirMatchesPlanPath` any task path; else `null`. Use it in the crediting loop in place of the current `overlap.length>0` check, preserving the `hasPlanFiles`/empty-commit short-circuits.
4. Verify GREEN.
5. Commit: "feat(autoheal): try bounded dirname overlap after exact/suffix miss (#707)"
**Files:** `src/conductor/src/engine/autoheal.ts`
**Wired-into:** same as Task 1
**Dependencies:** 1

### Task 3: Stamp `trailer-dirname` for dirname-branch credits
**Story:** "Credit a subsystem-local commit…" (stamp form) + regression (exact keeps `trailer`)
**Type:** happy-path
**Steps:**
1. Write failing test: a dirname-branch credit writes an evidence stamp with `form: 'trailer-dirname'`; an exact/suffix credit keeps `form: 'trailer'`.
2. Verify RED.
3. Implement: at the satisfy site (autoheal.ts:784) set `form` from the `corroborationMatch` result — `'trailer'` for `'exact-suffix'`, `'trailer-dirname'` for `'dirname'`. No `EvidenceStamp` type change (form is `string`).
4. Verify GREEN.
5. Commit: "feat(autoheal): distinguish trailer-dirname evidence stamp form (#707)"
**Files:** `src/conductor/src/engine/autoheal.ts`
**Wired-into:** `src/conductor/src/engine/autoheal.ts#deriveCompletion` (writes existing evidence sidecar; no new consumer)
**Dependencies:** 2

### Task 4: Test — #445 non-regression: ancestor-only and repo-root-only rejected
**Story:** "Bound the dirname match to the immediate parent dir (#445 non-regression)"
**Type:** negative-path
**Steps:**
1. Write failing tests: plan path `src/conductor/src/engine/conductor.ts`; a `Task: N` commit touching only `src/conductor/src/cli.ts` (ancestor `src/conductor/src`, not immediate) is NOT credited; a commit touching only `README.md`/`VERSION` (repo root) is NOT credited.
2. Verify RED (fails today only if a bug slipped; otherwise these encode the guarantee) → GREEN against Tasks 1–3.
3. Commit: "test(autoheal): #445 non-regression — ancestor/repo-root do not corroborate (#707)"
**Files:** `src/conductor/test/engine/autoheal-dirname-corroboration.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** 3

### Task 5: Test — #445-shaped inheritance does not false-positive
**Story:** "Bound the dirname match…" (inheritance scenario)
**Type:** negative-path
**Steps:**
1. Write failing test: task N inherits another task's declared Files (`same as Task M`); a commit touching a directory unrelated to N's real work is NOT credited to N by the dirname pass (bound + trailer precondition together).
2. Verify RED→GREEN.
3. Commit: "test(autoheal): inherited-Files task not dirname-credited on unrelated dir (#707)"
**Files:** `src/conductor/test/engine/autoheal-dirname-corroboration.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** 3

### Task 6: Test — wrong immediate dir falls through to reject
**Story:** "Do not credit a commit whose files are in the wrong immediate directory"
**Type:** negative-path
**Steps:**
1. Write failing test: plan paths only under `src/conductor/src/engine/`; a `Task: N` commit touching only `test/` + `docs/` files is NOT credited by the dirname pass; on full miss with no `semantic-verified` stamp the `warnOnce` "Path corroboration failed" audit still fires (assert unchanged reject behavior).
2. Verify RED→GREEN.
3. Commit: "test(autoheal): wrong-dir commit falls through to unchanged reject (#707)"
**Files:** `src/conductor/test/engine/autoheal-dirname-corroboration.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** 3

### Task 7: Test — semantic judge path preserved + no judge-lane diff
**Story:** "Preserve the semantic judge fallback path unchanged (interaction)"
**Type:** negative-path
**Steps:**
1. Write test: with the dirname pass missing but a pre-existing `semantic-verified` stamp present, task N is still credited via the existing branch. Add a guard assertion/check that the change set does not modify `attribution-lane.ts` or the conductor judge-dispatch block (documented in the test file header; verified in review — no runtime coupling).
2. Verify GREEN.
3. Commit: "test(autoheal): semantic-verified credit branch unchanged by dirname pass (#707)"
**Files:** `src/conductor/test/engine/autoheal-dirname-corroboration.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** 3

### Task 8: Test — cutover OFF: deterministic credit + unchanged reject
**Story:** "Deterministic credit works with the judge cutover OFF (degradation)"
**Type:** negative-path
**Steps:**
1. Write test: with the judge lane disabled/absent (no cutover), a same-immediate-dir `Task: N` commit is still credited by the dirname pass; a full miss still rejects (no new false positive).
2. Verify GREEN.
3. Commit: "test(autoheal): dirname credit independent of judge cutover (#707)"
**Files:** `src/conductor/test/engine/autoheal-dirname-corroboration.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** 3

### Task 9: Test — trailer precondition (no/ambiguous trailer never dirname-credited)
**Story:** "Require a real, unambiguous Task trailer as a precondition"
**Type:** negative-path
**Steps:**
1. Write test: a commit with NO `Task: N` trailer whose files sit in task N's plan dir is NOT credited; a commit with an AMBIGUOUS trailer that `taskTrailerMatches` rejects is NOT credited. (Confirms the dirname pass is reached only inside the existing per-matching-commit loop.)
2. Verify GREEN.
3. Commit: "test(autoheal): trailer match remains precondition for dirname credit (#707)"
**Files:** `src/conductor/test/engine/autoheal-dirname-corroboration.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** 3

### Task 10: CHANGELOG entry (harness release gate)
**Story:** n/a (repo release gate — CLAUDE.md)
**Type:** infrastructure
**Steps:**
1. Add under `## [Unreleased]` → `### Fixed`: "conduct-ts autoheal: path-corroboration now credits a `Task:`-trailered commit whose files land in the same immediate directory as a plan-declared path (bounded `trailer-dirname` corroboration), eliminating a `no_task_progress` 0/N stall class where valid subsystem-local work was rejected. Judge lane unchanged; #445 inheritance guard preserved by the immediate-parent-dir bound. (#707)"
2. Commit: "docs(changelog): path-corroboration bounded dirname pass (#707)"
**Files:** `CHANGELOG.md`
**Wired-into:** none (no new production surface)
**Dependencies:** 3

### Task 11: VERSION patch bump + migration/waiver decision
**Story:** n/a (repo release gate — CLAUDE.md)
**Type:** infrastructure
**Steps:**
1. Bump `VERSION` `0.99.19` → `0.99.20` (PATCH — bug fix; no new skill/hook/gate, no breaking surface).
2. Migration/waiver: the diff is internal engine only (`autoheal.ts` + tests + CHANGELOG/VERSION) — no `bin/conduct CLI`, `hook wiring`, `settings.json schema`, or `skill symlink targets`. Expect NO migration block. If the self-host release gate's path classifier nonetheless flags a breaking surface, create `.docs/release-waivers/autoheal-path-corroboration-rejects-valid-build-co.md` with `Waives:` naming the flagged canonical surface(s) and a `Rationale:` stating the edit is internal-only (no consumer-visible CLI/hook/schema change) — do NOT invent an empty migration block.
3. Commit: "chore(release): VERSION 0.99.20 for #707"
**Files:** `VERSION`; conditionally `.docs/release-waivers/autoheal-path-corroboration-rejects-valid-build-co.md`
**Wired-into:** none (no new production surface)
**Dependencies:** 10

## Task Dependency Graph
```
1  (predicate)
└─ 2  (branch-aware overlap)
   └─ 3  (stamp form)  ← core implementation complete
      ├─ 4  (test: ancestor/repo-root reject)
      ├─ 5  (test: inheritance no false-positive)
      ├─ 6  (test: wrong-dir reject)
      ├─ 7  (test: judge path preserved)
      ├─ 8  (test: cutover OFF)
      ├─ 9  (test: trailer precondition)
      └─ 10 (CHANGELOG)
          └─ 11 (VERSION + waiver decision)
```
Tasks 4–9 are independent of each other (parallelizable); all depend only on Task 3.

## Integration Points
- After Task 3: `deriveCompletion` credits subsystem-local commits end-to-end; runnable against a
  fixture repo to reproduce/confirm the #707 stall is gone.
- After Task 9: full acceptance coverage of all 7 stories.
- After Task 11: release-gate clean (changelog + version), ready for the daemon's ship phase.

## Verification
- [x] All happy-path criteria covered (Tasks 1–3)
- [x] All negative-path criteria covered by explicit test tasks (Tasks 4–9)
- [x] No task exceeds ~5 min
- [x] Dependencies explicit and acyclic (graph above)
- [x] Every production-surface task carries a `Wired-into:` line
- [x] Judge lane excluded from all Files: sets
