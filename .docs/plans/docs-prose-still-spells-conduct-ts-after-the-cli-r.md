# Implementation Plan: Legacy-CLI guard covers all of docs/

**Date:** 2026-10-10
**Design:** none (technical track, Tier S; scope in `.docs/track/docs-prose-still-spells-conduct-ts-after-the-cli-r.md`)
**Stories:** .docs/stories/docs-prose-still-spells-conduct-ts-after-the-cli-r.md
**Conflict check:** Skipped (Tier S)

## Summary

Widen the `conduct-ts` scan in the legacy-CLI reference guard from two `docs/reference/` pages to the whole `docs/` tree, allowlisting exactly the two alias-describing mentions, and extend the guard's backend regression test to prove it. Two tasks.

## Technical Approach

- `test/test_no_legacy_cli_references.sh` runs one `conduct-ts` scan with either `rg` or the `grep` fallback over a fixed path list that currently ends `docs/reference/cli.md docs/reference/skills.md`. Replace those two path arguments with `docs` in BOTH backend invocations, so the backends keep receiving an identical path set. `docs/reference/cli.md` and `docs/reference/skills.md` remain covered because they live under `docs/`.
- Every hit is matched against the closed `case "$path:$text"` allowlist; anything unmatched prints `non-allowlisted conduct-ts reference: <path:line:text>` and fails the guard. Follow that existing pattern: add two exact-string entries, each with a one-line comment stating why the mention documents the alias itself. The entries match the whole line text, never a glob, so any other `conduct-ts` line in the same file still fails. The two lines are, verbatim:
  - `docs/quickstart.md`: `` `--uninstall` removes harness-owned skill and reference links, the `conduct`, `conduct-ts`, and ``
  - `docs/contributing/extending.md`: `` `src/conductor/src/engine/`, and evaluates each `ai-conductor <subcommand>` (or `conduct-ts`) occurrence ``
- The second scan in the same script (`bin/conduct`, the removed-CLI scan) keeps its current path set; widening it is out of scope.
- `test/test_legacy_cli_guard_backends.sh` copies the guard into a temp fixture tree, plants a `non-allowlisted conduct-ts reference` line at a named path, and runs it under a deterministic `rg` stand-in and under a PATH with only `grep`, asserting rejection under grep and byte-identical output between backends. Its planted-path loop is the pattern to extend; `make_fixture` already `mkdir -p`s the planted file's parent.

## Prerequisites

- None.

## Tasks

### Task 1: Scan all of docs/ for conduct-ts with the alias-describing mentions allowlisted

**Story:** Story 1 — S1.1, S1.2, S1.3, S1.4
**Type:** happy-path

**Steps:**
1. Write failing test: in `test/test_legacy_cli_guard_backends.sh`, add `docs/guides/planted.md` and `docs/runbooks/planted.md` to the planted-path loop (the loop already asserts grep-fallback rejection naming `<path>:1:non-allowlisted conduct-ts reference` and identical rg/grep exit and output). In `make_clean_fixture`, also write a `docs/guides/clean.md` containing text with no `conduct-ts`, so the existing clean-fixture assertions exercise a non-reference docs page.
2. Verify the two new planted cases fail (RED): the guard does not yet scan those pages, so it exits 0.
3. Implement: in `test/test_no_legacy_cli_references.sh`, replace `docs/reference/cli.md docs/reference/skills.md` with `docs` in the `rg` and the `grep` `conduct-ts` invocations only, and add the two exact `path:text` allowlist entries listed in Technical Approach, each with a comment saying it documents the deprecated alias. Leave the `bin/conduct` scan's path list untouched.
4. Verify GREEN: `bash test/test_legacy_cli_guard_backends.sh` passes and `bash test/test_no_legacy_cli_references.sh` prints `legacy CLI reference guard: PASS` against the real tree.
5. Commit with message: "test(legacy-cli-guard): scan all of docs/ for conduct-ts".

**Done when:**
- Running `bash test/test_no_legacy_cli_references.sh` against the repository's real `docs/` tree exits 0 and prints `legacy CLI reference guard: PASS`, with the two allowlisted alias-describing lines in `docs/quickstart.md` and `docs/contributing/extending.md` accepted by exact `path:text` case entries.
- [test] `test/test_legacy_cli_guard_backends.sh` clean-fixture assertions, with a fixture `docs/guides/clean.md` holding no `conduct-ts`, show both the rg stand-in and the grep fallback exit 0 and each print exactly `legacy CLI reference guard: PASS`.
- [test] `test/test_legacy_cli_guard_backends.sh` planted cases for `docs/guides/planted.md` and `docs/runbooks/planted.md` assert the grep fallback exits non-zero and prints `non-allowlisted conduct-ts reference:` followed by `<path>:1:non-allowlisted conduct-ts reference`.
- [test] The same planted `docs/` cases assert the rg stand-in and grep fallback return the same non-zero exit status and identical output.
- The diff to `test/test_no_legacy_cli_references.sh` changes the `conduct-ts` scan's path arguments to end in `docs` for both backends and leaves the `bin/conduct` removed-CLI scan's path arguments unchanged.

**Files likely touched:**
- `test/test_no_legacy_cli_references.sh` — widen the `conduct-ts` scan path set to `docs`; add two exact allowlist entries
- `test/test_legacy_cli_guard_backends.sh` — planted non-reference docs cases; clean-fixture docs page

**Dependencies:** none

### Task 2: Reject a non-allowlisted conduct-ts line inside an allowlisted docs file

**Story:** Story 1 — S1.5
**Type:** negative-path

**Steps:**
1. Write failing test: in `test/test_legacy_cli_guard_backends.sh`, add a case that builds a fixture whose `docs/quickstart.md` contains the exact allowlisted `--uninstall` line from Technical Approach followed by a second line `run conduct-ts daemon start` (mirroring the existing `removed-cli-self-host` case, which plants an allowlisted contract line plus a non-contract line in the same file). Assert the grep fallback exits non-zero, its output contains `docs/quickstart.md:2:run conduct-ts daemon start`, its output does not contain `docs/quickstart.md:1:`, and rg and grep output are identical.
2. Verify RED by temporarily replacing the exact quickstart allowlist entry with a `docs/quickstart.md:*` glob and confirming the case fails; restore the exact entry.
3. Implement: no production change is expected beyond Task 1's exact entries; if the case fails, tighten the entry to the exact line text.
4. Verify GREEN: `bash test/test_legacy_cli_guard_backends.sh` passes.
5. Commit with message: "test(legacy-cli-guard): reject unlisted conduct-ts lines in allowlisted docs".

**Done when:**
- [test] The new `test/test_legacy_cli_guard_backends.sh` case asserts the grep fallback exits non-zero and prints `non-allowlisted conduct-ts reference: docs/quickstart.md:2:run conduct-ts daemon start`, naming the rejected line.
- [test] The same case asserts the guard output contains no `docs/quickstart.md:1:` rejection, so the allowlisted `--uninstall` line in the same file is still accepted.
- [test] The same case asserts the rg stand-in and grep fallback return the same exit status and identical output.

**Files likely touched:**
- `test/test_legacy_cli_guard_backends.sh` — same-file non-allowlisted docs case

**Dependencies:** Task 1

## Task Dependency Graph

```
Task 1 ──> Task 2
```

## Integration Points

- After Task 1: `test/test_harness_integrity.sh` already invokes `test/test_no_legacy_cli_references.sh`, so the widened guard runs in the aggregate integrity suite with no wiring change.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the current `docs/` tree, whose only `conduct-ts` mentions are the `--uninstall` launcher list in `docs/quickstart.md` and the session-command audit description in `docs/contributing/extending.md`, when `test/test_no_legacy_cli_references.sh` runs, then it exits 0 and prints `legacy CLI reference guard: PASS`. | 1 | "Running `bash test/test_no_legacy_cli_references.sh` against the repository's real `docs/` tree exits 0 and prints `legacy CLI reference guard: PASS`" | diff-local |
| Story 1 happy: Given a fixture repository whose `docs/` pages contain no `conduct-ts` text, when the guard runs under the `rg` backend and under the `grep` fallback, then both exit 0 with identical output. | 1 | "show both the rg stand-in and the grep fallback exit 0 and each print exactly `legacy CLI reference guard: PASS`" | diff-local |
| Story 1 negative: Given a page under `docs/` outside `docs/reference/` (for example `docs/guides/planted.md` or `docs/runbooks/planted.md`) contains a non-allowlisted `conduct-ts` line, when the guard runs, then it exits non-zero and prints `non-allowlisted conduct-ts reference:` followed by that page's `path:line:text`. | 1 | "assert the grep fallback exits non-zero and prints `non-allowlisted conduct-ts reference:` followed by `<path>:1:non-allowlisted conduct-ts reference`" | diff-local |
| Story 1 negative: Given the same planted `docs/` reference, when the guard runs under the `rg` backend and under the `grep` fallback, then both backends exit with the same non-zero status and print identical output. | 1 | "assert the rg stand-in and grep fallback return the same non-zero exit status and identical output" | diff-local |
| Story 1 negative: Given a line in `docs/quickstart.md` or `docs/contributing/extending.md` that contains `conduct-ts` but is not one of the two allowlisted alias-describing lines, when the guard runs, then it rejects that line by name even though its file holds an allowlisted mention. | 2 | "prints `non-allowlisted conduct-ts reference: docs/quickstart.md:2:run conduct-ts daemon start`, naming the rejected line" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
