# Implementation Plan: re-enable bin/setup worktree smoke via worktree-local invocation (#334)

**Date:** 2026-07-06
**Design:** none (technical track, Tier S — see `.docs/track/reenable-bin-setup-worktree-smoke.md`,
`.docs/complexity/reenable-bin-setup-worktree-smoke.md`)
**Stories:** `.docs/stories/reenable-bin-setup-worktree-smoke.md`
**Conflict check:** intentionally skipped (Tier S)

## Summary

Re-enable the skipped `bin/setup worktree compatibility` smoke by pointing it at the temp
worktree's own `bin/setup` instead of the primary's, with a generous timeout. 6 tasks, one
production-test file touched.

## Technical Approach

The smoke (`src/conductor/test/engine/publish-interrupted.test.ts:179`) currently invokes the
**primary** checkout's `bin/setup` (`BIN_SETUP = join(REPO_ROOT, 'bin', 'setup')`) with
`cwd: worktreeDir`. `bin/setup` resolves its target from `$0`, so it rebuilds the primary and
the worktree's `src/conductor/dist` never appears (`lstat` ENOENT). Operator-selected fix
(Option C of #334): invoke `join(worktreeDir, 'bin', 'setup')` so `$0` resolves inside the
worktree; the unmodified script then runs `npm install` + the versioned build **in the
worktree**, creating the worktree-local `dist` symlink the assertions check. The change is
deliberately test-only: `bin/setup`, `src/conductor/src/engine/worktree-prepare.ts`, and
`src/conductor/scripts/publish-engine.mjs` MUST NOT change (Options A/B rejected — see
`.memory/decisions/2026-07-06-reenable-bin-setup-worktree-smoke.md`).

Sequencing is true RED→GREEN: first un-skip the smoke and watch it fail exactly as #334
describes (ENOENT on the worktree dist), then re-point the invocation and watch it pass.
The smoke pays a real `npm install` per run **by design** — the `it` gets an explicit
`timeout: 600_000` (vitest default 5s; install+build takes minutes; 10 min is headroom for
cold CI caches).

## Prerequisites

- `src/conductor/node_modules` installed in the working checkout (`npm install` in
  `src/conductor`) so vitest can run.
- Network access to the npm registry (the smoke installs the worktree's dependencies).

## Tasks

### Task 1: Re-enable the smoke and reproduce the #334 failure (RED)
**Story:** happy path — "executes as `it` … with an explicit per-test timeout of 600_000 ms"
**Type:** happy-path (RED half)

**Steps:**
1. In `src/conductor/test/engine/publish-interrupted.test.ts`: change `it.skip(` to `it(` on
   the smoke and add the timeout: `it('creates a worktree-local dist/ symlink without
   touching the primary checkout', { timeout: 600_000 }, async (ctx) => …)` (vitest v1+
   options-object form; match the project's vitest idiom if it differs).
2. Run `rtk proxy npx vitest run test/engine/publish-interrupted.test.ts` from `src/conductor`.
3. Verify RED: the smoke FAILS with ENOENT from `lstat(<worktreeDir>/src/conductor/dist)` —
   the exact #334 symptom. (The two interrupted-publish tests must still pass.)

**Files likely touched:**
- `src/conductor/test/engine/publish-interrupted.test.ts` — `it.skip` → `it` + timeout

**Dependencies:** none

### Task 2: Point the invocation at the worktree's own bin/setup (GREEN)
**Story:** happy paths — "executes the worktree's own script … with `cwd: worktreeDir` and
`CI: 'true'`", "dist is a symlink and dist/index.js exists", "primary symlink mtime unchanged"
**Type:** happy-path (GREEN half)

**Steps:**
1. In the smoke body, replace the `execa(BIN_SETUP, [], …)` call with
   `execa(join(worktreeDir, 'bin', 'setup'), [], { cwd: worktreeDir, env: { ...process.env, CI: 'true' } })`
   (options unchanged).
2. Keep every existing assertion: worktree `dist` is a symlink, `dist/index.js` exists,
   primary `dist` `lstat` state and `mtimeMs` unchanged.
3. Re-run the file's suite; verify GREEN — smoke passes within the timeout.

**Files likely touched:**
- `src/conductor/test/engine/publish-interrupted.test.ts` — invocation target

**Dependencies:** Task 1

### Task 3: Re-point the existence guard at the worktree copy (negative path)
**Story:** negative path — "bin/setup absent from the created worktree → explicit skip/fail,
not unhandled ENOENT"
**Type:** negative-path

**Steps:**
1. Move/adjust the `exists()` guard so it checks the **worktree's** `bin/setup` after
   `git worktree add` (the tracked file is expected there; `ctx.skip()` if absent). The
   top-level `BIN_SETUP` const may remain for the primary-dist path computation only.
2. Re-run the file's suite; smoke still GREEN (guard does not trip on current repo state).

**Files likely touched:**
- `src/conductor/test/engine/publish-interrupted.test.ts` — guard placement

**Dependencies:** Task 2

### Task 4: Verify failure propagation + cleanup (negative path, evidence-only)
**Story:** negative path — "bin/setup exits non-zero → test FAILS promptly; finally cleanup
still removes worktree, branch, temp dir"
**Type:** negative-path (verification; no committed code change expected)

**Steps:**
1. Temporarily force a failure (e.g. after `git worktree add`, `chmod -x` the worktree's
   `bin/setup` in a scratch copy of the test run, or point the invocation at a
   known-failing stub) and run the smoke once.
2. Verify: the test fails with the setup error (execa rejection) well before the timeout, and
   afterwards `git worktree list` shows no leftover smoke worktree and
   `git branch --list 'bin-setup-smoke-*'` is empty.
3. Revert the temporary sabotage; confirm the committed test text is untouched by this task.

**Files likely touched:**
- none committed

**Dependencies:** Task 3

### Task 5: Rewrite the stale SKIPPED comment block
**Story:** happy path — "comment rewritten to describe the actual semantics"
**Type:** refactor

**Steps:**
1. Replace the `// SKIPPED pending #334 …` block (test.ts:172-178) with a short comment: the
   smoke runs the **worktree's own** `bin/setup` (so `$0` resolves inside the worktree) and
   performs a real `npm install` + versioned build there by design (#334, Option C), hence
   the 600s timeout.
2. Also refresh the section banner (test.ts:146-157) which still says `bin/setup` "does not
   exist yet on this branch" — it landed in PR #269.

**Files likely touched:**
- `src/conductor/test/engine/publish-interrupted.test.ts` — comments only

**Dependencies:** Task 2

### Task 6: Full suite + CHANGELOG
**Story:** Done When — "full conductor suite green", "diff touches only the test file (plus
CHANGELOG per repo rules)"
**Type:** infrastructure

**Steps:**
1. Run the full conductor suite: `rtk proxy npx vitest run` from `src/conductor`. All green.
2. Add a `### Fixed` entry under `## [Unreleased]` in `CHANGELOG.md`: re-enabled the
   bin/setup worktree smoke by invoking the worktree's own `bin/setup` (#334).
3. Run `test/test_harness_integrity.sh` (repo validation gate) — must pass.
4. Verify the diff: `git diff --stat` lists exactly
   `src/conductor/test/engine/publish-interrupted.test.ts` and `CHANGELOG.md`.
5. Commit: "test(conductor): re-enable bin/setup worktree smoke via worktree-local invocation (#334)".

**Files likely touched:**
- `CHANGELOG.md` — `[Unreleased]` → Fixed

**Dependencies:** Tasks 1–5

## Task Dependency Graph

```
Task 1 (RED) → Task 2 (GREEN) → Task 3 (guard) → Task 4 (failure evidence)
                     └→ Task 5 (comments) ────────────┴→ Task 6 (suite + changelog + commit)
```

## Integration Points

- After Task 2: the #334 acceptance can be demonstrated end-to-end (worktree dist symlink
  exists; primary untouched).
- After Task 6: suite-green evidence for the PR.

## Coverage

| Acceptance criterion (stories file) | Task |
|---|---|
| smoke runs as `it` with 600_000 ms timeout | 1 |
| invokes worktree's own `bin/setup`, `cwd`+`CI` kept | 2 |
| worktree `dist` symlink + `dist/index.js` exist | 2 |
| primary `dist` mtime unchanged | 2 |
| stale comment rewritten | 5 |
| non-zero `bin/setup` → prompt failure + cleanup | 4 |
| absent `bin/setup` → explicit guard, no raw ENOENT | 3 |
| Done When: no `it.skip`; targeted + full suite green; diff scope | 1, 2, 6 |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by explicit tasks (3, 4)
- [ ] No task exceeds ~5 minutes of agent work (suite runtime excluded)
- [ ] Dependencies are explicit and acyclic
