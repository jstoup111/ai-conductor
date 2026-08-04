# Implementation Plan: Live-agent daemon E2E smoke tier (#1124)

**Date:** 2026-08-02
**Design:** `.docs/architecture/daemon-e2e-smoke-step-has-no-real-agent-live-llm-t.md`
**Architecture review:** `.docs/decisions/architecture-review-2026-08-02-live-agent-daemon-e2e-tier.md`
**Stories:** `.docs/stories/daemon-e2e-smoke-step-has-no-real-agent-live-llm-t.md`
**Complexity:** `.docs/complexity/daemon-e2e-smoke-step-has-no-real-agent-live-llm-t.md` (Tier M)
**Conflict check:** Clean as of 2026-08-02

## Summary

Add a live-LLM tier over the deterministic daemon E2E fixture that shipped from #630 (PR #1155), in
six tasks. No file under `src/conductor/src/` changes. The work is: widen the existing failure
diagnostics, add a test-local token-metering provider decorator, add a `*.smoke.test.ts` file that
injects a real Claude provider at the seam the deterministic tier already uses, and add one
manually-dispatched workflow with a reusable fail-closed gate mode.

**Deliberately short pipeline.** The task count is bounded on purpose. Nothing this feature builds
can be verified by the build itself: the repository has no provider secrets and the smoke file is
excluded from `npm test`, so every in-build gate signal is structural (the file skips cleanly, the
default suite ignores it, the workflow parses). A long build would buy hours of unverifiable output.
Tasks are therefore scoped to one cohesive deliverable each, with RED/GREEN folded where the
assertion and its implementation are a single small unit. See
`adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate` for the matching decision to ship one
provider leg first.

## Technical Approach

- **Reuse the seam, not the script.** `daemon-e2e-fixture.test.ts:272-282` builds
  `new DefaultStepRunner(fake.provider, …)` and hands it to a real `Conductor` inside `runDaemon`'s
  injected `runFeature` (`:294-326`). The live tier substitutes a real `ClaudeProvider`
  (`src/execution/claude-provider.ts:475`) at that argument. The plugin registry
  (`plugin-loader.ts:140`) is not involved.
- **Assert outcomes, never agent choices**, per
  `adr-2026-08-02-live-tier-asserts-outcomes-not-scripts`: `DONE` present, no `HALT`, no park marker,
  a post-baseline commit whose diff touches the fixture plan's declared
  `test/fixtures/daemon-e2e/touched.txt` and carries a `Task:` trailer. No provider-call count and
  no byte-exact commit body.
- **Two independent cost bounds**: a test-local `LLMProvider` decorator summing
  `InvokeResult.tokenUsage` (`src/execution/llm-provider.ts:168`) for the token cap, and the
  workflow job's `timeout-minutes` for the hang case the token cap cannot observe.
- **Gate with the existing idiom**, not a new one: `describe.skipIf` over binary presence plus
  credential presence plus a kill switch, exactly as `test/engine/build-token-auth.smoke.test.ts:26-40`
  does — #1021 tracks unifying these idioms and this file must not add a tenth variant.
- **Isolation is structural**: the `*.smoke.test.ts` name is what `vitest.config.ts:19` excludes and
  what `test/structural/test-execution-policy.test.ts` keys on to permit a `claude` spawn.
- **One provider leg, parameterized.** The workflow takes the provider as a matrix entry with a
  single `claude` value today. Adding a `codex` leg later is one matrix entry plus one credential
  var, not a restructuring — see the amended ADR for why Codex is deferred rather than dropped.
- **Diagnostics widen in place.** The dump at `daemon-e2e-fixture.test.ts:35-68` gains two additional
  artifacts and is exported from that file for the live tier to import. No separate helper module is
  created; a shared module is worth its own task only once a third caller exists.

## Prerequisites

- Accepted stories, an approved architecture review, both ADRs APPROVED, and a clean conflict check
  are present.
- The deterministic tier (`test/engine/daemon-e2e-fixture.test.ts` and
  `test/fixtures/daemon-e2e/`) exists on `main`. Verified: merged in PR #1155 on 2026-07-29.
- No schema migration, database, port, or fixture installation is required.
- **Not a prerequisite for landing:** the `CLAUDE_CODE_OAUTH_TOKEN` repository secret. Verified
  2026-08-02 that the repository has zero secrets. Every task below is implementable and testable
  without it — Task 3 makes its absence a clean skip and Task 5 makes it a loud failure in gate mode.

## Tasks

### Task 1: Widen the e2e failure diagnostics with task status and evidence

**Story:** ST-1124-3 — a failure is diagnosable from CI output alone.
**Type:** happy-path

**Steps:**
1. Write a failing test that seeds a temp worktree with `.daemon/daemon.log`, `.pipeline/HALT`,
   `.pipeline/task-status.json`, and `.pipeline/task-evidence.json`, calls the diagnostics dump, and
   asserts all four appear in captured `console.error` output.
2. Verify it fails: the dump at `daemon-e2e-fixture.test.ts:35-68` emits neither JSON file and is not
   exported.
3. Add the two dumps, each tolerating absence the way the existing log dump does, and export the
   function so the live tier can import it.
4. Verify the new test passes and all four existing `daemon E2E fixture` cases still pass unchanged.
5. Commit with message: `test: dump task status and evidence on daemon e2e failure`.

**Files:** `src/conductor/test/engine/daemon-e2e-fixture.test.ts`,
`src/conductor/test/engine/daemon-e2e-diagnostics.test.ts`

**Wired-into:** src/conductor/test/engine/daemon-e2e-live.smoke.test.ts#dumpPipelineDiagnostics

**Dependencies:** none

### Task 2: Token-metering provider decorator with cap enforcement

**Story:** ST-1124-2 — the live run's cost is bounded and reported.
**Type:** happy-path

**Steps:**
1. Write failing tests that wrap a stub `LLMProvider` returning known `tokenUsage`, invoke it several
   times through both `invoke` and `invokeInteractive`, and assert the running total equals the sum,
   that an absent `tokenUsage` counts as zero rather than throwing, and that every `InvokeOptions`
   field and the returned `InvokeResult` pass through unmodified.
2. Add a failing test for the cap predicate: a total above the cap reports a breach whose message
   names both the cap and the observed total; a total at the cap does not.
3. Implement the decorator — delegating `invoke`, `invokeInteractive`, `readiness`, and the optional
   self-host members, and preserving `supportsSessionResume` and `lifecycleCapability` so wrapping is
   behaviorally transparent — plus the cap predicate.
4. Verify the tests pass.
5. Commit with message: `test: add a token-metering provider decorator with a cap`.

**Files:** `src/conductor/test/fixtures/token-meter.ts`,
`src/conductor/test/engine/token-meter.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** none

### Task 3: Gate the live smoke file on binary, credential, and the real-exec guard

**Story:** ST-1124-5 — an uncredentialed advisory run skips cleanly.
**Type:** negative-path

**Steps:**
1. Create `test/engine/daemon-e2e-live.smoke.test.ts` with a `describe.skipIf` gate mirroring
   `build-token-auth.smoke.test.ts:26-40`: `claude` resolvable, `CLAUDE_CODE_OAUTH_TOKEN` non-empty,
   and a kill switch honored.
2. Delete `AI_CONDUCTOR_NO_REAL_EXEC` for this file's cases, as
   `test/engine/daemon-tmux-smoke.test.ts:76-77` does, and assert it is unset before any dispatch so
   a reinstated guard fails explicitly instead of surfacing as a provider error.
3. Verify that with no credential in the environment the file skips rather than fails, and that
   `npm test` does not execute it at all.
4. Commit with message: `test: gate the live daemon e2e smoke on binary and credential`.

**Files:** `src/conductor/test/engine/daemon-e2e-live.smoke.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 1, Task 2

### Task 4: Drive the fixture to a terminal finish with the real Claude provider

**Story:** ST-1124-1 — a real agent carries the fixture to a finish.
**Type:** happy-path

**Steps:**
1. Seed a temp repository with `initTestRepo`, copy `test/fixtures/daemon-e2e/`, and write the
   pre-resolved `.pipeline/conduct-state.json` exactly as `daemon-e2e-fixture.test.ts:249-269` does.
2. Construct a real `ClaudeProvider`, wrap it in the Task 2 meter, and pass it to
   `new DefaultStepRunner(...)` and thence to a real `Conductor` inside `runDaemon`'s `runFeature`.
3. Assert `.pipeline/DONE` exists, `.pipeline/HALT` does not, `.daemon/parked/<slug>` does not, and a
   commit beyond the seeded `T0` baseline exists whose diff touches
   `test/fixtures/daemon-e2e/touched.txt` and carries a `Task:` trailer — asserting neither dispatch
   count nor exact commit wording.
4. Assert the metered total against the cap from Task 2, reading it from an env var with a
   documented default, and print the observed total unconditionally so a passing run reports its cost.
5. Add the negative case: with a `HALT` marker pre-written into the seeded worktree, the terminal
   predicate reports failure rather than passing on other artifacts, and no retry is attempted.
6. Wrap the body in the Task 1 diagnostics dump's `try`/`catch` and remove the temp repo in `finally`.
7. Commit with message: `test: drive the daemon e2e fixture with a real claude agent`.

**Files:** `src/conductor/test/engine/daemon-e2e-live.smoke.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 3

### Task 5: Add the dispatch-only workflow with fail-closed gate mode

**Story:** ST-1124-4 — the live tier can never block a merge.
**Type:** happy-path

**Steps:**
1. Add a workflow with `on: workflow_dispatch` and `on: workflow_call` only — no `schedule`, no
   `pull_request` — carrying a `require_credentials` boolean `workflow_call` input defaulting to
   `false`.
2. Define the provider as a matrix with the single value `claude` and `fail-fast: false`, so a second
   leg is an additive entry; install the CLI, run `npm ci` and `npm run build` in `src/conductor`,
   then invoke the live smoke file directly with `npx vitest run`.
3. Set `timeout-minutes` on the job as the wall-clock bound, independent of the token cap.
4. Add the pre-dispatch credential step: when `require_credentials` is true and the secret is empty,
   fail the job naming the missing secret before any provider spawns; when false, emit a job-summary
   line naming whether the leg was credentialed or skipped.
5. Verify the workflow's job name does not appear in `ci.yml`'s `ci-gate` `needs` list, that
   `npm test` still does not execute the live file, and that
   `test/structural/test-execution-policy.test.ts` passes with the new `claude` spawn present in a
   smoke-named file.
6. Commit with message: `ci: add the manually-dispatched live daemon e2e workflow`.

**Files:** `.github/workflows/live-daemon-e2e.yml`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 4

### Task 6: Documentation, changelog, and validation

**Story:** ST-1124-3 — the new tier and its diagnostics are documented.
**Type:** happy-path

**Steps:**
1. Add a row for the new file to the smoke table in `docs/contributing/testing.md:260-269`, naming
   its gate and its direct run command, and add a prose subsection beside the existing
   "Deterministic daemon end-to-end fixture" section explaining what the live tier adds and why its
   assertions differ.
2. Document the credential secret, the token-cap env var and its default, the advisory-versus-gate
   distinction, and that a second provider leg is an additive matrix entry.
3. Add one additive `CHANGELOG.md` `[Unreleased]` bullet.
4. Run `bash test/test_harness_integrity.sh`, `npm run lint`, `npm run typecheck:test`, and
   `npm test` from `src/conductor`, and `lychee` over the docs.
5. Commit with message: `docs: document the live daemon e2e smoke tier`.

**Files:** `docs/contributing/testing.md`, `CHANGELOG.md`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 5

## Task Dependency Graph

```
Task 1 ─┐
        ├──► Task 3 ──► Task 4 ──► Task 5 ──► Task 6
Task 2 ─┘
```

Tasks 1 and 2 are independent and may run in either order; both must complete before Task 3.
Everything from Task 3 onward is strictly sequential.

## Notes

- **No production code changes.** Every file this plan touches is under `src/conductor/test/`,
  `.github/workflows/`, `docs/`, or `CHANGELOG.md`. No `src/conductor/src/` file is modified, so no
  migration block or release waiver applies on the CLI, hook, skill-symlink, or settings-schema
  surfaces.
- **Deferred, not dropped:** a Codex matrix leg. Headless `CODEX_API_KEY` auth has no CI precedent in
  this repo, so proving it would spend build time on the least verifiable part of the feature. Task 5
  keeps the matrix shape so adding it is one entry.
- **Out of scope:** wiring this workflow into `release.yml`. That is #1259's work and depends on the
  changelog/unreleased-issue implementation merging first. Task 5 ships the fail-closed input that
  caller will use.
- **Credential dependency.** Until `CLAUDE_CODE_OAUTH_TOKEN` exists as a repository secret, a
  dispatch skips by design. Task 5's summary line makes that visible rather than silent.
