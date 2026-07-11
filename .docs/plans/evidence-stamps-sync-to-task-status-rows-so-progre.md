# Implementation Plan: Evidence stamps sync to task-status rows (#526)

**Date:** 2026-07-11
**Design:** technical track — no PRD (`.docs/track/evidence-stamps-sync-to-task-status-rows-so-progre.md`)
**Stories:** `.docs/stories/evidence-stamps-sync-to-task-status-rows-so-progre.md`
**Conflict check:** skipped per Tier S (`.docs/complexity/evidence-stamps-sync-to-task-status-rows-so-progre.md`)

## Summary

Make `.pipeline/task-evidence.json`'s `evidenceStamps` the single source of truth that
`.pipeline/task-status.json` rows are reconciled from, so a stamped-but-`in_progress` row can
never persist past the write that stamped it. Root cause (#526): `applyDerivedCompletion`
(`autoheal.ts:798`) only advances rows whose status is `pending`, so an `in_progress` row with a
correct stamp (issue's task 26) is never flipped; and `writeJudgedStamps` (`task-evidence.ts:181`)
writes stamps without touching rows at all. Progress/stall readers count rows
(`task-progress.ts:34`, `build-progress-watcher.ts:77,253`), so they under-report and the stall
detector exhausts retries on committed, stamped work. 5 tasks: one reconcile primitive (happy +
negative), two call-site wirings, docs/changelog.

## Technical Approach

- **One reconcile primitive.** New exported `reconcileStatusFromStamps(projectRoot):
  Promise<{ synced: string[]; orphanStamps: string[] }>` in `autoheal.ts`, reusing the existing
  private `readTaskStatus`/`writeTaskStatus` and `createTaskEvidence`. Algorithm, evidence-first:
  load rows + `evidenceStamps`; for each stamp id, if a matching row exists whose status is
  neither `completed` nor `skipped`, set it `completed` and (if the stamp has a sha) set the
  row's `commit` to the 7-char short sha; if the stamp id matches NO row, push it to
  `orphanStamps` and emit ONE greppable `console.warn` per orphan (prefix
  `[task-evidence] stamp for unknown task id`) — never create a row. Rows with no stamp are never
  touched (completion only ever advances on stamp presence). Persist only if something changed.
  Missing/corrupt/empty `task-status.json` ⇒ logged no-op, never throws (wrap in try/catch
  returning the empty result, mirroring `applyDerivedCompletion`'s existing swallow).
- **Terminal rows are immutable.** `completed`/`skipped` rows keep their status and `commit`
  byte-for-byte — reconciliation only advances non-terminal rows, so it can never demote a skip
  or rewrite a finished row.
- **Wire the two stamp-write paths.** (1) `applyDerivedCompletion` keeps its existing
  `pending`-row derived-hit loop and H5 skip handling, then calls `reconcileStatusFromStamps` so
  `in_progress` rows carrying a stamp (from this or any prior pass) also sync — this is the
  minimal, additive fix for the task-26 shape, and it subsumes the old pending-only limitation
  without changing skip semantics. (2) `writeJudgedStamps` calls `reconcileStatusFromStamps`
  after `evidence.write()` via a dynamic `import('./autoheal.js')` (autoheal already dynamically
  imports task-evidence, so a static import here would risk an init cycle).
- **Readers unchanged.** `task-progress.ts` and `build-progress-watcher.ts` need no edit: once
  rows agree with stamps, the row counts they read are honest.
- **Sequencing.** Primitive (happy, then negative) first so both call-site tasks build on a
  tested helper; docs last.

## Prerequisites

- Repo checkout; vitest runs from `src/conductor` (never the worktree root), per repo precedent.
- No new deps, schema, CLI, or hook surface.

## Tasks

### Task 1: reconcileStatusFromStamps — happy-path sync
**Story:** RS-1 happy (stamped pending/in_progress row ⇒ completed; terminal row untouched)
**Type:** happy-path

**Steps:**
1. Write failing test: build a temp project with `.pipeline/task-status.json` (rows: `7`
   `in_progress`, `8` `pending`, `9` `completed`) and `.pipeline/task-evidence.json` with
   `evidenceStamps` for `7`, `8`, `9`; call `reconcileStatusFromStamps(root)` and assert rows 7
   and 8 become `completed` (with `commit` = short sha), row 9 unchanged, and `synced` = `[7,8]`.
2. Verify test fails (RED).
3. Implement `reconcileStatusFromStamps` in `autoheal.ts` reusing `readTaskStatus`/
   `writeTaskStatus`/`createTaskEvidence`; advance only non-terminal rows with a matching stamp;
   persist only on change.
4. Verify test passes (GREEN).
5. Commit: "feat(autoheal): reconcileStatusFromStamps advances stamped non-terminal rows (#526)"

**Files:**
- src/conductor/src/engine/autoheal.ts
- src/conductor/test/engine/autoheal.test.ts

**Dependencies:** none

### Task 2: reconcileStatusFromStamps — orphan + no-stamp + missing-file safety
**Story:** RS-2 (orphan stamp no-invent + warn), RS-1 negative (no-stamp row untouched)
**Type:** negative-path

**Steps:**
1. Write failing test: (a) `evidenceStamps` with an orphan id `99` (no row) plus a valid `7`
   (`in_progress`) ⇒ row 7 completed, no `99` row created, `orphanStamps` = `[99]`, and a
   `console.warn` containing `stamp for unknown task id` fired exactly once; (b) a row `8`
   `pending` with NO stamp stays `pending`; (c) missing/corrupt `task-status.json` ⇒ returns
   empty result, writes nothing, does not throw.
2. Verify test fails (RED).
3. Implement: orphan branch (`orphanStamps.push` + single greppable `console.warn`, no row
   creation); wrap the body so a missing/corrupt status file returns
   `{ synced: [], orphanStamps: [] }` without throwing.
4. Verify test passes (GREEN).
5. Commit: "feat(autoheal): reconcile never invents rows for orphan stamps, fail-soft on no status (#526)"

**Files:**
- src/conductor/src/engine/autoheal.ts
- src/conductor/test/engine/autoheal.test.ts

**Dependencies:** Task 1

### Task 3: applyDerivedCompletion syncs stamped in_progress rows
**Story:** RS-3 happy (applyDerivedCompletion advances in_progress rows), RS-1 happy (gate-cycle honesty)
**Type:** happy-path

**Steps:**
1. Write failing test: seed a plan + `task-status.json` with an `in_progress` row (task 26) and a
   matching `evidenceStamps` entry, run `applyDerivedCompletion(root, derived)` (derived lacking a
   `pending` hit for 26, matching the #526 shape), and assert task 26's row reads `completed` on
   disk afterward; assert a row-counting reader (`task-progress.ts`) then reports the task as
   resolved.
2. Verify test fails (RED) — pending-only filter leaves 26 `in_progress`.
3. Implement: after the existing pending/skip loop in `applyDerivedCompletion`, call
   `reconcileStatusFromStamps(projectRoot)`; keep the swallow-on-error contract and the
   `auto_heal` result shape.
4. Verify test passes (GREEN); existing `applyDerivedCompletion` tests still pass.
5. Commit: "fix(autoheal): applyDerivedCompletion syncs stamped in_progress rows, not just pending (#526)"

**Files:**
- src/conductor/src/engine/autoheal.ts
- src/conductor/test/engine/autoheal.test.ts

**Dependencies:** Task 2

### Task 4: writeJudgedStamps reconciles rows after stamping
**Story:** RS-3 (judged-lane stamp advances its row; orphan/no-status-file safety at this site)
**Type:** happy-path

**Steps:**
1. Write failing test: with a `task-status.json` row `10` `in_progress`, call
   `writeJudgedStamps(root, [{taskId:'10',...}], [])` and assert row 10 reads `completed` on
   disk; a validated `taskId` with no row ⇒ no row invented + warning; a project with no
   `task-status.json` ⇒ stamp still written to sidecar, no throw.
2. Verify test fails (RED).
3. Implement: after `evidence.write()` in `writeJudgedStamps`, `await import('./autoheal.js')`
   and call `reconcileStatusFromStamps(projectRoot)` (dynamic import to avoid an init cycle;
   reconcile already fail-soft on missing status).
4. Verify test passes (GREEN); existing `task-evidence.test.ts` (pre-existing stamps byte-identical)
   still passes.
5. Commit: "fix(task-evidence): writeJudgedStamps reconciles task-status rows after stamping (#526)"

**Files:**
- src/conductor/src/engine/task-evidence.ts
- src/conductor/test/engine/task-evidence.test.ts

**Dependencies:** Task 3

### Task 5: Docs + changelog
**Story:** cross-cutting (repo docs-track-features + changelog gate)
**Type:** docs

**Steps:**
1. Add a `## [Unreleased]` → `### Fixed` entry to `CHANGELOG.md` describing the stamp→row sync
   (stamped `in_progress` rows now reconcile to `completed`; judged-lane stamps reconcile rows;
   orphan stamps never invent rows), referencing #526.
2. Add a short note to `src/conductor/README.md` where task-status/evidence completion is
   described (or the evidence-derivation section) stating `evidenceStamps` is the single source
   of truth reconciled into `task-status.json` on every stamp write. Internal-only change (no
   CLI/hook/schema surface) — confirm no `## Migration` block is required.
3. Verify: `grep` the new CHANGELOG entry; `test/test_harness_integrity.sh` passes.
4. Commit: "docs: record evidence-stamp→task-status reconciliation (#526)"

**Files:**
- CHANGELOG.md
- src/conductor/README.md

**Dependencies:** Task 4

## Task Dependency Graph

```
Task 1 ─▶ Task 2 ─▶ Task 3 ─▶ Task 4 ─▶ Task 5
```
(Strictly linear: the primitive is proven happy then negative, then wired at each call site, then
documented.)

## Coverage Mapping

| Story criterion | Task(s) |
|---|---|
| RS-1 happy: stamped in_progress/pending row ⇒ completed | 1, 3 |
| RS-1 happy: gate cycle ⇒ row-counting reader reports N/N | 3 |
| RS-1 neg: terminal row untouched | 1 |
| RS-1 neg: no-stamp row never advanced | 2 |
| RS-2 happy: orphan stamp ⇒ no row invented + greppable warn | 2 |
| RS-2 happy: valid stamp still syncs despite co-present orphan | 2 |
| RS-2 neg: missing/corrupt status ⇒ logged no-op, no throw | 2, 4 |
| RS-3 happy: applyDerivedCompletion advances in_progress rows | 3 |
| RS-3 happy: writeJudgedStamps reconciles its row | 4 |
| RS-3 neg: orphan / no-status-file safety at both call sites | 2, 4 |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
