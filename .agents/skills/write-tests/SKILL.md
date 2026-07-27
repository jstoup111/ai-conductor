---
name: write-tests
description: "Use whenever adding, changing, reviewing, or debugging tests in the ai-conductor repository. Defines repository-specific test scope, isolation, mocking, fixture, performance, and CI-parity rules that prevent cyclic Conductor runs, leaked workers, real third-party calls, and slow aggregate suites. Complements the provider-neutral tdd skill, which controls implementation order rather than test design."
---

# Write Tests

Design tests for this repository. Use the provider-neutral `tdd` skill separately when implementing behavior test-first.

## 1. Classify the test

Choose the narrowest level that proves the behavior.

- **Unit:** Exercise one function, class, transition, or adapter contract. Inject dependencies and mock every process, network, LLM, GitHub, filesystem boundary not under test.
- **Integration:** Exercise real collaboration between selected internal components. Use real temporary files or local Git only when they are the boundary under test. Fake all third-party services.
- **Acceptance:** Exercise an observable story or gate across the minimum real internal path. Fake third-party boundaries; create only the authoritative artifacts the scenario requires.
- **Smoke:** Exercise a real executable or third-party service. Put it under `src/conductor/test/smoke/` or name it `*.smoke.test.ts`. Smoke tests are excluded from the ordinary suite.

Only explicit smoke tests may call real Claude, Codex, GitHub, package registries, HTTP services, or other third parties.

## 2. Select the seam before writing the fixture

Name the exact behavior and terminal observation first. Test that seam directly.

- Prefer exported pure helpers for selection, classification, ordering, and state calculations.
- For an engine-native boundary, invoke the smallest method that owns the behavior.
- Use `Conductor.run()` only when the test must prove orchestration across multiple steps.
- Never use a full conductor run merely to prove plugin registration, provider invocation, marker contents, configuration resolution, event emission, or one state transition.

If the assertion can be made without completing the full workflow, the test MUST stop at that boundary.

## 3. Bound every Conductor fixture

Before calling `Conductor.run()`, write down:

1. The first step that may run.
2. The exact steps expected to dispatch.
3. The condition that ends the run.
4. Every completion artifact or gate verdict required before that endpoint.

Then enforce these rules:

- Pre-resolve unrelated steps in `conduct-state.json`.
- Use `fromStep` for a targeted transition.
- Use `resume` only when resume selection itself is under test; otherwise test `findResumeIndex` directly.
- Keep `verifyArtifacts: false` for mocked-success unit flows. Mocked runner success is their authority.
- With `verifyArtifacts: true`, create fresh, valid evidence for every participating gate. Status `done` alone is not evidence.
- In auto mode, account for the whole validation group: `manual_test`, `prd_audit`, and `architecture_review_as_built`. Either supply valid evidence for every applicable member or configure a real skip condition.
- At the finish boundary, ensure validator evidence is current for the session and HEAD. Never reuse a stale marker accidentally.
- For a dispatch-time observation, terminate immediately after the observation with an injected, expected sentinel failure and await the conductor's cleanup. Do not let the run continue into unrelated gates.

Never rely on Vitest's timeout to stop a conductor. A timed-out test does not cancel its async work; the orphan can keep rewriting temporary state and contaminate hundreds of later tests.

## 4. Mock external boundaries through dependency injection

Mock the adapter, not internal domain behavior.

- Inject `StepRunner`, `LLMProvider`, Git/GitHub runners, clocks, sleeps, process launchers, and verifier interfaces.
- Assert calls and returned domain results at the injected boundary.
- Do not spawn `claude`, `codex`, `gh`, `curl`, `wget`, `npm install`, `npm ci`, or `bin/setup` in ordinary tests.
- Do not hide a real external call behind a variable, wrapper, shell string, or dynamically assembled argv.
- Acceptance and integration tests should use the real internal implementation up to the third-party adapter, then use a deterministic fake.

Use real local Git repositories only for behavior that depends on Git semantics. Pin the initial branch, configure local identity, avoid remotes unless the remote itself is the subject, and clean up the exact `mkdtemp` directory.

## 5. Keep time deterministic

- Inject clocks and sleep functions.
- Use fake timers only when the timer behavior is the subject.
- Never add real waits to make a race pass.
- Never raise a timeout to accommodate a unit or ordinary integration test.
- Prefer unit tests under 100 ms and ordinary test files under 2 seconds.
- A real-local-Git integration may take longer, but must remain bounded and should usually finish under 10 seconds.

A 20-second timeout is a defect signal, not a performance budget.

## 6. Keep cleanup trustworthy

- Create isolated state with `mkdtemp`.
- Await every started promise before `afterEach` removes its directory.
- Stop watchers, timers, subprocesses, event listeners, and abort controllers in `finally` paths.
- Never let cleanup race a still-running conductor.
- Treat `ENOTEMPTY` after a timeout as evidence of unfinished async work. Find the live loop or worker; do not add retrying cleanup.

## 7. Avoid false integration tests

Remove or rewrite a test when it:

- retrieves a provider but never injects it into the system under test;
- runs the whole conductor with an all-success runner only to assert one call;
- asserts `feature_status: complete` without creating the gate evidence required by the current architecture;
- duplicates a pure registry, policy, or helper assertion through a full workflow;
- invokes the repository's aggregate test command from inside Vitest;
- passes alone but fails in a group because it leaks module mocks, process state, listeners, workers, or files.

An integration label does not justify a broad path. Preserve the real boundary and delete the ceremony.

## 8. Verify with CI parity

During authoring, run the project's narrowest test invocation for the file under work, then the
project's configured static checks: its typecheck command and, where one is configured, its lint
command. Each project supplies its own concrete commands; this repository documents them in
`docs/contributing/testing.md`.

The typecheck command MUST be one that covers test files. Many projects' default typecheck target
excludes the test directory, and many test runners transpile without type-checking — together those
mean a test can carry a type error indefinitely, pass every run, and surface only when someone edits
nearby code. If the project's default typecheck skips tests, use the target that includes them.

A green test run is not evidence that the test compiles. Verify both.

Before handoff, run the project's configured aggregate test command — the one CI runs, declared in
`test_suite.command`. Do not substitute a raw, broad test-runner invocation for the configured
aggregate operation in CI or completion evidence.

The ordinary suite must finish in under five minutes. The expected healthy range is roughly two to three minutes. If it exceeds five minutes, inspect active workers and recent temporary fixture state; do not wait indefinitely.

## 9. Diagnose a slow or wedged suite

1. Stop only the exact local test-runner workers started by the current diagnostic run.
2. Re-run the last reported file or test name in isolation with a concise reporter.
3. If it times out, inspect its live temporary `conduct-state.json` and `.pipeline/phase-active` before cleanup.
4. Look for repeated `stale` validator states, unchanged gate evidence, or a mocked-success runner traversing an artifact-driven finish fence.
5. Fix the inconsistent authority or fixture boundary.
6. Run the formerly failing files together; isolation-only success is insufficient.
7. Run the project's aggregate test command once from a clean process set.

## Completion checklist

- The test proves one named behavior at the narrowest credible level.
- No ordinary test can reach a real LLM or third-party service.
- Every async operation has an awaited terminal path.
- Conductor fixtures declare and satisfy only their required gates.
- The test passes both alone and with affected neighboring files.
- The project's typecheck command passes, AND it is one that covers test files — not a target that
  excludes the test directory.
- The project's lint command passes, where one is configured.
- CI and local aggregate execution use the project's configured aggregate test command.
- The aggregate suite completes under five minutes.
