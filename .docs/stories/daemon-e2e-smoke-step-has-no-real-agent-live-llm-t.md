**Status:** Accepted

# Live-agent daemon E2E smoke tier (#1124)

Track: technical (no PRD — acceptance criteria live here)
Tier: M

## Context

The deterministic daemon E2E tier shipped from #630 (PR #1155,
`src/conductor/test/engine/daemon-e2e-fixture.test.ts`) drives a committed fixture feature through
the real `runDaemon` loop and a real `Conductor`, with a scripted `LLMProvider` fake
(`createFixtureAgentFake`) as the only external boundary. That fake makes real git commits with real
`Task:` trailers, so it proves the dispatch, evidence, completion-gate, and finish wiring.

What it cannot prove is how the pipeline behaves against output a *real* agent produces. Several of
the incidents that motivated #630 were exactly that class: `## Task Graph` parsed as a phantom task
(#620), `### T0 —` read as an empty plan (#578/#615), prose backtick tokens harvested as required
corroboration paths (#548). A script never writes a surprising heading, so the deterministic tier is
structurally blind to them.

This feature adds a second tier that swaps only the injected provider for a real `claude` subprocess,
at the same constructor seam (`daemon-e2e-fixture.test.ts:272-282`). No production code changes.

Verified 2026-08-02: the repository has zero Actions secrets and no workflow using `schedule`,
`cron`, or `workflow_dispatch`. The provider credential must be provisioned before the tier produces
signal.

**Scope note.** A second (Codex) provider leg is deliberately deferred, not dropped. Headless
`CODEX_API_KEY` auth has no CI precedent in this repository, so proving it would spend the most build
time on the least verifiable part of the feature. The workflow keeps a provider matrix shape so
adding that leg later is one entry plus one credential var. Recorded in
`adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate`.

---

## Story ST-1124-1: A real agent carries the fixture to a finish

**As** a maintainer, **I want** the committed daemon E2E fixture driven end to end by a real provider
subprocess, **so that** regressions specific to real-agent output shapes have a signal that the
scripted tier cannot produce.

### Scenario: the pipeline reaches a terminal finish (happy path)

- **Given** a temp git repository seeded with `test/fixtures/daemon-e2e/` and a
  `.pipeline/conduct-state.json` whose pre-build steps are resolved
- **And** a real `ClaudeProvider` injected at the `DefaultStepRunner` constructor seam in place of
  the scripted fake
- **When** the smoke test runs `runDaemon` with the fixture as its only backlog item
- **Then** `.pipeline/DONE` exists
- **And** `.pipeline/HALT` does not exist and `.daemon/parked/<slug>` does not exist
- **And** at least one commit beyond the seeded `T0` baseline exists whose diff touches
  `test/fixtures/daemon-e2e/touched.txt` — the path the fixture plan declares — and which carries a
  `Task:` trailer

### Scenario: the agent's free choices are not asserted (negative path)

- **Given** a completed live run whose commit subject differs from the deterministic tier's
  `test: complete fixture task` and which took a different number of provider dispatches
- **When** the assertions are evaluated
- **Then** the test still passes, because dispatch count and commit wording are properties of the
  agent, not the pipeline
- **And** no assertion in the live file references an exact provider call count or a byte-exact
  commit body

### Scenario: a halted pipeline fails the tier (negative path)

- **Given** a live run in which the pipeline writes `.pipeline/HALT` or a park marker instead of
  `DONE`
- **When** the test evaluates its terminal-state assertions
- **Then** the test fails
- **And** no retry is attempted, because a non-finish here is the signal the tier exists to report

---

## Story ST-1124-2: The live run's cost is bounded by two independent mechanisms

**As** a maintainer, **I want** a hard, predictable ceiling on what one live run can spend, **so
that** an unexpectedly chatty or hung run cannot burn tokens or runner minutes without limit.

### Scenario: a normal run reports its token total under the cap (happy path)

- **Given** a token-metering decorator wrapping the real provider that accumulates
  `InvokeResult.tokenUsage` across every `invoke` and `invokeInteractive`
- **When** a live run completes
- **Then** the summed token total is asserted at or under the configured cap
- **And** the total is printed so a maintainer can see the run's actual cost, not only that it
  passed

### Scenario: exceeding the token cap fails the run (negative path)

- **Given** a live run whose accumulated token usage crosses the configured cap
- **When** the cap is evaluated
- **Then** the test fails with a message naming the cap and the observed total

### Scenario: a hung provider is bounded by wall clock (negative path)

- **Given** a provider subprocess that never returns, so no `tokenUsage` is ever accumulated
- **When** the job's `timeout-minutes` elapses
- **Then** the workflow job terminates
- **And** the wall-clock bound is asserted to be independent of the token cap — neither mechanism is
  the other's fallback

---

## Story ST-1124-3: A failure is diagnosable from CI output alone

**As** a maintainer reading a failed run in GitHub Actions, **I want** the daemon log and pipeline
state printed, **so that** I can identify the failing seam without reproducing the run locally.

### Scenario: a failed live run dumps the pipeline's state (negative path)

- **Given** a live run that fails any assertion
- **When** the failure handler runs
- **Then** the tail of `.daemon/daemon.log` is printed
- **And** the contents of `.pipeline/HALT` and of any `.daemon/parked/<slug>` marker are printed
  when present
- **And** the contents of `.pipeline/task-status.json` and `.pipeline/task-evidence.json` are
  printed when present, so an evidence-corroboration failure is distinguishable from a dispatch
  failure

### Scenario: both tiers share one diagnostics implementation (happy path)

- **Given** the diagnostics dump currently inlined at `daemon-e2e-fixture.test.ts:35-68`
- **When** the live tier is added
- **Then** that dump is widened in place and exported, and the live tier imports it
- **And** no second, divergent copy of the dump exists in the repository
- **And** the deterministic tier's four existing cases still pass unchanged

---

## Story ST-1124-4: The live tier can never block a merge

**As** a contributor, **I want** the live tier structurally excluded from the required per-PR path,
**so that** a real-agent flake cannot block an unrelated pull request.

### Scenario: the default suite does not run the live tier (happy path)

- **Given** the live test file is named `*.smoke.test.ts`
- **When** `npm test` runs in `src/conductor`
- **Then** the file is excluded by the existing `vitest.config.ts` exclude glob and does not execute
- **And** `test/structural/test-execution-policy.test.ts` still passes, since the live file is a
  smoke file and is therefore permitted to spawn `claude`

### Scenario: the workflow is absent from the required gate (negative path)

- **Given** the new workflow file
- **When** its triggers and `ci.yml`'s `ci-gate` job are inspected
- **Then** the workflow declares no `pull_request` trigger
- **And** the workflow's job name does not appear in `ci-gate`'s `needs` list, so no result of it can
  fail the gate

---

## Story ST-1124-5: Missing credentials skip when advisory and fail when gating

**As** an operator, **I want** an uncredentialed dispatch to skip honestly and a gating caller to
fail loudly, **so that** a release can never pass because its smoke tier quietly did nothing.

### Scenario: an uncredentialed advisory dispatch skips cleanly (happy path)

- **Given** a matrix leg whose credential secret is unset or whose provider CLI is absent
- **And** the run is in advisory mode (`workflow_dispatch`, or `workflow_call` with
  `require_credentials` false)
- **When** the smoke file evaluates its gate
- **Then** that leg skips rather than fails, following the `describe.skipIf` idiom already used by
  `test/engine/build-token-auth.smoke.test.ts:36-40`
- **And** the job summary names which legs were credentialed and which were skipped

### Scenario: an uncredentialed gating call fails (negative path)

- **Given** the same missing credential
- **And** a `workflow_call` invocation with `require_credentials` set true
- **When** the credential check runs
- **Then** the job fails before any provider dispatch, naming the missing secret

### Scenario: the matrix stays open to a second provider leg (negative path)

- **Given** the workflow declares its provider as a matrix with a single `claude` value and
  `fail-fast: false`
- **When** a second provider leg is added later
- **Then** it is one matrix entry plus one credential variable, requiring no restructuring of the job
- **And** a leg whose credential is absent skips independently, without affecting any other leg's
  result

### Scenario: the global real-exec guard is cleared for the live file (negative path)

- **Given** `test/setup.ts` sets `AI_CONDUCTOR_NO_REAL_EXEC=1` for every test in the suite
- **When** the live smoke file runs
- **Then** the file clears that variable for its own cases, as
  `test/engine/daemon-tmux-smoke.test.ts` already does
- **And** the file asserts the variable is unset before dispatching, so a reinstated guard surfaces
  as an explicit failure rather than a misleading provider error
