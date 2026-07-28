# Implementation Plan: CI daemon end-to-end smoke step (deterministic tier)

**Date:** 2026-07-28
**Stories:** .docs/stories/ci-needs-a-daemon-end-to-end-smoke-step-drive-a-1-.md
**Complexity:** .docs/complexity/ci-needs-a-daemon-end-to-end-smoke-step-drive-a-1-.md (Tier: S)
**Conflict check:** skipped (Small tier)

## Summary

Builds a committed fixture feature (plan + stories using the real heading
grammar the daemon parses) and a new E2E test that drives it through the real
daemon dispatch pipeline — claim → worktree setup/engine publish → build
dispatch → evidence corroboration → completion gate → finish — using a
scripted `LLMProvider` fake that makes real git commits. 9 tasks.

## Technical Approach

**No new CI workflow job is needed.** `src/conductor/vitest.config.ts` already
runs every `test/**/*.test.ts` file except `test/smoke/**` and
`**/*.smoke.test.ts`, and `.github/workflows/ci.yml`'s existing `conductor`
job already runs `npm test` (gated into `ci-gate`). Naming the new test file
`test/engine/daemon-e2e-fixture.test.ts` (not under `test/smoke/`, no
`.smoke.` in the name) makes it run in CI automatically via the existing
job — this satisfies the "actually runs in CI, not silently excluded" story
without adding new workflow surface (verified by reading both files; #630's
"wire into ci.yml" hypothesis is unnecessary given the current job already
covers the include pattern).

**Fixture placement:** `src/conductor/test/fixtures/daemon-e2e/` holds a
static plan file (`plan.md`) and stories file (`stories.md`) with the three
heading shapes (`### Task N —`, `### T0 —`, `## Task Dependency Graph`) and
the backtick-vs-bullet evidence distinction. These are read-only fixtures;
the E2E test copies them into a disposable temp worktree per run (same
pattern other engine smoke tests use for isolation).

**Driving the pipeline:** the E2E test uses `createCodexProviderFake` (already
exists at `test/fixtures/codex-provider-fake.ts`) with a script callback that,
on each `invoke`, performs the real git operations (stage the fixture's
declared file, commit with the real `Task: <id>` trailer) inside the temp
worktree, then returns `{ success: true, ... }` — so the SAME
dispatch/evidence/completion code paths a real build uses run against a real
git history, only the "agent" step is scripted instead of shelling out to a
real LLM CLI.

**Failure diagnostics** are a `try/catch` (or `afterEach` with test-status
check) around the pipeline run that, on failure, prints the temp worktree's
daemon log tail and any halt/park marker file contents to `console.error`
before rethrowing/failing.

## Prerequisites

None beyond what's already in the repo (dispatch pipeline, evidence gate,
`LLMProvider` fake pattern).

## Tasks

### T0: Author fixture plan/stories with the real heading grammar
**Story:** Story 1 — "a fixture feature exercises real header and evidence-harvesting conventions" (happy path)
**Type:** infrastructure

**Steps:**
1. Create `src/conductor/test/fixtures/daemon-e2e/stories.md` — a minimal
   `Status: Accepted` stories file for a trivial fixture feature (one
   happy-path story).
2. Create `src/conductor/test/fixtures/daemon-e2e/plan.md` containing: a
   `### T0 — Setup` heading, a `### Task 1 — <title>` heading, a
   `## Task Dependency Graph` section, one prose sentence with an inline
   `` `not-a-path` `` backtick token (not a declared corroboration path), and
   one `- \`test/fixtures/daemon-e2e/touched.txt\`` bullet under Task 1
   declaring the file the fixture commit will actually touch.
3. Create the placeholder target file `src/conductor/test/fixtures/daemon-e2e/touched.txt`
   (empty/marker content) so Task 1's declared path exists pre-fixture-run.
4. Commit: "test(fixtures): add daemon E2E fixture plan/stories"

**Files:**
- `src/conductor/test/fixtures/daemon-e2e/stories.md`
- `src/conductor/test/fixtures/daemon-e2e/plan.md`
- `src/conductor/test/fixtures/daemon-e2e/touched.txt`

**Wired-into:** none (fixture data, consumed by Task 2's test file)
**Dependencies:** none

### Task 1: Assert the fixture plan parses with no phantom task id
**Story:** Story 1 (happy path — `## Task Dependency Graph` doesn't produce a phantom task)
**Type:** happy-path

**Steps:**
1. Write failing test in `src/conductor/test/engine/daemon-e2e-fixture.test.ts`:
   import `plan-task-parse.ts`'s parser, parse the fixture plan's raw text,
   assert the extracted task id set is exactly `{'T0', '1'}` (no id derived
   from "Dependency" or "Graph").
2. Verify test fails (RED) — only fails if the fixture file doesn't exist yet
   or the assertion is wrong; expect this to pass immediately since #620 is
   already fixed. If it passes on first write, note in the commit that this
   task is regression-proving, not bug-fixing.
3. No implementation needed (parser already correct) — commit the test as-is.
4. Verify test passes (GREEN).
5. Commit: "test(engine): assert fixture plan yields no phantom task id"

**Files:**
- `src/conductor/test/engine/daemon-e2e-fixture.test.ts`

**Wired-into:** none (no new production surface)
**Verify-only:** yes
**Dependencies:** T0

### Task 2: Assert inline-prose backticks are never harvested as corroboration paths
**Story:** Story 1 (negative path — prose backtick token never treated as required corroboration)
**Type:** negative-path

**Steps:**
1. In `daemon-e2e-fixture.test.ts`, write a test that parses Task 1's evidence
   requirements from the fixture plan and asserts the harvested path set does
   NOT contain `not-a-path`.
2. Verify test fails only if harvesting is wrong (expect immediate pass —
   #548 already fixed; this is regression coverage).
3. Commit: "test(engine): assert prose backticks excluded from corroboration paths"

**Files:**
- `src/conductor/test/engine/daemon-e2e-fixture.test.ts`

**Wired-into:** none (no new production surface)
**Verify-only:** yes
**Dependencies:** Task 1

### Task 3: Assert a declared bullet path IS harvested and enforced
**Story:** Story 1 (negative path — unsatisfied bullet-declared path correctly rejects evidence)
**Type:** negative-path

**Steps:**
1. In `daemon-e2e-fixture.test.ts`, add a test asserting the harvested
   corroboration path set for Task 1 DOES contain
   `test/fixtures/daemon-e2e/touched.txt`.
2. Add a second assertion (or separate `it`) that a commit NOT touching that
   path fails corroboration when run through the evidence gate directly
   (unit-level call, not the full pipeline — the full pipeline case is
   covered by Task 6).
3. Commit: "test(engine): assert declared bullet path is harvested and enforced"

**Files:**
- `src/conductor/test/engine/daemon-e2e-fixture.test.ts`

**Wired-into:** none (no new production surface)
**Verify-only:** yes
**Dependencies:** Task 2

### Task 4: Scaffold the scripted provider fake that makes real git commits
**Story:** Story 2 (happy path — scripted fake makes real commits with real trailers)
**Type:** infrastructure

**Steps:**
1. In `daemon-e2e-fixture.test.ts`, add a helper `createFixtureAgentFake(worktreeDir)`
   built on `createCodexProviderFake` whose script callback, per invocation:
   stages `test/fixtures/daemon-e2e/touched.txt` (writes a marker line),
   commits with `git commit -m "..." --trailer "Task: <id>"` inside
   `worktreeDir`, then returns `{ success: true, output: 'fixture agent
   completed', exitCode: 0 }`.
2. Write a focused test that invokes the fake directly (no full pipeline yet)
   and asserts a real commit lands in a temp git repo with the expected
   trailer — proves the fake's git mechanics work in isolation before wiring
   it into the full pipeline in Task 5.
3. Commit: "test(engine): scripted fixture agent fake makes real trailered commits"

**Files:**
- `src/conductor/test/engine/daemon-e2e-fixture.test.ts`

**Wired-into:** none (no new production surface — test-only fake)
**Dependencies:** Task 3

### Task 5: Drive the fixture through claim → dispatch → build via the fake
**Story:** Story 2 (happy path — pipeline runs claim through build dispatch with the fake)
**Type:** happy-path

**Steps:**
1. Write a failing test that: creates a disposable temp git worktree, copies
   the fixture plan/stories in, invokes the real daemon dispatch entrypoint
   (the same function `test/acceptance/codex-fresh-session-per-step-contract.acceptance.test.ts`
   uses to drive dispatch with an injected `LLMProvider`) with the Task 4
   fake as the provider.
2. Verify test fails (RED) before the fake/wiring is correct — confirm it
   fails for the right reason (no commits yet), not a setup error.
3. Implement: connect the fake, run dispatch through build completion of
   Task 1.
4. Verify test passes (GREEN) — build dispatch reports Task 1 complete.
5. Commit: "test(engine): drive fixture through claim-to-build-dispatch via fake provider"

**Files:**
- `src/conductor/test/engine/daemon-e2e-fixture.test.ts`

**Wired-into:** none (no new production surface — consumes existing dispatch entrypoint)
**Dependencies:** Task 4

### Task 6: Assert the pipeline reaches finish with no halt/park
**Story:** Story 2 (happy path — finished/mergeable terminal state, never halt/park)
**Type:** happy-path

**Steps:**
1. Extend the Task 5 test through the completion gate and finish step.
2. Assert the pipeline reaches a finished/mergeable (or local-merge
   equivalent) terminal state.
3. Assert explicitly: no halt marker file and no park marker file exist in
   the temp worktree's `.pipeline/` (or wherever `halt-marker.ts`/
   `park-marker.ts` write them) after finish.
4. Commit: "test(engine): assert fixture pipeline finishes with no halt or park"

**Files:**
- `src/conductor/test/engine/daemon-e2e-fixture.test.ts`

**Wired-into:** none (no new production surface)
**Dependencies:** Task 5

### Task 7: Negative path — missing evidence trailer halts the pipeline
**Story:** Story 2 (negative path — gate halts on missing evidence, proving the happy path isn't vacuous)
**Type:** negative-path

**Steps:**
1. Write a second scenario reusing the Task 4-6 scaffolding but with a fake
   script that omits the `Task:` trailer (or skips the declared file write)
   on its commit.
2. Verify test fails (RED) if the pipeline doesn't halt as expected.
3. Assert the pipeline halts (halt marker present) rather than completing.
4. Commit: "test(engine): assert fixture pipeline halts on missing evidence trailer"

**Files:**
- `src/conductor/test/engine/daemon-e2e-fixture.test.ts`

**Wired-into:** none (no new production surface)
**Dependencies:** Task 6

### Task 8: Failure-diagnostics — dump daemon log and pipeline state on failure
**Story:** Story 4 (happy + negative paths — daemon log tail, halt marker reason, missing-log case)
**Type:** infrastructure

**Steps:**
1. Write a small helper `dumpPipelineDiagnostics(worktreeDir)` in
   `daemon-e2e-fixture.test.ts` that reads the daemon log file (tail last
   ~50 lines) and any halt/park marker file contents, printing them via
   `console.error`; if the log file is absent, prints an explicit
   "daemon log not found at <path>" message instead of throwing.
2. Wrap the Task 5-7 pipeline-running tests' bodies in try/catch (or use
   `onTestFailed` from vitest) so `dumpPipelineDiagnostics` runs and prints
   before the test framework reports failure.
3. Manually verify locally (not committed) by temporarily breaking the
   fixture (e.g. removing the declared bullet path) and confirming the
   printed output names the halt reason.
4. Commit: "test(engine): print daemon log and pipeline state on E2E fixture failure"

**Files:**
- `src/conductor/test/engine/daemon-e2e-fixture.test.ts`

**Wired-into:** none (no new production surface)
**Dependencies:** Task 7

### Task 9: Docs — record the new coverage in testing docs and CHANGELOG
**Story:** cross-cutting (repo CLAUDE.md documentation-upkeep rule)
**Type:** infrastructure

**Steps:**
1. Add a short section to `docs/contributing/testing.md` describing
   `test/engine/daemon-e2e-fixture.test.ts`: what it covers (full
   claim-to-finish pipeline via a scripted provider fake), where the fixture
   lives, and that it runs in CI via the existing `conductor` job (no new
   workflow job — `vitest.config.ts`'s exclude patterns don't match this
   file).
2. Add a `## [Unreleased]` entry to `CHANGELOG.md`: "Added a deterministic
   end-to-end daemon smoke test (`test/engine/daemon-e2e-fixture.test.ts`)
   that drives a fixture feature through the real claim-to-finish pipeline
   in CI, catching seam bugs unit tests miss (#630)."
3. Commit: "docs: document the daemon E2E fixture smoke test"

**Files:**
- `docs/contributing/testing.md`
- `CHANGELOG.md`

**Wired-into:** none (documentation only)
**Dependencies:** Task 8

## Task Dependency Graph

```
T0 → Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8 → Task 9
```

Linear chain: each task builds directly on the previous one's scaffolding
within the single new test file.

## Integration Points

- After Task 3: fixture parsing/evidence-harvesting regression coverage is
  complete and independently verifiable without running any pipeline.
- After Task 6: the full happy-path claim-to-finish pipeline run is
  provable end-to-end.
- After Task 9: the feature is fully documented and CI-visible with no
  further wiring needed.

## Verification

- [x] All happy path criteria covered: Story 1 happy path → T0/Task 1; Story 2 happy path → Task 5/6; Story 3 happy path → satisfied by file placement (Technical Approach) + Task 9 doc note; Story 4 happy path → Task 8.
- [x] All negative path criteria covered: Story 1 negative → Task 2/3; Story 2 negative → Task 7; Story 3 negative → satisfied by file placement (no new job needed, so no blanket-exclusion risk); Story 4 negative → Task 8.
- [x] No task exceeds ~5 minutes of work.
- [x] Dependencies are explicit and acyclic (linear chain).
- [x] Every task touching new production-surface files carries `**Wired-into:**` — all tasks here are test/fixture/doc-only, so all carry `none (...)` forms; no production code surface is introduced by this plan.
