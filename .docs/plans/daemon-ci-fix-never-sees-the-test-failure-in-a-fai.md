# Implementation Plan: CI-fix log excerpt carries the failure, not the setup output

**Date:** 2026-10-10
**Design:** none (technical track, Tier S — see `.docs/track/daemon-ci-fix-never-sees-the-test-failure-in-a-fai.md`)
**Stories:** .docs/stories/daemon-ci-fix-never-sees-the-test-failure-in-a-fai.md
**Conflict check:** Not required (Tier S)

## Summary

Make each workflow-run excerpt that `enrichCiFixHint` adds to the daemon CI-fix hint carry the log's
failure lines and its final lines instead of its first 12 KB, and raise the failed-log read limit so
logs over 64 KiB are read at all. Four tasks.

## Technical Approach

- **Verified baseline.** `enrichCiFixHint` (`src/conductor/src/engine/ci-fix.ts`) reads each failed
  run with `tracker.viewWorkflowRunFailedLog(repo, run, cwd, { timeout: CI_FIX_LOG_TIMEOUT_MS,
  maxBuffer: CI_FIX_LOG_MAX_BUFFER })` and keeps `truncateUtf8(stdout, 12_288, '[log excerpt
  truncated]')`, i.e. the head. `makeProductionGh` forwards `maxBuffer` to Node `execFile`, and a
  child writing 127,189 bytes under the current 65,536-byte limit rejects with
  `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` (reproduced locally), which the enrichment catch turns into
  `log-unavailable`. So the issue's run produces no excerpt today, and a log under 64 KiB produces
  only setup output.
- **Read limit.** Change `CI_FIX_LOG_MAX_BUFFER` to `8 * 1024 * 1024` (8,388,608). A log above it
  still rejects and keeps today's `log-unavailable` degradation; the partial stdout Node attaches to
  that error is the head, which is the noise this feature removes, so it is not used.
- **New pure function** `export function buildCiLogExcerpt(log: string, budget = CI_FIX_LOG_EXCERPT_MAX_BYTES): string`
  in `ci-fix.ts`, with `export const CI_FIX_LOG_EXCERPT_MAX_BYTES = 12_288` replacing the inline
  `12_288`. Every byte count is UTF-8 (`Buffer.byteLength`), every cut iterates code points (the
  existing `truncateUtf8` for heads plus a new `truncateUtf8Tail` that keeps the end), and the whole
  returned string, labels and markers included, is at most `budget` bytes.
  1. Empty log returns `''`. A log of at most `budget` bytes returns unchanged.
  2. Otherwise drop one trailing newline and split on `\n`. A line is a failure line when it matches
     `FAILURE_LINE = /##\[error\]|\bFAIL\b|✗|×|Error:|\[ci-progress\] (?:failed test:|stalled |still running at run end:|process exiting|done \S+ failed\b)/`
     (case-sensitive, anywhere in the line, so the `--log-failed` job/step/timestamp prefix does not
     matter and lowercase `fail`/`error` in branch names does not match).
  3. Failure section, only when at least one line matches: label `[failure lines]`, then matching
     lines in log order, each cut to at most 512 bytes with `truncateUtf8(line, 512, ' [line truncated]')`.
     The section is capped at `Math.floor(budget / 2)` bytes; it keeps the earliest lines that fit
     while reserving room for a final `[<N> failure lines omitted]` line, written only when N > 0.
  4. Tail section, always: label `[log tail: earlier lines omitted]`, then whole lines taken from the
     end while they fit in the remaining budget, in original order. When even the last line does not
     fit, keep its end via `truncateUtf8Tail(line, remaining, '[line truncated] ')` (marker first).
  5. Return failure section (if any), then tail section, joined with `\n`.
  Lines in the failure section may reappear in the tail; that duplication is accepted to keep the
  function a single pass with fixed section budgets.
- **Wiring.** `enrichCiFixHint` replaces only the `truncateUtf8(stdout, 12_288, ...)` call with
  `buildCiLogExcerpt(stdout)`. The `Workflow run <id> log excerpt:` framing, the three-run limit, the
  24,576-byte total cap, the `[context truncated]` marker, and the `log-unavailable` and
  `context-truncated` degradations (surfaced by `daemon-ci-fix.ts` as `log-enrichment` diagnostics on
  the existing event path) are unchanged.
- **Tests.** Pure-function tests go in `src/conductor/test/engine/ci-fix.test.ts` beside the existing
  `enrichCiFixHint` suite (fake `viewWorkflowRunFailedLog` trackers, `as any`, the pattern used there).
  The production entry point is `createDaemonCiFixDispatch`, already exercised in
  `src/conductor/test/daemon-cli-ci-fix-wiring.test.ts` with a fake tracker and a `run` spy that
  receives the hint; Task 4 owns that integration proof. The production `gh` limit is proved in
  `src/conductor/test/engine/tracker-client.test.ts`, which already mocks `node:child_process`
  `execFile` for `makeProductionGh` (no real `gh` is spawned).
- **Shared fixture.** Tasks 2-4 use one generated log: 12,288+ bytes of
  `conductor\tUNKNOWN STEP\t2026-09-21T19:43:43.2626199Z  * [new branch]        feat/x-<n> -> origin/feat/x-<n>`
  lines, then plain Vitest progress lines, then `FAIL  test/engine/foo.test.ts > foo > bar` and
  `AssertionError: expected 1 to be 2`, then padding lines, then a final
  `##[error]Process completed with exit code 1.` line, padded to exactly 127,189 bytes. Define it once
  as a helper in `ci-fix.test.ts` and export nothing from production for it; the wiring and tracker
  tests build their own copy with the same shape.

## Prerequisites

- None.

## Tasks

### Task 1: Excerpt builder passes small logs through and falls back to the log tail
**Story:** Story 1 (happy 4), Story 2 (happy 1, negative 1, negative 2)
**Type:** happy-path

**Steps:**
1. Write failing tests in `ci-fix.test.ts` for `buildCiLogExcerpt`: a 12,288-byte log returned unchanged; an empty log returning `''`; a 40,000-byte log of numbered lines with no failure line; a single-line log of `'😀'.repeat(20_000)`.
2. Verify the tests fail (RED): `buildCiLogExcerpt` does not exist.
3. Implement `CI_FIX_LOG_EXCERPT_MAX_BYTES`, `truncateUtf8Tail`, and `buildCiLogExcerpt` steps 1, 2, 4, and 5 from Technical Approach (no failure section yet).
4. Verify the tests pass (GREEN).
5. Commit: "feat(ci-fix): build log excerpts from the log tail instead of its head".

**Done when:**
- [test] `buildCiLogExcerpt` returns a log of at most 12,288 bytes byte-for-byte unchanged, with no `[failure lines]` label, no `[log tail: earlier lines omitted]` label, and no truncation marker.
- [test] `buildCiLogExcerpt('')` returns an empty string.
- [test] For a 40,000-byte log with no failure line, `buildCiLogExcerpt` returns a non-empty excerpt of at most 12,288 bytes that begins with `[log tail: earlier lines omitted]`, contains no `[failure lines]` label, and whose remaining lines are a contiguous run of the log's final lines in order ending with the log's last line, filling the budget so that adding the next earlier log line would exceed 12,288 bytes.
- [test] For a single-line log of 20,000 emoji, `buildCiLogExcerpt` returns a non-empty excerpt of at most 12,288 bytes that ends with the end of that line, carries the `[line truncated]` marker, and contains no U+FFFD character.

**Files likely touched:**
- `src/conductor/src/engine/ci-fix.ts` — excerpt budget constant, tail cut helper, `buildCiLogExcerpt`
- `src/conductor/test/engine/ci-fix.test.ts` — builder tests

**Dependencies:** none

### Task 2: Excerpt builder lists failure lines before the log tail
**Story:** Story 1 (happy 1, happy 2, happy 3, negative 1, negative 2, negative 3, negative 4)
**Type:** happy-path

**Steps:**
1. Write failing tests in `ci-fix.test.ts` for `buildCiLogExcerpt` using the shared 127,189-byte fixture, per-marker fixtures, a 400-failure-line fixture, a fixture with one 2,000-byte failure line, and a multibyte fixture (emoji-filled failure and tail lines around every cut point).
2. Verify the tests fail (RED): the Task 1 builder has no failure section.
3. Implement `FAILURE_LINE` and step 3 of Technical Approach (failure section, 512-byte line cut, half-budget cap, omitted-count line) ahead of the tail section.
4. Verify the tests pass (GREEN).
5. Commit: "feat(ci-fix): carry failure lines ahead of the log tail in CI-fix excerpts".

**Done when:**
- [test] For the shared 127,189-byte fixture, `buildCiLogExcerpt` returns at most 12,288 bytes that contain a `[failure lines]` section listing the `FAIL  test/engine/foo.test.ts > foo > bar` and `AssertionError: expected 1 to be 2` lines in log order, followed by a `[log tail: earlier lines omitted]` section that is a contiguous run of the log's final lines ending with `##[error]Process completed with exit code 1.`, and contain none of the fixture's `* [new branch]` fetch lines.
- [test] Per-marker fixtures through `buildCiLogExcerpt` list in the failure section each line containing `##[error]`, whole-word `FAIL`, `✗`, `×`, `Error:`, `[ci-progress] failed test:`, `[ci-progress] stalled`, `[ci-progress] still running at run end:`, `[ci-progress] process exiting`, or `[ci-progress] done <path> failed`, and list none of `* [new branch] feat/fail-fast -> origin/feat/fail-fast`, a line containing only lowercase `error`, or `[ci-progress] done <path> passed 1s`.
- [test] For a log with 400 failure lines, the `[failure lines]` section is at most 6,144 bytes, keeps the earliest failure lines in log order, ends with `[<N> failure lines omitted]` where N is the exact omitted count, and is followed by the `[log tail: earlier lines omitted]` section, with the whole excerpt at most 12,288 bytes.
- [test] A 2,000-byte failure line appears in the failure section cut to at most 512 bytes ending with `[line truncated]`, and the multibyte fixture yields an excerpt of at most 12,288 bytes with no U+FFFD character.

**Files likely touched:**
- `src/conductor/src/engine/ci-fix.ts` — `FAILURE_LINE` and failure section in `buildCiLogExcerpt`
- `src/conductor/test/engine/ci-fix.test.ts` — failure-section tests

**Dependencies:** Task 1

### Task 3: Enrichment reads logs up to 8 MiB and uses the excerpt builder
**Story:** Story 2 (negative 1), Story 3 (happy 1, happy 2, negative 1, negative 2)
**Type:** happy-path

**Steps:**
1. Write failing tests: update the existing runner-options test in `ci-fix.test.ts` to expect `maxBuffer: 8_388_608`; add `enrichCiFixHint` tests for the 127,189-byte fixture, an empty log, one rejected read beside one successful read, and three runs each returning the fixture; add a `makeProductionGh` test in `src/conductor/test/engine/tracker-client.test.ts` that calls `createGithubTrackerClient(makeMockedProductionGh()).viewWorkflowRunFailedLog('acme/repo', '41', '/worktree', { timeout: CI_FIX_LOG_TIMEOUT_MS, maxBuffer: CI_FIX_LOG_MAX_BUFFER })` with the mocked `execFile` returning 127,189 bytes.
2. Verify the tests fail (RED): the limit is 65,536 and the excerpt is the head.
3. Implement: set `CI_FIX_LOG_MAX_BUFFER = 8 * 1024 * 1024` and replace the `truncateUtf8(stdout, 12_288, '[log excerpt truncated]')` call in `enrichCiFixHint` with `buildCiLogExcerpt(stdout)`, keeping the `if (excerpt)` guard so an empty excerpt adds nothing.
4. Verify the tests pass (GREEN).
5. Commit: "fix(ci-fix): read long failed logs and hand CI-fix the failure excerpt".

**Done when:**
- [test] The runner-options test asserts `enrichCiFixHint` calls `viewWorkflowRunFailedLog` with `{ timeout: 10_000, maxBuffer: 8_388_608 }` and that `CI_FIX_LOG_MAX_BUFFER` equals 8,388,608.
- [test] `enrichCiFixHint` with a tracker returning the 127,189-byte fixture for one run returns a hint containing `Workflow run <id> log excerpt:` followed by exactly `buildCiLogExcerpt(fixture)`, and its degradations do not include `log-unavailable`.
- [test] `enrichCiFixHint` with a tracker returning `''` returns a hint equal to the `buildCiFixHint` metadata, with no `Workflow run` excerpt line, and no degradation.
- [test] `enrichCiFixHint` with run 8's read rejecting and run 7 returning the fixture reports `log-unavailable`, adds no run 8 excerpt, and keeps run 7's excerpt and every required check name and link; with three runs each returning the fixture, the hint is at most 24,576 bytes and `context-truncated` is reported.
- [test] In `tracker-client.test.ts`, `viewWorkflowRunFailedLog` through `makeProductionGh` passes `maxBuffer: 8_388_608` and argv `run view 41 --repo acme/repo --log-failed` to the mocked `execFile`, and resolves with its 127,189-byte stdout unchanged.

**Files likely touched:**
- `src/conductor/src/engine/ci-fix.ts` — read limit and `enrichCiFixHint` excerpt call
- `src/conductor/test/engine/ci-fix.test.ts` — enrichment tests
- `src/conductor/test/engine/tracker-client.test.ts` — production read-limit test

**Dependencies:** Task 2

### Task 4: The daemon CI-fix dispatch hands the agent the failure excerpt
**Story:** Story 1 (happy 1), Story 3 (happy 2)
**Type:** happy-path

**Steps:**
1. Write a failing test in `src/conductor/test/daemon-cli-ci-fix-wiring.test.ts` following its existing pattern: `createDaemonCiFixDispatch` with a fake tracker whose `getPullRequestHeadRef` resolves a branch and whose `viewWorkflowRunFailedLog` returns a 127,189-byte log of the shared fixture's shape, a `run` spy capturing the hint, and a `diagnostic` spy; dispatch one entry whose rollup has one failed check linked to `https://github.com/acme/widget/actions/runs/41`.
2. Verify the test fails (RED) against the head-only excerpt (the fetch lines fill it); if Task 3 has already landed, confirm RED by reverting only `buildCiLogExcerpt(stdout)` to the head cut locally.
3. Implement nothing beyond Task 3 unless the test exposes a wiring gap; fix any gap inside `daemon-ci-fix.ts`.
4. Verify the test passes (GREEN).
5. Commit: "test(ci-fix): prove the daemon dispatch carries the failure excerpt".

**Done when:**
- [test] `createDaemonCiFixDispatch` with a tracker returning the 127,189-byte fixture calls its `run` callback with a hint that contains the `FAIL  test/engine/foo.test.ts > foo > bar` line and the `AssertionError: expected 1 to be 2` line and contains none of the fixture's `* [new branch]` fetch lines.
- [test] The same dispatch emits no `log-enrichment` diagnostic with reason `log-unavailable`.

**Files likely touched:**
- `src/conductor/test/daemon-cli-ci-fix-wiring.test.ts` — dispatch integration test

**Dependencies:** Task 3

## Task Dependency Graph

```
Task 1 ──> Task 2 ──> Task 3 ──> Task 4
```

## Integration Points

- After Task 3: `enrichCiFixHint` returns the failure excerpt for a 127 KB log.
- After Task 4: the daemon's `createDaemonCiFixDispatch` (production entry point) hands that excerpt to the CI-fix run.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a failed-run log larger than the per-run budget whose first 12,288 bytes are checkout and `* [new branch]` fetch lines and whose later lines include `FAIL  test/engine/foo.test.ts > foo > bar` and `AssertionError: expected 1 to be 2`, when the hint is enriched, then that run's excerpt contains both of those lines and no more than the per-run budget of log text. | 2, 3, 4 | "returns at most 12,288 bytes that contain a `[failure lines]` section listing the `FAIL  test/engine/foo.test.ts > foo > bar` and `AssertionError: expected 1 to be 2` lines in log order" | diff-local |
| Story 1 happy: Given a failed-run log larger than the per-run budget, when the hint is enriched, then that run's excerpt ends with the log's last line (for example `##[error]Process completed with exit code 1.`) and contains a contiguous run of the log's final lines. | 2, 3 | "a `[log tail: earlier lines omitted]` section that is a contiguous run of the log's final lines ending with `##[error]Process completed with exit code 1.`" | diff-local |
| Story 1 happy: Given a failed-run log larger than the per-run budget that contains failure lines, when the hint is enriched, then the excerpt lists its failure lines in their original log order, under a labelled failure-lines section that appears before a labelled log-tail section. | 2 | "contain a `[failure lines]` section listing the `FAIL  test/engine/foo.test.ts > foo > bar` and `AssertionError: expected 1 to be 2` lines in log order, followed by a `[log tail: earlier lines omitted]` section" | diff-local |
| Story 1 happy: Given a failed-run log at or under the per-run budget, when the hint is enriched, then that run's excerpt is the whole log unchanged, with no section labels and no truncation marker. | 1, 3 | "returns a log of at most 12,288 bytes byte-for-byte unchanged, with no `[failure lines]` label, no `[log tail: earlier lines omitted]` label, and no truncation marker" | diff-local |
| Story 1 negative: Given a long failed-run log whose failure lines together exceed half the per-run budget, when the hint is enriched, then the excerpt keeps the earliest failure lines, states how many failure lines were omitted, and still includes the log tail, all within the per-run budget. | 2 | "keeps the earliest failure lines in log order, ends with `[<N> failure lines omitted]` where N is the exact omitted count, and is followed by the `[log tail: earlier lines omitted]` section, with the whole excerpt at most 12,288 bytes" | diff-local |
| Story 1 negative: Given a failure line longer than 512 bytes, when the hint is enriched, then the excerpt carries that line cut to at most 512 bytes with a truncation marker, so one oversized line cannot consume the failure-lines section. | 2 | "A 2,000-byte failure line appears in the failure section cut to at most 512 bytes ending with `[line truncated]`" | diff-local |
| Story 1 negative: Given a long log of checkout output whose lines contain `error` or `fail` only in lowercase (for example `* [new branch] feat/fail-fast -> origin/feat/fail-fast`), when the hint is enriched, then none of those lines is listed as a failure line. | 2 | "list none of `* [new branch] feat/fail-fast -> origin/feat/fail-fast`, a line containing only lowercase `error`" | diff-local |
| Story 1 negative: Given a long log containing multibyte characters at every cut point, when the hint is enriched, then the excerpt contains no U+FFFD replacement character and stays within the per-run budget. | 2 | "the multibyte fixture yields an excerpt of at most 12,288 bytes with no U+FFFD character" | diff-local |
| Story 2 happy: Given a failed-run log larger than the per-run budget with no failure line, when the hint is enriched, then that run's excerpt is the log's final lines filling the per-run budget, ending with the log's last line, with a marker stating that earlier lines were omitted and no failure-lines section. | 1 | "returns a non-empty excerpt of at most 12,288 bytes that begins with `[log tail: earlier lines omitted]`, contains no `[failure lines]` label, and whose remaining lines are a contiguous run of the log's final lines in order ending with the log's last line, filling the budget so that adding the next earlier log line would exceed 12,288 bytes" | diff-local |
| Story 2 negative: Given a failed-run log that is empty, when the hint is enriched, then no excerpt is added for that run and the required check metadata is still present in the hint. | 1, 3 | "returns a hint equal to the `buildCiFixHint` metadata, with no `Workflow run` excerpt line, and no degradation" | diff-local |
| Story 2 negative: Given a failed-run log whose final line alone exceeds the per-run budget, when the hint is enriched, then the excerpt carries the end of that line cut to fit the per-run budget rather than an empty excerpt. | 1 | "returns a non-empty excerpt of at most 12,288 bytes that ends with the end of that line, carries the `[line truncated]` marker" | diff-local |
| Story 3 happy: Given the CI-fix enrichment reads a failed-run log, when it calls the tracker, then it passes a read limit of 8 MiB (8,388,608 bytes) and the existing 10,000 ms timeout. | 3 | "calls `viewWorkflowRunFailedLog` with `{ timeout: 10_000, maxBuffer: 8_388_608 }`" | diff-local |
| Story 3 happy: Given a failed-run log of 127,189 bytes returned by the tracker, when the hint is enriched, then the run contributes an excerpt and no `log-unavailable` degradation is reported. | 3, 4 | "returns a hint containing `Workflow run <id> log excerpt:` followed by exactly `buildCiLogExcerpt(fixture)`, and its degradations do not include `log-unavailable`" | diff-local |
| Story 3 negative: Given the tracker rejects a run's log read (for example a log above the read limit or a denied read), when the hint is enriched, then that run contributes no excerpt, `log-unavailable` is reported, and the other runs' excerpts and the required check metadata are still present. | 3 | "reports `log-unavailable`, adds no run 8 excerpt, and keeps run 7's excerpt and every required check name and link" | diff-local |
| Story 3 negative: Given three failed runs each contributing a full per-run excerpt, when the hint is enriched, then the combined hint still never exceeds 24,576 bytes and reports `context-truncated` when it was cut. | 3 | "with three runs each returning the fixture, the hint is at most 24,576 bytes and `context-truncated` is reported" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
