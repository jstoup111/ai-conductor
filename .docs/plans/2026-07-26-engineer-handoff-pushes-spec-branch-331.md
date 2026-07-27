# Implementation Plan: Engineer handoff publishes the spec branch

**Date:** 2026-07-26
**Design:** Technical track — `.docs/track/engineer-handoff-pushes-spec-branch-331.md`
**Stories:** `.docs/stories/engineer-handoff-pushes-spec-branch-331.md`
**Conflict check:** Skipped — Small-tier feature

## Summary

Teach the shared engineer handoff primitive to distinguish an absent remote from a failed remote,
push the exact spec branch before PR creation, and make the deterministic CLI return failure for
publication errors. Five TDD tasks cover first publication, retry safety, offline evidence, CLI
composition, and the end-to-end command contract.

## Technical Approach

- Extend the existing `openSpecPr` dependency bag with the repository's shared injectable
  `GitRunner`; do not create a second Git execution abstraction.
- Use parsed `TargetRepo.remote` presence as the no-remote discriminator. When absent, preserve the
  existing authored-ledger `pr-skipped` result without invoking Git or GitHub.
- For remote targets, run `git push -u origin <branch>` in the per-idea worktree before the existing
  `gh pr create --head <branch> --fill`. Use a normal push only, so divergence remains a hard,
  non-destructive failure.
- Wire `makeProductionGit()` at the deterministic CLI composition root and inject the same runner
  through the scripted `runHandoff` path. Publication errors propagate from `openSpecPr`.
- Change only the deterministic CLI's thrown-publication branch: print the actionable failure and
  retained-worktree location, then return nonzero without emitting `local-commit`. Keep branch
  evidence advisory and keep genuine `pr-skipped` output unchanged.

## Prerequisites

- Accepted stories for TECH-1 and TECH-2.
- Existing `TargetRepo`, `GitRunner`, authored-ledger, GitHub runner, and worktree-removal seams.
- No dependency or schema changes.

## Tasks

### Task 1: Publish before creating the PR

**Story:** TECH-1 — new-branch publication and command ordering
**Type:** happy-path

**Steps:**
1. Write failing unit tests proving a remote target invokes `git push -u origin spec/<slug>` in the
   supplied worktree before `gh pr create --head spec/<slug> --fill`.
2. Verify the focused handoff test fails because no Git runner is invoked.
3. Add an injected `GitRunner` to `HandoffDeps` and run the normal push before the existing PR call.
4. Verify the focused test passes and still returns the existing `pr-opened` URL result.
5. Commit with message: `fix(engineer): push spec branch before opening PR`.

**Files:**
- `src/conductor/src/engine/engineer/handoff.ts` — add remote-aware push-before-create behavior.
- `src/conductor/test/engine/engineer/handoff.test.ts` — prove exact argv, cwd, ordering, and result.

**Wired-into:** none (no new production surface)

**Dependencies:** none

### Task 2: Preserve safe retry and push-failure behavior

**Story:** TECH-1 — fast-forward retry, divergence, and no-force negative path; TECH-2 — remote
publication failures are not offline success
**Type:** negative-path

**Steps:**
1. Write failing tests where the injected Git runner accepts an already-published fast-forward and
   rejects divergence/auth/network/authorization cases.
2. Verify tests expose any PR invocation after a failed push or any force-push argv.
3. Tighten `openSpecPr` sequencing so Git failures propagate unchanged and PR creation is never
   attempted after them; keep all push argv free of force flags.
4. Verify retry proceeds to PR creation while every rejected push stops before GitHub.
5. Commit with message: `test(engineer): guard handoff publication failures`.

**Files:**
- `src/conductor/src/engine/engineer/handoff.ts` — preserve strict sequencing and propagated errors.
- `src/conductor/test/engine/engineer/handoff.test.ts` — cover retry, rejection classes, and no-force invariant.

**Wired-into:** same as Task 1

**Dependencies:** Task 1

### Task 3: Keep genuine no-remote handoff local

**Story:** TECH-2 — no-remote local result, no external calls, and invariant ledger evidence
**Type:** negative-path

**Steps:**
1. Write failing tests for a `TargetRepo` without `remote` proving neither Git nor GitHub runner is
   called while `pr-skipped` and authored-ledger evidence are produced.
2. Verify the test fails against the current GitHub-error-pattern fallback.
3. Move no-remote classification to the parsed target boundary before publication and preserve the
   existing authored-key write.
4. Verify the no-remote unit tests and existing no-merge/no-build guarantees pass.
5. Commit with message: `fix(engineer): reserve local fallback for no remote`.

**Files:**
- `src/conductor/src/engine/engineer/handoff.ts` — short-circuit only when `TargetRepo.remote` is absent.
- `src/conductor/test/engine/engineer/handoff.test.ts` — prove no external invocation and ledger persistence.

**Wired-into:** same as Task 1

**Dependencies:** Task 1

### Task 4: Wire Git publication through both handoff callers

**Story:** TECH-1 — production command works from the per-idea worktree; TECH-2 — scripted and CLI
paths retain consistent remote classification
**Type:** infrastructure

**Steps:**
1. Write failing composition tests showing both `dispatchEngineer(...handoff...)` and `runHandoff`
   supply a Git runner with the per-idea worktree/current target cwd.
2. Verify TypeScript or the focused tests fail because the new dependency is unwired.
3. Add `git` injection to `DispatchEngineerOpts` and `RunHandoffDeps`, default the CLI to
   `makeProductionGit()`, and pass each runner into `openSpecPr`.
4. Verify both handoff caller suites pass without executing real Git or GitHub commands.
5. Commit with message: `fix(engineer): wire handoff git publisher`.

**Files:**
- `src/conductor/src/engine/engineer-cli.ts` — compose the production/injected Git runner.
- `src/conductor/src/engine/engineer/handoff-step.ts` — propagate Git through the scripted path.
- `src/conductor/src/engine/engineer/loop.ts` — expose the scripted-path Git dependency if required by its caller contract.
- `src/conductor/test/engine/engineer/engineer-cli-handoff-branch-evidence.test.ts` — assert CLI composition and cwd.
- `src/conductor/test/engine/engineer/handoff-step.test.ts` — assert scripted-path composition.

**Wired-into:** `src/conductor/src/engine/engineer-cli.ts#dispatchEngineer, src/conductor/src/engine/engineer/handoff-step.ts#runHandoff`

**Dependencies:** Tasks 1, 3

### Task 5: Make publication failures fail the CLI handoff

**Story:** TECH-1 — push/PR failure returns nonzero and retains worktree; TECH-2 — failures never
emit `local-commit`
**Type:** negative-path

**Steps:**
1. Replace the outdated catch-path expectations with failing CLI tests for push failure, thrown PR
   failure, and missing PR URL: nonzero status, no `local-commit` JSON, retained worktree message,
   and preserved advisory branch evidence when `--source-ref` exists.
2. Verify the tests fail because the current catch block returns exit 0 with `local-commit`.
3. Change the thrown-publication catch path to retain its diagnostics/evidence attempt and return
   nonzero without printing success JSON; leave the explicit `pr-skipped` branch unchanged.
4. Run the handoff unit and CLI suites, then run a real local bare-remote integration fixture proving
   first publication creates `refs/heads/spec/<slug>` before the stubbed PR call.
5. Commit with message: `fix(engineer): fail loudly when handoff publication fails`.

**Files:**
- `src/conductor/src/engine/engineer-cli.ts` — correct thrown-publication exit and output semantics.
- `src/conductor/test/engine/engineer/engineer-cli-handoff-branch-evidence.test.ts` — cover failure status, output, retention, and evidence.
- `src/conductor/test/acceptance/engineer-worktree-isolation.test.ts` — prove first-push remote reachability and ordering with a local Git remote.

**Wired-into:** `src/conductor/src/engine/engineer-cli.ts#dispatchEngineer`

**Dependencies:** Tasks 2, 4

## Task Dependency Graph

```text
Task 1 ──┬──> Task 2 ──────────┐
         └──> Task 3 ──> Task 4 ├──> Task 5
                 Task 1 ────────┘
```

## Integration Points

- After Task 3: `openSpecPr` fully distinguishes remote publication from offline preservation.
- After Task 4: both production handoff callers provide the Git and GitHub dependencies.
- After Task 5: the deterministic CLI satisfies the complete first-handoff and failure contract.

## Acceptance-Criterion Coverage

| Story criterion | Tasks |
|---|---|
| TECH-1: new branch pushed with upstream before PR create | 1, 4, 5 |
| TECH-1: successful publication reports existing `pr-opened` URL | 1, 5 |
| TECH-1: same/fast-forward retry succeeds without force | 2 |
| TECH-1: divergent push stops, never force-pushes, retains worktree, exits nonzero | 2, 5 |
| TECH-1: PR failure/missing URL exits nonzero and retains worktree | 5 |
| TECH-2: no remote produces local result without push/PR calls | 3, 4 |
| TECH-2: no-remote intake evidence remains recorded | 3, 5 |
| TECH-2: remote push failures never become local success | 2, 5 |
| TECH-2: PR failure after push never becomes local success | 5 |

## Verification

- [x] All happy-path criteria map to at least one task.
- [x] All negative-path criteria map to explicit tasks.
- [x] Tasks are scoped to short RED/GREEN/commit cycles.
- [x] Dependencies are explicit and acyclic.
- [x] Every task declares its production wiring or inherits it.
- [x] No ordinary documentation work is included.
