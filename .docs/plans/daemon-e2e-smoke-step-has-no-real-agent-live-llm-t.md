# Implementation Plan: Live-agent daemon E2E smoke tier (#1124)

**Date:** 2026-08-02
**Design:** `.docs/architecture/daemon-e2e-smoke-step-has-no-real-agent-live-llm-t.md`
**Architecture review:** `.docs/decisions/architecture-review-2026-08-02-live-agent-daemon-e2e-tier.md`
**Stories:** `.docs/stories/daemon-e2e-smoke-step-has-no-real-agent-live-llm-t.md`
**Complexity:** `.docs/complexity/daemon-e2e-smoke-step-has-no-real-agent-live-llm-t.md` (Tier M)
**Conflict check:** Clean as of 2026-08-02

## Summary

Add a live-LLM tier over the deterministic daemon E2E fixture that shipped from #630 (PR #1155),
in thirteen short tasks. No file under `src/conductor/src/` changes. The work is: extract and widen
the shared failure-diagnostics dump, build a test-local token-metering provider decorator, add a
`*.smoke.test.ts` file that injects a real provider at the seam the deterministic tier already uses,
and add one manually-dispatched workflow with a reusable fail-closed gate mode.

## Technical Approach

- **Reuse the seam, not the script.** `daemon-e2e-fixture.test.ts:272-282` builds
  `new DefaultStepRunner(fake.provider, …)` and hands it to a real `Conductor` inside `runDaemon`'s
  injected `runFeature` (`:294-326`). The live tier substitutes a real `ClaudeProvider`
  (`src/execution/claude-provider.ts:475`) or `CodexProvider` (`src/execution/codex-provider.ts:154`)
  at that argument. The plugin registry (`plugin-loader.ts:140`) is not involved.
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
  what `test/structural/test-execution-policy.test.ts` keys on to permit `claude`/`codex` spawns.
- **Trigger shape** per `adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate`:
  `workflow_dispatch` + `workflow_call` with a `require_credentials` input, a two-leg
  `claude`/`codex` matrix, no `schedule`, no `pull_request`, absent from `ci-gate`.

## Prerequisites

- Accepted stories, an approved architecture review, both ADRs APPROVED, and a clean conflict check
  are present.
- The deterministic tier (`test/engine/daemon-e2e-fixture.test.ts` and
  `test/fixtures/daemon-e2e/`) exists on `main`. Verified: merged in PR #1155 on 2026-07-29.
- No schema migration, database, port, or fixture installation is required.
- **Not a prerequisite for landing:** the `CLAUDE_CODE_OAUTH_TOKEN` and `CODEX_API_KEY` repository
  secrets. Verified 2026-08-02 that the repository has zero secrets. Every task below is
  implementable and testable without them — Task 5 makes their absence a clean skip, and Task 11
  makes it a loud failure in gate mode.

## Tasks

### Task 1: RED — the diagnostics dump must include task status and evidence

**Story:** ST-1124-3 — a failure is diagnosable from CI output alone.
**Type:** happy-path

**Steps:**
1. Write a failing test that seeds a temp worktree with `.daemon/daemon.log`, `.pipeline/HALT`,
   `.pipeline/task-status.json`, and `.pipeline/task-evidence.json`, calls the diagnostics dump, and
   asserts every one of the four appears in captured `console.error` output.
2. Verify it fails because no shared helper is importable yet and the inlined version dumps neither
   JSON file.
3. Commit with message: `test: require task status and evidence in the e2e diagnostics dump`.

**Files:** `src/conductor/test/engine/daemon-e2e-diagnostics.test.ts`

**Wired-into:** none (test-only surface)

**Dependencies:** none

### Task 2: GREEN — extract the shared diagnostics helper and widen it

**Story:** ST-1124-3 — both tiers share one diagnostics implementation.
**Type:** happy-path

**Steps:**
1. Move `dumpPipelineDiagnostics` out of `daemon-e2e-fixture.test.ts:35-68` into a shared test
   helper module, preserving its existing daemon-log tail, `HALT`, and park-marker dumps verbatim.
2. Add the two new dumps (`.pipeline/task-status.json`, `.pipeline/task-evidence.json`), each
   tolerating absence the way the existing log dump does.
3. Update `daemon-e2e-fixture.test.ts` to import the helper, deleting the inlined copy so no second
   version exists.
4. Verify Task 1's test passes and all four existing `daemon E2E fixture` cases still pass unchanged.
5. Commit with message: `refactor(test): share the daemon e2e diagnostics dump`.

**Files:** `src/conductor/test/fixtures/daemon-e2e-diagnostics.ts`,
`src/conductor/test/engine/daemon-e2e-fixture.test.ts`,
`src/conductor/test/engine/daemon-e2e-diagnostics.test.ts`

**Wired-into:** `src/conductor/test/engine/daemon-e2e-fixture.test.ts` (the deterministic tier's
`catch` block) and, from Task 6, `src/conductor/test/engine/daemon-e2e-live.smoke.test.ts`

**Dependencies:** Task 1

### Task 3: RED — a metering decorator must accumulate token usage across dispatches

**Story:** ST-1124-2 — a normal run reports its token total under the cap.
**Type:** happy-path

**Steps:**
1. Write a failing test that wraps a stub `LLMProvider` returning known `tokenUsage` values, invokes
   it several times through both `invoke` and `invokeInteractive`, and asserts the decorator's
   running total equals the sum.
2. Assert the decorator forwards every `InvokeOptions` field and returns the underlying
   `InvokeResult` unmodified, so wrapping cannot change pipeline behavior.
3. Verify it fails because the decorator does not exist.
4. Commit with message: `test: require a token-metering provider decorator`.

**Files:** `src/conductor/test/engine/token-meter.test.ts`

**Wired-into:** none (test-only surface)

**Dependencies:** none

### Task 4: GREEN — implement the token-metering decorator

**Story:** ST-1124-2 — a normal run reports its token total under the cap.
**Type:** happy-path

**Steps:**
1. Implement a test-local decorator implementing `LLMProvider`, delegating `invoke`,
   `invokeInteractive`, `readiness`, and the optional self-host members to the wrapped adapter.
2. Accumulate `InvokeResult.tokenUsage` on every returned result, treating an absent
   `tokenUsage` as zero rather than throwing.
3. Preserve `supportsSessionResume` and `lifecycleCapability` from the wrapped provider so the
   decorator is behaviorally transparent.
4. Verify Task 3's tests pass.
5. Commit with message: `test: add a transparent token-metering provider decorator`.

**Files:** `src/conductor/test/fixtures/token-meter.ts`,
`src/conductor/test/engine/token-meter.test.ts`

**Wired-into:** `src/conductor/test/engine/daemon-e2e-live.smoke.test.ts` (from Task 6)

**Dependencies:** Task 3

### Task 5: Gate the live smoke file on binary, credential, and the real-exec guard

**Story:** ST-1124-5 — an uncredentialed advisory dispatch skips cleanly.
**Type:** negative-path

**Steps:**
1. Create `test/engine/daemon-e2e-live.smoke.test.ts` with a `describe.skipIf` gate mirroring
   `build-token-auth.smoke.test.ts:26-40`: provider binary resolvable, credential env var non-empty,
   and a kill switch honored.
2. Delete `AI_CONDUCTOR_NO_REAL_EXEC` for this file's cases, as
   `test/engine/daemon-tmux-smoke.test.ts:76-77` does, and assert it is unset before any dispatch so
   a reinstated guard fails explicitly instead of surfacing as a provider error.
3. Verify that with no credential in the environment the file skips (does not fail), and that
   `npm test` does not execute it at all.
4. Commit with message: `test: gate the live daemon e2e smoke on binary and credential`.

**Files:** `src/conductor/test/engine/daemon-e2e-live.smoke.test.ts`

**Wired-into:** none (test-only surface)

**Dependencies:** Task 2, Task 4

### Task 6: Drive the fixture to a terminal finish with the real Claude provider

**Story:** ST-1124-1 — the pipeline reaches a terminal finish.
**Type:** happy-path

**Steps:**
1. In the live smoke file, seed a temp repository with `initTestRepo`, copy
   `test/fixtures/daemon-e2e/`, and write the pre-resolved `.pipeline/conduct-state.json` exactly as
   `daemon-e2e-fixture.test.ts:249-269` does.
2. Construct a real `ClaudeProvider`, wrap it in the Task 4 meter, and pass it to
   `new DefaultStepRunner(...)` and thence to a real `Conductor` inside `runDaemon`'s `runFeature`.
3. Assert `.pipeline/DONE` exists, `.pipeline/HALT` does not, and `.daemon/parked/<slug>` does not.
4. Assert a commit beyond the seeded `T0` baseline exists whose diff touches
   `test/fixtures/daemon-e2e/touched.txt` and which carries a `Task:` trailer — asserting neither
   dispatch count nor exact commit wording.
5. Wrap the body in the Task 2 diagnostics helper's `try`/`catch` and remove the temp repo in
   `finally`.
6. Commit with message: `test: drive the daemon e2e fixture with a real claude agent`.

**Files:** `src/conductor/test/engine/daemon-e2e-live.smoke.test.ts`

**Wired-into:** none (consumes the existing `runDaemon`/`Conductor` entry points)

**Dependencies:** Task 5

### Task 7: Negative path — a halt or park fails the tier with no retry

**Story:** ST-1124-1 — a halted pipeline fails the tier.
**Type:** negative-path

**Steps:**
1. Add a case that pre-writes a `.pipeline/HALT` marker (or forces a park marker) into the seeded
   worktree before the run.
2. Assert the tier's terminal-state predicate reports failure for that state rather than passing on
   the presence of other artifacts, proving the happy path is not vacuous.
3. Assert no retry path exists — the failure is reported on the first evaluation.
4. Commit with message: `test: fail the live tier on halt or park`.

**Files:** `src/conductor/test/engine/daemon-e2e-live.smoke.test.ts`

**Wired-into:** none (test-only surface)

**Dependencies:** Task 6

### Task 8: Enforce and report the token cap

**Story:** ST-1124-2 — exceeding the token cap fails the run.
**Type:** negative-path

**Steps:**
1. Read the cap from an env var with a documented default, and assert the metered total is at or
   under it after the live run.
2. Print the observed total unconditionally so a passing run still reports its cost.
3. Add a case that drives the cap check with a metered total above the cap and asserts the failure
   message names both the cap and the observed total.
4. Commit with message: `test: bound the live tier with a token cap`.

**Files:** `src/conductor/test/engine/daemon-e2e-live.smoke.test.ts`

**Wired-into:** none (test-only surface)

**Dependencies:** Task 7

### Task 9: Add the Codex leg

**Story:** ST-1124-1 — the pipeline reaches a terminal finish (second provider).
**Type:** happy-path

**Steps:**
1. Parameterize the live run over a provider key so the same body runs for `claude` and `codex`,
   each with its own binary check and its own credential var (`CODEX_API_KEY`).
2. Assert each leg gates independently: with only one credential present, that leg runs and the
   other skips, neither affecting the other's result.
3. Commit with message: `test: add the codex leg to the live daemon e2e tier`.

**Files:** `src/conductor/test/engine/daemon-e2e-live.smoke.test.ts`

**Wired-into:** none (consumes the existing `CodexProvider` adapter)

**Dependencies:** Task 8

### Task 10: Add the manually-dispatched workflow with the provider matrix

**Story:** ST-1124-4 — the workflow is absent from the required gate.
**Type:** happy-path

**Steps:**
1. Add a new workflow file with `on: workflow_dispatch` and `on: workflow_call` only — no
   `schedule`, no `pull_request`.
2. Define a two-leg `claude`/`codex` matrix with `fail-fast: false`, each leg installing its provider
   CLI, running `npm ci` and `npm run build` in `src/conductor`, then invoking the live smoke file
   directly with `npx vitest run`.
3. Set `timeout-minutes` on the job as the wall-clock bound, independent of the token cap.
4. Verify the workflow's job name does not appear in `ci.yml`'s `ci-gate` `needs` list.
5. Commit with message: `ci: add the manually-dispatched live daemon e2e workflow`.

**Files:** `.github/workflows/live-daemon-e2e.yml`

**Wired-into:** none (workflow definition; invoked by `workflow_dispatch` and, later, by a
`workflow_call` caller in #1259)

**Dependencies:** Task 9

### Task 11: Fail-closed gate mode and the credential summary

**Story:** ST-1124-5 — an uncredentialed gating call fails.
**Type:** negative-path

**Steps:**
1. Declare a `require_credentials` boolean `workflow_call` input, default `false`.
2. Add a pre-dispatch step that, when the input is true and the leg's credential secret is empty,
   fails the job naming the missing secret — before any provider is spawned.
3. When the input is false, emit a job-summary line naming which legs were credentialed and which
   skipped, so an advisory dispatch never reads as green-and-covered.
4. Commit with message: `ci: fail closed when a gating live-smoke call has no credential`.

**Files:** `.github/workflows/live-daemon-e2e.yml`

**Wired-into:** none (workflow input surface consumed by a future `workflow_call` caller)

**Dependencies:** Task 10

### Task 12: Prove the live tier cannot block a merge

**Story:** ST-1124-4 — the default suite does not run the live tier.
**Type:** negative-path

**Steps:**
1. Run `npm test` in `src/conductor` and confirm the live file did not execute, and that
   `test/structural/test-execution-policy.test.ts` passes with the new `claude`/`codex` spawns
   present in a smoke-named file.
2. Confirm `vitest.config.ts`'s exclusion globs are unchanged.
3. Commit with message: `test: confirm the live tier stays out of the required suite`.

**Files:** `src/conductor/test/engine/daemon-e2e-live.smoke.test.ts`

**Wired-into:** none (test-only surface)

**Dependencies:** Task 11

### Task 13: Documentation, changelog, and validation

**Story:** ST-1124-3 — shared diagnostics and the new tier are documented.
**Type:** happy-path

**Steps:**
1. Add a row for the new file to the smoke table in `docs/contributing/testing.md:260-269`, naming
   its gate and its direct run command, and add a prose subsection beside the existing
   "Deterministic daemon end-to-end fixture" section explaining what the live tier adds and why its
   assertions differ.
2. Document the two credential secrets, the token-cap env var and its default, and the
   advisory-versus-gate distinction.
3. Add one additive `CHANGELOG.md` `[Unreleased]` bullet.
4. Run `bash test/test_harness_integrity.sh`, `npm run lint`, `npm run typecheck:test`, and
   `npm test` from `src/conductor`, and `lychee` over the docs.
5. Commit with message: `docs: document the live daemon e2e smoke tier`.

**Files:** `docs/contributing/testing.md`, `CHANGELOG.md`

**Wired-into:** none (documentation only)

**Dependencies:** Task 12

## Task Dependency Graph

```
Task 1 ──► Task 2 ─┐
                   ├──► Task 5 ──► Task 6 ──► Task 7 ──► Task 8 ──► Task 9
Task 3 ──► Task 4 ─┘                                                  │
                                                                      ▼
                                          Task 13 ◄── Task 12 ◄── Task 11 ◄── Task 10
```

Tasks 1–2 and 3–4 are independent chains and may proceed in either order; both must complete before
Task 5. Everything from Task 5 onward is strictly sequential.

## Notes

- **No production code changes.** Every file this plan touches is under `src/conductor/test/`,
  `.github/workflows/`, `docs/`, or `CHANGELOG.md`. No `src/conductor/src/` file is modified, so no
  migration block or release waiver applies on the CLI, hook, skill-symlink, or settings-schema
  surfaces.
- **Out of scope:** wiring this workflow into `release.yml`. That is #1259's work and depends on the
  changelog/unreleased-issue implementation merging first. Task 11 ships the fail-closed input that
  caller will use.
- **Credential dependency.** Until `CLAUDE_CODE_OAUTH_TOKEN` and `CODEX_API_KEY` exist as repository
  secrets, a dispatch skips both legs by design. Task 11's summary line makes that visible rather
  than silent.
