# Implementation Plan: Measured feature active duration always reaches OTEL

**Date:** 2026-10-26
**Design:** [architecture review](../decisions/architecture-review-2026-10-26-feature-active-duration-is-dropped-from-otel-whene.md) (technical track, no PRD)
**Stories:** .docs/stories/feature-active-duration-is-dropped-from-otel-whene.md
**Conflict check:** Clean as of 2026-10-26

## Summary

This plan makes every measured feature active duration reach `conductor.feature.duration.active`
and counts every unmeasured one, then removes the two causes that made every recent ship partial:
pre-spawn provider failures recorded as invoked, and retired `coverage_binding` step identities.
It also gives the remediation-closure judgement the native-schema scratch home it lacks. Eleven tasks.

## Technical Approach

- **Event field.** `feature_shipped.active` in `src/conductor/src/types/events.ts` gains optional
  `reason?: TimingReasonClass`, a closed union `empty-active-union | active-evidence-incomplete |
  open-executions | provider-outside-active-union | provider-evidence-incomplete |
  ledger-unreadable`. `emitShipped` in `src/conductor/src/engine/daemon-runner.ts` maps the
  rollup's reason to its class (`open-executions:<keys>` collapses to `open-executions`) and derives
  `ledger-unreadable` only when the rollup is `partial` with no reason. `timing-rollup.ts` output and
  shipped records are unchanged for that case (conflict-check resolution 1).
- **Metrics.** The listener's `feature_shipped` handler in `src/conductor/src/engine/otel/metrics-listener.ts`
  passes `activeMs`, `state`, and `reason` to `MetricsRecorder.onFeatureDuration` regardless of
  state. In `src/conductor/src/engine/otel/metrics.ts` the recorder records a finite `activeMs` on
  `conductor.feature.duration.active` with `state` and, when present, `reason`; otherwise it adds 1
  to a new counter `conductor.feature.duration.active.missing` with the same attributes. Both carry
  `tier` when defined. Only the existing label names `state` and `reason` are added (review C1);
  `activeMs` is never synthesized (C2).
- **Retired steps.** `src/conductor/src/engine/config.ts` exports `isRetiredBuiltInStep(name)` over
  its existing `RETIRED_BUILT_IN_STEPS` map. `executionKey` in `timing-rollup.ts` resolves a
  lifecycle-step context whose step is retired with the same `resolveExecutionIdentity` key shape it
  uses for known steps; `isStepName` and `resolveExecutionIdentity` are unchanged (C3).
- **Not invoked.** `buildProviderAttemptMetadata` in `src/conductor/src/engine/provider-execution.ts`
  computes `invoked` as `providerInvocationSkipped !== true && executionDisposition !== 'not-started'`.
  `providerInvocationSkipped` and the unavailable, cached-unavailable, and suppression routing are
  untouched (C4). The engine's scratch-home acquisition failure (before invoke) stamps
  `executionDisposition: 'not-started'`; a teardown failure after invoke keeps the invocation's
  `observedIntervals` beside its token usage.
- **Adapters.** Each return in the closed pre-spawn set of `invoke()` in `claude-provider.ts`,
  `codex-provider.ts`, and `pi-provider.ts` under `src/conductor/src/execution/` adds
  `executionDisposition: 'not-started'`, matching Codex's existing `readinessFailure`. The set is the
  one Story 3 defines; Tasks 6 to 8 enumerate each adapter's sites. The shared
  `abortedInvocationResult()` helpers are also used after spawn, so the stamp is applied at the
  pre-spawn call sites only. Existing `providerUnavailable`, `commandUnresolved`, and
  `nativeSchemaUnsupported` fields are kept.
- **Closure judgement.** The remediation-closure judgement dispatch in
  `src/conductor/src/engine/step-runners.ts` passes `nativeSchemaScratch` with the feature worktree
  as `worktreeRoot` and `repository` and the feature slug, exactly as the other native-schema
  auxiliary dispatches in that file do.

## Prerequisites

- None. ADR-014 Decision 9 and the two on-main stories were amended in this spec's first commit.

## Tasks

### Task 1: Carry the bounded timing reason on `feature_shipped`
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-runner.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement: add the closed `TimingReasonClass` union and optional `active.reason` to `feature_shipped` in `types/events.ts`; in `emitShipped` map the rollup reason to its class, collapse `open-executions:<keys>` to `open-executions`, and use `ledger-unreadable` when the rollup is `partial` with no reason. `measured` and `unavailable` rollups carry no reason.
4. Verify GREEN.
5. Commit: "feat(timing): carry the bounded partial reason on feature_shipped".

**Done when:**
- [test] A daemon-runner ship test asserts `emitShipped` emits `feature_shipped` whose `active` is state `partial`, the rollup's active total, and reason `provider-evidence-incomplete` for a provider-evidence-incomplete rollup.
- [test] The same test asserts the emitted reason for each of `empty-active-union`, `active-evidence-incomplete`, `provider-outside-active-union`, and `open-executions`, and that a rollup reason of `open-executions:step:build,parallel:wiring_check` is emitted as exactly `open-executions` with no execution key.
- [test] A ship test whose worktree `events.jsonl` holds a non-JSON line asserts `feature_shipped.active` is state `partial`, reason `ledger-unreadable`, and has no `activeMs`, while `computeTimingRollup` for that worktree still returns `{ state: 'partial' }` with no reason.
- [test] A ship test with a measured rollup asserts `feature_shipped.active` carries state `exact` and the active total and has no `reason` key.
- [test] A shipped-record test asserts `appendTimingSection` renders the unreadable-ledger worktree's rollup as a `## Time` block byte-identical to today's reason-free `state: partial` block, with no reason line.

**Files likely touched:**
- src/conductor/src/types/events.ts — `TimingReasonClass`, optional `active.reason`
- src/conductor/src/engine/daemon-runner.ts — `emitShipped` reason mapping
- src/conductor/test/engine/daemon-runner.test.ts — ship tests
- src/conductor/test/engine/shipped-record.test.ts — unchanged Time block regression

**Dependencies:** none

### Task 2: Record measured active duration with state and reason, and count unmeasured ships
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/otel/metrics-listener.test.ts` and `src/conductor/test/engine/otel/metrics.test.ts` for every Done-when check below, driving `feature_shipped` events through the `MetricsListener` handler.
2. Verify RED.
3. Implement: `onFeatureDuration(wallMs, active, tier)` records a finite `active.activeMs` on `conductor.feature.duration.active` with `state` and, when defined, `reason`; otherwise adds 1 to a new `conductor.feature.duration.active.missing` counter registered in the existing instrument factory with the same attributes. The listener passes the event's `active` object unchanged.
4. Verify GREEN.
5. Commit: "feat(otel): record measured active duration on partial rollups and count missing ones".

**Done when:**
- [test] A listener test asserts an exact `feature_shipped` with tier M and activeMs 5000 records one `conductor.feature.duration.active` point of 5000 with attributes tier M and state exact and no reason, and no `conductor.feature.duration.active.missing` increment.
- [test] A listener test asserts a partial `feature_shipped` with activeMs 23907699 and reason provider-evidence-incomplete records one active point of 23907699 with state partial and that reason, and no missing increment.
- [test] A listener test asserts partial without activeMs (reason active-evidence-incomplete), unavailable, and a non-finite activeMs each record no active point and exactly one missing increment carrying tier M, the event's state, the event's reason when present (asserted for `active-evidence-incomplete`, `open-executions`, and `ledger-unreadable`) and no reason attribute when absent, while `conductor.feature.duration.wall` is still recorded for the event with `runStartedAt`.
- [test] A listener test replays a reason-free legacy partial `feature_shipped` with an activeMs and asserts one active point with state partial and no reason attribute or placeholder value.
- [test] A recorder test asserts the instrument `conductor.feature.duration.active.missing` exists and every data point on it and on `conductor.feature.duration.active` carries only label names from `project`, `worker`, `feature`, `tier`, `state`, `reason`, and the configured static attributes.

**Files likely touched:**
- src/conductor/src/engine/otel/metrics.ts — counter instrument, `onFeatureDuration`
- src/conductor/src/engine/otel/metrics-listener.ts — `feature_shipped` handler
- src/conductor/test/engine/otel/metrics-listener.test.ts — listener tests
- src/conductor/test/engine/otel/metrics.test.ts — recorder tests

**Dependencies:** Task 1

### Task 3: Resolve retired built-in step identities in the timing rollup
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/timing-rollup.test.ts` and `src/conductor/test/engine/execution-identity.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement: export `isRetiredBuiltInStep(name)` from `config.ts` over `RETIRED_BUILT_IN_STEPS`; in `timing-rollup.ts` `executionKey`, when `resolveExecutionIdentity` returns undefined for a lifecycle-step context whose step equals the event's step and is retired, resolve the key with the event's execution id and step in the same correlated shape. Leave `isStepName` and `resolveExecutionIdentity` unchanged.
4. Verify GREEN.
5. Commit: "fix(timing): resolve retired coverage_binding identities in the rollup".

**Done when:**
- [test] A rollup test over a ledger whose every start has an interval-bearing terminal, including a correlated `coverage_binding` step_started/step_completed pair, asserts `computeTimingRollup` returns state measured with an active total that includes the coverage_binding interval, and the same ledger with context-free coverage_binding events also returns measured.
- [test] A rollup test asserts a correlated `coverage_binding` step_started with no terminal yields state partial with reason starting `open-executions`.
- [test] A rollup test asserts a correlated start/terminal pair naming `not_a_real_step` yields state partial with reason `active-evidence-incomplete`.
- [test] An execution-identity test asserts `isStepName('coverage_binding')` is false and `resolveExecutionIdentity` returns undefined for a `coverage_binding` lifecycle-step context.

**Files likely touched:**
- src/conductor/src/engine/config.ts — export `isRetiredBuiltInStep`
- src/conductor/src/engine/timing-rollup.ts — retired identity resolution in `executionKey`
- src/conductor/test/engine/timing-rollup.test.ts — rollup tests
- src/conductor/test/engine/execution-identity.test.ts — guard regression

**Dependencies:** none

### Task 4: Record a not-started attempt as not invoked
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/provider-execution.test.ts` and `src/conductor/test/engine/timing-rollup.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement: in `buildProviderAttemptMetadata`, `invoked` is false when `result.executionDisposition === 'not-started'` as well as when `providerInvocationSkipped` is true; change nothing else in availability, cached-unavailable, or suppression handling.
4. Verify GREEN.
5. Commit: "fix(provider): record a not-started attempt as not invoked".

**Done when:**
- [test] A provider-execution test with a fake runtime returning `{ success: false, executionDisposition: 'not-started' }` asserts the emitted `provider_attempt` has `invoked: false`, outcome failure, and the result's failure text as its reason.
- [test] A provider-execution test with a fake runtime that reports a spawned failure with one observed interval asserts `invoked: true` and the interval on the attempt, and one returning a post-spawn aborted result with token usage and no `executionDisposition` asserts the attempt has `invoked: true`.
- [test] A provider-execution test asserts that after a not-started failure the provider is neither recorded cached-unavailable nor suppressed, and the next dispatch to it invokes the runtime.
- [test] A rollup test asserts a ledger whose only provider anomaly is an `invoked: false` failure attempt with no intervals returns state measured, and one whose invoked attempt carries no interval returns partial with reason `provider-evidence-incomplete`.

**Files likely touched:**
- src/conductor/src/engine/provider-execution.ts — `invoked` derivation
- src/conductor/test/engine/provider-execution.test.ts — attempt tests
- src/conductor/test/engine/timing-rollup.test.ts — rollup tests

**Dependencies:** none

### Task 5: Mark scratch-home acquisition failure not started and keep intervals on teardown failure
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/provider-execution.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement: in `executeProviderCandidates`, when `nativeSchemaScratchFailure` comes from acquisition before invoke, the synthesized failure result carries `executionDisposition: 'not-started'`; when it comes from teardown after invoke, the result keeps the invocation's `observedIntervals` alongside its token usage.
4. Verify GREEN.
5. Commit: "fix(provider): classify native-schema scratch failures by whether the provider ran".

**Done when:**
- [test] A provider-execution test whose scratch-home acquisition throws asserts the runtime's invoke is never called and the emitted `provider_attempt` has `invoked: false` with the scratch-home failure reason.
- [test] A provider-execution test whose scratch-home teardown fails after the runtime returned one observed interval and token usage asserts the attempt has `invoked: true`, that interval, and that token usage.

**Files likely touched:**
- src/conductor/src/engine/provider-execution.ts — scratch failure results
- src/conductor/test/engine/provider-execution.test.ts — scratch tests

**Dependencies:** Task 4

### Task 6: Codex stamps not-started on every pre-spawn return
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/codex-provider.test.ts` and `src/conductor/test/execution/codex-provider-abort.test.ts` for every Done-when check below, mocking the subprocess boundary and asserting the mock is reached by a passing dispatch before exercising failures.
2. Verify RED.
3. Implement: in `CodexProvider.invoke`, add `executionDisposition: 'not-started'` at the call sites of the closed pre-spawn set: the abort check before the git guard (spread over `abortedInvocationResult()` at that call site only, never inside the shared helper), the git-guard failure, and the native-schema setup failure. `readinessFailure` already stamps it. Post-spawn abort returns stay unstamped.
4. Verify GREEN.
5. Commit: "fix(codex): mark pre-spawn failures not started".

**Done when:**
- [test] A Codex adapter test with a native schema and no scratch home asserts `invoke` returns failure with `executionDisposition: 'not-started'` and an output naming native schema setup, and the mocked subprocess spawn is never called.
- [test] Codex adapter tests whose git guard throws, and whose abort signal is already aborted at entry, each assert `executionDisposition: 'not-started'` and no spawn call.
- [test] A Codex abort test whose signal fires after the mocked subprocess starts asserts the result carries no `executionDisposition`, keeps its streamed token usage, and is recorded by `buildProviderAttemptMetadata` as a `provider_attempt` with `invoked: true`, and a spawned non-zero exit likewise carries no `executionDisposition`.

**Files likely touched:**
- src/conductor/src/execution/codex-provider.ts — pre-spawn returns
- src/conductor/test/execution/codex-provider.test.ts — adapter tests
- src/conductor/test/execution/codex-provider-abort.test.ts — abort tests

**Dependencies:** none

### Task 7: Claude stamps not-started on every pre-spawn return
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/claude-provider.test.ts` for every Done-when check below, mocking the subprocess boundary as in Task 6.
2. Verify RED.
3. Implement: in `ClaudeProvider.invoke`, add `executionDisposition: 'not-started'` to the closed pre-spawn set: the abort check at entry (at that call site only), the git-guard failure, and the interactive native-schema refusal, which keeps `nativeSchemaUnsupported: true`.
4. Verify GREEN.
5. Commit: "fix(claude): mark pre-spawn failures not started".

**Done when:**
- [test] Claude adapter tests whose git guard throws, and whose abort signal is already aborted at entry, each assert `invoke` returns failure with `executionDisposition: 'not-started'` and the mocked subprocess spawn is never called.
- [test] A Claude adapter test for an interactive dispatch carrying a native schema asserts `executionDisposition: 'not-started'`, `nativeSchemaUnsupported: true`, and no spawn call.
- [test] A Claude adapter test whose spawned subprocess exits non-zero asserts the result carries no `executionDisposition`.

**Files likely touched:**
- src/conductor/src/execution/claude-provider.ts — pre-spawn returns
- src/conductor/test/execution/claude-provider.test.ts — adapter tests

**Dependencies:** none

### Task 8: Pi stamps not-started on every pre-spawn return
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-provider.test.ts` and `src/conductor/test/execution/pi-provider-git-guard.test.ts` for every Done-when check below, mocking the subprocess boundary as in Task 6.
2. Verify RED.
3. Implement: in `PiProvider.invoke`, add `executionDisposition: 'not-started'` to the closed pre-spawn set: both abort checks before spawn (at those call sites only, never inside the shared helper), the git-guard failure, the missing `HARNESS.md` refusal, the unresolved skill command, the native-schema setup failure, and the missing subagents package refusal. Existing `providerUnavailable` and `commandUnresolved` fields are kept unchanged.
4. Verify GREEN.
5. Commit: "fix(pi): mark pre-spawn failures not started".

**Done when:**
- [test] Pi adapter tests whose native-schema setup throws, whose git guard throws, and whose abort signal is already aborted at entry each assert `invoke` returns failure with `executionDisposition: 'not-started'` and the mocked subprocess spawn is never called.
- [test] Pi adapter tests for a missing `HARNESS.md` and for an enabled but uninstalled subagents package each assert `executionDisposition: 'not-started'`, `providerUnavailable: true` with its existing reason, and no spawn call.
- [test] A Pi adapter test whose prompt names an unknown skill asserts `executionDisposition: 'not-started'`, `commandUnresolved: true` with the skill name, and no spawn call.
- [test] A Pi adapter test whose abort signal fires during asynchronous preflight, after the entry abort check and before spawn, asserts `executionDisposition: 'not-started'` and no spawn call.
- [test] Pi adapter tests whose spawned subprocess exits non-zero, and whose abort signal fires after the mocked subprocess starts, each assert the result carries no `executionDisposition`, and the post-spawn abort keeps its token usage and is recorded by `buildProviderAttemptMetadata` as a `provider_attempt` with `invoked: true`.

**Files likely touched:**
- src/conductor/src/execution/pi-provider.ts — pre-spawn returns
- src/conductor/test/execution/pi-provider.test.ts — adapter tests
- src/conductor/test/execution/pi-provider-git-guard.test.ts — git-guard test

**Dependencies:** none

### Task 9: A CI-fix session whose provider fails before spawn is classified not-started
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/ci-fix.test.ts` for the Done-when check below, wiring the real Claude adapter with its git guard forced to throw and its subprocess boundary mocked.
2. Verify RED.
3. Implement: no production change beyond Task 7 is expected; if the CI-fix session path drops the adapter's `executionDisposition`, carry it through to the outcome classifier.
4. Verify GREEN.
5. Commit: "test(ci-fix): classify a pre-spawn provider failure as not-started".

**Done when:**
- [test] A CI-fix session test asserts a repair session whose Claude dispatch fails git-guard setup returns outcome kind `not-started`, not `failed`, and the mocked subprocess spawn is never called.
- [test] The same test asserts the `provider_attempt` recorded for that dispatch has `invoked: false`.

**Files likely touched:**
- src/conductor/test/engine/ci-fix.test.ts — session classification test
- src/conductor/src/engine/step-runners.ts — only if the disposition is dropped

**Dependencies:** Tasks 4, 7

### Task 10: The remediation-closure judgement supplies a native-schema scratch home
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/step-runners-remediation-closure.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement: pass `nativeSchemaScratch: { worktreeRoot: this.projectDir, repository: this.projectDir, featureSlug: this.featureDesc || basename(this.projectDir) }` to the closure judgement's `executeAuxiliaryProviderCandidates` call, mirroring the other native-schema auxiliary dispatches in `step-runners.ts`.
4. Verify GREEN.
5. Commit: "fix(remediation-closure): give the judgement its native-schema scratch home".

**Done when:**
- [test] A step-runner test asserts the closure-judgement dispatch passes `nativeSchemaScratch` whose `worktreeRoot` and `repository` are the feature worktree.
- [test] A step-runner test with a Codex-routed closure judgement in a non-self-host run asserts the Codex invocation receives a `nativeSchemaScratchHome` under the feature worktree, the runtime is invoked, and the recorded `provider_attempt` has `invoked: true` with one observed interval.
- [test] A step-runner test in a self-host run asserts the closure judgement receives no engine scratch home and its Codex invocation uses the self-host `CODEX_HOME`.
- [test] A step-runner test runs two closure judgements for two feature worktrees concurrently and asserts their scratch homes are distinct paths, each under its own worktree, and each Codex invocation's native-schema file path lies inside its own scratch home and not the other's.

**Files likely touched:**
- src/conductor/src/engine/step-runners.ts — closure dispatch input
- src/conductor/test/engine/step-runners-remediation-closure.test.ts — dispatch tests

**Dependencies:** none

### Task 11: A closure judgement whose scratch home fails ends unjudged without starting a provider
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/step-runners-remediation-closure.test.ts` for the Done-when check below.
2. Verify RED.
3. Implement: no production change beyond Tasks 5 and 10 is expected; the existing two-attempt retry handles the not-started results.
4. Verify GREEN.
5. Commit: "test(remediation-closure): scratch failure ends unjudged without a provider start".

**Done when:**
- [test] A step-runner test whose scratch-home acquisition throws on both attempts asserts the judgement is attempted twice, the runtime's invoke is never called, every `provider_attempt` it records has `invoked: false`, and the closure event records outcome `unjudged` with every candidate unjudged.
- [test] The same test asserts no remediation task is reopened and BUILD completes when nothing else withholds it.

**Files likely touched:**
- src/conductor/test/engine/step-runners-remediation-closure.test.ts — failure test

**Dependencies:** Tasks 5, 10

## Task Dependency Graph

```
Task 1 ──▶ Task 2
Task 3
Task 4 ──▶ Task 5 ──┐
Task 6              │
Tasks 4, 7 ──▶ Task 9   │
Task 8              │
Task 10 ────────────┴──▶ Task 11
```

## Integration Points

- After Task 2: a `feature_shipped` from the daemon reaches the metric backend through `MetricsListener` with state and reason.
- After Tasks 4 and 6: a Codex pre-spawn failure no longer degrades a feature's timing rollup.
- After Task 10: a Codex-routed closure judgement runs instead of failing setup.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-014-otel-observability-exporter#D1 | no-change | none | No emission site changes for OTel; the listener still subscribes to existing events only. |
| adr-014-otel-observability-exporter#D2 | no-change | none | Plugin packaging is untouched. |
| adr-014-otel-observability-exporter#D3 | no-change | none | Visualizer wiring in `index.ts` is untouched. |
| adr-014-otel-observability-exporter#D4 | no-change | none | The `feature_shipped` handler still makes one in-memory recorder call per event with no I/O; the new counter is recorded through the same periodic metric reader. |
| adr-014-otel-observability-exporter#D5 | no-change | none | Exporter failure isolation is untouched; the new counter uses the same recorder path. |
| adr-014-otel-observability-exporter#D6 | no-change | none | No transport or `otel:` config change. |
| adr-014-otel-observability-exporter#D7 | task | task-2 | exactly one missing increment carrying tier M, the event's state |
| adr-014-otel-observability-exporter#D8 | no-change | none | `service.instance.id` and the `feature` data-point attribute are unchanged; the new counter takes identity from the existing `withIdentity` seam. |
| adr-014-otel-observability-exporter#D9 | task | task-1, task-2 | records one active point of 23907699 with state partial and that reason |
| adr-014-otel-observability-exporter#D10 | task | task-2 | carries only label names from `project`, `worker`, `feature`, `tier`, `state`, `reason`, and the configured static attributes |
| adr-014-otel-observability-exporter#D11 | task | task-1 | emits `feature_shipped` whose `active` is state `partial`, the rollup's active total, and reason `provider-evidence-incomplete` |
| adr-014-otel-observability-exporter#D12 | no-change | none | `otel.attributes` handling is untouched. |
| adr-014-otel-observability-exporter#D13 | no-change | none | Static attributes still ride every point through `withIdentity`; the new counter inherits them. |
| adr-014-otel-observability-exporter#D14 | task | task-2 | exactly one missing increment carrying tier M, the event's state |
| adr-014-otel-observability-exporter#D15 | no-change | none | The write-first spool is untouched. |
| adr-014-otel-observability-exporter#D16 | no-change | none | The spool drainer is untouched. |
| adr-014-otel-observability-exporter#D17 | no-change | none | Spool health events are untouched. |
| adr-014-otel-observability-exporter#D18 | no-change | none | Provenance fields on `feature_complete` and `loop_halt` are untouched. |
| adr-014-otel-observability-exporter#D19 | no-change | none | Provenance placement on spans is untouched. |
| adr-014-otel-observability-exporter#D20 | no-change | none | `otel.provenance` toggles are untouched. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
