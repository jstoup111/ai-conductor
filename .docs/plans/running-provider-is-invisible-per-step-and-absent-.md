# Implementation Plan: Live provider identification per attempt (#1268)

**Date:** 2026-10-14
**Design:** `.docs/specs/running-provider-is-invisible-per-step-and-absent-.md`
**Stories:** `.docs/stories/running-provider-is-invisible-per-step-and-absent-.md`
**Conflict check:** Clean as of 2026-10-14 (`.docs/conflicts/running-provider-is-invisible-per-step-and-absent-.md`)

## Summary

Add a `provider_attempt_started` event to the existing event spine. The candidate executor fires a new callback each time a provider candidate (or within-provider model rung) is actually invoked, and every provider-execution context maps that callback to the event. The daemon log and the interactive terminal renderer each print one line per start. 14 tasks.

## Technical Approach

- **Event shape** (`src/conductor/src/types/events.ts`). Add the variant `{ type: 'provider_attempt_started'; step: StepName; provider: ProviderStartIdentity; model?: string; executionContext?: ExecutionContext }`, where `ProviderStartIdentity = { kind: 'known'; id: string } | { kind: 'unknown' }`. The explicit `unknown` kind satisfies architecture-review Condition 2. A blank or absent provider is not representable. The persister stamps `ts`, as it does for every persisted event.
- **Sink row** (`src/conductor/src/engine/event-sinks.ts`). The final row is `render: true, persist: true, audit: false, otel: false`. Task 1 lands it with `render: false`, and Task 4 flips it to `render: true` in the same commit that adds the `renderDaemonEvent` case and updates the existing render-exhaustiveness and exact-set render assertions. Every commit therefore leaves the existing suite green (plan review PR-1, PR-2). With `otel: false`, the OTel wiring never subscribes the event, so the unknown kind can never become a telemetry label (conflict C5). The event is a start fact only and carries no accounting authority (conflict C4). `provider_attempt` stays the only source for cost, usage and running-work accounting; no accounting consumer reads the new type.
- **Emission boundary** (`src/conductor/src/engine/provider-execution.ts`). Add `onCandidateStart?: (step, { provider, model?, executionContext? }) => void | Promise<void>` to `ExecuteProviderCandidatesInput`, beside `onAttempt`, and to the `ProviderExecutionContext` that carries `onAttempt`.
  - `executeProviderCandidates` passes it, with `providerKey` and `executionContext`, into `invokeProviderCandidate`. There it fires inside `invokeModel`, the single per-rung runtime call, immediately before `runtime.provider.invoke(...)`, with the rung's model.
  - That placement is after every skip decision (setup-unavailable, cached run-wide unavailable, suppression refusal). A caller-supplied `onModelRung` that returns a cached result without calling `invoke()` therefore never fires it: the build-review rubric cache hit in `step-runners.ts` is one such caller (plan review PR-5).
  - The placement is also independent of `providerStreamObserverForCandidate`, so interactive (REPL) candidates fire too (architecture-review Condition 1).
  - The call is synchronous, unawaited and throw-guarded: `try { const r = onCandidateStart?.(…); if (r) void r.catch(() => {}) } catch {}`. A deferred call (for example through `Promise.resolve().then`) is not acceptable, because the synchronous render must happen before invocation. A throw or a slow listener therefore cannot hold or fail dispatch (conflict C3; Story 12).
  - A `providerKey` that is empty after trimming maps to `{ kind: 'unknown' }`.
  - The callback is never placed on the options object handed to an `LLMProvider` runtime (`adr-2026-08-24-one-dispatch-member-on-the-provider-contract`).
- **Why the executor, not `StepRunners`** (verified while planning, corrected by plan review PR-4 and PR-6). Not every dispatch crosses `StepRunners`: the project prelude (`src/conductor/src/engine/project-prelude.ts`) calls `executeProviderCandidates` directly and forwards only `onAttempt` and `warn`. The executor is the one boundary every dispatch crosses. Recovery dispatches do go through a `DefaultStepRunner` constructed with the slug-scoped context.
- **One shared callback mapping** (plan review PR-7). A new exported `providerExecutionEventCallbacks(eventTarget)` in `src/conductor/src/engine/provider-execution.ts` returns `{ onAttempt, onCandidateStart, warn }`:
  - `onAttempt` maps to `provider_attempt`, as today.
  - `onCandidateStart` maps to `void eventTarget.emit({ type: 'provider_attempt_started', … })`.
  - Both production contexts spread it: `daemon-cli.ts` `createProviderExecution` and the `providerExecution` object in `src/conductor/src/index.ts`. Their wiring is then one tested helper, not two hand-written copies.
  - Every executor caller forwards `onCandidateStart`. The callers, enumerated by searching `src/conductor/src` for `executeProviderCandidates` and `executeAuxiliaryProviderCandidates`, are:
    - `StepRunners`, for every executor input it builds. Its three `executeAuxiliaryProviderCandidates` calls carry the callback through that function's `...input` spread.
    - `src/conductor/src/engine/project-prelude.ts`.
    - `src/conductor/src/engine/plan-review-runner.ts` `runPlanReview`, which builds its own executor input from the executor `StepRunners` hands it (plan review PR-8). It gains an `onCandidateStart` input field, and `StepRunners` supplies it.
- **Line format** (`src/conductor/src/ui/provider-start-line.ts`, a new pure formatter shared by both renderers):
  - The label is `step` for a `lifecycle-step` subject or no `executionContext`, and `«parentGroup» / «member»` for a `configured-member` subject. It deliberately does not reuse `subjectLabel`'s `configured:g/m` form, because Story 3 fixes `review / security`.
  - The line is `▸ «label» on «id»`, plus ` («model»)` only when `model` is a non-empty string. For the unknown kind it is `▸ «label» provider unknown`.
  - `renderDaemonEvent` (`daemon-cli.ts`) logs it with the existing `dot` prefix. `TerminalRenderer` (`src/conductor/src/ui/terminal-renderer.ts`) logs it through `this.region.log` in a dedicated case, and the type is added to `DEDICATED_EVENT_TYPES`. `LiveRegion.log` writes plainly while suspended and records nothing that `resume()` would lose.
- **Recovery subscription** (architecture-review Condition 3; plan review PR-6). `createSlugScopedProviderExecution` is a closure inside the daemon entrypoint and can't be driven by a test. Extract its by-name subscriptions into an exported `subscribeScopedProviderRendering(events, log)` in `daemon-cli.ts`, which registers `provider_attempt`, `provider_fallback`, `session_policy` and `provider_attempt_started` → `renderDaemonEvent(event, log)`. The closure calls it in place of its three inline `.on` lines.
- **Local test patterns.**
  - Renderer tests follow `test/daemon-render-provider-attempt.test.ts` (call `renderDaemonEvent` with a capturing `log`; strip chalk) and `test/ui/terminal-renderer.test.ts` (construct `TerminalRenderer` over a fake stream and assert written text).
  - Executor tests follow `test/engine/provider-execution.test.ts` (fake runtimes in a runtime set, scripted outcomes per candidate).
  - Integration tests drive `StepRunners` with fake runtimes and subscribe the real `renderDaemonEvent` and `TerminalRenderer` to the same `ConductorEventEmitter`, as `test/integration/provider-lifecycle-supervision.integration.test.ts` does. Search hints: `renderedEventTypes`, `createProviderRuntimeSet`, `fakeRuntime`.

## Prerequisites

- None.

## Tasks

### Task 1: Declare the provider_attempt_started event and its sink row
**Story:** Story 8, Story 11
**Type:** infrastructure

**Steps:**
1. Write failing test in `src/conductor/test/engine/event-sinks.test.ts`: the `EVENT_SINKS` row for `provider_attempt_started` has `persist: true, audit: false, otel: false`. It lands `render: false` here; Task 4 flips render with its renderer case, so no existing render-exhaustiveness test goes red in this commit. In the same commit, add `provider_attempt_started` to the literal list behind the existing "pins the exact persisted event set" test in the same file, so that pin stays green (plan review PR-9).
2. Write failing test in `src/conductor/test/engine/event-persister-wiring.test.ts`: persisting a `provider_attempt_started` event whose provider is `{ kind: 'unknown' }` writes a JSONL record with `provider.kind === 'unknown'` and a `ts`.
3. Verify both fail (RED).
4. Implement: add `ProviderStartIdentity` and the variant to the `ConductorEvent` union in `types/events.ts`, and add the sink row.
5. Verify GREEN and commit.

**Done when:**
- [test] event-sinks test asserts the EVENT_SINKS row for provider_attempt_started is persist true, audit false, otel false, so OTel wiring subscribes no handler and no exported metric or span carries its provider value
- [test] the existing "pins the exact persisted event set" test passes with provider_attempt_started added to its pinned list
- [test] event-persister-wiring test asserts a persisted unknown start carries provider {kind: 'unknown'} explicitly rather than omitting the provider, and carries a ts
- The ConductorEvent union's provider_attempt_started provider field type is ProviderStartIdentity, which admits only {kind: 'known', id} or {kind: 'unknown'}

**Files likely touched:**
- `src/conductor/src/types/events.ts`
- `src/conductor/src/engine/event-sinks.ts`
- `src/conductor/test/engine/event-sinks.test.ts`
- `src/conductor/test/engine/event-persister-wiring.test.ts`

**Dependencies:** none

### Task 2: Fire onCandidateStart from the candidate executor
**Story:** Story 6, Story 2, Story 5, Story 7, Story 8
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/provider-execution.test.ts`, using the file's fake-runtime pattern (scripted per-candidate outcomes in a runtime set), for each behavior in Done when.
2. Verify they fail (RED).
3. Implement: add `onCandidateStart` to `ExecuteProviderCandidatesInput` and `ProviderExecutionContext`. `executeProviderCandidates` passes it, with `providerKey` and `executionContext`, into `invokeProviderCandidate`. That function calls it synchronously, unawaited and throw-guarded, inside `invokeModel` immediately before `runtime.provider.invoke(...)`, with `{ provider: providerKey.trim() ? { kind: 'known', id: providerKey } : { kind: 'unknown' }, model: rungOptions.model, executionContext }`. Never add it to the options object passed to the runtime.
4. Verify GREEN and commit.

**Done when:**
- [test] executeProviderCandidates calls onCandidateStart exactly once with provider {kind: 'known', id: 'claude'} for a single invoked claude candidate, before the fake runtime's invoke is entered, including for an interactive candidate where no stream observer is created
- [test] with ladder claude then codex where claude fails after starting, executeProviderCandidates calls onCandidateStart twice in order, first claude then codex
- [test] a candidate skipped as setup-unavailable, and separately one skipped as cached run-wide unavailable, produces no onCandidateStart call while the next invoked candidate produces exactly one
- [test] when the model fallback ladder moves claude from its first to its second model, onCandidateStart is called again with provider claude and the second model, and an empty providerKey yields provider {kind: 'unknown'}
- [test] the options object passed to the fake runtime's invoke contains no onCandidateStart key, a throwing onCandidateStart does not change the executor's result, and an onModelRung that returns a cached result without calling invoke produces no onCandidateStart call

**Files likely touched:**
- `src/conductor/src/engine/provider-execution.ts`
- `src/conductor/test/engine/provider-execution.test.ts`

**Dependencies:** Task 1

### Task 3: Map onCandidateStart to the event on every dispatch path
**Story:** Story 3, Story 12
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/provider-execution.test.ts` (for the shared callback builder), `src/conductor/test/engine/step-runners.test.ts` and `src/conductor/test/engine/project-prelude.test.ts`, covering the Done when cases.
2. Verify they fail (RED).
3. Implement:
   - Export `providerExecutionEventCallbacks(eventTarget)` from `provider-execution.ts`, returning `{ onAttempt, onCandidateStart, warn }`; `onCandidateStart` emits `provider_attempt_started` without awaiting.
   - Replace the hand-written `onAttempt`/`warn` in `daemon-cli.ts` `createProviderExecution` and in the `index.ts` `providerExecution` object with a spread of that helper.
   - `StepRunners` stores `options?.providerExecution?.onCandidateStart` and forwards it into every `executeProviderCandidates` / `executeAuxiliaryProviderCandidates` input it builds, next to `onAttempt`.
   - `project-prelude.ts` forwards `execution.onCandidateStart` next to `execution.onAttempt`.
   - `plan-review-runner.ts` `runPlanReview` accepts an `onCandidateStart` input and forwards it into the executor input it builds; `StepRunners` passes its stored callback when it calls `runPlanReview`.
   - Update the two existing structural tests that parse these object literals and pin the `onAttempt` and `warn` initializer text, so they assert the `providerExecutionEventCallbacks` spread instead: `src/conductor/test/integration/provider-model-policy-wiring.integration.test.ts` and `src/conductor/test/acceptance/setup-triage-dispatch.acceptance.test.ts` (plan review PR-10).
4. Verify GREEN and commit.

**Done when:**
- [test] provider-execution test asserts providerExecutionEventCallbacks(emitter).onCandidateStart emits provider_attempt_started carrying step, provider, model and executionContext on that emitter, and returns without awaiting a listener whose promise never resolves
- [test] step-runners test asserts a configured-member dispatch emits provider_attempt_started on the runner's event bus carrying that dispatch's executionContext subject parentGroup and member
- [test] step-runners test asserts a listener whose promise never resolves does not prevent the fake runtime's invoke from being entered, because the context emits without awaiting
- [test] project-prelude test asserts a prelude provider dispatch through runProjectPrelude calls the context's onCandidateStart with the invoked provider, and a plan-review-runner test asserts runPlanReview forwards its onCandidateStart into the executor input it builds
- [test] provider-model-policy-wiring and setup-triage-dispatch structural tests pass asserting createProviderExecution in daemon-cli.ts and the providerExecution object in index.ts each spread providerExecutionEventCallbacks and contain no other mapping of provider_attempt or provider_attempt_started

**Files likely touched:**
- `src/conductor/src/engine/provider-execution.ts`
- `src/conductor/src/daemon-cli.ts`
- `src/conductor/src/index.ts`
- `src/conductor/src/engine/step-runners.ts`
- `src/conductor/src/engine/project-prelude.ts`
- `src/conductor/src/engine/plan-review-runner.ts`
- `src/conductor/test/engine/provider-execution.test.ts`
- `src/conductor/test/engine/step-runners.test.ts`
- `src/conductor/test/engine/project-prelude.test.ts`
- `src/conductor/test/engine/plan-review-runner.test.ts`
- `src/conductor/test/integration/provider-model-policy-wiring.integration.test.ts`
- `src/conductor/test/acceptance/setup-triage-dispatch.acceptance.test.ts`

**Dependencies:** Task 2

### Task 4: Shared provider-start line formatter and daemon-log rendering
**Story:** Story 7, Story 1, Story 3, Story 8
**Type:** happy-path

**Steps:**
1. Write failing tests in a new `src/conductor/test/daemon-render-provider-start.test.ts`, following `test/daemon-render-provider-attempt.test.ts` (capture `log`, strip chalk).
2. Verify they fail (RED).
3. Implement `src/conductor/src/ui/provider-start-line.ts` (`formatProviderStartLine(event)`), per the Technical Approach format, and a `provider_attempt_started` case in `renderDaemonEvent`. In the same commit, flip the sink row to `render: true`. Update every existing assertion that enumerates rendered types or sink rows so the suite stays green: the exact-set and literal lists in `src/conductor/test/engine/event-sinks.test.ts` and `src/conductor/test/event-sink-registry.test.ts`, and the `renderDaemonEventUnsafe` case-exhaustiveness check in `src/conductor/test/engine/daemon-render.test.ts` (which the new case satisfies).
4. Verify GREEN and commit.

**Done when:**
- [test] renderDaemonEvent renders a lifecycle-step start of prd on claude as a line containing `prd on claude`, and a configured-member start of review/security on codex as a line containing `review / security on codex`
- [test] renderDaemonEvent renders provider claude with model opus as a line containing both `claude` and `opus`, and with no model renders the provider with no `undefined`, `null`, or `()` text
- [test] renderDaemonEvent renders an unknown-provider start as a line containing `«step» provider unknown` with a non-empty provider portion, and rendered after a claude start for the same step the unknown line contains no `claude`
- [test] event-sinks test asserts the provider_attempt_started row is now render true, and the daemon-render exhaustiveness test passes with renderedEventTypes() equal to the set of renderDaemonEventUnsafe cases

**Files likely touched:**
- `src/conductor/src/ui/provider-start-line.ts`
- `src/conductor/src/daemon-cli.ts`
- `src/conductor/test/daemon-render-provider-start.test.ts`
- `src/conductor/src/engine/event-sinks.ts`
- `src/conductor/test/engine/event-sinks.test.ts`
- `src/conductor/test/event-sink-registry.test.ts`
- `src/conductor/test/engine/daemon-render.test.ts`

**Dependencies:** Task 1

### Task 5: Render provider starts on recovery-session daemon logs
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write a failing test in `src/conductor/test/daemon-render-provider-start.test.ts`. Call the exported `subscribeScopedProviderRendering(emitter, scopedLog)`, emit a `provider_attempt_started` event, and assert the scoped log receives the same line `renderDaemonEvent` writes. Assert the same for `provider_attempt`, `provider_fallback` and `session_policy`, so the extraction keeps today's subscriptions.
2. Verify it fails (RED).
3. Implement: extract the closure's three by-name `.on` lines into the exported `subscribeScopedProviderRendering(events, log)` in `daemon-cli.ts`, add `provider_attempt_started` to it, and have `createSlugScopedProviderExecution` call it.
4. Verify GREEN and commit.

**Done when:**
- [test] subscribeScopedProviderRendering registered on an emitter writes a `«step» on «provider»` line to the supplied scoped log for a provider_attempt_started event, matching the line renderDaemonEvent writes for the same event on a normal feature log, and still renders provider_attempt, provider_fallback, and session_policy
- [test] a recovery-session rebase-conflict dispatch, run through DefaultStepRunner.resolveRebaseConflict on a fake runtime with a context built from providerExecutionEventCallbacks(scopedEmitter) and subscribeScopedProviderRendering(scopedEmitter, a slug-tagged feature logger), writes the `«step» on «provider»` provider-start line to that feature's daemon log exactly as a normal feature dispatch writes it
- `createSlugScopedProviderExecution` in daemon-cli.ts calls subscribeScopedProviderRendering(scopedEvents, scopedLog) and contains no inline `.on('provider_` subscription

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts`
- `src/conductor/test/daemon-render-provider-start.test.ts`

**Dependencies:** Tasks 3, 4

### Task 6: Render provider starts in the interactive terminal renderer
**Story:** Story 2, Story 3, Story 7, Story 8
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/ui/terminal-renderer.test.ts`, using its fake-stream pattern.
2. Verify they fail (RED).
3. Implement a dedicated `provider_attempt_started` case calling `this.region.log(formatProviderStartLine(event))`, and add the type to `DEDICATED_EVENT_TYPES`. In the same commit, add it to the test file's own `DEDICATED_RENDERER_EVENT_TYPES` literal set, so the existing generic-fallback test stops treating it as a fallback type and never feeds it a bare `{ type }` event (plan review PR-3).
4. Verify GREEN and commit.

**Done when:**
- [test] TerminalRenderer fed step_started(stories), provider_attempt_started(claude), step_completed renders a line containing `stories on claude` before the completion line, and renders a configured-member start as `review / security on codex`
- [test] with the live region suspended, the provider-start line is written as a plain line, and after resume the current step's running indicator is still rendered
- [test] TerminalRenderer renders model opus beside claude, omits `undefined`, `null`, and `()` when no model, and renders an unknown start as `«step» provider unknown` without naming a prior provider
- [test] provider_attempt_started is in DEDICATED_EVENT_TYPES and in the test's DEDICATED_RENDERER_EVENT_TYPES, the existing generic-fallback test passes, and the generic fallback rendering does not print a second line for it

**Files likely touched:**
- `src/conductor/src/ui/terminal-renderer.ts`
- `src/conductor/test/ui/terminal-renderer.test.ts`

**Dependencies:** Task 4

### Task 7: Serial dispatch shows the provider live on both surfaces
**Story:** Story 1, Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in a new `src/conductor/test/integration/provider-start-serial.integration.test.ts`. Drive `StepRunners` with fake runtimes through a context whose callbacks come from the production `providerExecutionEventCallbacks(emitter)` — the same helper both production contexts spread. Subscribe the real `renderDaemonEvent` (via `renderedEventTypes()`) and a `TerminalRenderer` to the same emitter, as `provider-lifecycle-supervision.integration.test.ts` does.
2. These are characterization tests over behavior Tasks 3–6 implement, so they are expected to pass on first run. A failure is a wiring defect: fix it in production code within this task. Record that no RED phase applies.
3. Commit.

**Done when:**
- [test] a feature dispatch of prd on a fake claude runtime that blocks mid-attempt writes a daemon-log line containing `prd on claude` while the attempt is still blocked and before its completion line
- [test] a feature dispatch of plan on a fake codex runtime writes a daemon-log line containing `plan on codex` before that attempt's completion line
- [test] an interactive-mode dispatch of stories through a context built from providerExecutionEventCallbacks prints `stories on claude` to the TerminalRenderer before the fake runtime's invoke is entered and before the completion line, with no stream observer created

**Files likely touched:**
- `src/conductor/test/integration/provider-start-serial.integration.test.ts`

**Dependencies:** Tasks 3, 4, 6

### Task 8: Parallel members are labelled with group, member and provider
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in a new `src/conductor/test/integration/provider-start-members.integration.test.ts`. Drive a configured parallel group and the built-in validation group through the group-core branch executor with fake runtimes, rendering both surfaces.
2. Characterization tests over behavior Tasks 3–6 implement: expected to pass on first run, and any failure is a wiring defect fixed in this task. No RED phase applies.
3. Commit.

**Done when:**
- [test] a configured parallel group review with member security on fake codex produces a daemon-log line and a terminal line each containing `review / security on codex`
- [test] the built-in validation group's prd_audit member on fake claude produces on both surfaces a line containing `prd_audit on claude`
- [test] a configured member named plan renders as `«group» / plan on «provider»`, distinguishable from the bare `plan on «provider»` that a serial plan dispatch renders
- [test] a member skipped before dispatch emits no provider_attempt_started event and renders no provider-start line on either surface

**Files likely touched:**
- `src/conductor/test/integration/provider-start-members.integration.test.ts`

**Dependencies:** Tasks 3, 4, 6

### Task 9: Concurrent members stay distinguishable
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing tests in a new `src/conductor/test/integration/provider-start-concurrency.integration.test.ts`. Run two members of one configured group concurrently with fake runtimes whose start order is forced by deferred promises.
2. Characterization tests over behavior Tasks 3–6 implement: expected to pass on first run, and any failure is a wiring defect fixed in this task. No RED phase applies.
3. Commit.

**Done when:**
- [test] two members of one group running concurrently on fake claude (A) and fake codex (B), with starts forced in the order B then A, render on both surfaces exactly one line for A naming claude and one for B naming codex, and neither line names the other member's provider
- [test] two concurrent members of one group both on fake claude render two separate provider-start lines on both surfaces, one labelled with each member

**Files likely touched:**
- `src/conductor/test/integration/provider-start-concurrency.integration.test.ts`

**Dependencies:** Tasks 3, 4, 6

### Task 10: Fallback, skipped candidates and model rungs on the live surfaces
**Story:** Story 5, Story 6, Story 7
**Type:** negative-path

**Steps:**
1. Write failing tests in a new `src/conductor/test/integration/provider-start-fallback.integration.test.ts`, rendering both surfaces from one emitter.
2. Characterization tests over behavior Tasks 3–6 implement: expected to pass on first run, and any failure is a wiring defect fixed in this task. No RED phase applies.
3. Commit.

**Done when:**
- [test] a dispatch with ladder claude then codex where claude fails after starting renders on both surfaces a second line `«step» on codex` after the PROVIDER FALLBACK notice, and the last provider-start line for the step names codex and not claude
- [test] a configured member falling back from claude to codex renders `«group» / «member» on codex` on both surfaces, while a concurrent sibling member's only provider-start line still names its own provider and no provider_attempt_started event is attributed to the sibling
- [test] a dispatch whose claude candidate is skipped as setup-unavailable, and separately one skipped as cached run-wide unavailable, renders no provider-start line naming claude and exactly one naming codex on the daemon log, while a dispatch invoking preferred claude renders a line naming claude
- [test] a dispatch whose claude model ladder moves to a second model renders a second daemon-log provider-start line naming claude and the second model

**Files likely touched:**
- `src/conductor/test/integration/provider-start-fallback.integration.test.ts`

**Dependencies:** Tasks 3, 4, 6

### Task 11: No provider line for mechanical steps
**Story:** Story 9
**Type:** negative-path

**Steps:**
1. Write failing tests in a new `src/conductor/test/integration/provider-start-noise.integration.test.ts`, rendering both surfaces and persisting through `EventPersister`.
2. Characterization tests over behavior Tasks 3–6 implement: expected to pass on first run, and any failure is a wiring defect fixed in this task. No RED phase applies.
3. Commit.

**Done when:**
- [test] a run executing a step that dispatches no provider persists zero provider_attempt_started records for it in .pipeline/events.jsonl
- [test] for that same step, the run renders neither a provider-start line nor `provider unknown` for it on the daemon log or the terminal

**Files likely touched:**
- `src/conductor/test/integration/provider-start-noise.integration.test.ts`

**Dependencies:** Tasks 3, 4, 6

### Task 12: Persisted starts are ordered and never alter accounting
**Story:** Story 11
**Type:** negative-path

**Steps:**
1. Write failing tests in a new `src/conductor/test/integration/provider-start-history.integration.test.ts`. Run a fallback dispatch with a real `EventPersister` over a temp `.pipeline/`, and feed fixture histories to `cost-rollup`, `dispatch-metering`, `timing-rollup` and the `daemon-dashboard` running-work classifier.
2. Characterization tests over behavior Tasks 3–6 implement: expected to pass on first run, and any failure is a wiring defect fixed in this task. No RED phase applies.
3. Commit.

**Done when:**
- [test] after a fallback run, .pipeline/events.jsonl contains one provider_attempt_started record per begun attempt in begin order, each carrying step, provider, ts, and executionContext with member identity for a member dispatch
- [test] cost-rollup, dispatch-metering, and daemon-dashboard running-work classification produce identical results over a history with and without provider_attempt_started records
- [test] a pre-feature events.jsonl with no provider_attempt_started records is read by cost-rollup, dispatch-metering, timing-rollup, and daemon-dashboard without error and yields no provider-start data
- [test] with the EventPersister append failing, a dispatch still reaches its normal step outcome and the persister's existing failure handling is invoked unchanged

**Files likely touched:**
- `src/conductor/test/integration/provider-start-history.integration.test.ts`

**Dependencies:** Tasks 3, 4, 6

### Task 13: Provider identification never disturbs the step
**Story:** Story 12
**Type:** negative-path

**Steps:**
1. Write failing tests in a new `src/conductor/test/integration/provider-start-isolation.integration.test.ts`.
2. Characterization tests over behavior Tasks 3–6 implement: expected to pass on first run, and any failure is a wiring defect fixed in this task. No RED phase applies.
3. Commit.

**Done when:**
- [test] the step's completion status and its step_completed observed duration under a fake clock with provider-start rendering active are each identical to the same dispatch with no provider_attempt_started listener
- [test] with a daemon renderer that throws on provider_attempt_started, the step completes with its normal status and no step_retry or HALT is recorded because of the render failure
- [test] with a provider_attempt_started listener returning a never-resolving promise, the fake runtime's invoke is still entered and the step completes with its normal status

**Files likely touched:**
- `src/conductor/test/integration/provider-start-isolation.integration.test.ts`

**Dependencies:** Tasks 3, 4, 6

### Task 14: A single-provider serial run gains exactly one line per step
**Story:** Story 10
**Type:** negative-path

**Steps:**
1. Write tests in a new `src/conductor/test/integration/provider-start-single-provider.integration.test.ts`, rendering both surfaces from one emitter, following `provider-lifecycle-supervision.integration.test.ts`.
2. Characterization tests over behavior Tasks 3–6 implement: expected to pass on first run, and any failure is a wiring defect fixed in this task. No RED phase applies.
3. Commit.

**Done when:**
- [test] a single-provider serial step emitting repeated provider_stream_progress events renders exactly one provider-start line on the daemon log and exactly one on the terminal during the attempt
- [test] the step's completion line and the daemon-log lifecycle `provider running` line are each byte-identical and still present compared with the same run without provider_attempt_started, so the provider-start line is the only added line

**Files likely touched:**
- `src/conductor/test/integration/provider-start-single-provider.integration.test.ts`

**Dependencies:** Tasks 3, 4, 6

## Task Dependency Graph

```
Task 1 ─┬─▶ Task 2 ─▶ Task 3 ─┬─▶ Task 5
        │                     ├─▶ Tasks 7–14
        └─▶ Task 4 ─┬─────────┤   (Tasks 7–14 each depend on Tasks 3, 4, 6)
                    ├─▶ Task 5
                    └─▶ Task 6 ─▶ Tasks 7–14
```

## Integration Points

- After Task 3: every dispatch path (feature, interactive, recovery and project prelude) emits `provider_attempt_started` on its bus.
- After Tasks 4–6: both live surfaces render it. Tasks 7–14 prove the behavior end to end through `StepRunners` and the group branch executor.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a daemon feature dispatch of the serial step prd routed to claude, when the claude attempt begins executing, then the feature's daemon log shows a line containing "prd on claude" before that attempt's completion line. | 7 | "writes a daemon-log line containing `prd on claude` while the attempt is still blocked and before its completion line" | diff-local |
| Story 1 happy: Given a daemon feature dispatch of the serial step plan routed to codex, when the codex attempt begins executing, then the feature's daemon log shows a line containing "plan on codex" before that attempt's completion line. | 7 | "writes a daemon-log line containing `plan on codex` before that attempt's completion line" | diff-local |
| Story 1 negative: Given a provider attempt that is still executing and has not completed, when the daemon log is read, then the provider-start line for that attempt is already present rather than appearing only after completion. | 7 | "while the attempt is still blocked" | diff-local |
| Story 1 negative: Given a recovery-session dispatch for a retained feature, when its provider attempt begins executing, then the provider-start line appears on that feature's daemon log exactly as for a normal feature dispatch. | 5 | "writes the `«step» on «provider»` provider-start line to that feature's daemon log exactly as a normal feature dispatch writes it" | diff-local |
| Story 2 happy: Given an interactive conduct run of the serial step stories routed to claude, when the claude attempt begins executing, then the terminal view shows a line containing "stories on claude" before that step's completion line. | 7 | "prints `stories on claude` to the TerminalRenderer before the fake runtime's invoke is entered and before the completion line" | diff-local |
| Story 2 happy: Given a step dispatched in interactive mode where the provider takes over the operator's terminal, when the attempt begins, then the provider-start line is printed before the provider takes over the terminal. | 7 | "before the fake runtime's invoke is entered" | diff-local |
| Story 2 negative: Given a step dispatched in interactive mode where no live stream observation is created, when the attempt begins, then the provider-start line is still printed. | 7 | "with no stream observer created" | diff-local |
| Story 2 negative: Given the terminal view's sticky region is suspended because a step is running, when the provider-start line is rendered, then it is printed as a plain line and the step's running indicator is not lost when the region resumes. | 6 | "with the live region suspended, the provider-start line is written as a plain line, and after resume the current step's running indicator is still rendered" | diff-local |
| Story 3 happy: Given a configured parallel group review with member security routed to codex, when the member's attempt begins, then both the daemon log and the terminal view show a line containing "review / security on codex". | 8 | "produces a daemon-log line and a terminal line each containing `review / security on codex`" | diff-local |
| Story 3 happy: Given the built-in validation group, when its prd_audit member's attempt begins on claude, then both live surfaces show a line naming prd_audit and claude. | 8 | "produces on both surfaces a line containing `prd_audit on claude`" | diff-local |
| Story 3 negative: Given a configured member whose name matches a serial step name, when the member's attempt begins, then its line carries the group label and is distinguishable from a serial dispatch of that step. | 8 | "renders as `«group» / plan on «provider»`, distinguishable from the bare `plan on «provider»` that a serial plan dispatch renders" | diff-local |
| Story 3 negative: Given a member that is skipped and never dispatched, when the group runs, then no provider-start line is shown for that member. | 8 | "a member skipped before dispatch emits no provider_attempt_started event and renders no provider-start line on either surface" | diff-local |
| Story 4 happy: Given two members of one group executing concurrently with member A on claude and member B on codex, when both attempts have begun, then member A's line names claude and member B's line names codex on both surfaces. | 9 | "render on both surfaces exactly one line for A naming claude and one for B naming codex" | diff-local |
| Story 4 negative: Given two concurrent members whose attempts begin in interleaved order, when their lines are rendered, then neither member's line names the other member's provider. | 9 | "with starts forced in the order B then A" | diff-local |
| Story 4 negative: Given two concurrent members of the same group both routed to claude, when both attempts begin, then two separate lines are shown, one per member. | 9 | "render two separate provider-start lines on both surfaces, one labelled with each member" | diff-local |
| Story 5 happy: Given a step whose ladder is claude then codex, when claude fails after beginning and codex begins executing, then both live surfaces show a second line naming codex for that step after the existing fallback notice. | 10 | "renders on both surfaces a second line `«step» on codex` after the PROVIDER FALLBACK notice" | diff-local |
| Story 5 happy: Given a parallel member that falls back from claude to codex, when codex begins executing, then the new line names that member's group, member, and codex. | 10 | "a configured member falling back from claude to codex renders `«group» / «member» on codex` on both surfaces" | diff-local |
| Story 5 negative: Given a fallback has occurred, when the latest provider-start line for that step is read, then it names codex and not claude. | 10 | "the last provider-start line for the step names codex and not claude" | diff-local |
| Story 5 negative: Given a fallback within one member, when the other concurrent members' lines are read, then their providers are unchanged. | 10 | "while a concurrent sibling member's only provider-start line still names its own provider and no provider_attempt_started event is attributed to the sibling" | diff-local |
| Story 6 happy: Given a step whose preferred provider is claude and claude is invoked, when the attempt begins, then the line names claude. | 10 | "while a dispatch invoking preferred claude renders a line naming claude" | diff-local |
| Story 6 negative: Given a step whose preferred provider claude is skipped as setup-unavailable and codex is then invoked, when the attempts are processed, then no provider-start line names claude and one provider-start line names codex. | 10 | "skipped as setup-unavailable" | diff-local |
| Story 6 negative: Given a step whose preferred provider is skipped as cached run-wide unavailable, when the attempts are processed, then no provider-start line is shown for the skipped provider. | 10 | "one skipped as cached run-wide unavailable, renders no provider-start line naming claude and exactly one naming codex on the daemon log" | diff-local |
| Story 7 happy: Given an attempt that begins on claude with model opus resolved, when its line is rendered, then the line shows claude and opus. | 4 | "renders provider claude with model opus as a line containing both `claude` and `opus`" | diff-local |
| Story 7 happy: Given a provider whose model ladder moves to a second model within the same provider, when the second model begins executing, then a new line shows the provider with the second model. | 10 | "renders a second daemon-log provider-start line naming claude and the second model" | diff-local |
| Story 7 negative: Given an attempt that begins with no model resolved, when its line is rendered, then the line shows the provider alone with no placeholder model text such as "undefined" or empty parentheses. | 4 | "with no model renders the provider with no `undefined`, `null`, or `()` text" | diff-local |
| Story 8 happy: Given a provider-backed attempt begins and its provider cannot be determined, when the line is rendered, then both surfaces show the step and the text "provider unknown". | 4, 6 | "renders an unknown start as `«step» provider unknown`" | diff-local |
| Story 8 negative: Given an earlier attempt of the same step named claude, when a later attempt begins with an undeterminable provider, then the later line shows "provider unknown" and does not name claude. | 4 | "rendered after a claude start for the same step the unknown line contains no `claude`" | diff-local |
| Story 8 negative: Given an attempt with an undeterminable provider, when the line is rendered, then the provider portion is never blank. | 4 | "with a non-empty provider portion" | diff-local |
| Story 8 negative: Given an attempt with an undeterminable provider, when telemetry is exported, then the unknown state never appears as a provider label value. | 1 | "so OTel wiring subscribes no handler and no exported metric or span carries its provider value" | diff-local |
| Story 9 happy: Given a run that executes a mechanical step that dispatches no provider, when the step completes, then neither live surface shows a provider-start line for it. | 11 | "renders neither a provider-start line nor `provider unknown` for it on the daemon log or the terminal" | diff-local |
| Story 9 negative: Given a mechanical step, when it runs, then neither surface shows "provider unknown" for it. | 11 | "renders neither a provider-start line nor `provider unknown` for it" | diff-local |
| Story 9 negative: Given a mechanical step, when the run's event history is read, then it contains no provider-start record for that step. | 11 | "persists zero provider_attempt_started records for it" | diff-local |
| Story 10 happy: Given a serial run on a single provider with no fallback, when a provider-backed step runs to completion, then each live surface shows exactly one provider-start line for that step. | 14 | "renders exactly one provider-start line on the daemon log and exactly one on the terminal during the attempt" | diff-local |
| Story 10 negative: Given a long-running step emitting many live progress updates, when the step runs, then no further provider-start line is printed for it during the attempt. | 14 | "a single-provider serial step emitting repeated provider_stream_progress events renders exactly one provider-start line" | diff-local |
| Story 10 negative: Given a single-provider serial run, when the step completes, then the existing completion line is unchanged apart from no added duplicate provider line. | 14 | "the step's completion line and the daemon-log lifecycle `provider running` line are each byte-identical and still present" | diff-local |
| Story 10 negative: Given a single-provider serial run in the daemon log, when a step attempt begins, then the existing provider lifecycle running line is still printed unchanged and the provider-start line is the only added line. | 14 | "so the provider-start line is the only added line" | diff-local |
| Story 11 happy: Given a run with a fallback, when the run's event history is read afterwards, then it contains one provider-start record per begun attempt with its step, provider, member identity when applicable, and a timestamp, in order. | 12 | "contains one provider_attempt_started record per begun attempt in begin order, each carrying step, provider, ts, and executionContext with member identity for a member dispatch" | diff-local |
| Story 11 negative: Given an event history written before this feature, when it is read by the existing history consumers, then it is read without error and no provider-start records are invented. | 12 | "is read by cost-rollup, dispatch-metering, timing-rollup, and daemon-dashboard without error and yields no provider-start data" | diff-local |
| Story 11 negative: Given the persister cannot write the event history, when a provider-start record is emitted, then the step proceeds and the existing persistence-failure handling applies unchanged. | 12 | "with the EventPersister append failing, a dispatch still reaches its normal step outcome and the persister's existing failure handling is invoked unchanged" | diff-local |
| Story 11 negative: Given a run whose history contains provider-start records, when cost, usage, and running-work accounting are computed, then their results are identical to the same run without provider-start records. | 12 | "produce identical results over a history with and without provider_attempt_started records" | diff-local |
| Story 12 happy: Given a step whose provider-start line renders normally, when the attempt runs, then the step's outcome and timing are unchanged from a run without the line. | 13 | "the step's completion status and its step_completed observed duration under a fake clock with provider-start rendering active are each identical to the same dispatch with no provider_attempt_started listener" | diff-local |
| Story 12 negative: Given a renderer that throws while rendering the provider-start line, when the attempt begins, then the step still executes to its normal outcome and no retry or halt is recorded because of the render failure. | 13 | "the step completes with its normal status and no step_retry or HALT is recorded because of the render failure" | diff-local |
| Story 12 negative: Given an event listener that is slow to process the provider-start record, when the attempt begins, then the provider dispatch is not held waiting on that listener. | 13 | "the fake runtime's invoke is still entered and the step completes with its normal status" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
