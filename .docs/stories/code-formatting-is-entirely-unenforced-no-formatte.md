**Status:** Accepted

# Stories: Enforce canonical code formatting on touched files (#1991)

Technical track — no PRD. Acceptance derives from intake jstoup111/ai-conductor#1991's desired
outcomes under the operator-approved
`architecture-review-2026-11-07-code-formatting-is-entirely-unenforced-no-formatte` (Decisions 1–7,
Conditions 1–4). Outcomes: O1 a changed file that violates canonical form fails before merge and
the canonical form is producible by one command; O2 formatting is enforced mechanically, never by a
review finding or prompt rule; O3 the errors-only ESLint stance is untouched. Operator-confirmed
narrowing: only files a change adds or modifies are checked; untouched files are not.

The checked set throughout is TypeScript (`*.ts`, `*.mts`) under `src/conductor/` and `plugins/`,
tracked `*.sh` files, and tracked extensionless files whose first line is a `sh` or `bash` shebang,
minus ignored fixture paths.

---

## Story 1: Changed-file format check

**Requirement:** O1, O2 · Review Decisions 3, 4, 5

As a contributor or build, I want one read-only command that reports every changed file not in
canonical form so that formatting is decided by machinery rather than by review.

### Acceptance Criteria

#### Happy Path
- Given a branch whose only change against the base is a TypeScript file under `src/conductor/` already in canonical form, when `npm run format:check` runs, then it exits 0.
- Given a branch that modifies a TypeScript file under `src/conductor/` so it is not in canonical form, when `npm run format:check` runs, then it exits non-zero and its output names that file's repository path.
- Given a branch that modifies a `*.sh` file so it is not in canonical form, when `npm run format:check` runs, then it exits non-zero and names that file.
- Given a branch that modifies an extensionless file whose first line is `#!/bin/bash` so it is not in canonical form, when `npm run format:check` runs, then it exits non-zero and names that file.
- Given a branch that modifies a TypeScript file under `plugins/` so it is not in canonical form, when `npm run format:check` runs, then it exits non-zero and names that file.
- Given an explicit `--base <sha>` argument, when `npm run format:check -- --base <sha>` runs, then only files changed between that commit and the working tree are checked.

#### Negative Paths
- Given a tracked TypeScript file that is not in canonical form and that the branch does not change, when `npm run format:check` runs, then it exits 0 and does not name that file.
- Given a branch that deletes a TypeScript file, when `npm run format:check` runs, then the deleted path is not checked and the command does not fail on it.
- Given a branch that changes only Markdown, JSON, or YAML files, when `npm run format:check` runs, then it exits 0 without checking any of them.
- Given a branch that changes a file matched by the formatter ignore file, when `npm run format:check` runs, then that file is not checked.
- Given a branch that changes a TypeScript file containing a syntax error, when `npm run format:check` runs, then it exits non-zero and names that file rather than passing.
- Given a checkout where neither `--base` is supplied nor a merge-base with `origin/main` can be resolved, when `npm run format:check` runs, then it exits non-zero with an error naming the unresolved base reference and checks no files.
- Given an explicit `--base` naming a reference that does not exist, when `npm run format:check` runs, then it exits non-zero with an error naming that reference.

### Done When
- [ ] `npm run format:check` exists in `src/conductor/package.json` and exits 0 on a branch whose changed in-scope files are canonical.
- [ ] A test exercises a non-canonical changed TypeScript file, a non-canonical changed shell file, and an extensionless bash file, and asserts a non-zero exit naming each.
- [ ] A test asserts an untouched non-canonical file and a deleted file are not checked.
- [ ] A test asserts an unresolvable base exits non-zero with a named error and checks nothing.

---

## Story 2: One command produces the canonical form

**Requirement:** O1 · Review Decision 5

As a contributor or build, I want one command that rewrites files into canonical form so that a
format failure has a single mechanical fix.

### Acceptance Criteria

#### Happy Path
- Given a branch with non-canonical changed in-scope files, when `npm run format` runs, then each of those files is rewritten in canonical form and a following `npm run format:check` exits 0.
- Given a branch with changed in-scope files, when `npm run format` runs, then no tracked file the branch did not change is modified.
- Given any checkout, when `npm run format -- --all` runs, then every file in the checked set is in canonical form afterward and `npm run format:check -- --all` exits 0.
- Given files already in canonical form, when `npm run format` runs twice, then the second run modifies no file.

#### Negative Paths
- Given a changed TypeScript file containing a syntax error, when `npm run format` runs, then it exits non-zero naming that file and leaves that file's bytes unchanged.
- Given `npm run format -- --all`, when it runs, then files matched by the formatter ignore file and files outside the checked set (Markdown, JSON, YAML) are byte-for-byte unchanged.
- Given a checkout where no base resolves and `--all` is not supplied, when `npm run format` runs, then it exits non-zero naming the unresolved base and modifies no file.

### Done When
- [ ] `npm run format` exists in `src/conductor/package.json` and supports `--all` and `--base <ref>`.
- [ ] A test asserts write-then-check passes, untouched files are unchanged, and a second run is a no-op.
- [ ] A test asserts a syntax-error file is left unchanged with a non-zero exit.

---

## Story 3: Canonical form is reproducible

**Requirement:** O1, O2 · Review Decisions 1, 2 · Condition 1

As a maintainer, I want the canonical form fixed by pinned tool versions and one configuration so
that the same file is judged the same way on every machine and in CI.

### Acceptance Criteria

#### Happy Path
- Given `src/conductor/package.json`, when it is read, then `prettier` and `prettier-plugin-sh` are declared in `devDependencies` with exact versions carrying no range operator.
- Given a TypeScript file with a line longer than 120 columns that can be wrapped, when `npm run format` runs on it, then the result uses two-space indentation, single quotes, semicolons, and LF line endings, with no wrappable line longer than 120 columns.
- Given the repository root, when `.editorconfig` is read, then it declares two-space indentation, LF line endings, and a final newline for the checked file types.

#### Negative Paths
- Given a dependency declaration for either formatter that uses a range such as a caret or tilde, when the conductor test suite runs, then a test fails naming the unpinned package.
- Given a TypeScript file using double quotes and no semicolons, when `npm run format:check` runs on it as a changed file, then it exits non-zero naming that file.

### Done When
- [ ] Both formatter packages are exact-pinned and the lockfile records them.
- [ ] One formatter configuration file holds the option values; `.editorconfig` exists at the repository root.
- [ ] A test asserts the exact pins.

---

## Story 4: CI rejects a pull request with a non-canonical changed file

**Requirement:** O1 · Review Decision 6 · Condition 2

As the operator, I want CI to fail a pull request whose changed files are not canonical so that no
such file merges.

### Acceptance Criteria

#### Happy Path
- Given a pull request whose changed in-scope files are all canonical, when CI runs, then the `format` job passes and does not cause `ci-gate` to fail.
- Given a pull request that changes an in-scope file into non-canonical form, when CI runs, then the `format` job fails naming the file and `ci-gate` fails.
- Given the `format` job, when it runs, then it checks files changed between the pull request's base SHA and its head SHA.

#### Negative Paths
- Given a pull request classified docs-only by the existing `changes` job, when CI runs, then the `format` job is skipped and `ci-gate` does not fail because of it.
- Given a file that became non-canonical on `main` after the pull request's branch point and that the pull request does not change, when CI runs, then the `format` job does not fail on that file.
- Given the `format` job is removed from `ci-gate`'s `needs` list or its result summary, when the conductor test suite runs, then a structural test fails naming the missing wiring.

### Done When
- [ ] `.github/workflows/ci.yml` has a `format` job gated on `changes` like `typecheck`, running `format:check` with the pull request base SHA.
- [ ] `ci-gate` lists `format` in `needs` and evaluates its result.
- [ ] A structural test asserts the job, its base argument, and its `ci-gate` wiring.

---

## Story 5: Self-host builds fail on a non-canonical changed file before a pull request

**Requirement:** O1 · Review Decision 6

As the operator, I want a self-host build's `test_suite` to fail on a non-canonical changed file so
that the build fixes it before a pull request exists instead of failing CI after shipping.

### Acceptance Criteria

#### Happy Path
- Given `.ai-conductor/config.yml`, when it is read, then `test_suite.commands` keeps its three ordered entries and the first runs `npm run format:check --silent` before both typechecks from `src/conductor`, and `test_suite.changed_command` runs `npm run format:check --silent` before Vitest.
- Given a self-host feature branch whose changed in-scope files are canonical, when `test_suite` runs in either full or changed mode, then the format check passes.
- Given a self-host feature branch that changed an in-scope file into non-canonical form, when `test_suite` runs in either full or changed mode, then the step fails and its output names the file.

#### Negative Paths
- Given a self-host feature branch that changes no in-scope file, when `test_suite` runs, then the format check passes without checking any file.
- Given `format:check` is removed from `test_suite.commands` or `test_suite.changed_command`, when the conductor test suite runs, then a structural test fails naming the missing entry.

### Done When
- [ ] `.ai-conductor/config.yml` chains `format:check` ahead of the typechecks in the first `test_suite.commands` entry and runs it in `test_suite.changed_command`.
- [ ] The existing test_suite entry tests assert the chained first command and the changed-mode format check.

---

## Story 6: Existing lint and consumer surfaces are unchanged

**Requirement:** O3 · Review Decision 7 · Condition 4

As the operator, I want formatting added without touching the errors-only ESLint policy or any
consumer-shipped file so that lint keeps its bug-class-only meaning and consumer repositories see
no change.

### Acceptance Criteria

#### Happy Path
- Given this change merged, when `npm run lint` runs on an unchanged source tree, then it reports the same findings and exit status as before the change.
- Given this change merged, when a consumer repository runs the shipped `hooks/claude/lint-after-edit.sh`, then the hook's behavior and output are unchanged.

#### Negative Paths
- Given this change's own diff, when it is inspected, then it adds no rule to `src/conductor/eslint.config.mjs` or any `plugins/*/eslint.config.mjs` and does not modify `hooks/claude/lint-after-edit.sh`.
- Given this change's own diff, when it is inspected, then no in-scope file outside those this change edits for its own implementation is reformatted.

### Done When
- [ ] ESLint configuration files and `hooks/claude/lint-after-edit.sh` are byte-identical to the base.
- [ ] The diff contains no reformat-only file changes.
