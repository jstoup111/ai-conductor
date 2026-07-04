# Implementation Plan: conductor test suite must not leak .pipeline artifacts into the process cwd

**Date:** 2026-07-04
**Design:** technical track — no PRD; approach recorded in `.memory/decisions/pipeline-halt-leak-required-projectroot.md`
**Stories:** `.docs/stories/conductor-test-suite-leaks-a-real-pipeline-halt-in.md`
**Conflict check:** skipped per complexity Tier S (`.docs/complexity/conductor-test-suite-leaks-a-real-pipeline-halt-in.md`)
**Source:** jstoup111/ai-conductor#252

## Summary

Nine tasks: mechanically isolate the ~80 Conductor test constructions into their existing
tmpdirs, then make `projectRoot` a required `ConductorOptions` field (deleting the
`?? process.cwd()` fallback that fabricated operator-facing HALTs), then add a vitest
globalSetup/teardown snapshot-diff guard so any future cwd `.pipeline` leak fails the suite.

## Technical Approach

- **Order for green commits:** add `projectRoot: dir` to test sites FIRST (compatible while the
  field is still optional), flip the field to required SECOND (compiler then enforces it
  forever), guard LAST. Every commit compiles and passes the suite.
- **TECH-1 mechanism:** in `src/conductor/src/engine/conductor.ts`, change
  `ConductorOptions.projectRoot?: string` → `projectRoot: string`; replace
  `this.projectRoot = opts.projectRoot ?? process.cwd()` (line ~480) with an assignment guarded
  by a runtime throw (`if (!opts.projectRoot) throw new Error('Conductor requires an explicit projectRoot — refusing to default to process.cwd()')`)
  so JS-level evasion (`undefined as any`, `''`) fails before any filesystem path is derived.
  Production call sites `src/daemon-cli.ts:284` and `src/index.ts:741` already pass it — no
  production diff.
- **TECH-2 mechanism:** every offending test file already creates a per-test tmpdir
  (`dir = await mkdtemp(...)`) in `beforeEach`/local helpers; the fix is adding
  `projectRoot: dir` to each construction — 69 in `test/engine/conductor.test.ts`, 10 in
  `test/engine/when-parallel.test.ts`, 1 in `test/integration/config-flow.test.ts`. Tests that
  assert on `.pipeline` artifacts keep working because writes land in `dir/.pipeline`.
- **TECH-3 mechanism:** new `test/pipeline-leak-guard.ts` exporting pure
  `snapshotPipeline(cwd)` (existence + recursive entry list + mtimeMs/size per entry) and
  `diffPipeline(before, after)` (returns added/modified paths). A new vitest `globalSetup`
  file (`test/global-setup.ts`, registered in `vitest.config.ts` alongside the existing
  `setupFiles`) snapshots at start and returns a teardown that throws listing leaked paths if
  the diff is non-empty. Pure functions are unit-testable; the no-false-positive case (a
  pre-existing live `.pipeline/` untouched by the suite) is a first-class test.

## Prerequisites

- Remove the currently-leaked droppings in the primary checkout before the first verification
  run: `rm -rf src/conductor/.pipeline` (untracked/gitignored; operational cleanup, not a commit).

## Tasks

### Task 1: Isolate all Conductor constructions in `test/engine/conductor.test.ts`
**Story:** TECH-2 happy path (suite writes only under tmpdirs)
**Type:** infrastructure

**Steps:**
1. Add `projectRoot: dir` (the file's existing per-test tmpdir) to each of the 69 `new Conductor({...})` constructions currently omitting it.
2. Run `rtk proxy npx vitest run test/engine/conductor.test.ts` — all pass (GREEN; field is still optional so this is behavior-neutral for assertions, but HALT/DONE/gates now land in `dir`).
3. Verify `test -e .pipeline` in the package cwd → absent after the run.
4. Commit: "test(conductor): pass explicit tmpdir projectRoot in conductor.test.ts (no cwd .pipeline writes)"

**Files likely touched:**
- `src/conductor/test/engine/conductor.test.ts` — add `projectRoot: dir` to 69 constructions

**Dependencies:** none

### Task 2: Isolate Conductor constructions in `test/engine/when-parallel.test.ts`
**Story:** TECH-2 happy path
**Type:** infrastructure

**Steps:**
1. Add `projectRoot: <that file's tmpdir>` to the 10 constructions omitting it (reuse the file's existing mkdtemp dir; thread it through its local helper if constructions go via one).
2. Run `rtk proxy npx vitest run test/engine/when-parallel.test.ts` — GREEN, no cwd `.pipeline`.
3. Commit: "test(conductor): tmpdir projectRoot in when-parallel.test.ts"

**Files likely touched:**
- `src/conductor/test/engine/when-parallel.test.ts` — 10 constructions

**Dependencies:** none

### Task 3: Isolate the Conductor construction in `test/integration/config-flow.test.ts`
**Story:** TECH-2 happy path
**Type:** infrastructure

**Steps:**
1. Add `projectRoot: dir` to the single construction at ~line 63.
2. Run `rtk proxy npx vitest run test/integration/config-flow.test.ts` — GREEN.
3. Commit: "test(conductor): tmpdir projectRoot in config-flow integration test"

**Files likely touched:**
- `src/conductor/test/integration/config-flow.test.ts` — 1 construction

**Dependencies:** none

### Task 4: Full-suite leak verification checkpoint
**Story:** TECH-2 "Done When" (`rtk proxy npx vitest run` leaves no `src/conductor/.pipeline`)
**Type:** happy-path

**Steps:**
1. `rm -rf .pipeline` in the package dir (clear old droppings).
2. Run the FULL suite from `src/conductor/`: `rtk proxy npx vitest run`.
3. Assert `test -e .pipeline; echo $?` → `1` (nothing reappeared) and the suite is green.
4. If anything reappears, locate the residual writer (`grep` the failing artifact's content back to its writing test) and isolate it the same way before proceeding.
5. Commit only if steps 1–3 needed extra fixes; otherwise no-op checkpoint.

**Files likely touched:** none (verification)

**Dependencies:** Tasks 1, 2, 3

### Task 5: RED — runtime throw on missing/empty projectRoot
**Story:** TECH-1 negative path (runtime evasion throws before any filesystem write)
**Type:** negative-path

**Steps:**
1. Write failing tests in `test/engine/conductor.test.ts`: `new Conductor({ stateFilePath, stepRunner, events, projectRoot: undefined as unknown as string })` throws an error whose message names `projectRoot`; same for `projectRoot: ''`. Assert no `.pipeline` is created in cwd by the attempt.
2. Verify RED (currently the constructor silently defaults to cwd).
3. Commit deferred to Task 6 (RED+GREEN land together per TDD cycle).

**Files likely touched:**
- `src/conductor/test/engine/conductor.test.ts` — new `describe('projectRoot is required')` block

**Dependencies:** Task 1 (same file, avoid conflicts)

### Task 6: GREEN — make `projectRoot` required and delete the cwd fallback
**Story:** TECH-1 happy path + negative paths (compile-time requirement; production unchanged)
**Type:** happy-path

**Steps:**
1. In `src/engine/conductor.ts`: make `ConductorOptions.projectRoot` non-optional; replace the `?? process.cwd()` fallback with the runtime throw from the Technical Approach.
2. Run `npx tsc --noEmit` — must pass with zero uncovered construction sites (Tasks 1–3 made all test sites explicit; `daemon-cli.ts`/`index.ts` already comply).
3. Run Task 5's tests — GREEN.
4. `grep -n "process.cwd()" src/engine/conductor.ts` → no pipeline-root usage remains.
5. Full suite green.
6. Commit: "fix(conductor): require explicit projectRoot — never default .pipeline writes to process.cwd() (#252)"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — `ConductorOptions` type + constructor

**Dependencies:** Tasks 1, 2, 3, 5

### Task 7: Leak-guard pure functions with unit tests
**Story:** TECH-3 (snapshot/diff logic; no-false-positive negative path)
**Type:** negative-path

**Steps:**
1. Write failing tests in new `test/engine/pipeline-leak-guard.test.ts`: (a) `diffPipeline` flags a file added under `.pipeline/` between snapshots; (b) flags a modified (mtime/size changed) pre-existing file; (c) returns empty for an untouched pre-existing `.pipeline/` (no false positive); (d) returns empty when `.pipeline` never existed.
2. Verify RED.
3. Implement `test/pipeline-leak-guard.ts`: `snapshotPipeline(cwd)` → `{ exists, entries: Map<relPath, {mtimeMs, size}> }`; `diffPipeline(before, after)` → `{ added: string[], modified: string[] }`.
4. Verify GREEN.
5. Commit: "test(conductor): pipeline leak-guard snapshot/diff primitives"

**Files likely touched:**
- `src/conductor/test/pipeline-leak-guard.ts` — new
- `src/conductor/test/engine/pipeline-leak-guard.test.ts` — new

**Dependencies:** none

### Task 8: Wire the guard into vitest globalSetup/teardown
**Story:** TECH-3 happy path + trip case (suite fails naming leaked paths)
**Type:** infrastructure

**Steps:**
1. Add `test/global-setup.ts`: default export snapshots `process.cwd()` via `snapshotPipeline`, returns async teardown that re-snapshots, diffs, and `throw new Error('.pipeline leak into <cwd> during test run: <added/modified paths>')` on a non-empty diff.
2. Register in `vitest.config.ts`: `globalSetup: ['./test/global-setup.ts']` (keep existing `setupFiles`).
3. Self-check the trip case once manually: temporarily plant `mkdir -p .pipeline && touch .pipeline/HALT` mid-run (or via a scratch test), observe the teardown failure message, remove the plant. Document the check as a comment in `global-setup.ts`.
4. Full suite green from a clean cwd; guard silent.
5. Commit: "test(conductor): fail the suite on any cwd .pipeline leak (globalSetup guard)"

**Files likely touched:**
- `src/conductor/test/global-setup.ts` — new
- `src/conductor/vitest.config.ts` — register globalSetup

**Dependencies:** Task 7

### Task 9: CHANGELOG + docs
**Story:** all (harness repo release gate)
**Type:** infrastructure

**Steps:**
1. Add to `CHANGELOG.md` `## [Unreleased]` → Fixed: test suite leaked a real `.pipeline/HALT`/`gates/`/`DONE` into the process cwd (poisoning live daemon worktrees); `Conductor.projectRoot` is now required and the suite fails on any cwd `.pipeline` leak (#252).
2. No README change needed (no user-facing CLI/flag change; internal engine option). No Migration block (ConductorOptions is not a published consumer contract; `bin/conduct`/`settings.json` untouched).
3. Run `test/test_harness_integrity.sh` (repo validation gate).
4. Commit: "docs: changelog for required Conductor projectRoot + suite leak guard"

**Files likely touched:**
- `CHANGELOG.md`

**Dependencies:** Tasks 6, 8

## Task Dependency Graph

```
T1 ─┬─▶ T4 ─┐
T2 ─┤       │
T3 ─┘       │
T1 ───▶ T5 ─┴▶ T6 ─┐
T7 ───▶ T8 ────────┴▶ T9
```

## Integration Points

- After Task 4: full suite runs from any cwd with zero leakage — the 2026-07-03 poisoning
  scenario is dead for existing tests.
- After Task 6: the compiler + runtime throw make the regression impossible at the constructor.
- After Task 8: any OTHER cwd-relative pipeline writer (present or future) turns CI red.

## Verification

- [ ] All happy path criteria covered: TECH-1 → T6; TECH-2 → T1–T4; TECH-3 → T8
- [ ] All negative path criteria covered: TECH-1 compile/runtime → T5/T6; TECH-2 live-worktree
      invariance → T4 + T8 no-false-positive; TECH-3 trip + no-false-positive → T7/T8
- [ ] No task exceeds 5 minutes (T1 is mechanical bulk-edit of one file; use a scripted edit)
- [ ] Dependencies explicit and acyclic (see graph)
