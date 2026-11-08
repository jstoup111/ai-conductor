# Implementation Plan: Enforce canonical code formatting on touched files

**Date:** 2026-11-07
**Design:** .docs/decisions/architecture-review-2026-11-07-code-formatting-is-entirely-unenforced-no-formatte.md
**Stories:** .docs/stories/code-formatting-is-entirely-unenforced-no-formatte.md
**Conflict check:** Clean as of 2026-11-07 (.docs/conflicts/code-formatting-is-entirely-unenforced-no-formatte.md)

## Summary

Adds a pinned Prettier formatter (with `prettier-plugin-sh` for shell), one Node script that
resolves the changed in-scope files and either checks or writes canonical form, and enforces the
check in a new CI job and in the self-host `test_suite`. Nine tasks.

## Technical Approach

- **Tooling (review Decisions 1–2).** `src/conductor/package.json` gains exact-pinned
  `devDependencies` `prettier@3.9.10` and `prettier-plugin-sh@0.20.2`
  (`npm install --save-dev --save-exact`), recorded in `src/conductor/package-lock.json`. The
  repository root gains `.prettierrc.json` (`printWidth: 120`, `tabWidth: 2`, `useTabs: false`,
  `singleQuote: true`, `semi: true`, `trailingComma: "all"`, `endOfLine: "lf"`,
  `spaceRedirects: false`, and no `plugins` key), `.prettierignore`, and `.editorconfig`. The
  ignore file lists `src/conductor/test/fixtures/`, `src/conductor/test/types/fixtures/`,
  `test/fixtures/`, `examples/fixtures/`, `node_modules/`, `src/conductor/dist*/`, and the
  out-of-scope `*.md`, `*.json`, `*.yml`, `*.yaml` types. Both Prettier files sit at the root
  because Prettier resolves ignore patterns relative to the ignore file's own directory.
- **One script (review Decisions 3–5).** `src/conductor/scripts/format.mjs`, invoked by the
  package scripts `"format": "node scripts/format.mjs --write"` and
  `"format:check": "node scripts/format.mjs --check"`. It works on the git root of its working
  directory (`git rev-parse --show-toplevel`) and reads `.prettierrc.json` and `.prettierignore`
  from that root, so tests can point it at a temporary repository holding copies of the real
  configuration. Steps:
  1. **Base.** `--base <ref>` when given, else `origin/main`; the comparison point is
     `git merge-base <ref> HEAD`. An unresolvable ref or merge-base exits 1 before any file is read
     or written, printing `format: cannot resolve base reference "<ref>"`.
  2. **Candidates.** With `--all`: `git ls-files`. Otherwise
     `git diff --name-only --diff-filter=ACMR <merge-base>` (working tree versus the merge-base, so
     uncommitted edits count) plus `git ls-files --others --exclude-standard`. Deleted paths are
     never candidates.
  3. **Classification.** Keep `*.ts`/`*.mts` under `src/conductor/` or `plugins/` (parser
     `typescript`), `*.sh` anywhere (parser `sh`), and extensionless files whose first line matches
     `^#!.*\b(ba)?sh\b` (parser `sh`). Drop any path `prettier.getFileInfo(path, { ignorePath })`
     reports `ignored`.
  4. **Format.** Through the Prettier Node API only: options are
     `prettier.resolveConfig(file, { config: <root>/.prettierrc.json })` plus the explicit parser
     and `plugins: [<imported prettier-plugin-sh module>]`. `--check` uses `prettier.check` and
     prints `not canonical: <repo-relative path>` per failing file; `--write` uses
     `prettier.format` and rewrites only files whose output differs. A parse error prints
     `syntax error: <repo-relative path>: <first message line>`, leaves that file's bytes
     unchanged, and makes the run exit 1. Any `not canonical` or `syntax error` line makes
     `--check` exit 1; otherwise exit 0.
- **Enforcement (review Decision 6).** `.github/workflows/ci.yml` gains a `format` job shaped like
  `typecheck` (`needs: changes`, `if: needs.changes.outputs.docs_only != 'true'`,
  `actions/checkout@v5` with `fetch-depth: 0`, `setup-node` on the conductor lockfile, `npm ci`)
  running `npm run format:check -- --base ${{ github.event.pull_request.base.sha }}` from
  `src/conductor`. Because the merge-base is computed, a commit landing on `main` after the branch
  point is not attributed to the pull request. `ci-gate` gains `format` in `needs`, a
  `FORMAT: ${{ needs.format.result }}` env entry, `format=$FORMAT` in the summary, and `"$FORMAT"`
  in the result loop, each inserted immediately after the corresponding `typecheck` / `TYPECHECK`
  item so the exact substrings `', docs-corpus]'` and `"$CONDUCTOR_E2E" "$LINKS" "$DOCS_CORPUS"; do`
  that `src/conductor/test/structural/docs-corpus-ci-wiring.test.ts` mutates stay intact. In
  `.ai-conductor/config.yml` the first `test_suite.commands` entry becomes
  `npm run format:check --silent && npm run typecheck --silent && npm run typecheck:test --silent`
  (three entries kept), and `test_suite.changed_command` gains a leading
  `npm run format:check --silent && `.
- **Test seam.** Script behavior is proved by `src/conductor/test/format-script.test.ts`, which
  spawns `node <conductor>/scripts/format.mjs` (resolved via `import.meta.url`) with its working
  directory set to a temporary local Git repository. Per `.agents/skills/write-tests`: create it
  with `mkdtemp`, pin the initial branch (`git init -b main`), configure a local identity, add no
  remote except in the test that needs an unresolvable `origin/main` (which simply has none), copy
  the real root `.prettierrc.json` and `.prettierignore` into it, and remove that exact directory
  in `afterEach`. Prettier resolves from the conductor package because the script imports it.
  CI wiring follows `src/conductor/test/structural/shell-tests-ci-wiring.test.ts` (parse the
  workflow with `js-yaml`, assert `needs`, `if`, and step text) and the ci-gate execution pattern
  in `docs-corpus-ci-wiring.test.ts` (run the `ci-gate` step's `run` script with `bash -c` and
  result env vars).
- **This feature passes its own gate.** Every TypeScript or shell file a task creates or edits is
  left in canonical form by running `npm run format -- --base origin/main` from `src/conductor`
  before committing; no other file is reformatted (Story 6).
- **Sequencing.** Task 1 lands tooling and configuration; Tasks 2–6 build the script in order on
  one test file; Tasks 7 and 8 wire the enforcement points once the script exists; Task 9 verifies
  the untouched surfaces.

## Prerequisites

- None beyond the existing `npm ci` in `src/conductor`.

## Tasks

### Task 1: Pin the formatter and add the canonical-style configuration
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write failing test `src/conductor/test/structural/format-config.test.ts`: read `src/conductor/package.json` and, for each of `prettier` and `prettier-plugin-sh`, assert `devDependencies[name]` matches `/^\d+\.\d+\.\d+$/` with the failure message `formatter dependency <name> is not exact-pinned: <value>`; a second case feeds the fixtures `{ prettier: '^3.9.10' }`, `{ prettier: '~3.9.10' }`, `{ 'prettier-plugin-sh': '^0.20.2' }`, and `{ 'prettier-plugin-sh': '~0.20.2' }` through the same assertion helper and expects each to throw naming the ranged package. A third case reads the root `.editorconfig` and asserts a section covering `ts`, `mts`, and `sh` declares `indent_style = space` and `indent_size = 2`, and that `end_of_line = lf` and `insert_final_newline = true` apply to those types.
2. Verify the tests fail (RED).
3. Implement: `npm install --save-dev --save-exact prettier@3.9.10 prettier-plugin-sh@0.20.2` in `src/conductor`; add root `.prettierrc.json`, `.prettierignore`, and `.editorconfig` with exactly the contents in Technical Approach.
4. Verify the tests pass (GREEN), then leave the new test file canonical as described in Technical Approach.
5. Commit: "build(format): pin prettier and add canonical style config".

**Done when:**
- [test] format-config.test.ts asserts `src/conductor/package.json` declares `prettier` `3.9.10` and `prettier-plugin-sh` `0.20.2` in `devDependencies` with no range operator, and `src/conductor/package-lock.json` records both at those versions.
- [test] format-config.test.ts asserts the pin helper throws `formatter dependency <name> is not exact-pinned` naming the package for caret and tilde ranges of each of `prettier` and `prettier-plugin-sh`, so a ranged declaration of either fails the suite naming the unpinned package.
- [test] format-config.test.ts asserts the root `.editorconfig` declares two-space space indentation, `end_of_line = lf`, and `insert_final_newline = true` for `ts`, `mts`, and `sh` files.
- Root `.prettierrc.json` sets `printWidth` 120, `tabWidth` 2, `singleQuote` true, `semi` true, `trailingComma` all, `endOfLine` lf, `spaceRedirects` false, and has no `plugins` key; root `.prettierignore` lists every path and type named in Technical Approach.

**Files likely touched:**
- `src/conductor/package.json` — exact-pinned devDependencies
- `src/conductor/package-lock.json` — lock entries
- `.prettierrc.json` — canonical options
- `.prettierignore` — fixture, dependency, and out-of-scope type exclusions
- `.editorconfig` — editor defaults
- `src/conductor/test/structural/format-config.test.ts` — pin and editorconfig tests

**Dependencies:** none

### Task 2: Check mode classifies and reports changed in-scope files
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/format-script.test.ts` using the temporary-repository fixture from Technical Approach (base commit on `main`, then a feature branch): (a) a changed canonical `src/conductor/src/a.ts` → `--check --base main` exits 0; (b) changed non-canonical `src/conductor/src/a.ts`, `test/x.sh`, an extensionless `bin/tool` starting `#!/bin/bash`, and `plugins/p/index.ts` → exit 1 and stdout contains `not canonical: <path>` for each of the four repo-relative paths; (c) changed non-canonical `README.md`, `data.json`, and `cfg.yml` only → exit 0 and none of the three names appears; (d) a changed non-canonical `src/conductor/test/fixtures/f.ts` (matched by the copied `.prettierignore`) → exit 0 and its path is not printed.
2. Verify the tests fail (RED).
3. Implement `src/conductor/scripts/format.mjs` steps 1–4 for `--check` as specified in Technical Approach (the merge-base, candidate, classification, ignore, and Prettier-API check paths), and add the `format` and `format:check` scripts to `src/conductor/package.json`. The script imports `prettier` and `prettier-plugin-sh` and never spawns the Prettier CLI.
4. Verify GREEN; leave the test file canonical.
5. Commit: "feat(format): check changed files for canonical form".

**Done when:**
- [test] format-script.test.ts asserts `format.mjs --check --base main` exits 0 when the only changed in-scope file is a canonical TypeScript file under `src/conductor/`.
- [test] format-script.test.ts asserts `format.mjs --check` exits 1 and prints `not canonical: <path>` naming each of a non-canonical changed `src/conductor/` TypeScript file, `*.sh` file, extensionless `#!/bin/bash` file, and `plugins/` TypeScript file.
- [test] format-script.test.ts asserts `format.mjs --check` exits 0 and prints none of the changed non-canonical Markdown, JSON, or YAML paths, because classification keeps only TypeScript under `src/conductor/` or `plugins/` and shell files.
- [test] format-script.test.ts asserts a changed non-canonical file matched by `.prettierignore` is not checked: `--check` exits 0 and does not print its path.
- `src/conductor/package.json` defines `format` as `node scripts/format.mjs --write` and `format:check` as `node scripts/format.mjs --check`.

**Files likely touched:**
- `src/conductor/scripts/format.mjs` — new script (check path)
- `src/conductor/package.json` — `format` and `format:check` scripts
- `src/conductor/test/format-script.test.ts` — new script tests

**Dependencies:** Task 1

### Task 3: Base resolution limits the check to what the branch changed
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `format-script.test.ts`: (a) a tracked non-canonical `src/conductor/src/old.ts` committed on `main` before the branch point and untouched by the branch, plus a changed canonical file → `--check --base main` exits 0 and `old.ts` is not printed; (b) the branch deletes a non-canonical tracked TypeScript file → exit 0 and the deleted path is not printed; (c) after the branch point, `main` gains a commit adding non-canonical `src/conductor/src/later.ts`; check out a merge of the branch (which changes non-canonical `src/conductor/src/mine.ts`) into that `main` tip, as CI's pull-request merge checkout does → `--check --base main` exits 1, prints `not canonical: src/conductor/src/mine.ts`, and does not print `later.ts`; (d) two commits `A` then `B` on the branch, each changing one non-canonical file → `--check --base A` prints only the file changed in `B`; (e) a branch changing no in-scope file → exit 0 and prints no `not canonical` line.
2. Verify RED.
3. Implement or correct base handling so the comparison point is always `git merge-base <ref> HEAD` and candidates are working tree versus that point with `--diff-filter=ACMR` plus untracked files.
4. Verify GREEN; leave the test file canonical.
5. Commit: "feat(format): resolve the changed set against the merge-base".

**Done when:**
- [test] format-script.test.ts asserts an untouched tracked non-canonical file is not checked: `--check --base main` exits 0 and does not print its path.
- [test] format-script.test.ts asserts a file the branch deletes is never a candidate: `--check` exits 0 and does not print the deleted path.
- [test] format-script.test.ts asserts that on a merge checkout of the branch into a `main` tip that gained non-canonical `later.ts` after the branch point, `--check --base main` names the branch's `mine.ts` and never `later.ts`, because `format.mjs` diffs against `git merge-base <base> HEAD`.
- [test] format-script.test.ts asserts `--check --base A` reports only the file changed between commit `A` and the working tree, not the file changed before `A`.
- [test] format-script.test.ts asserts a branch changing no in-scope file makes `--check` exit 0 with no `not canonical` line, so no file is checked.

**Files likely touched:**
- `src/conductor/scripts/format.mjs` — merge-base and candidate resolution
- `src/conductor/test/format-script.test.ts` — base-resolution tests

**Dependencies:** Task 2

### Task 4: Check mode fails on syntax errors and unresolvable bases
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `format-script.test.ts`: (a) a changed `src/conductor/src/bad.ts` containing `const = ;` → `--check --base main` exits 1 and prints `syntax error: src/conductor/src/bad.ts:`; (b) a repository with no `origin` remote and no `--base` → exits 1, prints `format: cannot resolve base reference "origin/main"`, and prints no `not canonical` or `syntax error` line even though a non-canonical file is changed; (c) `--base no-such-ref` → exits 1 and prints `format: cannot resolve base reference "no-such-ref"`.
2. Verify RED.
3. Implement the parse-error path and the pre-read base failure in `format.mjs` exactly as in Technical Approach.
4. Verify GREEN; leave the test file canonical.
5. Commit: "feat(format): fail closed on syntax errors and missing base".

**Done when:**
- [test] format-script.test.ts asserts `--check` exits 1 and prints `syntax error: src/conductor/src/bad.ts:` for a changed TypeScript file that does not parse, rather than exiting 0.
- [test] format-script.test.ts asserts that with no `--base` and no `origin/main`, `--check` exits 1, prints `format: cannot resolve base reference "origin/main"`, and prints no per-file line, so no file was checked.
- [test] format-script.test.ts asserts `--check --base no-such-ref` exits 1 and prints `format: cannot resolve base reference "no-such-ref"`.

**Files likely touched:**
- `src/conductor/scripts/format.mjs` — parse-error and base-failure paths
- `src/conductor/test/format-script.test.ts` — failure-path tests

**Dependencies:** Task 3

### Task 5: Write mode produces the canonical form
**Story:** Story 2
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `format-script.test.ts`: (a) changed non-canonical TypeScript and shell files → `--write --base main` then `--check --base main` exits 0; (b) the same run leaves the bytes of an untouched tracked non-canonical file identical; (c) a repository with non-canonical tracked in-scope files and no changes → `--write --all` then `--check --all` exits 0; (d) after a first `--write`, a second `--write` changes no file's bytes or mtime; (e) a changed file holding a wrappable call longer than 120 columns, double-quoted strings, missing semicolons, CRLF line endings, and four-space indentation → after `--write`, its content uses two-space indentation, single quotes, semicolons, LF only, and no line longer than 120 columns; (f) a changed file using double quotes and no semicolons → `--check --base main` exits 1 naming it.
2. Verify RED.
3. Implement the `--write` path and `--all` candidate source in `format.mjs` as in Technical Approach; add `--all` support to `--check`.
4. Verify GREEN; leave the test file canonical.
5. Commit: "feat(format): write canonical form for changed or all files".

**Done when:**
- [test] format-script.test.ts asserts `format.mjs --write --base main` rewrites each non-canonical changed in-scope file and a following `--check --base main` exits 0.
- [test] format-script.test.ts asserts `--write --base main` leaves every tracked file the branch did not change byte-identical.
- [test] format-script.test.ts asserts `--write --all` puts every in-scope tracked file in canonical form and a following `--check --all` exits 0.
- [test] format-script.test.ts asserts a second `--write` over already-canonical files modifies no file, and asserts the rewritten sample uses two-space indentation, single quotes, semicolons, LF endings, and no line over 120 columns.
- [test] format-script.test.ts asserts `--check --base main` exits 1 naming a changed TypeScript file that uses double quotes and no semicolons.

**Files likely touched:**
- `src/conductor/scripts/format.mjs` — write path and `--all`
- `src/conductor/test/format-script.test.ts` — write-mode tests

**Dependencies:** Task 4

### Task 6: Write mode leaves unsafe and out-of-scope files untouched
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `format-script.test.ts`: (a) a changed `bad.ts` that does not parse plus a changed non-canonical `good.ts` → `--write --base main` exits 1, prints `syntax error:` naming `bad.ts`, leaves `bad.ts` byte-identical, and rewrites `good.ts`; (b) `--write --all` in a repository with a non-canonical ignored `src/conductor/test/fixtures/f.ts` and non-canonical `README.md`, `data.json`, `cfg.yml` → all four byte-identical afterward; (c) no `origin/main`, no `--base`, no `--all` → `--write` exits 1 printing `format: cannot resolve base reference "origin/main"` and every file in the repository is byte-identical.
2. Verify RED.
3. Implement or correct the write path so a parse failure skips only that file and base resolution completes before any write.
4. Verify GREEN; leave the test file canonical.
5. Commit: "feat(format): never rewrite unparseable, ignored, or out-of-scope files".

**Done when:**
- [test] format-script.test.ts asserts `--write` exits 1 naming an unparseable changed file and leaves that file byte-identical.
- [test] format-script.test.ts asserts `--write --all` leaves a `.prettierignore`-matched file and Markdown, JSON, and YAML files byte-identical.
- [test] format-script.test.ts asserts `--write` with no resolvable base and no `--all` exits 1 naming `origin/main` and modifies no file in the repository.

**Files likely touched:**
- `src/conductor/scripts/format.mjs` — write-path guards
- `src/conductor/test/format-script.test.ts` — write negative tests

**Dependencies:** Task 5

### Task 7: CI format job joined to ci-gate
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing test `src/conductor/test/structural/format-ci-wiring.test.ts` following the YAML-parse pattern of `shell-tests-ci-wiring.test.ts`: the `format` job's `needs` contains `changes`, its `if` is `needs.changes.outputs.docs_only != 'true'`, its checkout step sets `fetch-depth: 0`, and a step runs `npm run format:check -- --base ${{ github.event.pull_request.base.sha }}` with `working-directory: src/conductor`; `ci-gate.needs` contains `format` and its env maps `FORMAT` to `${{ needs.format.result }}`. Following the ci-gate execution pattern in `docs-corpus-ci-wiring.test.ts`, run the `ci-gate` step script with every result `success` and `FORMAT` set to each of `success`, `skipped`, `failure`, `cancelled`, asserting exit 0, 0, 1, 1, and that the failure output's summary contains `format=failure`. Export a `formatWiringGaps(workflowText)` helper returning the missing pieces (`job`, `ci-gate-needs`, `ci-gate-result`), assert it returns `[]` for the real `ci.yml` so the suite fails naming each missing piece when the committed workflow loses it, and assert it names `ci-gate-needs` for a copy of the workflow with `format` removed from `ci-gate`'s `needs`, and `ci-gate-result` for a copy with `"$FORMAT"` removed from the loop.
2. Verify RED.
3. Implement the `format` job and `ci-gate` changes in `.github/workflows/ci.yml` exactly as in Technical Approach, inserting each `ci-gate` item immediately after its `typecheck` / `TYPECHECK` counterpart.
4. Verify GREEN, confirm `docs-corpus-ci-wiring.test.ts` still passes unchanged, and leave the new test file canonical.
5. Commit: "ci: run format:check on pull requests and gate on it".

**Done when:**
- [test] format-ci-wiring.test.ts asserts the `format` job needs `changes`, is skipped when `docs_only` is true, checks out with `fetch-depth: 0`, and runs `npm run format:check -- --base ${{ github.event.pull_request.base.sha }}` from `src/conductor`, so the job checks exactly the files changed between the pull request base SHA and the checked-out head under format.mjs's merge-base resolution.
- [test] format-ci-wiring.test.ts runs the `ci-gate` script and asserts it exits 0 for `FORMAT` `success` and `skipped`, and exits 1 with `format=failure` in its summary for `FORMAT` `failure` (and 1 for `cancelled`).
- [test] format-ci-wiring.test.ts asserts `formatWiringGaps` returns `[]` for the committed `ci.yml` and the test fails listing the returned gap names otherwise, and asserts the helper names `ci-gate-needs` when `format` is removed from `ci-gate`'s `needs` and `ci-gate-result` when `"$FORMAT"` is removed from its result loop.
- `src/conductor/test/structural/docs-corpus-ci-wiring.test.ts` passes without modification after the `ci.yml` change.

**Files likely touched:**
- `.github/workflows/ci.yml` — `format` job and `ci-gate` wiring
- `src/conductor/test/structural/format-ci-wiring.test.ts` — new structural test

**Dependencies:** Task 2

### Task 8: Self-host test_suite runs the format check first
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Update failing expectations: in `src/conductor/test/self-host-verification-entries.test.ts`, the expected first `commands` entry becomes `npm run format:check --silent && npm run typecheck --silent && npm run typecheck:test --silent` (still three entries), and add an assertion that `changed_command` starts with `npm run format:check --silent && ` and that `format:check` precedes `run-vitest.mjs`; in `src/conductor/test/acceptance/full-suite-verification-gate.acceptance.test.ts`, update the expected first `commands` entry to the same string.
2. Verify RED against the current `.ai-conductor/config.yml`.
3. Implement the two `.ai-conductor/config.yml` edits from Technical Approach.
4. Verify GREEN; leave both edited test files canonical.
5. Commit: "test-suite: run format:check ahead of the typechecks".

**Done when:**
- [test] self-host-verification-entries.test.ts asserts `loadConfig` yields exactly three `test_suite.commands` entries whose first runs `npm run format:check --silent && npm run typecheck --silent && npm run typecheck:test --silent` from `src/conductor`, followed by `npm test` and `test/test_harness_integrity.sh`.
- [test] self-host-verification-entries.test.ts asserts `test_suite.changed_command` begins with `npm run format:check --silent && ` and runs `format:check` before `run-vitest.mjs`, so a failing check stops the changed-mode lap through the `&&` chain.
- [test] full-suite-verification-gate.acceptance.test.ts asserts the same chained first `commands` entry.
- [test] self-host-verification-entries.test.ts fails naming the missing entry when `format:check` is absent from the first command or from `changed_command`, via its `toEqual` and `toMatch` assertions on the loaded config.

**Files likely touched:**
- `.ai-conductor/config.yml` — chained first command and changed-mode prefix
- `src/conductor/test/self-host-verification-entries.test.ts` — updated expectations
- `src/conductor/test/acceptance/full-suite-verification-gate.acceptance.test.ts` — updated expectation

**Dependencies:** Task 2

### Task 9: Lint policy and consumer surfaces are unchanged
**Story:** Story 6
**Type:** verification

**Steps:**
1. Run `git diff --quiet "$(git merge-base origin/main HEAD)" -- src/conductor/eslint.config.mjs plugins/*/eslint.config.mjs hooks/claude/lint-after-edit.sh` and record its exit status.
2. Run `git diff --name-only "$(git merge-base origin/main HEAD)" -- . ':!.docs'` and compare it with the union of the Files lines of Tasks 1–8.
3. Run `npm run lint` in `src/conductor` at HEAD, and again in a detached `git worktree add --detach` checkout of the merge-base (after `npm ci` there), capturing each run's exit status and its reported findings; remove that worktree afterward.
4. Complete with an empty commit carrying `Task: 9` and `Evidence: skipped verification-only` trailers.

**Done when:**
- `git diff --quiet <merge-base> -- src/conductor/eslint.config.mjs plugins/*/eslint.config.mjs hooks/claude/lint-after-edit.sh` exits 0, so no ESLint rule is added and the shipped hook is byte-identical.
- Every path printed by `git diff --name-only <merge-base> -- . ':!.docs'` appears in a Files line of Tasks 1–8, so no other in-scope file is reformatted.
- `npm run lint` in `src/conductor` reports the same exit status and the same findings at HEAD as in the merge-base checkout (exit 0 with zero problems in both).

**Files likely touched:** none

**Verify-only:** yes

**Dependencies:** Tasks 1, 2, 3, 4, 5, 6, 7, 8

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a branch whose only change against the base is a TypeScript file under `src/conductor/` already in canonical form, when `npm run format:check` runs, then it exits 0. | 2 | "[test] format-script.test.ts asserts `format.mjs --check --base main` exits 0 when the only changed in-scope file is a canonical TypeScript file under `src/conductor/`." | diff-local |
| Story 1 happy: Given a branch that modifies a TypeScript file under `src/conductor/` so it is not in canonical form, when `npm run format:check` runs, then it exits non-zero and its output names that file's repository path. | 2 | "[test] format-script.test.ts asserts `format.mjs --check` exits 1 and prints `not canonical: <path>` naming each of a non-canonical changed `src/conductor/` TypeScript file, `*.sh` file, extensionless `#!/bin/bash` file, and `plugins/` TypeScript file." | diff-local |
| Story 1 happy: Given a branch that modifies a `*.sh` file so it is not in canonical form, when `npm run format:check` runs, then it exits non-zero and names that file. | 2 | "[test] format-script.test.ts asserts `format.mjs --check` exits 1 and prints `not canonical: <path>` naming each of a non-canonical changed `src/conductor/` TypeScript file, `*.sh` file, extensionless `#!/bin/bash` file, and `plugins/` TypeScript file." | diff-local |
| Story 1 happy: Given a branch that modifies an extensionless file whose first line is `#!/bin/bash` so it is not in canonical form, when `npm run format:check` runs, then it exits non-zero and names that file. | 2 | "[test] format-script.test.ts asserts `format.mjs --check` exits 1 and prints `not canonical: <path>` naming each of a non-canonical changed `src/conductor/` TypeScript file, `*.sh` file, extensionless `#!/bin/bash` file, and `plugins/` TypeScript file." | diff-local |
| Story 1 happy: Given a branch that modifies a TypeScript file under `plugins/` so it is not in canonical form, when `npm run format:check` runs, then it exits non-zero and names that file. | 2 | "[test] format-script.test.ts asserts `format.mjs --check` exits 1 and prints `not canonical: <path>` naming each of a non-canonical changed `src/conductor/` TypeScript file, `*.sh` file, extensionless `#!/bin/bash` file, and `plugins/` TypeScript file." | diff-local |
| Story 1 happy: Given an explicit `--base <sha>` argument, when `npm run format:check -- --base <sha>` runs, then only files changed between that commit and the working tree are checked. | 3 | "[test] format-script.test.ts asserts `--check --base A` reports only the file changed between commit `A` and the working tree, not the file changed before `A`." | diff-local |
| Story 1 negative: Given a tracked TypeScript file that is not in canonical form and that the branch does not change, when `npm run format:check` runs, then it exits 0 and does not name that file. | 3 | "[test] format-script.test.ts asserts an untouched tracked non-canonical file is not checked: `--check --base main` exits 0 and does not print its path." | diff-local |
| Story 1 negative: Given a branch that deletes a TypeScript file, when `npm run format:check` runs, then the deleted path is not checked and the command does not fail on it. | 3 | "[test] format-script.test.ts asserts a file the branch deletes is never a candidate: `--check` exits 0 and does not print the deleted path." | diff-local |
| Story 1 negative: Given a branch that changes only Markdown, JSON, or YAML files, when `npm run format:check` runs, then it exits 0 without checking any of them. | 2 | "[test] format-script.test.ts asserts `format.mjs --check` exits 0 and prints none of the changed non-canonical Markdown, JSON, or YAML paths, because classification keeps only TypeScript under `src/conductor/` or `plugins/` and shell files." | diff-local |
| Story 1 negative: Given a branch that changes a file matched by the formatter ignore file, when `npm run format:check` runs, then that file is not checked. | 2 | "[test] format-script.test.ts asserts a changed non-canonical file matched by `.prettierignore` is not checked: `--check` exits 0 and does not print its path." | diff-local |
| Story 1 negative: Given a branch that changes a TypeScript file containing a syntax error, when `npm run format:check` runs, then it exits non-zero and names that file rather than passing. | 4 | "[test] format-script.test.ts asserts `--check` exits 1 and prints `syntax error: src/conductor/src/bad.ts:` for a changed TypeScript file that does not parse, rather than exiting 0." | diff-local |
| Story 1 negative: Given a checkout where neither `--base` is supplied nor a merge-base with `origin/main` can be resolved, when `npm run format:check` runs, then it exits non-zero with an error naming the unresolved base reference and checks no files. | 4 | "[test] format-script.test.ts asserts that with no `--base` and no `origin/main`, `--check` exits 1, prints `format: cannot resolve base reference "origin/main"`, and prints no per-file line, so no file was checked." | diff-local |
| Story 1 negative: Given an explicit `--base` naming a reference that does not exist, when `npm run format:check` runs, then it exits non-zero with an error naming that reference. | 4 | "[test] format-script.test.ts asserts `--check --base no-such-ref` exits 1 and prints `format: cannot resolve base reference "no-such-ref"`." | diff-local |
| Story 2 happy: Given a branch with non-canonical changed in-scope files, when `npm run format` runs, then each of those files is rewritten in canonical form and a following `npm run format:check` exits 0. | 5 | "[test] format-script.test.ts asserts `format.mjs --write --base main` rewrites each non-canonical changed in-scope file and a following `--check --base main` exits 0." | diff-local |
| Story 2 happy: Given a branch with changed in-scope files, when `npm run format` runs, then no tracked file the branch did not change is modified. | 5 | "[test] format-script.test.ts asserts `--write --base main` leaves every tracked file the branch did not change byte-identical." | diff-local |
| Story 2 happy: Given any checkout, when `npm run format -- --all` runs, then every file in the checked set is in canonical form afterward and `npm run format:check -- --all` exits 0. | 5 | "[test] format-script.test.ts asserts `--write --all` puts every in-scope tracked file in canonical form and a following `--check --all` exits 0." | diff-local |
| Story 2 happy: Given files already in canonical form, when `npm run format` runs twice, then the second run modifies no file. | 5 | "[test] format-script.test.ts asserts a second `--write` over already-canonical files modifies no file, and asserts the rewritten sample uses two-space indentation, single quotes, semicolons, LF endings, and no line over 120 columns." | diff-local |
| Story 2 negative: Given a changed TypeScript file containing a syntax error, when `npm run format` runs, then it exits non-zero naming that file and leaves that file's bytes unchanged. | 6 | "[test] format-script.test.ts asserts `--write` exits 1 naming an unparseable changed file and leaves that file byte-identical." | diff-local |
| Story 2 negative: Given `npm run format -- --all`, when it runs, then files matched by the formatter ignore file and files outside the checked set (Markdown, JSON, YAML) are byte-for-byte unchanged. | 6 | "[test] format-script.test.ts asserts `--write --all` leaves a `.prettierignore`-matched file and Markdown, JSON, and YAML files byte-identical." | diff-local |
| Story 2 negative: Given a checkout where no base resolves and `--all` is not supplied, when `npm run format` runs, then it exits non-zero naming the unresolved base and modifies no file. | 6 | "[test] format-script.test.ts asserts `--write` with no resolvable base and no `--all` exits 1 naming `origin/main` and modifies no file in the repository." | diff-local |
| Story 3 happy: Given `src/conductor/package.json`, when it is read, then `prettier` and `prettier-plugin-sh` are declared in `devDependencies` with exact versions carrying no range operator. | 1 | "[test] format-config.test.ts asserts `src/conductor/package.json` declares `prettier` `3.9.10` and `prettier-plugin-sh` `0.20.2` in `devDependencies` with no range operator, and `src/conductor/package-lock.json` records both at those versions." | diff-local |
| Story 3 happy: Given a TypeScript file with a line longer than 120 columns that can be wrapped, when `npm run format` runs on it, then the result uses two-space indentation, single quotes, semicolons, and LF line endings, with no wrappable line longer than 120 columns. | 5 | "[test] format-script.test.ts asserts a second `--write` over already-canonical files modifies no file, and asserts the rewritten sample uses two-space indentation, single quotes, semicolons, LF endings, and no line over 120 columns." | diff-local |
| Story 3 happy: Given the repository root, when `.editorconfig` is read, then it declares two-space indentation, LF line endings, and a final newline for the checked file types. | 1 | "[test] format-config.test.ts asserts the root `.editorconfig` declares two-space space indentation, `end_of_line = lf`, and `insert_final_newline = true` for `ts`, `mts`, and `sh` files." | diff-local |
| Story 3 negative: Given a dependency declaration for either formatter that uses a range such as a caret or tilde, when the conductor test suite runs, then a test fails naming the unpinned package. | 1 | "[test] format-config.test.ts asserts the pin helper throws `formatter dependency <name> is not exact-pinned` naming the package for caret and tilde ranges of each of `prettier` and `prettier-plugin-sh`, so a ranged declaration of either fails the suite naming the unpinned package." | diff-local |
| Story 3 negative: Given a TypeScript file using double quotes and no semicolons, when `npm run format:check` runs on it as a changed file, then it exits non-zero naming that file. | 5 | "[test] format-script.test.ts asserts `--check --base main` exits 1 naming a changed TypeScript file that uses double quotes and no semicolons." | diff-local |
| Story 4 happy: Given a pull request whose changed in-scope files are all canonical, when CI runs, then the `format` job passes and does not cause `ci-gate` to fail. | 7, 2 | "[test] format-ci-wiring.test.ts runs the `ci-gate` script and asserts it exits 0 for `FORMAT` `success` and `skipped`, and exits 1 with `format=failure` in its summary for `FORMAT` `failure` (and 1 for `cancelled`)." | diff-local |
| Story 4 happy: Given a pull request that changes an in-scope file into non-canonical form, when CI runs, then the `format` job fails naming the file and `ci-gate` fails. | 7, 2 | "[test] format-ci-wiring.test.ts runs the `ci-gate` script and asserts it exits 0 for `FORMAT` `success` and `skipped`, and exits 1 with `format=failure` in its summary for `FORMAT` `failure` (and 1 for `cancelled`)." | diff-local |
| Story 4 happy: Given the `format` job, when it runs, then it checks files changed between the pull request's base SHA and its head SHA. | 7, 3 | "[test] format-ci-wiring.test.ts asserts the `format` job needs `changes`, is skipped when `docs_only` is true, checks out with `fetch-depth: 0`, and runs `npm run format:check -- --base ${{ github.event.pull_request.base.sha }}` from `src/conductor`, so the job checks exactly the files changed between the pull request base SHA and the checked-out head under format.mjs's merge-base resolution." | diff-local |
| Story 4 negative: Given a pull request classified docs-only by the existing `changes` job, when CI runs, then the `format` job is skipped and `ci-gate` does not fail because of it. | 7 | "[test] format-ci-wiring.test.ts runs the `ci-gate` script and asserts it exits 0 for `FORMAT` `success` and `skipped`, and exits 1 with `format=failure` in its summary for `FORMAT` `failure` (and 1 for `cancelled`)." | diff-local |
| Story 4 negative: Given a file that became non-canonical on `main` after the pull request's branch point and that the pull request does not change, when CI runs, then the `format` job does not fail on that file. | 3, 7 | "[test] format-script.test.ts asserts that on a merge checkout of the branch into a `main` tip that gained non-canonical `later.ts` after the branch point, `--check --base main` names the branch's `mine.ts` and never `later.ts`, because `format.mjs` diffs against `git merge-base <base> HEAD`." | diff-local |
| Story 4 negative: Given the `format` job is removed from `ci-gate`'s `needs` list or its result summary, when the conductor test suite runs, then a structural test fails naming the missing wiring. | 7 | "[test] format-ci-wiring.test.ts asserts `formatWiringGaps` returns `[]` for the committed `ci.yml` and the test fails listing the returned gap names otherwise, and asserts the helper names `ci-gate-needs` when `format` is removed from `ci-gate`'s `needs` and `ci-gate-result` when `"$FORMAT"` is removed from its result loop." | diff-local |
| Story 5 happy: Given `.ai-conductor/config.yml`, when it is read, then `test_suite.commands` keeps its three ordered entries and the first runs `npm run format:check --silent` before both typechecks from `src/conductor`, and `test_suite.changed_command` runs `npm run format:check --silent` before Vitest. | 8 | "[test] self-host-verification-entries.test.ts asserts `loadConfig` yields exactly three `test_suite.commands` entries whose first runs `npm run format:check --silent && npm run typecheck --silent && npm run typecheck:test --silent` from `src/conductor`, followed by `npm test` and `test/test_harness_integrity.sh`." | diff-local |
| Story 5 happy: Given a self-host feature branch whose changed in-scope files are canonical, when `test_suite` runs in either full or changed mode, then the format check passes. | 8, 2 | "[test] self-host-verification-entries.test.ts asserts `test_suite.changed_command` begins with `npm run format:check --silent && ` and runs `format:check` before `run-vitest.mjs`, so a failing check stops the changed-mode lap through the `&&` chain." | diff-local |
| Story 5 happy: Given a self-host feature branch that changed an in-scope file into non-canonical form, when `test_suite` runs in either full or changed mode, then the step fails and its output names the file. | 8, 2 | "[test] self-host-verification-entries.test.ts asserts `test_suite.changed_command` begins with `npm run format:check --silent && ` and runs `format:check` before `run-vitest.mjs`, so a failing check stops the changed-mode lap through the `&&` chain." | diff-local |
| Story 5 negative: Given a self-host feature branch that changes no in-scope file, when `test_suite` runs, then the format check passes without checking any file. | 3, 8 | "[test] format-script.test.ts asserts a branch changing no in-scope file makes `--check` exit 0 with no `not canonical` line, so no file is checked." | diff-local |
| Story 5 negative: Given `format:check` is removed from `test_suite.commands` or `test_suite.changed_command`, when the conductor test suite runs, then a structural test fails naming the missing entry. | 8 | "[test] self-host-verification-entries.test.ts fails naming the missing entry when `format:check` is absent from the first command or from `changed_command`, via its `toEqual` and `toMatch` assertions on the loaded config." | diff-local |
| Story 6 happy: Given this change merged, when `npm run lint` runs on an unchanged source tree, then it reports the same findings and exit status as before the change. | 9 | "`npm run lint` in `src/conductor` reports the same exit status and the same findings at HEAD as in the merge-base checkout (exit 0 with zero problems in both)." | diff-local |
| Story 6 happy: Given this change merged, when a consumer repository runs the shipped `hooks/claude/lint-after-edit.sh`, then the hook's behavior and output are unchanged. | 9 | "`git diff --quiet <merge-base> -- src/conductor/eslint.config.mjs plugins/*/eslint.config.mjs hooks/claude/lint-after-edit.sh` exits 0, so no ESLint rule is added and the shipped hook is byte-identical." | diff-local |
| Story 6 negative: Given this change's own diff, when it is inspected, then it adds no rule to `src/conductor/eslint.config.mjs` or any `plugins/*/eslint.config.mjs` and does not modify `hooks/claude/lint-after-edit.sh`. | 9 | "`git diff --quiet <merge-base> -- src/conductor/eslint.config.mjs plugins/*/eslint.config.mjs hooks/claude/lint-after-edit.sh` exits 0, so no ESLint rule is added and the shipped hook is byte-identical." | diff-local |
| Story 6 negative: Given this change's own diff, when it is inspected, then no in-scope file outside those this change edits for its own implementation is reformatted. | 9 | "Every path printed by `git diff --name-only <merge-base> -- . ':!.docs'` appears in a Files line of Tasks 1–8, so no other in-scope file is reformatted." | diff-local |

## Task Dependency Graph

```
Task 1 ─▶ Task 2 ─▶ Task 3 ─▶ Task 4 ─▶ Task 5 ─▶ Task 6 ─┐
             ├────▶ Task 7 ──────────────────────────────┤
             └────▶ Task 8 ──────────────────────────────┴─▶ Task 9
```

## Integration Points

- After Task 2: `npm run format:check` runs against the real repository from `src/conductor`.
- After Task 7: pull requests run the `format` job and `ci-gate` gates on it.
- After Task 8: self-host builds run the check in `test_suite` before the typechecks.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions

### Task rem-prd-audit-5-r1: Add a format-script.test.ts case that uses only parseable in-scope files in the fixture repository, including at least one non-canonical TypeScript file and one non-canonical shell file. Commit them, run `format.mjs --write --all`, and assert exit 0. Assert each in-scope file is now canonical: single quotes, semicolons, two-space indentation, LF endings, and no line over 120 columns. Assert a following `--check --all` exits 0. Use only the fixture repository, never the real one. Leave the existing ignored/unsafe --all test unchanged.
**Gate:** prd-audit
**Rationale:** Verified in src/conductor/test/format-script.test.ts:210-228: the only --all test includes the unparseable bad.ts, so `--write --all` exits 1 and `--check --all` is asserted to exit 1. No test checks that a.ts is canonical after `--write --all`, and none shows `--check --all` exiting 0. Task 5's done-when explicitly requires that test, so task 5 admits the repair. This is a missing test inside an existing task, which makes it BUILD work. No architecture or product decision is involved. The test must run against the temporary fixture repository from createRepository(), never the real repository (Story 6.4). The existing test that covers unsafe and ignored files stays unchanged.
**Criterion:** S2.3
**Parent task:** 5
**Done when:**
- [test] S2.3 is satisfied by this task.
- The repair for task rem-prd-audit-5-r1 is committed and its targeted tests pass.

### Task rem-prd-audit-rem-prd-audit-5-r2: In src/conductor/scripts/format.mjs, skip every candidate path whose lstat is not a regular file (symlinks, including directory symlinks, and directories) before parserFor reads it. Add a format-script.test.ts case in the createRepository() fixture repo (never the real repo) that commits a directory symlink with no extension (e.g. `.claude/skills/x -> ../../dir`) and a non-canonical in-scope TypeScript file. Assert that `--write --all` exits 0 without EISDIR, the TypeScript file is rewritten to canonical form, the symlink is still a symlink, and a following `--check --all` exits 0. Keep the existing --all tests unchanged.
**Gate:** prd-audit
**Rationale:** Verified: running `node scripts/format.mjs --check --all` in the real checkout crashes with an unhandled EISDIR. There are 21 tracked mode-120000 entries, and the `.claude/skills/*` ones are directory symlinks. parserFor (format.mjs:26-27) treats them as extensionless and calls readFileSync outside the per-file try/catch, so `--all` aborts before it processes most in-scope files. S2.3 says `--write --all` puts every in-scope tracked file in canonical form, so this is an implementation defect. Task 5 already admits it: its Steps cover implementing the `--all` candidate source, and its Files list includes format.mjs and format-script.test.ts. The approved architecture is unchanged and no product decision is needed, so this is BUILD work. The earlier lap (rem-prd-audit-5-r1) added a fixture test without symlinks and could not catch this. The repair keeps every existing test, including the r1 all-files test and Task 6's ignored/unsafe --all test. It adds one guard: any tracked path that is not a regular file is skipped before it is read, which covers both symlinks and directories. Excluded sibling: the --base candidate source can also list a changed symlink. The same guard in the shared loop covers it, so no extra scope is needed.
**Criterion:** S2.3
**Parent task:** 5
**Done when:**
- [test] S2.3 is satisfied by this task.
- The repair for task rem-prd-audit-rem-prd-audit-5-r2 is committed and its targeted tests pass.
