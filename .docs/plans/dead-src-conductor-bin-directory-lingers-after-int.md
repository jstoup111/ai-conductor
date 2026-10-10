# Implementation Plan: Delete the dead src/conductor/bin/ directory (#2791)

**Date:** 2026-10-09
**Design:** none (technical track, Tier S; see `.docs/track/dead-src-conductor-bin-directory-lingers-after-int.md`)
**Stories:** .docs/stories/dead-src-conductor-bin-directory-lingers-after-int.md
**Conflict check:** Not required at Tier S

## Summary

The Removal half of the two-feature deletion rule: delete `src/conductor/bin/` (its only file is
the stale, type-broken `src/conductor/bin/intake-file`) and prove the bundled intake helper still
works. One task.

## Technical Approach

- **Reference cleanup already shipped.** #742 (`.docs/shipped/skills-may-bundle-executable-helpers.md`)
  moved intake filing into `skills/intake/scripts/intake-file` and removed every live reference.
  On local main `e6b56fe3da`, `git grep -n "src/conductor/bin"` outside `.docs/` hits only the
  file's own contents (verified). Per CLAUDE.md "Skill Deletions Ship as Two Features", this
  feature deletes the now-unreferenced directory and nothing else.
- **Why it is dead.** `src/conductor/bin/intake-file:73` calls
  `fileIntakeIssue(parsed, { gh, cwd: '.', prompt })`, but `FileIntakeIssueDeps`
  (`src/conductor/src/engine/engineer/intake/file-issue.ts:45-54`) now requires
  `creation: { authority, operations }` and has no `gh`/`cwd`. `src/conductor/tsconfig.json:13,21`
  (`rootDir: "src"`, `include: ["src/**/*"]`) keeps the file outside type-checking, so no gate
  noticed. This feature fulfils the follow-up recorded at
  `.docs/decisions/adr-2026-09-28-skills-may-bundle-executable-helpers.md:134`; that ADR is not edited.
- **Survivors.** The bundled helper path: `skills/intake/scripts/intake-file` → `src/conductor/src/intake-file-cli.ts`.
  Existing coverage, none of which touches the deleted file:
  `src/conductor/test/skills/intake-file-helper-entry.test.ts` (caller-repo gh cwd; usage on
  missing args), `src/conductor/test/skills/bundled-helper-resolution.test.ts` (symlinked skill
  resolution; no qualifying harness), and `test/test_lint_shell_enumeration.sh` (real-tree shell
  enumeration lists the bundled helper). No characterization test is needed.
- **Historical `.docs/` mentions stay.** The ADR and architecture-review records for #742 mention
  the path as history; they are other features' sealed artifacts and are out of scope.
- **Release disposition.** `no-note`: internal deletion with no reader-visible change. The path is
  not a canonical breaking surface (`bin/conduct CLI`, hook wiring, skill symlink targets,
  settings.json schema), so no migration block or waiver applies.

## Prerequisites

- None.

## Tasks

### Task 1: Delete src/conductor/bin/ and confirm the bundled intake helper survives
**Story:** 1
**Type:** refactor

**Steps:**
1. Follow `/code-removal`. Survivor inventory is in Technical Approach; every survivor is already covered, so add no characterization test and no test asserting the directory is gone.
2. Delete the directory's only tracked file: `git rm src/conductor/bin/intake-file`. Confirm `src/conductor/bin/` no longer exists on disk (remove the empty directory if git left it).
3. Completeness sweep: run `git grep -n "src/conductor/bin"` and `git grep -n "conductor/bin/intake-file"`. Every remaining hit must be under `.docs/` (historical decision records, left unchanged by scope); a hit outside `.docs/` means the reference cleanup is incomplete: do not edit that file in this task (the diff must change no other file); stop and return to DECIDE. On main `e6b56fe3da` there are no such hits (verified at spec time).
4. Run the survivor tests: `ai-conductor scoped-run src/conductor/test/skills/intake-file-helper-entry.test.ts src/conductor/test/skills/bundled-helper-resolution.test.ts` and `bash test/test_lint_shell_enumeration.sh`. All must pass unchanged.
5. Commit with message: "chore: delete dead src/conductor/bin/ intake-file copy (#2791)".

**Done when:**
- The task's commit diff deletes `src/conductor/bin/intake-file` (git status `D`) and adds or modifies no other file.
- [test] `src/conductor/test/skills/intake-file-helper-entry.test.ts` passes unchanged: "keeps the caller repository as the production gh adapter cwd" asserts the bundled helper reaches the intake filing CLI and the production gh adapter runs with the caller repository as cwd, and "returns the CLI usage without reaching gh when required arguments are absent" asserts it prints the CLI usage, exits non-zero, and never reaches gh.
- [test] `src/conductor/test/skills/bundled-helper-resolution.test.ts` passes unchanged: "resolves a symlinked skill to its harness while preserving the caller directory and argument order" asserts a helper reached through a symlinked skill resolves its owning harness's `intake-file-cli.ts` and passes the caller directory and argument order through unchanged, and "reports the walked-from helper and PATH result when neither candidate qualifies" asserts the helper reports the walked-from helper path and the PATH result and exits non-zero.
- [test] `test/test_lint_shell_enumeration.sh` passes unchanged, its real-tree assertion still listing `skills/intake/scripts/intake-file`.
- `git grep -n "src/conductor/bin"` run on the task's commit returns hits only under `.docs/`.

**Files likely touched:**
- `src/conductor/bin/intake-file` — deleted

**Dependencies:** none

## Task Dependency Graph

Task 1 (single task, no dependencies).

## Integration Points

- After Task 1: the bundled `skills/intake/scripts/intake-file` helper remains the only intake filing entry point, proven by its existing entry-point tests.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the stale `src/conductor/bin/` copy has been deleted, when the bundled `skills/intake/scripts/intake-file` helper is run from a caller repository with a title and body, then it reaches the intake filing CLI and the production gh adapter runs with the caller repository as its working directory. | 1 | "asserts the bundled helper reaches the intake filing CLI and the production gh adapter runs with the caller repository as cwd" | diff-local |
| Story 1 happy: Given the stale `src/conductor/bin/` copy has been deleted, when the bundled helper is reached through a symlinked skill directory, then it resolves the harness that owns it and passes the caller directory and argument order through unchanged. | 1 | "asserts a helper reached through a symlinked skill resolves its owning harness's `intake-file-cli.ts` and passes the caller directory and argument order through unchanged" | diff-local |
| Story 1 negative: Given the stale `src/conductor/bin/` copy has been deleted, when the bundled helper is run without the required title and body arguments, then it prints the CLI usage and exits non-zero without reaching gh. | 1 | "asserts it prints the CLI usage, exits non-zero, and never reaches gh" | diff-local |
| Story 1 negative: Given the stale `src/conductor/bin/` copy has been deleted, when the bundled helper finds no qualifying harness root by walking up from itself or through `ai-conductor` on PATH, then it reports the walked-from helper path and the PATH result and exits non-zero. | 1 | "asserts the helper reports the walked-from helper path and the PATH result and exits non-zero" | diff-local |

## Verification
- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [x] Dependencies are explicit and acyclic
- [x] No task asserts the removed file's absence as a test subject (`/code-removal`)
