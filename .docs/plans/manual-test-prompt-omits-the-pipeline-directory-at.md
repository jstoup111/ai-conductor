# Implementation Plan: manual_test attempts record results without being handed a pipeline path (#3642)

**Date:** 2026-11-08
**Design:** none (technical track, Tier S; see `.docs/track/manual-test-prompt-omits-the-pipeline-directory-at.md`)
**Stories:** .docs/stories/manual-test-prompt-omits-the-pipeline-directory-at.md
**Conflict check:** not required at Tier S

## Summary

Stop manual_test attempts from halting for want of a pipeline path, and make an attempt that recorded nothing say so. `manual-test-record` resolves the feature's `.pipeline` from the git toplevel when `--pipeline-dir` is omitted. The skill and the retry hint drop the path requirement. The manual_test write handshake reports `no results written this attempt` with the agent's reported blocker. The work is 7 tasks.

## Technical Approach

- **Path resolution in the CLI, not the prompt.** `detectManualTestRecordCommand` stays pure: an omitted `--pipeline-dir` now yields a `skip` or `results` dispatch with `pipelineDir` undefined, while a present-but-relative value still yields `guide`. `dispatchManualTestRecord` already receives `cwd` (`src/index.ts` passes `process.cwd()`); when `pipelineDir` is undefined it calls a new injectable runner `resolveToplevel(cwd)` (production: `git rev-parse --show-toplevel` via `execa` with `reject: false`, the same call `task-cli.ts` makes) and a new injectable `isDirectory(path)` (production: `stat` + `isDirectory`). No toplevel → exit 1 with `manual-test-record: could not determine the pipeline directory (not inside a git work tree); pass --pipeline-dir <absolute path>`. Toplevel without `.pipeline` → exit 1 with `manual-test-record: <toplevel>/.pipeline does not exist; pass --pipeline-dir <absolute path>`. Both refusals happen before `appendAttemptSection`, so its `mkdir` never runs on a derived path that was not already present. An explicit absolute `--pipeline-dir` bypasses resolution entirely. `MANUAL_TEST_RECORD_USAGE` describes `--pipeline-dir` as optional.
- **Pattern context (CLI).** Follow the injectable-runner seam already in `manual-test-record-cli.ts` (`ManualTestRecordRunners`, `makeProductionManualTestRecordRunners`) and the real-binary acceptance harness in `test/acceptance/manual-test-record-real-binary.acceptance.test.ts` (spawns `bin/conduct-ts` in a `mkdtemp` scratch dir). Allowed variation: the scratch dir must be a `git init`ed repo for derived-path cases. Search hint: `show-toplevel` in `task-cli.ts`.
- **Guidance.** `skills/manual-test/SKILL.md` runs the record command from the feature worktree without `--pipeline-dir`, keeps `--pipeline-dir <absolute path>` as an optional override, and replaces "no pipeline directory supplied … HALT" with: if the record command exits non-zero, do not hand-write the results file; report the command's error as the blocker. `buildRetryHint`'s manual_test "is missing" branch in `remediation-hints.ts` shows `ai-conductor manual-test-record --results <path>` and `ai-conductor manual-test-record --skip --reason <r>` with no `--pipeline-dir`.
- **No-results reason (manual_test only).** In `Conductor.verdictDispatchHandshake` (`src/conductor/src/engine/conductor.ts`), the generic file branch is reached only by manual_test (prd_audit and architecture_review_as_built return from their own branches first). "This attempt wrote no results" is decided by the file alone: the results file is missing, or every results file's mtime predates `dispatchStartedAt - VERDICT_FRESHNESS_FS_TOLERANCE_MS`. Whenever that holds, whatever the identity state, the reason becomes `no results written this attempt: .pipeline/manual-test-results.md is missing` or `no results written this attempt: .pipeline/manual-test-results.md last written <ISO mtime>, before this attempt started`. When the identity state is `stale-run-identity` or `invalidated-code-stamp` (expected and found run ids differ, or the stamp is invalidated), the reason then appends `; expected run id <expected>; found run id <found>`, so the staleness reason still names the artifact, both identities and the mtime (adr-2026-08-25 D5). When the identity state is `match` or `unstamped`, the reason has no `expected run id …; found run id …` pair and does not contain the word `stale`. The blocker clause ends every no-results reason. An attempt that did write a fresh results file keeps the existing reason text for any identity failure. The returned `routeClass: 'absent'`, `retrySignal` and `verdictFreshness` facets are unchanged, so routing is unaffected.
- **Blocker clause.** A pure helper in `conductor.ts`, `manualTestBlockerClause(dispatchOutput)`, collapses whitespace runs in the trimmed output to single spaces; empty or undefined yields `; the agent gave no final message`; otherwise `; agent reported: "<excerpt>"`, where an excerpt longer than 600 characters is `…` followed by its last 600 characters. `dispatchOutput` is already passed at every handshake call site and is the provider's final agent message for both Claude (`result`) and Codex (last `agent_message`).
- **Retry and halt reasons.** No new wiring: the serial loop stores the handshake reason as `lastVerdictHandshakeFailure` and the exhaustion halt reuses it; the `step_retry` event carries the same reason. Task 7 proves this through the conductor loop.
- **Sequencing.** CLI (Tasks 1–2) precedes the skill change (Task 4) so the skill never directs a command that does not yet work. The handshake reason (Task 5) precedes the blocker clause (Task 6), which precedes the loop-level proof (Task 7). Task 3 is independent.

## Prerequisites

- None.

## Tasks

### Task 1: Resolve the pipeline directory from the git toplevel when --pipeline-dir is omitted
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests. In `src/conductor/test/engine/manual-test-record-cli.test.ts`: `detectManualTestRecordCommand` with `--results p` and no `--pipeline-dir` returns `{kind:'results', resultsPath:'p'}` with `pipelineDir` undefined, and likewise for `--skip --reason r`. In `src/conductor/test/acceptance/manual-test-record-real-binary.acceptance.test.ts`, following its spawn-the-real-binary pattern in a `mkdtemp` dir that is `git init`ed and holds a `.pipeline` directory: (a) `manual-test-record --results -` with a results table on stdin and cwd at the repo root exits 0 and `<root>/.pipeline/manual-test-results.md` gains a `## Attempt 1` section with the table; (b) `manual-test-record --skip --reason r` from the root exits 0 and records the skip attempt there; (c) the same `--results -` run from `<root>/sub/dir` exits 0, writes `<root>/.pipeline/manual-test-results.md`, and `<root>/sub/dir/.pipeline` does not exist; (d) with cwd at a second unrelated temp dir and `--pipeline-dir <root>/.pipeline`, the attempt lands in `<root>/.pipeline/manual-test-results.md`.
2. Verify the tests fail (RED).
3. Implement in `src/conductor/src/engine/manual-test-record-cli.ts`: make `pipelineDir` optional on the `skip`/`results` dispatch kinds; drop the missing-flag `guide` return but keep the relative-path one; add `resolveToplevel` and `isDirectory` to `ManualTestRecordRunners` and their production versions (`execa('git', ['rev-parse','--show-toplevel'], { cwd, reject: false })`, `stat(...).isDirectory()`); in `dispatchManualTestRecord`, resolve `<toplevel>/.pipeline` from `cwd` when `pipelineDir` is undefined; update `MANUAL_TEST_RECORD_USAGE` to show `[--pipeline-dir <dir>]` as optional. Follow the existing injectable-runner seam pattern in this file.
4. Verify the tests pass (GREEN).
5. Commit: "manual-test-record: derive the pipeline dir from the git toplevel".

**Done when:**
- [test] A real-binary acceptance test spawning `bin/conduct-ts manual-test-record --results -` with no `--pipeline-dir` from a git repo root holding `.pipeline` asserts exit 0 and that `<root>/.pipeline/manual-test-results.md` contains a new `## Attempt` section with the piped table.
- [test] A real-binary acceptance test spawning `manual-test-record --skip --reason r` with no `--pipeline-dir` from the repo root asserts exit 0 and a recorded skip attempt in `<root>/.pipeline/manual-test-results.md`.
- [test] A real-binary acceptance test run from `<root>/sub/dir` asserts `dispatchManualTestRecord` wrote `<root>/.pipeline/manual-test-results.md` and that `<root>/sub/dir/.pipeline` does not exist.
- [test] A real-binary acceptance test with cwd in an unrelated temp dir and an explicit absolute `--pipeline-dir <root>/.pipeline` asserts the attempt is appended to `<root>/.pipeline/manual-test-results.md`.

**Files likely touched:**
- `src/conductor/src/engine/manual-test-record-cli.ts` — optional `pipelineDir`, toplevel resolution runners, usage text
- `src/conductor/test/engine/manual-test-record-cli.test.ts` — detector cases without `--pipeline-dir`
- `src/conductor/test/acceptance/manual-test-record-real-binary.acceptance.test.ts` — derived-path real-binary cases

**Dependencies:** none

### Task 2: Refuse cleanly when the pipeline directory cannot be derived
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/acceptance/manual-test-record-real-binary.acceptance.test.ts`, same harness as Task 1: (a) cwd is a temp dir that is not inside a git work tree, `manual-test-record --results -` with stdin and no `--pipeline-dir` exits 1, stderr contains `could not determine the pipeline directory` and `--pipeline-dir`, and the temp dir is unchanged (no `.pipeline` created, no files); (b) cwd is a `git init`ed temp repo with no `.pipeline`, the same command exits 1, stderr names `<toplevel>/.pipeline`, and neither `<toplevel>/.pipeline` nor any results file exists afterwards; (c) `--pipeline-dir relative/dir` still exits 1 with the usage text and writes nothing. In `src/conductor/test/engine/manual-test-record-cli.test.ts`, keep the existing relative-path `guide` cases passing.
2. Verify the tests fail (RED).
3. Implement the two refusals in `dispatchManualTestRecord` before any call to `appendAttemptSection`, using the Task 1 runners and the messages given in Technical Approach.
4. Verify the tests pass (GREEN).
5. Commit: "manual-test-record: refuse when the pipeline dir cannot be derived".

**Done when:**
- [test] A real-binary acceptance test outside any git work tree asserts `manual-test-record` without `--pipeline-dir` exits 1, stderr contains `could not determine the pipeline directory` and `--pipeline-dir`, and the directory listing is unchanged.
- [test] A real-binary acceptance test in a git repo without `.pipeline` asserts exit 1, stderr names `<toplevel>/.pipeline`, and afterwards neither `<toplevel>/.pipeline` nor a `manual-test-results.md` exists.
- [test] A real-binary acceptance test asserts `--pipeline-dir relative/dir` exits 1 with the usage text and creates no file, and the existing `detectManualTestRecordCommand` relative-path tests still return `{kind:'guide'}`.

**Files likely touched:**
- `src/conductor/src/engine/manual-test-record-cli.ts` — derived-path refusals
- `src/conductor/test/acceptance/manual-test-record-real-binary.acceptance.test.ts` — refusal cases

**Dependencies:** Task 1

### Task 3: Drop --pipeline-dir from the manual_test retry hint
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write a failing test in a new `src/conductor/test/engine/manual-test-retry-hint.test.ts`: `buildRetryHint('manual_test', '.pipeline/manual-test-results.md is missing — …')` contains `ai-conductor manual-test-record --results <path>` and `ai-conductor manual-test-record --skip --reason <r>` and does not contain `--pipeline-dir`. Update any existing assertion in `src/conductor/test/acceptance/manual-test-auto-mode-marker-record.acceptance.test.ts` that pins the old hint text.
2. Verify the test fails (RED).
3. Implement: in `src/conductor/src/engine/remediation-hints.ts`, remove `--pipeline-dir <dir>` from both command lines in the manual_test "is missing" branch.
4. Verify the test passes (GREEN).
5. Commit: "remediation-hints: manual_test retry hint records without --pipeline-dir".

**Done when:**
- [test] A unit test asserts `buildRetryHint('manual_test', <reason containing "is missing">)` returns text containing `ai-conductor manual-test-record --results <path>` and `ai-conductor manual-test-record --skip --reason <r>` and not containing `--pipeline-dir`.
- [test] The same test asserts `buildRetryHint('manual_test', <reason without "is missing">)` still returns the `Finish the work now.` hint unchanged.

**Files likely touched:**
- `src/conductor/src/engine/remediation-hints.ts` — manual_test hint command lines
- `src/conductor/test/engine/manual-test-retry-hint.test.ts` — new hint test
- `src/conductor/test/acceptance/manual-test-auto-mode-marker-record.acceptance.test.ts` — existing hint assertion, if it pins `--pipeline-dir`

**Dependencies:** none

### Task 4: Manual-test skill records from the worktree and stops halting for a missing path
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Edit `skills/manual-test/SKILL.md`: in §0 and the recording section, show `ai-conductor manual-test-record --skip --reason "<reason>"` and `ai-conductor manual-test-record --results - <<'EOF' …` run from the feature worktree, and state that `--pipeline-dir <absolute path>` is an optional override. Remove every sentence that requires a pipeline path from the step's system prompt. Replace "If you cannot run the CLI (no pipeline directory supplied, or the command fails) … HALT and report the blocker" with: if the record command exits non-zero, do not consider manual_test complete, never hand-write the results file, and report the command's error output as the blocker. Leave the Whitewash guard (#367) paragraph and the `### 6. Bug Loop` section byte-identical.
2. Commit: "manual-test skill: record from the worktree; --pipeline-dir optional".

**Done when:**
- `grep -n "system prompt" skills/manual-test/SKILL.md` finds no line directing the agent to use a pipeline path supplied by the step's system prompt, `grep -n "no pipeline directory supplied" skills/manual-test/SKILL.md` finds nothing, and no instruction in the file directs the agent to halt or withhold results because a pipeline path was not supplied.
- `skills/manual-test/SKILL.md` directs running `ai-conductor manual-test-record` from the feature worktree, every `ai-conductor manual-test-record` example in it runs without `--pipeline-dir`, and the file states `--pipeline-dir` is an optional override.
- `skills/manual-test/SKILL.md` directs that a non-zero exit from the record command means manual_test is not complete, the results file must not be hand-written, and the command's error is reported as the blocker.
- `git diff main -- skills/manual-test/SKILL.md` changes no line of the `**Whitewash guard (#367):**` paragraph or the `### 6. Bug Loop` section.

**Files likely touched:**
- `skills/manual-test/SKILL.md` — recording guidance

**Dependencies:** Tasks 1, 2

### Task 5: Report "no results written this attempt" from the manual_test handshake
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in a new `src/conductor/test/engine/manual-test-handshake-reason.test.ts`, following the bind-the-private-method pattern in `src/conductor/test/engine/prd-audit-handshake.test.ts`: (a) results file and sidecar stamped with this run id, file mtime set one hour before `dispatchStartedAt` → reason starts `no results written this attempt`, contains `.pipeline/manual-test-results.md` and the file's ISO mtime, does not contain `stale`, and does not contain `expected run id`; (b) no results file → reason starts `no results written this attempt` and contains `.pipeline/manual-test-results.md is missing`; (c) sidecar stamped with a different run id and a stale file → reason starts `no results written this attempt`, names `.pipeline/manual-test-results.md` and its ISO mtime, and contains `expected run id <current>` and `found run id <other>`, with the `stale-run-identity` retry signal unchanged; (d) fresh file written after `dispatchStartedAt` with this run's stamp → the handshake returns `undefined`.
2. Verify the tests fail (RED).
3. Implement in `verdictDispatchHandshake` (`src/conductor/src/engine/conductor.ts`): for `step === 'manual_test'`, when the results file is missing or every results file is mtime-stale, return `{ done: false, routeClass: 'absent', reason }` with the `no results written this attempt: …` reason described in Technical Approach, whatever the identity state; append the `expected run id …; found run id …` pair only for `stale-run-identity` or `invalidated-code-stamp`, and keep those states' existing `retrySignal` and `verdictFreshness` facets.
4. Verify the tests pass (GREEN).
5. Commit: "conductor: manual_test handshake reports no results written this attempt".

**Done when:**
- [test] A unit test asserts that `verdictDispatchHandshake('manual_test', …)` with a this-run-stamped results file last written before `dispatchStartedAt` returns `done: false` with a reason starting `no results written this attempt` that contains `.pipeline/manual-test-results.md` and the file's ISO mtime and contains neither `stale` nor `expected run id`.
- [test] A unit test asserts that with no results file the handshake returns `done: false` with a reason starting `no results written this attempt` and containing `.pipeline/manual-test-results.md is missing`.
- [test] A unit test asserts that a stale results file whose sidecar is stamped with a different run id yields a reason starting `no results written this attempt` and containing `.pipeline/manual-test-results.md`, the file's ISO mtime, `expected run id <current>`, and `found run id <other>`, with `retrySignal` still `stale-run-identity`.
- [test] A unit test asserts that a this-run-stamped results file written after `dispatchStartedAt` makes the handshake return `undefined` and no reason containing `no results written this attempt`.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — manual_test no-results reason in `verdictDispatchHandshake`
- `src/conductor/test/engine/manual-test-handshake-reason.test.ts` — new handshake reason tests

**Dependencies:** none

### Task 6: Append the agent's reported blocker to the no-results reason
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/manual-test-handshake-reason.test.ts`: (a) no-results attempt with `dispatchOutput` `"Manual testing is blocked:\n\n  the app   would not start"` → reason contains `agent reported: "Manual testing is blocked: the app would not start"`; (b) a 2,000-character output → the reason's excerpt is `…` followed by exactly the last 600 characters of the whitespace-collapsed output; (c) `dispatchOutput` undefined, and separately `"   "` → reason contains `the agent gave no final message`; (d) fresh results file containing a FAIL row written after `dispatchStartedAt` with this run's stamp and a non-empty `dispatchOutput` → the handshake returns `undefined`, so no `agent reported` text is produced.
2. Verify the tests fail (RED).
3. Implement `manualTestBlockerClause(dispatchOutput)` in `src/conductor/src/engine/conductor.ts` as described in Technical Approach and append it to the Task 5 no-results reason only.
4. Verify the tests pass (GREEN).
5. Commit: "conductor: carry the manual_test agent's reported blocker into the no-results reason".

**Done when:**
- [test] A unit test asserts that the no-results reason from `verdictDispatchHandshake` contains `agent reported: "Manual testing is blocked: the app would not start"` for a multi-line, multi-space final message, proving whitespace runs collapse to single spaces.
- [test] A unit test asserts that for a 2,000-character final message the reason's excerpt equals `…` followed by exactly the last 600 characters of the collapsed message.
- [test] A unit test asserts that an undefined or whitespace-only final message yields a reason containing `the agent gave no final message`.
- [test] A unit test asserts that a fresh this-run results file with a FAIL row makes the handshake return `undefined`, so no `agent reported` text is added.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — `manualTestBlockerClause` and its use in the no-results reason
- `src/conductor/test/engine/manual-test-handshake-reason.test.ts` — blocker clause tests

**Dependencies:** Task 5

### Task 7: Prove retry and halt reasons carry the no-results text and blocker, and a blocked attempt never passes
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-verdicts-and-daemon.test.ts`, following its "records the %s handshake on failed dispatch retries and preserves its final diagnostic" fixture for `manual_test` in the serial loop. The stub dispatch writes nothing to `.pipeline/manual-test-results.md` (a results file and stamp from an earlier attempt of the same run are left on disk) and returns `success: true` with output `Manual testing is blocked: the app could not start`. Assert: every `step_retry` event for `manual_test` has a reason containing `no results written this attempt` and `agent reported: "Manual testing is blocked: the app could not start"`; when the retry budget is exhausted the halt reason contains the same two strings; and `manual_test` is never `done`. Repeat with output `All criteria PASS` and assert `step_retry` reasons contain `no results written this attempt` and `manual_test` is never `done`. Finally, a stub that writes fresh results (this run's stamp, after dispatch start) containing a FAIL row: assert the existing `manual_test` → `build` kickback event is emitted and no `step_retry` or halt reason contains `agent reported`.
2. Verify the tests fail (RED) before Tasks 5–6 land, or pass once they do (this task adds no production code).
3. Commit: "test: manual_test retry and halt reasons carry the no-results blocker".

**Done when:**
- [test] A conductor serial-loop test asserts each `manual_test` `step_retry` event reason contains `no results written this attempt` and `agent reported: "Manual testing is blocked: the app could not start"` when the dispatch wrote no results.
- [test] The same test asserts that after the retry budget is exhausted the conductor's halt reason contains `no results written this attempt` and the reported blocker text, and `manual_test` state is not `done`.
- [test] A conductor serial-loop test asserts that a dispatch returning `success: true` with output `All criteria PASS` but writing no results produces `step_retry` reasons containing `no results written this attempt` and leaves `manual_test` not `done`.
- [test] A conductor serial-loop test asserts that a dispatch writing fresh this-run results with a FAIL row produces the existing `manual_test` → `build` kickback event, and no `step_retry` or halt reason containing `agent reported`.

**Files likely touched:**
- `src/conductor/test/engine/conductor-verdicts-and-daemon.test.ts` — serial-loop manual_test no-results retry and halt cases

**Dependencies:** Task 6

## Optional Task Dependency Graph

```
Task 1 ─▶ Task 2 ─▶ Task 4
Task 3
Task 5 ─▶ Task 6 ─▶ Task 7
```

## Integration Points

- After Task 2: `bin/conduct-ts manual-test-record` records from a worktree with no `--pipeline-dir` (real binary).
- After Task 7: a non-recording manual_test attempt's retry and halt reasons carry `no results written this attempt` and the agent's blocker through the conductor loop.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the working directory is the root of a feature worktree that contains a `.pipeline` directory, when `ai-conductor manual-test-record --results -` runs with results on stdin and no `--pipeline-dir`, then a new attempt section is appended to `<worktree root>/.pipeline/manual-test-results.md` and the command exits 0 | 1 | "asserts exit 0 and that `<root>/.pipeline/manual-test-results.md` contains a new `## Attempt` section with the piped table" | diff-local |
| Story 1 happy: Given the same worktree, when `ai-conductor manual-test-record --skip --reason "<reason>"` runs with no `--pipeline-dir`, then the skip attempt is recorded in `<worktree root>/.pipeline/manual-test-results.md` and the command exits 0 | 1 | "asserts exit 0 and a recorded skip attempt in `<root>/.pipeline/manual-test-results.md`" | diff-local |
| Story 1 happy: Given the working directory is a subdirectory of the feature worktree, when the command runs with no `--pipeline-dir`, then it records into `<worktree root>/.pipeline/manual-test-results.md`, not into a `.pipeline` under the subdirectory | 1 | "asserts `dispatchManualTestRecord` wrote `<root>/.pipeline/manual-test-results.md` and that `<root>/sub/dir/.pipeline` does not exist" | diff-local |
| Story 1 happy: Given an explicit absolute `--pipeline-dir`, when the command runs, then it records into that directory exactly as before this change, regardless of the working directory | 1 | "asserts the attempt is appended to `<root>/.pipeline/manual-test-results.md`" | diff-local |
| Story 1 negative: Given the working directory is not inside a git work tree and no `--pipeline-dir` is passed, when the command runs, then it exits 1 with a message saying the pipeline directory could not be determined and naming `--pipeline-dir` as the override, and writes no file | 2 | "exits 1, stderr contains `could not determine the pipeline directory` and `--pipeline-dir`, and the directory listing is unchanged" | diff-local |
| Story 1 negative: Given the git toplevel of the working directory has no `.pipeline` directory and no `--pipeline-dir` is passed, when the command runs, then it exits 1 with a message naming the expected `<toplevel>/.pipeline` path, and creates neither that directory nor a results file | 2 | "asserts exit 1, stderr names `<toplevel>/.pipeline`, and afterwards neither `<toplevel>/.pipeline` nor a `manual-test-results.md` exists" | diff-local |
| Story 1 negative: Given a relative `--pipeline-dir` is passed, when the command runs, then it is refused before any write, as before this change | 2 | "asserts `--pipeline-dir relative/dir` exits 1 with the usage text and creates no file" | diff-local |
| Story 2 happy: Given the manual-test skill, when an agent reads its recording instructions, then the skill directs recording with `ai-conductor manual-test-record` run from the feature worktree and treats `--pipeline-dir` as optional | 4 | "`skills/manual-test/SKILL.md` directs running `ai-conductor manual-test-record` from the feature worktree, every `ai-conductor manual-test-record` example in it runs without `--pipeline-dir`, and the file states `--pipeline-dir` is an optional override." | diff-local |
| Story 2 happy: Given the manual-test skill, when an agent has no pipeline path in its step prompt, then no instruction in the skill directs it to halt or withhold results for that reason | 4 | "no instruction in the file directs the agent to halt or withhold results because a pipeline path was not supplied" | diff-local |
| Story 2 happy: Given a manual_test retry after a completion miss whose reason says the results file is missing, when the engine builds the retry hint, then the record commands it shows carry no `--pipeline-dir` placeholder | 3 | "returns text containing `ai-conductor manual-test-record --results <path>` and `ai-conductor manual-test-record --skip --reason <r>` and not containing `--pipeline-dir`" | diff-local |
| Story 2 negative: Given the record command itself exits non-zero, when the agent follows the skill, then the skill still directs it not to hand-write the results file and to report the command's error as its blocker | 4 | "directs that a non-zero exit from the record command means manual_test is not complete, the results file must not be hand-written, and the command's error is reported as the blocker" | diff-local |
| Story 2 negative: Given the skill's existing whitewash guard and bug loop, when the guidance is changed, then their instructions are unchanged | 4 | "changes no line of the `**Whitewash guard (#367):**` paragraph or the `### 6. Bug Loop` section" | diff-local |
| Story 3 happy: Given the results file on disk carries this run's identity but was last written before this attempt's dispatch started, when the post-dispatch handshake runs, then the attempt fails with a reason beginning `no results written this attempt` that names `.pipeline/manual-test-results.md` and its last-write time | 5 | "returns `done: false` with a reason starting `no results written this attempt` that contains `.pipeline/manual-test-results.md` and the file's ISO mtime" | diff-local |
| Story 3 happy: Given the same attempt, when the reason is formed, then it does not call the file stale and does not print an expected and a found run identity as a pair | 5 | "contains neither `stale` nor `expected run id`" | diff-local |
| Story 3 happy: Given no results file exists, when the handshake runs, then the attempt fails with a reason beginning `no results written this attempt` that names the missing `.pipeline/manual-test-results.md` | 5 | "returns `done: false` with a reason starting `no results written this attempt` and containing `.pipeline/manual-test-results.md is missing`" | diff-local |
| Story 3 happy: Given the attempt is retried or the step's retry budget is exhausted, when the `step_retry` event or the halt is recorded, then its reason carries the `no results written this attempt` text | 7 | "after the retry budget is exhausted the conductor's halt reason contains `no results written this attempt`" | diff-local |
| Story 3 negative: Given the results file carries a different run's identity, when the handshake runs, then the reason still names the artifact, the expected run identity, and the found identity as before this change | 5 | "containing `.pipeline/manual-test-results.md`, the file's ISO mtime, `expected run id <current>`, and `found run id <other>`" | diff-local |
| Story 3 negative: Given the attempt wrote fresh results stamped with this run's identity, when the handshake runs, then no `no results written this attempt` reason is produced | 5 | "makes the handshake return `undefined` and no reason containing `no results written this attempt`" | diff-local |
| Story 4 happy: Given an attempt that wrote no results and whose final agent message is non-empty, when the handshake reason is formed, then it includes that message as the agent's reported blocker, with whitespace runs collapsed to single spaces | 6 | "contains `agent reported: "Manual testing is blocked: the app would not start"` for a multi-line, multi-space final message, proving whitespace runs collapse to single spaces" | diff-local |
| Story 4 happy: Given a final agent message longer than 600 characters, when the reason is formed, then only its last 600 characters appear, preceded by an ellipsis | 6 | "the reason's excerpt equals `…` followed by exactly the last 600 characters of the collapsed message" | diff-local |
| Story 4 happy: Given the attempt is retried or exhausts its budget, when the `step_retry` event or halt reason is recorded, then it contains the reported blocker text | 7 | "each `manual_test` `step_retry` event reason contains `no results written this attempt` and `agent reported: "Manual testing is blocked: the app could not start"`" | diff-local |
| Story 4 negative: Given an attempt that wrote no results and produced no final agent message, when the reason is formed, then it states that the agent gave no final message | 6 | "an undefined or whitespace-only final message yields a reason containing `the agent gave no final message`" | diff-local |
| Story 4 negative: Given an attempt where the application could not start and the agent reported that instead of recording results, when the step concludes, then the attempt is failed and manual_test is not marked done | 7 | "the conductor's halt reason contains `no results written this attempt` and the reported blocker text, and `manual_test` state is not `done`" | diff-local |
| Story 4 negative: Given an attempt whose final message claims the tests passed but which recorded no results, when the step concludes, then the attempt is failed and manual_test is not marked done | 7 | "a dispatch returning `success: true` with output `All criteria PASS` but writing no results produces `step_retry` reasons containing `no results written this attempt` and leaves `manual_test` not `done`" | diff-local |
| Story 4 negative: Given an attempt that recorded fresh results containing FAIL rows, when the step concludes, then the existing FAIL routing applies unchanged and no reported-blocker text is added | 6, 7 | "a dispatch writing fresh this-run results with a FAIL row produces the existing `manual_test` → `build` kickback event, and no `step_retry` or halt reason containing `agent reported`" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
