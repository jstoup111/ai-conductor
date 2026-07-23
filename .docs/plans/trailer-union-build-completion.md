# Implementation Plan: Trailer-union build completion (fix false no_task_progress halt, #859)

**Date:** 2026-07-23
**Design:** .docs/decisions/adr-2026-07-23-trailer-union-build-step-routing.md (APPROVED) · .docs/architecture/trailer-union-build-completion.md
**Stories:** .docs/stories/trailer-union-build-completion.md (Accepted; S1–S5)
**Conflict check:** Clean as of 2026-07-23 (.docs/conflicts/2026-07-23-trailer-union-build-completion.md)
**Track/Tier:** technical · M

## Summary

Extract one shared task-resolution definition (`resolveTaskIds`: task-status rows
`completed|skipped` ∪ `Task:` commit trailers, canonical-id matched) and make both the build
completion predicate and the stall breaker consume it, so an all-evidenced build exits to
`build_review` instead of false-halting `no_task_progress`. 13 tasks.

## Technical Approach

- **`task-progress.ts`** gains exported `resolveTaskIds(projectRoot: string, planIds: string[]):
  Promise<Set<string>>` — the exact fold `countResolvedTasks` ships today: normalize rows, take
  `completed|skipped` ids, union in `distinctTaskTrailerIds` matched against `planIds` directly
  or via `canonicalTaskId` alias. Trailer read stays fail-soft (git error ⇒ no additional ids).
  `countResolvedTasks` is then refactored to delegate: read + normalize the status file (missing/
  unparseable/empty ⇒ 0, unchanged), derive its planIds from the rows as today, call the resolver,
  return `size` — count parity for its existing consumers (stall breaker `conductor.ts:3720-3733`,
  kickback baselines `conductor.ts:1909/1932`, daemon re-kick `daemon-cli.ts:434`).
- **`artifacts.ts` `build:` predicate** (ctx branch only, ~1270-1318): after the existing
  halt-marker check, seed, plan validation, and status-file read (all reasons unchanged),
  `unresolved` becomes `planTaskIds − await resolveTaskIds(ctx.projectRoot, planTaskIds)` instead
  of the row-only filter. Reason format (`x/y tasks pending…`, 3-name truncation) unchanged.
  Legacy no-context fallback branch (~1320-1352) byte-for-byte untouched. The #773 comment block
  (~1249-1269) is rewritten to the routing/authority split.
- **`conductor.ts`** needs no behavioral edit — the breaker inherits the shared fold through
  `countResolvedTasks`. One comment touch-up at the breaker cites the ADR.
- **Sequencing:** resolver first (S1), predicate consumption next (S2/S3), loop-level regression
  + genuine-stall pinning (S4), then contract/doc sync (S5). Tests live in the existing homes:
  `src/conductor/test/engine/task-progress.test.ts`, `…/engine/artifacts.test.ts`,
  `…/engine/conductor.test.ts`.

## Prerequisites

None — all primitives (`listCommitsWithTrailers`, `canonicalTaskId`, `normalizeTasks`,
`parsePlanTaskPaths`) exist; no migrations, no config changes, no VERSION bump (pre-v1:
CHANGELOG `[Unreleased]` only).

## Tasks

### Task 1: resolveTaskIds — row + trailer union with canonical alias matching
**Story:** S1 happy paths (row-completed, row-skipped, trailer-evidenced, alias `T2`↔`2`)
**Type:** happy-path

**Steps:**
1. Write failing tests: in a temp git repo with a seeded `.pipeline/task-status.json`, assert
   `resolveTaskIds` resolves a `completed` row id, a `skipped` row id, a trailer-only id
   (commit with `Task: 3`), and an alias (plan id `2`, trailer `Task: T2`).
2. Verify RED (export does not exist).
3. Implement `resolveTaskIds(projectRoot, planIds)` in `task-progress.ts` by extracting the
   union fold from `countResolvedTasks` (rows via `normalizeTasks`; trailers via
   `distinctTaskTrailerIds` + `canonicalTaskId` matching against `planIds`).
4. Verify GREEN.
5. Commit: "feat(engine): add shared resolveTaskIds union resolver"

**Files likely touched:**
- src/conductor/src/engine/task-progress.ts — new export
- src/conductor/test/engine/task-progress.test.ts — resolver tests

**Wired-into:** src/conductor/src/engine/task-progress.ts#countResolvedTasks, src/conductor/src/engine/artifacts.ts#build (call sites land in Tasks 3–4 per the review's Wiring Surface)
**Dependencies:** none

### Task 2: resolveTaskIds negatives — phantom trailers, fail-soft git, non-resolving statuses, malformed rows
**Story:** S1 negative paths
**Type:** negative-path

**Steps:**
1. Write failing tests: trailer `Task: 99` with planIds 1–5 contributes nothing; non-repo
   `projectRoot` ⇒ rows-only result (no throw); `in_progress`/`pending` rows contribute
   nothing; legacy map-shape rows normalize without throwing.
2. Verify RED (or confirm which already pass from Task 1's implementation — tighten any gap).
3. Implement guards only if a test exposes a gap (extraction should already satisfy these).
4. Verify GREEN.
5. Commit: "test(engine): resolveTaskIds phantom/fail-soft/malformed negatives"

**Files likely touched:**
- src/conductor/src/engine/task-progress.ts — guards if needed
- src/conductor/test/engine/task-progress.test.ts — negative tests

**Wired-into:** same as Task 1
**Dependencies:** Task 1

### Task 3: Refactor countResolvedTasks onto the resolver with a parity test
**Story:** S1 parity criterion (breaker, kickback baselines, re-kick observe identical values)
**Type:** refactor

**Steps:**
1. Write failing parity test: fixtures exercising rows-only, trailers-only, mixed, alias, and
   no-status-file cases assert `countResolvedTasks` returns the documented pre-refactor values
   (encode expected counts literally; include the missing-file ⇒ 0 and empty-rows ⇒ 0 contracts).
2. Verify RED where behavior is not yet delegated (parity tests should pass pre-refactor — use
   them as the pin, then refactor under them).
3. Refactor `countResolvedTasks` to delegate its union fold to `resolveTaskIds` (keep its own
   read/parse/empty short-circuits).
4. Verify GREEN (parity pins hold).
5. Commit: "refactor(engine): countResolvedTasks delegates to resolveTaskIds (parity pinned)"

**Files likely touched:**
- src/conductor/src/engine/task-progress.ts — delegation
- src/conductor/test/engine/task-progress.test.ts — parity pins

**Wired-into:** none (no new production surface)
**Dependencies:** Task 1, Task 2

### Task 4: Build predicate resolves via the union — the #859 regression shape
**Story:** S2 happy path (all-trailer-resolved + zero completed rows ⇒ done); O1/O4
**Type:** happy-path

**Steps:**
1. Write failing test in `artifacts.test.ts`: temp repo, plan with N tasks, task-status rows all
   `pending`/`in_progress`, every id trailer-committed ⇒ `checkStepCompletion('build', ctx)`
   returns `done: true`. Name the test after #859.
2. Verify RED (row-only filter returns not-done).
3. Implement: in the ctx branch, replace the row-only `unresolved` filter with
   `planTaskIds − await resolveTaskIds(ctx.projectRoot, planTaskIds)`.
4. Verify GREEN.
5. Commit: "fix(engine): build predicate exits on trailer-union resolution (#859)"

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts — ctx-branch unresolved computation
- src/conductor/test/engine/artifacts.test.ts — #859 regression test

**Wired-into:** none (no new production surface — existing predicate invoked from src/conductor/src/engine/conductor.ts#checkStepCompletion call sites)
**Dependencies:** Task 1

### Task 5: Mixed-evidence completion
**Story:** S2 happy path (some row-resolved, rest trailer-resolved)
**Type:** happy-path

**Steps:**
1. Write failing/confirming test: rows resolve tasks 1–2 (`completed`), trailers resolve 3–5 ⇒
   `done: true`.
2. Verify result (should be GREEN from Task 4 — if so, land as executable coverage, not new code).
3. No implementation expected.
4. Verify GREEN.
5. Commit: "test(engine): mixed row+trailer evidence completes build predicate"

**Files likely touched:**
- src/conductor/test/engine/artifacts.test.ts — mixed-evidence test

**Wired-into:** none (no new production surface)
**Dependencies:** Task 4

### Task 6: Fail-closed negatives stay fail-closed
**Story:** S2 negative paths (missing status file, corrupt JSON, unreadable/empty plan, halt-marker precedence)
**Type:** negative-path

**Steps:**
1. Write/extend tests: (a) missing `.pipeline/task-status.json` ⇒ not-done with existing
   "missing" reason; (b) invalid JSON ⇒ existing reason; (c) plan without task headings ⇒
   existing reason; (d) halt marker present + full trailer evidence ⇒ not-done with halt reason.
2. Verify each against the Task 4 implementation; RED any gap.
3. Fix only exposed gaps (ordering of checks must keep halt-marker and read guards ahead of
   the resolver call).
4. Verify GREEN.
5. Commit: "test(engine): build predicate fail-closed paths unchanged under union"

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts — only if a gap is exposed
- src/conductor/test/engine/artifacts.test.ts — fail-closed tests

**Wired-into:** none (no new production surface)
**Dependencies:** Task 4

### Task 7: Legacy no-context fallback byte-for-byte unchanged
**Story:** S2 negative path (no projectRoot/planPath callers)
**Type:** negative-path
**Verify-only:** yes

**Steps:**
1. Run the existing legacy-fallback tests in `artifacts.test.ts` (no-context branch: rows-only).
2. Confirm they pass unmodified against the new implementation.
3. If any fail, the ctx-branch edit leaked — fix in artifacts.ts (that would void verify-only;
   convert to a code commit).
4. Verify GREEN.
5. Commit (empty): "verify(engine): legacy no-context build fallback unchanged" with
   `Evidence: skipped legacy-fallback-tests-pass-unmodified`

**Files likely touched:**
- none (verification of existing suite)

**Wired-into:** none (no new production surface)
**Dependencies:** Task 4

### Task 8: Completion-miss reason names only truly-unresolved ids
**Story:** S3 (happy: exact unresolved set + `2/5` count; negatives: reverted-trailer counts, `(+N more)` truncation)
**Type:** happy-path

**Steps:**
1. Write failing/confirming tests: (a) ids 1–3 resolved (2 trailer-only) of 1–5 ⇒ reason lists
   exactly `4, 5` and `2/5`; (b) all-unresolved ⇒ existing truncation `(+N more)`; (c) a
   trailer whose commit is later reverted still resolves (assert documented semantics).
2. Verify against Task 4 implementation; RED any gap.
3. Fix formatting only if a gap is exposed (reason template itself must stay unchanged).
4. Verify GREEN.
5. Commit: "test(engine): completion-miss reasons name only union-unresolved tasks"

**Files likely touched:**
- src/conductor/test/engine/artifacts.test.ts — reason-content tests
- src/conductor/src/engine/artifacts.ts — only if a gap is exposed

**Wired-into:** none (no new production surface)
**Dependencies:** Task 4

### Task 9: Loop-level pinning — genuine stall halts; ceiling misread unreachable
**Story:** S4 (all criteria); O3/O4
**Type:** negative-path

**Steps:**
1. Write/extend conductor tests: (a) genuine stall — unresolved tasks, count unmoved across
   attempts ≥ 2 ⇒ `no_task_progress` with the unchanged reason string and routing; (b) #859
   shape at loop level — all ids trailer-resolved ⇒ completion check returns done and the stall
   evaluation is never reached (step advances toward build_review); (c) existing
   `build_progress_halt` bypass/ceiling tests pass unmodified.
2. Verify RED for (b) pre-Task-4 semantics is not needed — (b) should be GREEN now; (a)+(c)
   must pass unmodified. RED any gap.
3. Fix only exposed gaps; add the ADR citation comment at the breaker block.
4. Verify GREEN.
5. Commit: "test(engine): genuine no_task_progress stall pinned; ceiling misread unreachable (#859)"

**Files likely touched:**
- src/conductor/test/engine/conductor.test.ts — loop-level tests
- src/conductor/src/engine/conductor.ts — comment citation only

**Wired-into:** none (no new production surface)
**Dependencies:** Task 3, Task 4

### Task 10: Rewrite the artifacts.ts #773 comment block to routing/authority semantics
**Story:** S5 (artifacts.ts comment checkbox); ADR Decision 6
**Type:** infrastructure

**Steps:**
1. Rewrite the `build:` predicate's #773 comment block (~1249-1269): rows are one input; the
   union with `Task:` trailers ROUTES the handoff; `build_review` is sole completion authority;
   cite adr-2026-07-23-trailer-union-build-step-routing and #859.
2. `npx tsc --noEmit` (or the package's typecheck script) still clean.
3. Commit: "docs(engine): build predicate comment reflects trailer-union routing (#859)"

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts — comment block only

**Wired-into:** none (no new production surface)
**Dependencies:** Task 4

### Task 11: Correct skills/pipeline/SKILL.md contract text
**Story:** S5 (SKILL.md checkbox + grep-zero negative)
**Type:** infrastructure

**Steps:**
1. Edit steps 5–6 (lines ~86-95) and the forward-progress note (~392): trailers ROUTE the
   build→build_review handoff (non-authoritative routing telemetry); `build_review` judges
   completion; remove "The engine derives completion from this trailer" / "completion is
   derived solely from the commit's `Task: <id>` trailer" phrasing.
2. Grep `skills/ docs/ src/conductor/README.md` for remaining "derives completion" trailer
   claims ⇒ zero stale matches.
3. Run `test/test_harness_integrity.sh` ⇒ passes.
4. Commit: "docs(skills): pipeline contract states routing/authority split (#859)"

**Files likely touched:**
- skills/pipeline/SKILL.md — contract text

**Wired-into:** none (no new production surface)
**Dependencies:** Task 4

### Task 12: User-facing doc sync + CHANGELOG
**Story:** S5 (CHANGELOG, README, daemon-operations checkboxes)
**Type:** infrastructure

**Steps:**
1. `CHANGELOG.md` `[Unreleased]` → Fixed: false `no_task_progress` halt at 100% completion;
   build exit now routes on the shared trailer-union resolution (#859). No VERSION edit (pre-v1).
2. `src/conductor/README.md`: build-completion/stall section describes the union routing.
3. `docs/daemon-operations.md`: `no_task_progress` semantics note — genuine stalls unchanged;
   all-evidenced builds hand off to build_review.
4. Commit: "docs: sync build-completion routing semantics (#859)"

**Files likely touched:**
- CHANGELOG.md — [Unreleased] Fixed entry
- src/conductor/README.md — completion/stall section
- docs/daemon-operations.md — stall semantics

**Wired-into:** none (no new production surface)
**Dependencies:** Task 10, Task 11

### Task 13: Full verification sweep
**Story:** S5 (integrity suite) + all Done-When gates
**Type:** infrastructure
**Verify-only:** yes

**Steps:**
1. Run the conductor test suite (engine + integration) — all green.
2. Run `test/test_harness_integrity.sh` — passes.
3. Re-grep the stale-claim sweep (Task 11 step 2) one final time.
4. Commit (empty): "verify: full suite + integrity green for trailer-union completion (#859)"
   with `Evidence: skipped full-suite-verification-run`

**Files likely touched:**
- none

**Wired-into:** none (no new production surface)
**Dependencies:** Task 5, Task 6, Task 7, Task 8, Task 9, Task 12

## Task Dependency Graph

```
T1 ──▶ T2 ──▶ T3 ─────────────▶ T9 ─────────────────┐
 │                              ▲                    │
 └──▶ T4 ──┬──▶ T5 ─────────────┼────────────────────┤
           ├──▶ T6 ─────────────┼────────────────────┤
           ├──▶ T7 ─────────────┼────────────────────┼──▶ T13
           ├──▶ T8 ─────────────┘                    │
           ├──▶ T10 ──┐                              │
           └──▶ T11 ──┴──▶ T12 ──────────────────────┘
```

## Integration Points

- After Task 4: the #859 fixture demonstrates predicate-level fix end-to-end (`checkStepCompletion`).
- After Task 9: loop-level behavior verified — false halt unreachable, genuine stall intact.
- After Task 12: docs/contract text consistent with shipped semantics; PR-ready.

## Coverage Mapping

| Story criterion | Task(s) |
|---|---|
| S1 happy (rows/skipped/trailer/alias) | T1 |
| S1 parity | T3 |
| S1 negatives (phantom/fail-soft/status/malformed) | T2 |
| S2 happy (#859 shape, mixed evidence) | T4, T5 |
| S2 negatives (missing/corrupt/plan/halt-marker/legacy) | T6, T7 |
| S3 happy (exact unresolved reason, retry-hint threading) | T8 (reason content; hint threading is existing conductor plumbing pinned by T9b) |
| S3 negatives (reverted trailer, truncation) | T8 |
| S4 happy (genuine stall, progress bypass) | T9 |
| S4 negatives (ceiling unreachable, halt-marker stall) | T9, T6 |
| S5 all | T10, T11, T12, T13 |

## Verification

- [ ] All happy path criteria covered by at least one task (mapping above)
- [ ] All negative path criteria covered by explicit tasks (T2, T6, T7, T8, T9)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic (graph above)
- [ ] Every task carries Wired-into per the review's Wiring Surface (T1 declares; rest none/inherit)
