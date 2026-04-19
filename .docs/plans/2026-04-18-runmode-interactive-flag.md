# Implementation Plan: runmode-interactive-flag

**Date:** 2026-04-18
**Design:** `.claude/plans/cozy-foraging-rabbit.md`
**Stories:** `.docs/stories/runmode-interactive-flag.md`
**Conflict check:** Skipped (Small tier)

## Summary

Wire the `--interactive` CLI flag to the existing `RunMode = 'interactive'` code path. 5 tasks covering: CLI option declaration, mode derivation + mutual exclusion, and README accuracy. Engine and provider require no changes.

## Prerequisites

- Worktree `runmode-interactive-flag` checked out on branch `worktree-runmode-interactive-flag`
- Node.js / npm available; `npm install` run in `src/conductor/`
- Existing test suite passing (`npm test` in `src/conductor/` → 671 tests green)

## Tasks

### Task 1: Add `interactive` field to CLIOptions and Commander option

**Story:** Add `--interactive` flag — happy path (CLI parsing)
**Type:** infrastructure

**Steps:**
1. Write failing test: in `src/conductor/test/cli.test.ts` (or equivalent), assert that parsing `['--interactive']` produces `CLIOptions.interactive === true`, and that parsing `[]` produces `CLIOptions.interactive === false`.
2. Verify test fails (RED) — `interactive` property does not exist on `CLIOptions`.
3. In `src/conductor/src/cli.ts:8`, add `interactive: boolean;` to the `CLIOptions` interface.
4. In `src/conductor/src/cli.ts:33`, add `.option('--interactive', 'Run every step in interactive Claude REPL mode (no -p flag)')` to the Commander chain.
5. Verify test passes (GREEN).
6. Commit: `feat(cli): add --interactive option declaration to CLIOptions and Commander`

**Files likely touched:**
- `src/conductor/src/cli.ts` — add field to interface + Commander option
- `src/conductor/test/cli.test.ts` (or nearest CLI parse test file)

**Dependencies:** none

---

### Task 2: Update RunMode derivation and add mutual-exclusion guard

**Story:** Add `--interactive` flag — happy path (mode construction) + negative path (mutual exclusion)
**Type:** happy-path + negative-path

**Steps:**
1. Write failing tests:
   - `opts = { auto: false, interactive: true }` → derived mode is `'interactive'`
   - `opts = { auto: true, interactive: false }` → derived mode is `'auto'`
   - `opts = { auto: false, interactive: false }` → derived mode is `'default'`
   - `opts = { auto: true, interactive: true }` → process exits non-zero with message containing `--auto`, `--interactive`, `mutually exclusive`
2. Verify all four tests fail (RED).
3. In `src/conductor/src/index.ts:287`, replace the current ternary:
   ```ts
   // before
   const mode: RunMode = opts.auto ? 'auto' : 'default';
   // after
   if (opts.auto && opts.interactive) {
     console.error('Error: --auto and --interactive are mutually exclusive');
     process.exit(1);
   }
   const mode: RunMode = opts.auto ? 'auto' : opts.interactive ? 'interactive' : 'default';
   ```
4. Verify all four tests pass (GREEN).
5. Commit: `feat(cli): wire --interactive to RunMode and guard against --auto conflict`

**Files likely touched:**
- `src/conductor/src/index.ts` — update mode derivation at line ~287
- `src/conductor/test/` — new/updated unit tests for mode derivation

**Dependencies:** Task 1 (CLIOptions must have `interactive` field)

---

### Task 3: Verify `--help` output includes `--interactive`

**Story:** Add `--interactive` flag — negative path (`--help` coverage)
**Type:** negative-path

**Steps:**
1. Write failing test: spawn conductor with `['--help']`, capture stdout, assert it contains the string `--interactive`.
2. Verify test fails (RED) — flag not yet present (Task 1 not yet applied in test env, or confirm ordering).
3. No production code change needed — Commander auto-generates `--help` from `.option()` declarations added in Task 1.
4. Verify test passes (GREEN) once Task 1 is applied.
5. Commit: `test(cli): assert --help output includes --interactive flag`

**Files likely touched:**
- `src/conductor/test/` — new help-output assertion

**Dependencies:** Task 1

---

### Task 4: Regression — default and --auto modes unchanged

**Story:** Add `--interactive` flag — happy path regression (no flags, --auto only)
**Type:** negative-path (regression guard)

**Steps:**
1. Confirm existing tests for `mode: 'auto'` and `mode: 'default'` derivation still pass after Task 2 changes. If no such tests exist, write them:
   - No flags → `RunMode = 'default'`
   - `--auto` only → `RunMode = 'auto'`
2. Run full test suite: `npm test` in `src/conductor/`. All 671+ tests must pass.
3. If any test breaks, fix before proceeding.
4. Commit (only if new tests added): `test(cli): add regression guards for default and auto mode derivation`

**Files likely touched:**
- `src/conductor/test/` — regression tests only if missing

**Dependencies:** Task 2

---

### Task 5: Review and update README.md lines 52–85

**Story:** Add `--interactive` flag — done-when clause (README accuracy)
**Type:** infrastructure

**Steps:**
1. Read `README.md` lines 52–85.
2. Verify the `--interactive` usage example matches actual behavior: `conduct --interactive "feature"` runs every step in REPL mode.
3. Remove or correct any claims that are not implemented (e.g., checkpoint-skipping in interactive mode, if not true).
4. No test needed — manual verification per the story's Done When clause.
5. Commit: `docs(readme): verify --interactive usage examples are accurate`

**Files likely touched:**
- `README.md` — wording cleanup only if needed

**Dependencies:** Task 2 (must know exact behavior before documenting it)

---

## Task Dependency Graph

```
Task 1 (CLIOptions + Commander option)
  └── Task 2 (mode derivation + mutual exclusion)
        ├── Task 3 (--help test — depends on Task 1 option being wired)
        ├── Task 4 (regression tests)
        └── Task 5 (README review)
```

## Integration Points

- After Task 2: full end-to-end mode derivation is testable — all four flag combinations resolve correctly.
- After Task 4: full test suite passes; safe to commit and open PR.

## Coverage Mapping

| Acceptance Criterion | Covered By |
|---|---|
| `--interactive` → `RunMode = 'interactive'` | Task 2 |
| Step continues after REPL exits | Existing engine tests (no new task needed) |
| No flags → `RunMode = 'default'` (regression) | Task 4 |
| `--auto` → `RunMode = 'auto'` (regression) | Task 4 |
| `--auto --interactive` → non-zero exit + error message | Task 2 |
| `--help` includes `--interactive` | Task 3 |
| README 52–85 accurate | Task 5 |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Dependencies are explicit and acyclic
- [x] Tasks are TDD-sequenced (test → implement → commit)
