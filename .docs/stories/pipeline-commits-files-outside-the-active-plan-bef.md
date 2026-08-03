# Stories: Plan-scope containment at the commit boundary

**Date:** 2026-08-02
**Track:** Technical
**Tier:** M
**Status: Accepted**
**ADR:** `.docs/decisions/adr-2026-08-02-plan-scope-containment-at-commit-boundary.md`
**Issue:** #1227

Technical track — acceptance criteria live here; there is no PRD.

---

## Story TI-1: Plan-declared paths are seeded onto task rows

**As** the commit-boundary check
**I want** each `task-status.json` row to carry its plan-declared paths
**So that** the hook can authoritatively resolve a task's scope without parsing markdown in shell.

### Happy path

**Given** a plan whose Task 3 declares `**Files:**` with `src/conductor/src/engine/config.ts`
and `src/conductor/test/engine/config.test.ts`
**When** `seedTaskStatus` runs at build entry
**Then** the seeded row for task 3 carries `files` containing exactly those two paths
**And** the paths are the same set `parsePlanTaskPaths` returns for that task.

**Given** a plan task declaring `**Files:** same as Task 1`
**When** the rows are seeded
**Then** that task's `files` resolves to Task 1's path set, matching `parsePlanTaskPaths`.

### Negative paths

**Given** an existing `task-status.json` with rows in `in_progress` or terminal status
**When** `seedTaskStatus` re-runs and adds `files`
**Then** every existing status value and every other existing field is preserved unchanged.

**Given** a plan task with `**Files:** none`
**When** the rows are seeded
**Then** that task's `files` is an empty array — not absent, and not a wildcard.

**Given** a plan where no task declares a `Files:` block at all
**When** the rows are seeded
**Then** rows are created with no `files` field, and seeding does not throw.

**Given** a plan task section with no `**Files:**` line but with bullet items containing
backticked path tokens, which `parsePlanTaskPaths` harvests via its prose fallback
(`plan-task-parse.ts:224`)
**When** the rows are seeded
**Then** that task's row carries no `files` field — only an explicit `**Files:**` line is a
declaration, so the fallback's incidental paths can never become blocking scope (#548).

---

## Story TI-2: A commit outside the active task's declared paths is refused

**As** the harness
**I want** a BUILD commit touching undeclared files rejected at commit time
**So that** out-of-plan work never enters feature history.

### Happy path (the refusal)

**Given** the stamped task is 3, whose `files` are `src/conductor/src/engine/config.ts` and
its test
**And** the staged diff contains `src/conductor/src/engine/artifacts.ts` and
`src/conductor/src/engine/changelog-pr-finalizer-cli.ts`
**When** the `commit-msg` hook runs
**Then** the hook exits non-zero and the commit is refused
**And** stderr names task id `3`
**And** stderr lists both offending paths
**And** stderr names both forward paths: narrow the commit, or justify the widening with a
`Scope:` trailer
**And** stderr prints the exact `Scope: <path> — <rationale>` line to add, one per offending path
**And** stderr does not instruct the author to delete the work.

**Given** a refused commit
**When** the hook returns
**Then** the working tree and the index are byte-for-byte unchanged
**And** no file has been deleted, reverted, or unstaged.

### Happy path (the pass)

**Given** the stamped task is 3 and the staged diff contains only its declared paths
**When** the hook runs
**Then** the hook exits 0 and the commit proceeds.

**Given** a staged diff whose paths match declared paths only by suffix
(plan declares `engine/config.ts`, git reports `src/conductor/src/engine/config.ts`)
**When** the hook runs
**Then** the commit is accepted — segment-anchored suffix matching applies.

### Negative path (matching must not over-accept)

**Given** task 3 declares `trail.ts`
**And** the staged diff contains `audit-trail.ts`
**When** the hook runs
**Then** the commit is refused — the match must be `/`-boundary anchored, not substring.

---

## Story TI-3: The check abstains whenever evidence is absent

**As** a daemon operator
**I want** the check to block only on positive evidence of a violation
**So that** a live build is never wedged by missing or malformed data.

### Negative paths (each must exit 0 and allow the commit)

**Given** a plan where no task declares a `Files:` block anywhere (a legacy, non-contract-bearing plan)
**When** a commit stages any paths
**Then** the hook exits 0.

**Given** `.pipeline/task-status.json` is missing
**When** the hook runs
**Then** the hook exits 0.

**Given** `.pipeline/task-status.json` is present but malformed JSON
**When** the hook runs
**Then** the hook exits 0.

**Given** the stamped task id has no matching row
**When** the hook runs
**Then** the hook exits 0.

**Given** the stamped row exists but has no `files` field, or an empty `files` array
**When** the hook runs
**Then** the hook exits 0.

**Given** the commit carries no `Task:` trailer
**When** the hook runs
**Then** the hook exits 0.

**Given** the stamped row exists and has `files`, but its status is not `in_progress` — a stale
`.pipeline/current-task` produced a well-formed but wrong trailer
**When** the hook runs with paths outside that row's declared set
**Then** the hook exits 0, rather than judging correct work against a previous task's scope.

**Given** the engine entry point the hook calls is unavailable or throws
**When** the hook runs
**Then** the hook exits 0 and emits a diagnostic on stderr.

### Exit-code contract

**Given** the check is invoked as a subprocess
**When** it completes
**Then** it exits `0` for allowed, `2` for a violation, and any other code means abstain.

**Given** the check exits `1`, `127`, or any code other than `0` or `2` — a stale `dist`, an
unregistered subcommand, a node crash
**When** the `commit-msg` hook evaluates the result
**Then** the commit proceeds, because only `2` blocks.

**Given** `COMMIT_MSG_HOOK` runs under `set -e` (`git-hook-assets.ts:92`)
**When** the check exits non-zero
**Then** the hook has captured the status rather than letting it propagate, so the shell's
errexit cannot convert an abstention into a refusal.

### Inherited exemptions

**Given** a merge commit, an `--amend`, a rebase replay, or `CONDUCT_ENGINE_COMMIT=1` set
**When** the hook runs with staged paths outside the task's declared set
**Then** the hook exits 0 in each case — existing exemptions are preserved exactly.

### Machinery allowlist

**Given** the staged diff contains only paths under `.pipeline/` or `.docs/shipped/`
**When** the hook runs
**Then** the hook exits 0 — machinery-authored paths are never an author's violation.

**Given** the staged diff contains a declared path plus `.pipeline/task-status.json`
**When** the hook runs
**Then** the commit is accepted.

---

## Story TI-4: A `Scope:` trailer widens the allowed set for the commit it rides on

**As** a build agent with a legitimate collateral edit
**I want** to justify the widening in the commit message itself
**So that** required work proceeds without deleting it, without silent drift, and without a
separate record that would itself be an out-of-scope commit.

### Happy path

**Given** the staged diff for task 3 contains the undeclared path
`src/conductor/src/engine/artifacts.ts`
**And** the commit message carries
`Scope: src/conductor/src/engine/artifacts.ts — needed to register the new command`
**When** the hook runs
**Then** the commit is accepted.

**Given** a diff widening two undeclared paths
**And** the message carries one `Scope:` trailer per path
**When** the hook runs
**Then** the commit is accepted — the trailer is repeatable.

**Given** a commit accepted via a `Scope:` trailer
**When** the next commit stages the same undeclared path without a `Scope:` trailer
**Then** that commit is refused — a trailer authorizes exactly the commit it rides on, never a
standing widening for the task.

**Given** the author is mid-BUILD with the docs-guard enforcing
**When** they add a `Scope:` trailer and re-run `git commit`
**Then** no `.docs/` write is required, so the docs-guard is never consulted.

### Negative paths

**Given** a `Scope:` trailer naming a path that is not in the staged set
**When** the hook runs against an undeclared path
**Then** the commit is refused — a malformed trailer is treated as absent, never as blanket
permission.

**Given** a `Scope:` trailer with an empty or missing rationale, or a bare `Scope:` with no path
**When** the hook runs against an undeclared path
**Then** the commit is refused.

**Given** a `Scope:` trailer for path `A`
**And** a staged diff containing declared paths plus `A` plus undeclared path `B`
**When** the hook runs
**Then** the commit is refused, and stderr names `B` only — not `A`.

---

## Story TI-5: The engine backstop reports violations that reached history

**As** the harness
**I want** a non-LLM containment check at the build-step boundary
**So that** violations still surface when hook wiring failed open.

### Happy path

**Given** branch commits whose changed files all fall inside their stamped task's declared paths
**When** the containment floor runs
**Then** it reports satisfied with no violations.

**Given** a commit stamped `Task: 3` changing `src/conductor/src/engine/artifacts.ts`, which
no plan task declares
**When** the containment floor runs
**Then** it reports a violation naming task 3, the commit sha, and that path.

**Given** a commit whose undeclared path is covered by a `Scope:` trailer on that same commit
**When** the containment floor runs
**Then** it reports satisfied.

**Given** any commit accepted via a `Scope:` trailer
**When** the containment floor runs
**Then** it records the widening — path, rationale, task id, and sha — into
`.pipeline/containment-floor.json`
**And** that record is supplied as a `build_review` input, so widenings stay reviewable even
though the grader receives a diff rather than the commit log.

### Negative paths

**Given** an unreadable plan, a git failure, or malformed input
**When** the containment floor runs
**Then** it degrades to satisfied with a skip note and reports no violation it could not verify.

**Given** commits exempt from the hook (merge, rebase replay, `CONDUCT_ENGINE_COMMIT=1` engine
bookkeeping)
**When** the containment floor runs
**Then** those commits are not reported as violations.

---

## Story TI-6: The #1074 regression is reproduced and rejected

**As** a maintainer
**I want** the original incident encoded as a test
**So that** the exact failure cannot silently return.

### Happy path

**Given** a plan whose tasks are scoped only to `src/conductor/src/engine/config.ts` and
config/resolver tests
**And** a staged commit reproducing `8b9f753e5` — changing `artifacts.ts` and
`changelog-pr-finalizer-cli.ts`
**When** the commit boundary check runs
**Then** the commit is deterministically refused
**And** the failure names the active task id and both offending paths.

**Given** the same scenario
**When** the check refuses
**Then** no file is deleted or reverted, and the −249-line deletion of `0bf9d809b` is not
reproduced as the remedy.

### Negative path

**Given** the same config-only plan
**And** a staged commit changing only `src/conductor/src/engine/config.ts`
**When** the check runs
**Then** the commit is accepted — the regression test discriminates, rather than refusing everything.

---

## Story TI-7: The hook ships report-only before it blocks

**As** a daemon operator
**I want** the refusal path observable before it is enforced
**So that** the real refusal rate is measured on live builds rather than assumed.

### Happy path

**Given** report-only mode is active — the default this feature ships
**And** a staged diff violating the active task's declared paths
**When** the `commit-msg` hook runs
**Then** the full refusal message is printed to stderr
**And** the hook exits 0 and the commit proceeds.

**Given** report-only mode is active
**When** a commit is accepted despite a violation
**Then** the containment floor records what would have been blocked, so the refusal rate is
recoverable from `.pipeline/containment-floor.json` without re-running any build.

**Given** enforcing mode is enabled
**When** the same violating commit is attempted
**Then** the commit is refused per TI-2 — the two modes differ only in whether the exit is
acted on.

### Negative path

**Given** report-only mode is active
**And** the check abstains for any TI-3 reason
**When** the hook runs
**Then** nothing is printed and the commit proceeds — report-only widens what is allowed, never
what is reported.

---

## Out of scope

- Changes to `build_review`'s prompt, rubric, or `remediate` routing.
- Any new authority to mark a task `completed`.
- The concurrent-dispatch stamp ambiguity of #531 (see conflict-check).
- Machine-readable plan task dependencies (#623).
