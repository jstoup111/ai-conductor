# Implementation Plan: Cover nested bin shell files in both lint gates

**Date:** 2026-09-06
**Stories:** .docs/stories/cover-nested-bin-shell-files-in-both-lint-gates.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing gate contract stated in `test/lint_shell.sh`'s own header — one enumeration, one severity threshold, shared by the CI job and the integrity suite — and changes neither the threshold nor the enumerated roots.

## Summary

Five bounded tasks deliver #2161 by making the single shell-script enumeration recurse under `bin/`, giving it a declared exclusion list, and pointing the integrity suite's syntax check at that same enumeration instead of its own four directory globs. Raising the shellcheck severity floor, widening the enumerated roots, and editing any newly covered script are outside this slice.

## Technical Approach

`test/lint_shell.sh` already declares itself the single source of truth for the enforced file set, and its `collect_scripts` already selects `bin/` entries by shebang rather than suffix. The defect is that it walks `bin/` with a non-recursive glob guarded by `[ -f ]`, so the `bin/lib/` directory is skipped; `test/test_harness_integrity.sh` then repeats the same shape in four independent loops for the `bash -n` gate, so the declared single source is not actually shared. Fixing only the glob would leave two enumerations to drift apart again, so this slice fixes the glob and makes the syntax check consume the enumerator's existing list mode.

Replace the `bin/` glob in `collect_scripts` with a recursive walk that follows symlinks, then apply the existing shebang filter unchanged to each result. Following symlinks is required, not incidental: `bin/conduct-ts` is a symlink to `bin/ai-conductor` that today's `[ -f ]` guard resolves and enumerates, and a plain `-type f` walk would silently drop it — the exact class of regression this issue is about. The shebang filter continues to exclude the Python helper beside the shell library, which opens with a docstring and carries no shebang, so no new non-shell file enters the set.

Give the enumerator a declared exclusion constant of repo-relative paths, applied by exact match after the shebang filter, empty at landing and documented in the script header as the only sanctioned way to keep a shell file out of the gates. Hold it as a newline-delimited string constant rather than a bash array: this script runs under `set -u`, and expanding a possibly-empty array under `set -u` is precisely the silently-degrading shape the existing empty-set refusal exists to catch.

Point the syntax-check section of the integrity suite at `test/lint_shell.sh --list` and delete its four directory loops. Each enumerated path is asserted under `bash -n` and named repo-relative, which changes the `bin/` assertion labels from bare basenames to repo-relative paths; that is a deliberate, reviewable output change and keeps every gate line in one namespace. The section fails closed on an empty list: an enumeration that returns nothing must record a failure, never a clean parse of nothing. Both callers then answer to one enumeration, and the list mode is the seam a test can drive.

Author the new coverage as a focused fixture suite in the style of `test/test_harness_integrity_update_flow.sh`: a disposable copied tree per case, the enumerator invoked directly rather than through the integrity suite so the spec never recurses into itself, and cases that prove the guard still FAILS on the shapes it exists to catch rather than only that the current tree passes. The enumerator needs no new environment seam for this — it derives its harness root from its own source path, so copying it into a temporary tree at the same relative position is a faithful fixture boundary. The drift guard for the syntax-check section is a function in the suite applied to a file path, exercised against the real integrity suite and against mutated copies. There is no third-party boundary anywhere in this slice: no network, no LLM, no package registry, no `gh`. Wire the new suite as an additional assert inside the existing shellcheck section of the integrity suite, outside its shellcheck-availability branch so it runs regardless; do not add a new numbered check.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, recursion-plus-shared-enumeration over the filer's two-independent-walks hypothesis, and both stories on 2026-09-06 (delegated).
- Verified: `test/lint_shell.sh:36-44` — `collect_scripts` loops `"${HARNESS_DIR}"/bin/*` under `[ -f ]` and finds only under `hooks/`, `test/`, and `.github/scripts/`.
- Verified: `test/lint_shell.sh:52-55` implements `--list`, and `:57-63` refuses to report success on an empty set with exit 2.
- Verified: `test/test_harness_integrity.sh:70-102` runs four separate non-recursive loops for the `bash -n` gate, and `:128-155` is the shellcheck section that already shells out to the enumerator, including its `--list` count.
- Verified: `bin/lib/harness-common.sh` is tracked, opens `#!/usr/bin/env bash`, and does not appear in the enumerator's list output today.
- Verified: `bin/conduct-ts` is a symlink (git mode 120000) whose target is `bin/ai-conductor`, and it is enumerated today through the `[ -f ]` guard.
- Verified: `bin/lib/migration_fences.py` has no shebang line, so the existing shebang filter already excludes it.
- Verified: `bin/lib/harness-common.sh` exits 0 under `shellcheck --severity=error` and under `--severity=warning`, and parses under `bash -n`, so the widened gates land green with no edit to it.
- Verified: `test/test_harness_integrity_update_flow.sh:1-60` is the local precedent for a focused fixture suite over a gate — disposable copied tree, checker invoked directly, negative cases required.
- Verified: `.github/workflows/ci.yml:101` runs the enumerator directly, so CI inherits the widened set with no workflow edit.
- Scope check: A — harness-repo-only (this repository's own validation gates); B — n/a, no new skill; C — provider-agnostic. Event-spine: no event, metric, span, log line, or report is added or changed; the gates keep reporting through their existing assert output.
- Verify-claims verdict: CLEAR. Every path, line range, shebang, symlink, and gate result above was read in the worktree. No load-bearing assumption remains unconfirmed.

## Tasks

### Task 1: Walk bin/ recursively and keep the symlinked launcher
**Story:** Story 1
**Type:** happy-path
**Files:** test/lint_shell.sh, test/test_lint_shell_enumeration.sh
**Dependencies:** none

**Steps:**
1. Create the fixture suite as a new focused spec, following the local precedent named in Technical Approach: a disposable `mktemp -d` tree per case, the enumerator copied into the tree at the same relative position so it resolves that tree as its harness root, the enumerator invoked directly rather than through the integrity suite, and a trap that removes exactly the created directory.
2. Write the failing cases first: a fixture whose `bin/` holds a shell file two directories deep, a fixture whose `bin/` holds a symlink to a sibling shell file, and a real-tree case asserting the list output contains the shared shell library under `bin/lib/`.
3. Establish RED, then replace the `bin/` glob in `collect_scripts` with a symlink-following recursive walk and apply the existing shebang filter unchanged to each result. Do not alter the other enumerated roots, the sort, the empty-set refusal, or the severity threshold.
4. Run the new suite and the enumerator directly, then commit the focused change.

**Done when:**
1. Listing the enumeration against the real repository tree emits `bin/lib/harness-common.sh`.
2. Fixture cases prove a two-deep nested shell file under `bin/` and a `bin/` symlink to a sibling shell file are both enumerated.
3. The enumerator exits 0 over the widened real set at the unchanged severity threshold, with no edit to any newly covered script.

### Task 2: Keep non-shell files out of the widened walk
**Story:** Story 1 (negative path)
**Type:** negative-path
**Files:** test/lint_shell.sh, test/test_lint_shell_enumeration.sh
**Dependencies:** 1

**Steps:**
1. Add fixture cases planting, under a nested directory inside the fixture `bin/`, one file whose first line is a Python shebang and one file with no shebang line at all, both with a shell-looking suffix.
2. Establish RED if the recursive walk from Task 1 admits either, then confirm the shebang filter is applied to every recursive result rather than only to top-level entries.
3. Add a case that empties the fixture tree of all shell files and asserts the gate exits non-zero rather than reporting a clean run over nothing, preserving the existing refusal contract.
4. Run the suite and commit.

**Done when:**
1. Fixture cases prove a nested Python-shebang file and a nested shebang-less file are both absent from the list output.
2. A fixture tree yielding no shell files makes the gate exit non-zero instead of reporting success.

### Task 3: Declare exclusions in a list instead of losing them to a glob
**Story:** Story 2
**Type:** happy-path
**Files:** test/lint_shell.sh, test/test_lint_shell_enumeration.sh
**Dependencies:** 1

**Steps:**
1. Write failing fixture cases: with one repo-relative path declared excluded, the list output omits exactly that path and still contains every other shell file in the fixture tree; with nothing declared, the list output is unchanged from Task 1's expectation.
2. Establish RED, then add the declared exclusion constant to the enumerator as a newline-delimited string of repo-relative paths, empty at landing, filtered by exact match after the shebang filter. Do not use a bash array: this script runs under `set -u` and an empty array expansion degrades silently there.
3. Document in the script header that this constant is the only sanctioned way to keep a shell file out of both gates, and that a path must never leave coverage by not matching a glob.
4. Run the suite and commit.

**Done when:**
1. A fixture case proves one declared exclusion removes exactly its own path from the list output and leaves every other shell file present.
2. With no path declared, list output over the fixture tree is identical to the pre-exclusion expectation.
3. The script header states that the declared constant is the only sanctioned exclusion mechanism.

### Task 4: Make the syntax gate read the shared enumeration
**Story:** Story 2
**Type:** happy-path
**Files:** test/test_harness_integrity.sh, test/test_lint_shell_enumeration.sh
**Dependencies:** 1, 3

**Steps:**
1. Replace the four directory loops in the integrity suite's syntax-check section with a single loop over the enumerator's list output, running `bash -n` on each path and naming each assertion repo-relative.
2. Make the section fail closed: an empty list records a failed assertion naming the enumerator as the thing to fix, never a clean parse of nothing.
3. Wire the new fixture suite as an additional assert inside the existing shellcheck section, placed outside its shellcheck-availability branch so it runs whether or not the tool is installed. Do not add a new numbered check and do not change the existing shellcheck asserts.
4. Run the whole integrity suite and confirm the syntax section names the shared shell library under `bin/lib/` and that the run's failure count is unchanged from before the change.

**Done when:**
1. Running the integrity suite prints a passing syntax-gate assertion for `bin/lib/harness-common.sh`.
2. No directory glob over `bin/`, `hooks/`, `test/`, or `.github/scripts/` remains in the syntax-check section.
3. The integrity suite's failure count over the real tree is unchanged from before this change, and the new fixture suite reports through one added assert in the existing shellcheck section.
4. An empty enumeration makes the syntax-check section record a failure rather than reporting a clean parse.

### Task 5: Guard the syntax gate against a second enumeration
**Story:** Story 2 (negative path)
**Type:** negative-path
**Files:** test/test_lint_shell_enumeration.sh
**Dependencies:** 4

**Steps:**
1. Add a drift-guard function to the fixture suite that takes an integrity-suite file path and rejects it when its syntax-check section enumerates scripts from anywhere other than the enumerator's list mode.
2. Apply the guard to the real integrity suite and require it to pass.
3. Build two mutated copies in the disposable tree: one that reintroduces a top-level `bin/` glob loop in that section alongside the shared list, and one that drops the list invocation entirely. Require the guard to exit non-zero on each and to name the syntax-check section in its diagnostic.
4. Run the suite and commit.

**Done when:**
1. The drift guard passes against the real integrity suite.
2. The drift guard exits non-zero for a mutated copy that reintroduces a `bin/` glob loop in the syntax-check section, and for a mutated copy whose section no longer invokes the enumerator's list mode.
3. Each rejection diagnostic names the syntax-check section as the offending region.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the repository tree, when the shell-lint enumeration is listed, then it contains `bin/lib/harness-common.sh`. | 1 | "Listing the enumeration against the real repository tree emits `bin/lib/harness-common.sh`." | diff-local |
| Story 1 happy: Given a fixture tree whose `bin/` holds a shell file nested two directories deep, when the enumeration is listed, then that nested file is present. | 1 | "Fixture cases prove a two-deep nested shell file under `bin/` and a `bin/` symlink to a sibling shell file are both enumerated." | diff-local |
| Story 1 happy: Given a fixture tree whose `bin/` holds a symlink to a sibling shell file, when the enumeration is listed, then the symlink path is still present. | 1 | "Fixture cases prove a two-deep nested shell file under `bin/` and a `bin/` symlink to a sibling shell file are both enumerated." | diff-local |
| Story 1 negative: Given a fixture tree whose `bin/` holds a nested file with a Python shebang and a nested file with no shebang at all, when the enumeration is listed, then neither path is present. | 2 | "Fixture cases prove a nested Python-shebang file and a nested shebang-less file are both absent from the list output." | diff-local |
| Story 2 happy: Given the integrity suite's syntax check, when it selects the scripts to parse, then it takes them from the same enumeration the shellcheck gate uses rather than from its own directory globs. | 4 | "No directory glob over `bin/`, `hooks/`, `test/`, or `.github/scripts/` remains in the syntax-check section." | diff-local |
| Story 2 happy: Given a fixture tree whose enumerator declares one repo-relative path as excluded, when the enumeration is listed, then that path is absent and every other shell file in the tree is still present. | 3 | "A fixture case proves one declared exclusion removes exactly its own path from the list output and leaves every other shell file present." | diff-local |
| Story 2 negative: Given a copy of the integrity suite whose syntax check enumerates `bin/` through its own glob instead of the shared source, when the drift guard runs, then it exits non-zero and names the syntax-check section. | 5 | "The drift guard exits non-zero for a mutated copy that reintroduces a `bin/` glob loop in the syntax-check section, and for a mutated copy whose section no longer invokes the enumerator's list mode." | diff-local |
| Story 2 negative: Given a fixture tree in which the enumeration yields no files at all, when the shellcheck gate runs, then it exits non-zero refusing to report success, and when the syntax check runs against that empty list, then it records a failure rather than reporting a clean parse of nothing. | 2, 4 | "A fixture tree yielding no shell files makes the gate exit non-zero instead of reporting success." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local: every one is decided by the changed enumerator and the changed syntax-check section against fixtures created inside the diff, plus one real-tree assertion about a file this diff brings into coverage. Task 1 owns the recursive-walk and symlink cases, Task 2 the non-shell and empty-set negatives, Task 3 the declared-exclusion cases. Task 4 is the single integration-owning task: it proves the behavior through the integrity suite, the entry point an operator and CI actually run, rather than only through the enumerator's list mode. Task 5 owns the drift guard and its two mutation fixtures, which is what keeps the single-source property from degrading into a passing no-op. There is no third-party boundary in this slice — no network, LLM, registry, or `gh` call — so no fake is required and no smoke test is added. The existing shellcheck asserts supply the unchanged severity and tool-absence permutations. No terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3 -> Task 4 -> Task 5
Task 1 -> Task 4
