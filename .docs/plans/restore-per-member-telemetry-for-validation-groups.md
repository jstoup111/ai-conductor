# Implementation Plan: Sequential and parallel telemetry parity

**Date:** 2026-09-10
**Design:** .docs/decisions/adr-2026-09-10-shared-step-lifecycle-telemetry.md
**Stories:** .docs/stories/restore-per-member-telemetry-for-validation-groups.md
**Conflict check:** Clean as of 2026-09-10
**Source:** jstoup111/ai-conductor#2414

## Summary

Implement shared lifecycle instrumentation across serial steps, built-in validation groups, and configured parallel groups in 17 behavior-owning tasks. The operator approved this scope, technical track, architecture, and stories. The task plan remains subject to operator review before land.

## Technical Approach

Extend the existing ConductorEvent spine and tracked execution emission. Add optional execution context consisting of an opaque execution ID and a typed subject: lifecycle step, or configured member with parent group and member name. The same context travels on starts, retries, member settlement, provider attempts and terminals. Keep existing top-level policy-step identity valid; configured member attribution comes from the typed subject, with no addition to the closed lifecycle registry. Provide one resolver for execution keys and stable subject labels, used by persistence, timing, metrics, spans and presentation.

Reuse the existing group_member_step result as the member settlement observation, enriched with context and delivered before handshake/join work. Each timing consumer freezes its member end with its existing engine-clock semantics on this observation. EventPersister remains the owner of persisted activeInterval; the final terminal carries the interval it derives from the frozen boundary. Serial scopes without a separate member-settlement event retain existing start-to-terminal timing. At join, the existing outcome owner emits the final classification; it does not rewrite the measured work boundary. This preserves truthful refusal/failure without adding sibling or gate-join delay to member duration.

Execution scopes are explicit per invocation, never a mutable global current-step slot. Retry keeps an execution ID; redispatch changes it. Provider attempt and verdict handshake IDs keep their independent existing meaning. A malformed explicit execution context must not silently attach to a legacy live scope. Legacy events continue their historical name-based interpretation in a separate namespace. Configured-member labels use escaped parent/member components; IDs stay off metric labels and metric Resource fields. Existing serial and built-in labels and units remain unchanged.

The sequence is types/identity → lifecycle and producer plumbing → persistence/projections → actual dispatch integrations → interrupt and authoritative negative-outcome integration. Production context is supplied through per-invocation options and closures to the existing providerAttempt/onAttempt callback. Metrics remain owned solely by MetricsListener; spans remain owned by the visualizer/SpanManager. No scheduler, retry-policy, gate-authority, OTel backend, CLI or configuration migration is planned.

Focused local pattern basis: preserve emitExecutionEvent's serialized delivery and in-flight terminal promises; EventPersister's injected epoch-anchored monotonic IntervalClock; DispatchMeteringTracker's invoked-attempt authority and legacy completion suppression; group-core.test.ts's deferred promises, cap fixtures and detached session assertions. These are semantic patterns, not an exact-copy declaration. Each task repeats the relevant traits and rediscovery seeds.

## Prerequisites

- Approved technical track, Tier L, architecture decision and accepted stories in this spec.
- Existing TypeScript dependencies and test infrastructure; no external infrastructure or live service is required.
- BUILD resolves source symbols against its current checkout, including any subsequently merged OTel handler-table changes, while preserving the approved behavior.
- Fixture boundaries: specify starting step, expected dispatches, exact stop condition and required evidence. Use verifyArtifacts:false for mocked-success unit paths; supply fresh real internal gate evidence only for gate-join integration. Stop before unrelated SHIP/publication work and await cleanup.
- Scoped RED/GREEN and affected type checking use the repository's configured commands. The engine's test_suite owns aggregate BUILD verification. No tests contact real providers, GitHub, Grafana or Prometheus.

## Tasks

### Task 1: Define typed execution correlation and stable subject labels
**Story:** Story 2
**Story:** Story 6
**Type:** infrastructure

**Steps:**
1. Write scoped failing coverage for the observations in Done when at the named boundary. Use unit scope for internal transitions; the dispatch/forwarding tasks own their named entry-point integration proof.
2. Verify RED, then implement: Add optional execution context to existing lifecycle, retry, provider-attempt and member-result events. Use an opaque execution ID plus a discriminated lifecycle-step/configured-member subject; configured subjects retain parent group and member. Centralize correlation-key and display/metric-label resolution. Keep top-level lifecycle policy ownership separate from configured member names; no new StepName registration or unsafe telemetry casts. Encode configured parent/member labels unambiguously (escaped components); preserve existing step labels. Context-free records use a distinct legacy namespace. Follow existing discriminated event types, not free-text identity parsing.
3. Verify GREEN with the scoped tests and applicable type checking, then commit with message: "define typed execution correlation and stable subject labels".

**Done when:**
- The execution-identity resolver distinguishes same-name members in different parent groups and executions in different feature/run scopes, preserves serial/built-in step labels, and returns stable unambiguous configured-member labels.
- Event context is optional for legacy records; invalid explicit context is rejected as unusable rather than falling back into a live legacy execution, and execution/attempt identifiers are never selected as metric dimensions.

**Files:**
- src/conductor/src/types/events.ts
- src/conductor/src/engine/execution-identity.ts
- src/conductor/test/engine/execution-identity.test.ts

**Dependencies:** none

### Task 2: Centralize tracked lifecycle start, settlement, and terminal ownership
**Story:** Story 1
**Story:** Story 4
**Type:** infrastructure

**Steps:**
1. Write scoped failing coverage for the observations in Done when at the named boundary. Use unit scope for internal transitions; the dispatch/forwarding tasks own their named entry-point integration proof.
2. Verify RED, then implement: Extract or extend emitExecutionEvent's open/closing state and ordered event delivery into an engine-owned execution scope. Preserve its terminal promise joining and persistence-error propagation. Model admission/start, optional member settlement, terminal classification, and closure as typed transitions. A retry retains the scope; a redispatch creates another. Member settlement freezes the work boundary while terminal classification can wait for the join. Use the existing epoch-anchored monotonic clock semantics and injected test clock. Do not call OTel or mutate gate state here.
3. Verify GREEN with the scoped tests and applicable type checking, then commit with message: "centralize tracked lifecycle start, settlement, and terminal ownership".

**Done when:**
- The shared lifecycle scope emits one start per admitted execution and at most one terminal, keeps retry lifetime under the same ID, and rejects duplicate or late closure of another execution.
- The lifecycle settlement transition preserves a member's finish boundary through delayed classification, while a serial execution without a separate settlement observation retains its current start-to-terminal boundary; never-admitted work emits no start or duration.

**Files:**
- src/conductor/src/engine/execution-lifecycle.ts
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/execution-lifecycle.test.ts

**Dependencies:** Task 1

### Task 3: Persist correlated member intervals and frozen settlement boundaries
**Story:** Story 1
**Story:** Story 6
**Type:** infrastructure

**Steps:**
1. Write scoped failing coverage for the observations in Done when at the named boundary. Use unit scope for internal transitions; the dispatch/forwarding tasks own their named entry-point integration proof.
2. Verify RED, then implement: Key EventPersister's open intervals by the shared resolver, retaining legacy behavior when context is absent. On the context-bearing group_member_step result, record the member finish boundary with the persister's IntervalClock; terminal activeInterval uses that frozen end rather than join delivery time. Keep this boundary inside the existing event schema and ledger. Persist member results before handshake/join work; do not create a sidecar or derive duration from audit ts. Duplicate terminals cannot consume another execution's interval. Keep group envelope intervals independent.
3. Verify GREEN with the scoped tests and applicable type checking, then commit with message: "persist correlated member intervals and frozen settlement boundaries".

**Done when:**
- EventPersister writes activeInterval for a member from its own admitted start to observed settlement even when terminal classification is delayed; group intervals remain separate and no queued-member interval is fabricated.
- Temporary-ledger tests prove legacy records still persist, interleaved IDs cannot overwrite intervals, and malformed/orphan evidence is not promoted to a valid correlated interval.

**Files:**
- src/conductor/src/engine/event-persister.ts
- src/conductor/test/engine/event-persister.test.ts

**Dependencies:** Task 1, Task 2

### Task 4: Teach timing rollups execution correlation without changing elapsed union
**Story:** Story 4
**Story:** Story 6
**Type:** infrastructure

**Steps:**
1. Write scoped failing coverage for the observations in Done when at the named boundary. Use unit scope for internal transitions; the dispatch/forwarding tasks own their named entry-point integration proof.
2. Verify RED, then implement: Use the shared event identity resolver in collectExecutionEvidence for context-bearing starts/terminals. Preserve repeated legacy-start counts, legacy refusal handling, malformed-ledger degradation and reason vocabulary. Do not reconcile an old start from a later start. Keep existing interval union/intersection and provider-evidence partition logic. Exercise persisted group/member envelopes via temporary-ledger integration, not only hand-normalized interval arrays.
3. Verify GREEN with the scoped tests and applicable type checking, then commit with message: "teach timing rollups execution correlation without changing elapsed union".

**Done when:**
- The timing-rollup entry point reads both legacy and correlated ledgers; repeated legacy starts and unrecoverable open executions stay partial with a reason, and malformed/unmatched evidence never becomes fabricated measured time.
- Overlapping member and group activeInterval records produce the union elapsed total rather than the sum, while independent member intervals remain present in the persisted ledger.

**Files:**
- src/conductor/src/engine/timing-rollup.ts
- src/conductor/test/engine/timing-rollup.test.ts

**Dependencies:** Task 1, Task 3

### Task 5: Carry execution context through provider invocation callbacks
**Story:** Story 2
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write scoped failing coverage for the observations in Done when at the named boundary. Use unit scope for internal transitions; the dispatch/forwarding tasks own their named entry-point integration proof.
2. Verify RED, then implement: Add optional execution context to StepRunOptions and provider-attempt callback metadata. Propagate it through each invocation's callback closure in scalar/provider-aware paths, including unavailable candidates, retries and fallback. Use the existing providerAttempt/onAttempt seam and preserve its actual resolved dimensions; never store current execution in shared mutable runner state. Keep verdict runId and provider lifecycle attempt IDs unchanged. Both index.ts and daemon-cli.ts event emitters forward the additional metadata onto the same bus. Do not instrument auxiliary rubric executions as independent lifecycle steps.
3. Verify GREEN with the scoped tests and applicable type checking, then commit with message: "carry execution context through provider invocation callbacks".

**Done when:**
- Production runner/provider callback wiring emits each provider observation with its owning execution context and actual resolved dimensions, preserving unavailable-preferred fallback reason through successful fallback without changing verdict runId or provider attempt identity.
- Interleaved invocation tests prove no sibling context/dimension leakage, missing metadata stays absent, and non-invoked candidates remain non-invoked with unchanged retry/provider selection behavior.

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/src/engine/step-runners.ts
- src/conductor/src/engine/provider-execution.ts
- src/conductor/src/index.ts
- src/conductor/src/daemon-cli.ts
- src/conductor/test/engine/provider-execution.test.ts

**Dependencies:** Task 1

### Task 6: Correlate dispatch metering and compatibility suppression
**Story:** Story 3
**Story:** Story 6
**Type:** infrastructure

**Steps:**
1. Write scoped failing coverage for the observations in Done when at the named boundary. Use unit scope for internal transitions; the dispatch/forwarding tasks own their named entry-point integration proof.
2. Verify RED, then implement: Extend DispatchMeteringTracker's successful-attempt/compatibility-completion matching to execution identity and subject while preserving legacy step/provider matching for context-free records. Retain provider_attempt authority and invoked filtering. Return the shared stable step label for configured members. Do not count a member result or lifecycle-only row as a dispatch; do not sum completion usage again. Preserve attribution-bearing legacy completion fallback and absence/cost-unmetered distinctions.
3. Verify GREEN with the scoped tests and applicable type checking, then commit with message: "correlate dispatch metering and compatibility suppression".

**Done when:**
- DispatchMeteringTracker counts each invoked provider attempt once and suppresses only its own matching compatibility completion, so interleaved same-name executions retain exact dispatch/token/cost totals.
- Legacy attribution-bearing unmatched completions remain supported, provider-free completions count no dispatch, and non-invoked or lifecycle-only observations do not consume retry or dispatch counts.

**Files:**
- src/conductor/src/engine/dispatch-metering.ts
- src/conductor/test/engine/dispatch-metering.test.ts

**Dependencies:** Task 1, Task 5

### Task 7: Project member duration and attribution through the single metrics listener
**Story:** Story 1
**Story:** Story 2
**Story:** Story 6
**Type:** infrastructure

**Steps:**
1. Write scoped failing coverage for the observations in Done when at the named boundary. Use unit scope for internal transitions; the dispatch/forwarding tasks own their named entry-point integration proof.
2. Verify RED, then implement: Replace step-name-only open/dimension maps with the shared execution key and feature scope. Capture context-bearing member settlement from the bus to freeze elapsed time; terminal recording uses that boundary. Keep no-I/O handler behavior and one MetricsListener on daemon root or interactive bus. Feed stable subject labels and supported dimensions through MetricsRecorder; never place execution IDs on metric Resource or points. Preserve metric name, millisecond unit, and existing serial/built-in labels.
3. Verify GREEN with the scoped tests and applicable type checking, then commit with message: "project member duration and attribution through the single metrics listener".

**Done when:**
- Events delivered through MetricsListener.start export exactly one millisecond duration per closed execution, use its frozen member end when available, and keep interleaved feature/group/member dimensions independent.
- Exported metric data points and Resource retain existing identity/step contracts and omit execution/attempt IDs, free-text fallback reasons, and unknown dimensions; compatible completion records do not duplicate dispatch accounting.

**Files:**
- src/conductor/src/engine/otel/metrics-listener.ts
- src/conductor/src/engine/otel/metrics.ts
- src/conductor/test/engine/otel/metrics-listener.test.ts

**Dependencies:** Task 1, Task 3, Task 5, Task 6

### Task 8: Project retries and refusal terminals into metrics without duplication
**Story:** Story 3
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write scoped failing coverage for the observations in Done when at the named boundary. Use unit scope for internal transitions; the dispatch/forwarding tasks own their named entry-point integration proof.
2. Verify RED, then implement: Handle policy retries with correlated failed-attempt dimensions and accurate counts, preserving zero-retry absence. Add real OTel handling for refusal and the context-bearing member settlement observation using the exhaustive sink/handler registries; group ceremony is not promoted into member duration. A refusal with a started scope closes its duration once and remains refusal; pre-start refusal creates no duration. Preserve legacy orphan-retry behavior. Rate-limit recovery is not a policy retry.
3. Verify GREEN with the scoped tests and applicable type checking, then commit with message: "project retries and refusal terminals into metrics without duplication".

**Done when:**
- Metrics retry projection records the actual policy retry count and failed-attempt dimensions, emits no zero-filled retry point, and does not treat rate-limit waits or non-invoked candidates as retries.
- Refusal and failed terminals close only their own started duration once, never fabricate a pre-start observation, and exhaustive sink/handler coverage includes every newly projected event type.

**Files:**
- src/conductor/src/engine/otel/metrics-listener.ts
- src/conductor/src/engine/otel/metrics.ts
- src/conductor/src/engine/event-sinks.ts
- src/conductor/test/engine/otel/metrics-listener.test.ts

**Dependencies:** Task 2, Task 6, Task 7

### Task 9: Correlate spans and per-execution provider attributes
**Story:** Story 1
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write scoped failing coverage for the observations in Done when at the named boundary. Use unit scope for internal transitions; the dispatch/forwarding tasks own their named entry-point integration proof.
2. Verify RED, then implement: Key span state by execution identity using the shared resolver with legacy fallback. Retain existing run parenting, serial names and attributes; add configured parent/member context and a stable subject span label. Preserve attempt fallback context through successful candidate updates. Capture member settlement end time for later terminal closure instead of ending at the slower group's join. Use OTel's existing explicit end-time support and consistent clock conversion; do not create a metric recorder in the visualizer.
3. Verify GREEN with the scoped tests and applicable type checking, then commit with message: "correlate spans and per-execution provider attributes".

**Done when:**
- The production visualizer event path creates distinct spans under the correct run for interleaved executions, closes member spans at their observed finish boundary, and preserves existing serial/built-in names.
- Span attribution retains the owning execution's provider/model/effort/tier and fallback reason, omits absent usage/dimensions, and cannot be replaced by a late observation from an older execution or sibling.

**Files:**
- src/conductor/src/engine/otel/span-manager.ts
- src/conductor/src/engine/otel/otel-visualizer.ts
- src/conductor/test/engine/otel/span-manager.test.ts

**Dependencies:** Task 1, Task 5, Task 6

### Task 10: Close span outcomes truthfully on refusal, failure, and halt
**Story:** Story 4
**Story:** Story 5
**Story:** Story 6
**Type:** negative-path

**Steps:**
1. Write scoped failing coverage for the observations in Done when at the named boundary. Use unit scope for internal transitions; the dispatch/forwarding tasks own their named entry-point integration proof.
2. Verify RED, then implement: Add explicit refusal handler and terminal classification to spans: status attribute distinguishes refused, failed, and incomplete; refusal must not be represented as successful completion or work-failed error. Preserve ERROR for genuine failed work and existing incomplete root cleanup. Use captured member finish time at delayed terminal classification. Keep matching-start requirement, late-terminal isolation, and spans-only operation. Update traced-event handler coverage if introduced by upstream #2395; otherwise the existing subscription seam must handle the same declared traced set.
3. Verify GREEN with the scoped tests and applicable type checking, then commit with message: "close span outcomes truthfully on refusal, failure, and halt".

**Done when:**
- Refused, failed, and interrupted executions produce distinct truthful span outcomes with one closure, while duplicate terminals and legacy orphan completions create no extra span or success.
- Visualizers remain spans-only and their disabled/throwing export path cannot change execution or gate behavior; registry-derived subscriptions include real refusal/member-settlement handlers and no undeclared traced effects.

**Files:**
- src/conductor/src/engine/otel/span-manager.ts
- src/conductor/src/engine/otel/otel-visualizer.ts
- src/conductor/src/engine/event-sinks.ts
- src/conductor/test/engine/otel/span-manager.test.ts
- src/conductor/test/engine/otel/otel-visualizer.test.ts

**Dependencies:** Task 2, Task 8, Task 9

### Task 11: Make group member lifecycle observations complete and required
**Story:** Story 1
**Story:** Story 3
**Story:** Story 4
**Type:** infrastructure

**Steps:**
1. Write scoped failing coverage for the observations in Done when at the named boundary. Use unit scope for internal transitions; the dispatch/forwarding tasks own their named entry-point integration proof.
2. Verify RED, then implement: Replace the optional production instrumentation callback contract with a required typed observer for runGroupBranch callers. Emit logical start only after actual admission, attempt metadata at each invocation, policy retry only when the policy budget advances, and one settled observation on every returned outcome. Preserve richer terminal metadata instead of dropping StepRunResult dimensions/usage. Cover thrown work, exhausted retries, auth/permission outcomes, rate limit, and abort before admission. Emit settlement before asynchronous caller handshake work; keep the existing callback functionality for verdict identity and completion bookkeeping. Do not touch runAuxiliaryGroupBranch semantics.
3. Verify GREEN with the scoped tests and applicable type checking, then commit with message: "make group member lifecycle observations complete and required".

**Done when:**
- runGroupBranch with an injected observer reports one admitted lifecycle, every actual policy retry, and one settlement for success, thrown/exhausted work, refusal-shaped outcomes and admitted abort, retaining metadata and observed intervals.
- A queued/pre-admission abort produces no start or duration, rate-limit recovery preserves retry budget, and production group callers cannot omit the observer while auxiliary branch execution stays outside this contract.

**Files:**
- src/conductor/src/engine/group-core.ts
- src/conductor/test/engine/group-core.test.ts

**Dependencies:** Task 1, Task 2, Task 5

### Task 12: Wire serial execution to shared lifecycle ownership
**Story:** Story 1
**Story:** Story 3
**Story:** Story 4
**Story:** Story 5
**Type:** infrastructure

**Steps:**
1. Write scoped failing coverage for the observations in Done when at the named boundary. Use unit scope for internal transitions; the dispatch/forwarding tasks own their named entry-point integration proof.
2. Verify RED, then implement: Replace serial start/retry/terminal tracking with the shared execution scope at existing boundaries; carry the same scope in StepRunOptions across retries. Retain serial state/gate sequencing and normal start-to-terminal duration. Wire refusal, retry exhaustion and catchable exits to the same terminal owner. Use a bounded Conductor fixture beginning at a chosen serial step, pre-resolve unrelated state, and stop at its completion/refusal boundary. Capture actual bus, persister and in-memory exports.
3. Verify GREEN with the scoped tests and applicable type checking, then commit with message: "wire serial execution to shared lifecycle ownership".

**Done when:**
- The real serial dispatch entry emits one correlated lifecycle and one span/duration for ordinary success, width-one fallback, retry-success and exhaustion without changing existing dispatch policy, timing boundary, metric names, or step labels.
- Serial refusal closes truthfully without a failed/success substitute; telemetry disabled or exporter failure leaves serial gate/state and checkpoint behavior unchanged.

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor-telemetry-parity.test.ts

**Dependencies:** Task 2, Task 5, Task 7, Task 8, Task 9, Task 10

### Task 13: Wire built-in admission and settlement with registry-derived parity coverage
**Story:** Story 1
**Story:** Story 3
**Story:** Story 7
**Type:** infrastructure

**Steps:**
1. Write scoped failing coverage for the observations in Done when at the named boundary. Use unit scope for internal transitions; the dispatch/forwarding tasks own their named entry-point integration proof.
2. Verify RED, then implement: Supply shared instrumentation for every dispatchGroupRound member after runWithConcurrency admission, retaining the same logical scope across branch retries. Emit the member settlement observation before verdict identity/handshake work so its finish boundary freezes. Derive coverage cases from the real group registry, not a parallel list. Use an integration matrix through Conductor for each dispatchable member, width-two/three, cap-one multiple eligible members and unequal fake clock durations. Stop at join using a deterministic fixture endpoint. A controlled observer omission must be detected by the behavior assertions; do not source-match emitted text. Wire ordinary all-green member terminal emission at the existing join in this task, using the frozen boundary; Task 17 extends classification to the objective-failure/refusal paths.
3. Verify GREEN with the scoped tests and applicable type checking, then commit with message: "wire built-in admission and settlement with registry-derived parity coverage".

**Done when:**
- Conductor's actual built-in group entry yields member-specific lifecycle, duration and span output for every registry-derived applicable member, including cap-one and wider groups, with exact own-work timing excluding queue, siblings and delayed join.
- The registry-derived parity fixture fails when a dispatched member's emission is omitted and includes a newly supplied member or proves its real skip; it uses fake providers/exporters, bounded completion evidence and awaited cleanup.
- Built-in retry telemetry agrees with serial retry counts and lifetime semantics, while legitimate skipped members and width-one degradation retain zero/one observation as applicable.

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor-telemetry-parity.test.ts

**Dependencies:** Task 3, Task 4, Task 7, Task 8, Task 9, Task 10, Task 11, Task 12

### Task 14: Wire configured groups with stable member attribution and advisory semantics
**Story:** Story 1
**Story:** Story 2
**Story:** Story 5
**Story:** Story 7
**Type:** infrastructure

**Steps:**
1. Write scoped failing coverage for the observations in Done when at the named boundary. Use unit scope for internal transitions; the dispatch/forwarding tasks own their named entry-point integration proof.
2. Verify RED, then implement: Supply the shared observer in runParallelGroupViaCore with configured-member subjects retaining parent group identity; mint per-execution scope after admission and pass context into the runner. Preserve parent-derived phase/policy resolution and current synthetic state keys, group advisory behavior and caps. Use the same observable parity assertions as the serial/built-in fixture, with a real configured-group entry and controlled runner. Include identically named members across groups, no-usage results and advisory failures. Do not register configured names as lifecycle steps.
3. Verify GREEN with the scoped tests and applicable type checking, then commit with message: "wire configured groups with stable member attribution and advisory semantics".

**Done when:**
- The real configured-group entry exports one own-duration/span per admitted member with stable parent/member identity and correct provider context, and same-name members in different groups never collide.
- Configured advisory failures remain visible as failed members while the existing advisory group result, policy lookup, caps and state keys are preserved; skipped/cancelled-before-admission work emits no observation.
- The shared parity matrix includes configured execution and detects an omitted lifecycle after the fake runner dispatched, without any third-party calls or unrelated workflow completion.

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor-telemetry-parity.test.ts

**Dependencies:** Task 1, Task 3, Task 4, Task 7, Task 8, Task 9, Task 10, Task 11, Task 12

### Task 15: Close serial and member scopes exactly once during shutdown races
**Story:** Story 2
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write scoped failing coverage for the observations in Done when at the named boundary. Use unit scope for internal transitions; the dispatch/forwarding tasks own their named entry-point integration proof.
2. Verify RED, then implement: Route closeOpenExecutions, halt/live-boundary and graceful-signal cleanup through common scope closure, including members, without clearing newer scopes by name. Preserve existing signal behavior and branch join state retention. Use injected shutdown triggers and deferred promises to order result-versus-close races; never signal a real operator process. Stop at cleanup and await all branch promises. Observe persister balance and exported outcomes together.
3. Verify GREEN with the scoped tests and applicable type checking, then commit with message: "close serial and member scopes exactly once during shutdown races".

**Done when:**
- Graceful shutdown/catchable halt through the real conductor cleanup closes every started serial/member execution once with a truthful outcome, and leaves queued members without fabricated starts or duration.
- A result racing shutdown or arriving after redispatch cannot close or reattribute a newer execution; the persisted stream has no duplicate terminal and span output has no duplicate closure.

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor-telemetry-parity.test.ts
- src/conductor/test/engine/execution-lifecycle.test.ts

**Dependencies:** Task 2, Task 12, Task 13, Task 14

### Task 16: Preserve execution context through forwarding and operator rendering
**Story:** Story 2
**Story:** Story 5
**Story:** Story 6
**Type:** infrastructure

**Steps:**
1. Write scoped failing coverage for the observations in Done when at the named boundary. Use unit scope for internal transitions; the dispatch/forwarding tasks own their named entry-point integration proof.
2. Verify RED, then implement: Use the shared subject resolver in affected presentation consumers and preserve context when feature-scoped events are copied to the daemon root bus. Keep one feature-ledger copy and existing daemon-origin persistence policy. Do not change conductor state from a telemetry subject. Audit consumers of touched variants for step-name map assumptions, updating only those used for correlation or display. Extend the forwarding fixture to interleave two feature streams with same-named configured branches and to exercise a failed export projection.
3. Verify GREEN with the scoped tests and applicable type checking, then commit with message: "preserve execution context through forwarding and operator rendering".

**Done when:**
- Feature-bus forwarding into the single daemon MetricsListener preserves execution/feature identity and yields independent attributed exports for interleaved streams, with one ledger copy under the existing forwarding policy.
- Operator event/report rendering distinguishes configured parent/member subjects and refusal without mutating gate state; disabled or throwing OTel consumers leave forwarding and the persister's existing error policy intact.

**Files:**
- src/conductor/src/engine/event-persister.ts
- src/conductor/src/daemon-cli.ts
- src/conductor/src/ui/terminal-renderer.ts
- src/conductor/src/engine/report-renderer.ts
- src/conductor/test/engine/event-persister-wiring.test.ts

**Dependencies:** Task 1, Task 3, Task 7, Task 9

### Task 17: Finalize validation failures and refusals without extending member duration
**Story:** Story 1
**Story:** Story 4
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write scoped failing coverage for the observations in Done when at the named boundary. Use unit scope for internal transitions; the dispatch/forwarding tasks own their named entry-point integration proof.
2. Verify RED, then implement: At existing group decision branches, finalize each settled scope with its authoritative execution/refusal/failure classification while retaining the earlier work-finish boundary. Cover all-green, failed/no-verdict, objective evidence/handshake refusal, mixed sibling result and a passing member alongside a failed sibling. Never emit a successful terminal merely from runner.success before the relevant classification is known. Gate/state commits remain exactly at the existing single-writer join. Add bounded join integration fixtures with valid gate evidence only where verifyArtifacts is required and an endpoint before publication; compare telemetry-enabled/disabled/failing-exporter behavior.
3. Verify GREEN with the scoped tests and applicable type checking, then commit with message: "finalize validation failures and refusals without extending member duration".

**Done when:**
- The group join finalizes each member once using the existing objective verdict/handshake classification and its frozen finish boundary, so a later refusal/failure cannot be misreported as runner success or inherit sibling/join elapsed time.
- Mixed-success/failure and advisory-group Conductor fixtures preserve existing gate/state results and block publication when required; no member telemetry operation commits gate satisfaction or changes retry/provider/checkpoint policy.
- Enabled, disabled and throwing OTel projections produce identical dispatch and state/gate behavior at the join, and persistence errors retain their existing distinct failure policy.

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor-telemetry-parity.test.ts

**Dependencies:** Task 2, Task 13, Task 14, Task 15

## Task Dependency Graph

Tasks declare the authoritative acyclic dependencies above. Independent roots are Task 1's consumers: lifecycle (2), invocation context (5). Persistence (3→4), metering (6), metrics (7→8), and spans (9→10) converge at serial integration (12). Group observation (11) feeds built-in (13) and configured (14) integrations. Shutdown (15) and forwarding (16) retain distinct boundary ownership; validation classification (17) completes its specific negative paths, not an aggregate validation task.

## Integration Points

| Changed behavior | Sole boundary-proof owner |
| --- | --- |
| Provider invocation emits execution-scoped attempts | Task 5 |
| Events become correlated persisted intervals | Task 3 |
| Persisted evidence becomes historical/union timing results | Task 4 |
| Correlated events become metric duration and dimensions | Task 7 |
| Retry/refusal events become metric effects | Task 8 |
| Correlated events become spans and provider attributes | Task 9 |
| Refusal/interruption events become truthful span terminals | Task 10 |
| Serial dispatch uses shared lifecycle | Task 12 |
| Built-in registry membership reaches instrumentation | Task 13 |
| Configured member dispatch reaches instrumentation | Task 14 |
| Catchable conductor shutdown closes executions | Task 15 |
| Feature forwarding preserves correlation and rendering | Task 16 |
| Authoritative validation join finalizes negative outcomes | Task 17 |

Tasks 1, 2, 6 and 11 may prove their internal behavior below Conductor; the above tasks own real production-boundary proof. Story 7's registry matrix belongs to the changed built-in/configured wiring tasks, not a terminal test-only task.

## Coverage Check

All criteria are diff-local: test inputs exercise the named behaviors on the feature revision with controlled registry variations, clocks, providers and exporters. No criterion depends on live Grafana data, a future actual dispatch, or another PR landing. Coverage does not promise immunity to arbitrary future code changes; it promises a test that detects the defined omission.

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given equivalent successful work runs serially, as a built-in group member, or as a configured group member, when its execution completes, then each execution contributes exactly one duration observation in milliseconds and one attributable step span under its run trace, with equivalent outcome and timing semantics. | 7, 9, 12, 13, 14 | "Conductor's actual built-in group entry yields member-specific lifecycle, duration and span output for every registry-derived applicable member, including cap-one and wider groups, with exact own-work timing excluding queue, siblings and delayed join." | diff-local |
| Story 1 happy: Given a group with unequal member durations and a concurrency cap below its member count, when its members complete, then each member's duration excludes time queued before admission, slower siblings' work, and deferred group-join work; a delayed final classification retains that member's observed finish boundary. | 2, 3, 7, 9, 13, 17 | "The group join finalizes each member once using the existing objective verdict/handshake classification and its frozen finish boundary, so a later refusal/failure cannot be misreported as runner success or inherit sibling/join elapsed time." | diff-local |
| Story 1 negative: Given group membership degrades to one eligible member, when that member executes through the serial path, then its timing and span are recorded once, with no duplicate group/member observation. | 12, 13 | "The real serial dispatch entry emits one correlated lifecycle and one span/duration for ordinary success, width-one fallback, retry-success and exhaustion without changing existing dispatch policy, timing boundary, metric names, or step labels." | diff-local |
| Story 1 negative: Given a member is skipped or cancelled before admission, when the remaining group executes, then that member creates no execution span or duration observation, including no zero-duration substitute. | 11, 13, 14 | "A queued/pre-admission abort produces no start or duration, rate-limit recovery preserves retry budget, and production group callers cannot omit the observer while auxiliary branch execution stays outside this contract." | diff-local |
| Story 2 happy: Given two configured groups contain identically named members and their observations interleave with another feature's observations, when telemetry is projected, then each observation belongs to the correct feature, run, parent group, and member; configured member labels are stable and unambiguous while existing lifecycle step labels remain unchanged. | 1, 5, 7, 9, 14, 16 | "Feature-bus forwarding into the single daemon MetricsListener preserves execution/feature identity and yields independent attributed exports for interleaved streams, with one ledger copy under the existing forwarding policy." | diff-local |
| Story 2 happy: Given a preferred provider is unavailable and a fallback executes a member, when that execution closes, then its span and metrics carry the same supported provider/model/effort/tier and fallback attribution as equivalent serial execution, with fallback reason retained as trace context. | 5, 7, 9 | "Span attribution retains the owning execution's provider/model/effort/tier and fallback reason, omits absent usage/dimensions, and cannot be replaced by a late observation from an older execution or sibling." | diff-local |
| Story 2 negative: Given an earlier execution closes late after the same step/member has been redispatched, when its terminal or provider observation arrives, then it neither closes the new execution nor replaces the new execution's attribution. | 1, 2, 5, 7, 9, 15 | "A result racing shutdown or arriving after redispatch cannot close or reattribute a newer execution; the persisted stream has no duplicate terminal and span output has no duplicate closure." | diff-local |
| Story 2 negative: Given a provider omits usage or dispatch dimensions, when concurrent telemetry is exported, then absent values remain absent and are never borrowed from a sibling; execution/attempt IDs and free-text fallback reasons never enter metric data-point labels or metric Resource attributes. | 1, 5, 7, 9 | "Exported metric data points and Resource retain existing identity/step contracts and omit execution/attempt IDs, free-text fallback reasons, and unknown dimensions; compatible completion records do not duplicate dispatch accounting." | diff-local |
| Story 3 happy: Given an execution fails once and succeeds on its next policy attempt, when it settles in any of the three scheduling modes, then it has one logical execution span and duration covering its retry lifetime, one policy retry, and the actual invoked provider attempts counted exactly once. | 6, 8, 11, 12, 13 | "The real serial dispatch entry emits one correlated lifecycle and one span/duration for ordinary success, width-one fallback, retry-success and exhaustion without changing existing dispatch policy, timing boundary, metric names, or step labels." | diff-local |
| Story 3 happy: Given a retry changes the resolved model or effort, when retry and terminal telemetry are exported, then observations carry their own resolved attempt metadata and the final execution's terminal attribution, without resetting the execution start time. | 5, 8, 9, 11, 12 | "Metrics retry projection records the actual policy retry count and failed-attempt dimensions, emits no zero-filled retry point, and does not treat rate-limit waits or non-invoked candidates as retries." | diff-local |
| Story 3 negative: Given a member waits for a rate-limit episode or encounters a non-invoked provider candidate, when execution resumes, then that wait/candidate is not counted as a budget-consuming retry or an invoked dispatch; siblings retain independent accounting. | 6, 8, 11 | "A queued/pre-admission abort produces no start or duration, rate-limit recovery preserves retry budget, and production group callers cannot omit the observer while auxiliary branch execution stays outside this contract." | diff-local |
| Story 3 negative: Given every permitted work attempt fails or throws, when retries are exhausted, then the execution closes once as failed with its real retry count and elapsed time, and emits no success observation or extra attempt beyond the existing policy. | 8, 10, 11, 12 | "The real serial dispatch entry emits one correlated lifecycle and one span/duration for ordinary success, width-one fallback, retry-success and exhaustion without changing existing dispatch policy, timing boundary, metric names, or step labels." | diff-local |
| Story 4 happy: Given work fails or an execution is refused at an existing refusal boundary, when the terminal decision is emitted in any scheduling mode, then its duration/span closes once and distinguishes failure from refusal; refusal does not become success or work failure. | 8, 10, 12, 17 | "Refused, failed, and interrupted executions produce distinct truthful span outcomes with one closure, while duplicate terminals and legacy orphan completions create no extra span or success." | diff-local |
| Story 4 happy: Given graceful shutdown or a catchable halt occurs with admitted members in flight, when cleanup completes, then each started execution has one corresponding terminal record and closed span with its actual terminal meaning, while queued members remain without execution observations. | 3, 10, 15 | "Graceful shutdown/catchable halt through the real conductor cleanup closes every started serial/member execution once with a truthful outcome, and leaves queued members without fabricated starts or duration." | diff-local |
| Story 4 negative: Given a member resolves concurrently with shutdown or sends a duplicate terminal, when both paths finish, then only one terminal closes that execution and no newer execution is affected. | 2, 10, 15 | "A result racing shutdown or arriving after redispatch cannot close or reattribute a newer execution; the persisted stream has no duplicate terminal and span output has no duplicate closure." | diff-local |
| Story 4 negative: Given a process cannot emit a terminal after an unrecoverable death, when its ledger is read later, then its timing remains explicitly incomplete; no terminal, successful duration, or zero-duration observation is invented from later runs. | 4 | "The timing-rollup entry point reads both legacy and correlated ledgers; repeated legacy starts and unrecoverable open executions stay partial with a reason, and malformed/unmatched evidence never becomes fabricated measured time." | diff-local |
| Story 5 happy: Given one validation member finishes successfully before a slower sibling whose verdict fails, when telemetry and the group join complete, then the first member retains its own timing while the group follows the existing non-green gate/remediation result and does not advance publication prematurely. | 13, 17 | "Mixed-success/failure and advisory-group Conductor fixtures preserve existing gate/state results and block publication when required; no member telemetry operation commits gate satisfaction or changes retry/provider/checkpoint policy." | diff-local |
| Story 5 happy: Given a configured group has an advisory member failure, when that group joins, then the failed member remains visible as failed while the group's outcome follows its existing advisory policy; scheduling caps, provider selection, and checkpoint behavior remain unchanged. | 14 | "Configured advisory failures remain visible as failed members while the existing advisory group result, policy lookup, caps and state keys are preserved; skipped/cancelled-before-admission work emits no observation." | diff-local |
| Story 5 negative: Given a successful runner result later fails its objective evidence check or refusal handshake, when the authoritative outcome is determined, then member execution telemetry does not grant gate satisfaction, overwrite the non-green state, or misrepresent the eventual refusal/failure. | 17 | "The group join finalizes each member once using the existing objective verdict/handshake classification and its frozen finish boundary, so a later refusal/failure cannot be misreported as runner success or inherit sibling/join elapsed time." | diff-local |
| Story 5 negative: Given an OTel projection/exporter is disabled, unavailable, or throws, when an otherwise identical execution runs, then its dispatches, retries, gate outcomes, and state writes match the execution with working telemetry; event persistence retains its existing failure policy. | 10, 12, 16, 17 | "Enabled, disabled and throwing OTel projections produce identical dispatch and state/gate behavior at the join, and persistence errors retain their existing distinct failure policy." | diff-local |
| Story 6 happy: Given a historical ledger without execution context, when existing telemetry/timing readers process it, then its prior supported interpretation remains available; a new context-bearing ledger also pairs executions correctly through the same reader path. | 1, 3, 4 | "The timing-rollup entry point reads both legacy and correlated ledgers; repeated legacy starts and unrecoverable open executions stay partial with a reason, and malformed/unmatched evidence never becomes fabricated measured time." | diff-local |
| Story 6 happy: Given member intervals overlap each other and the group envelope, when feature elapsed time is calculated, then overlap is counted once by interval union while per-member durations remain separately observable. | 3, 4 | "Overlapping member and group activeInterval records produce the union elapsed total rather than the sum, while independent member intervals remain present in the persisted ledger." | diff-local |
| Story 6 negative: Given an invoked provider-attempt record and its compatible completion both carry provider data, when metrics and cost accounting consume them, then they count that invocation/usage once even when same-name executions interleave. | 6, 7, 16 | "DispatchMeteringTracker counts each invoked provider attempt once and suppresses only its own matching compatibility completion, so interleaved same-name executions retain exact dispatch/token/cost totals." | diff-local |
| Story 6 negative: Given malformed, unmatched, or incomplete historical lifecycle evidence, when it is processed, then it neither becomes a fabricated exact measurement nor closes an unrelated context-bearing execution; a legacy orphan completion does not create an orphan span. | 1, 3, 4, 10 | "The timing-rollup entry point reads both legacy and correlated ledgers; repeated legacy starts and unrecoverable open executions stay partial with a reason, and malformed/unmatched evidence never becomes fabricated measured time." | diff-local |
| Story 7 happy: Given the current built-in group registry, when parity coverage runs, then every dispatchable member is exercised through the actual grouped entry path and checked for member-specific lifecycle, duration, and span output, without a separately maintained member allowlist. | 11, 13 | "Conductor's actual built-in group entry yields member-specific lifecycle, duration and span output for every registry-derived applicable member, including cap-one and wider groups, with exact own-work timing excluding queue, siblings and delayed join." | diff-local |
| Story 7 happy: Given serial, width-one, cap-one multi-member, wider built-in, and configured-group paths, when the common parity scenarios run, then each path produces the applicable equivalent observations with all providers and exporters controlled locally. | 12, 13, 14 | "Conductor's actual built-in group entry yields member-specific lifecycle, duration and span output for every registry-derived applicable member, including cap-one and wider groups, with exact own-work timing excluding queue, siblings and delayed join." | diff-local |
| Story 7 negative: Given a dispatch still reaches its fake runner but member lifecycle emission is omitted, when the parity scenario runs, then its behavioral assertions fail on the missing lifecycle/duration/span rather than passing because the event type appears in an OTel registry. | 13, 14 | "The registry-derived parity fixture fails when a dispatched member's emission is omitted and includes a newly supplied member or proves its real skip; it uses fake providers/exporters, bounded completion evidence and awaited cleanup." | diff-local |
| Story 7 negative: Given a new built-in member or changed skip policy, when the coverage inventory resolves the production registry, then it exercises the new applicable member or demonstrates its legitimate non-dispatch; an unexercised member cannot silently satisfy coverage. | 11, 13 | "The registry-derived parity fixture fails when a dispatched member's emission is omitted and includes a newly supplied member or proves its real skip; it uses fake providers/exporters, bounded completion evidence and awaited cleanup." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-10-shared-step-lifecycle-telemetry#D1 | task | task-2, task-11, task-12, task-13, task-14, task-15, task-17 | The shared lifecycle scope emits one start per admitted execution and at most one terminal, keeps retry lifetime under the same ID, and rejects duplicate or late closure of another execution. |
| adr-2026-09-10-shared-step-lifecycle-telemetry#D2 | task | task-1, task-5, task-16 | The execution-identity resolver distinguishes same-name members in different parent groups and executions in different feature/run scopes, preserves serial/built-in step labels, and returns stable unambiguous configured-member labels. |
| adr-2026-09-10-shared-step-lifecycle-telemetry#D3 | task | task-2, task-3, task-7, task-9, task-13, task-17 | EventPersister writes activeInterval for a member from its own admitted start to observed settlement even when terminal classification is delayed; group intervals remain separate and no queued-member interval is fabricated. |
| adr-2026-09-10-shared-step-lifecycle-telemetry#D4 | task | task-2, task-8, task-10, task-11, task-15, task-17 | Graceful shutdown/catchable halt through the real conductor cleanup closes every started serial/member execution once with a truthful outcome, and leaves queued members without fabricated starts or duration. |
| adr-2026-09-10-shared-step-lifecycle-telemetry#D5 | task | task-1, task-3, task-4, task-7, task-8, task-9, task-10, task-16 | Exported metric data points and Resource retain existing identity/step contracts and omit execution/attempt IDs, free-text fallback reasons, and unknown dimensions; compatible completion records do not duplicate dispatch accounting. |
| adr-2026-09-10-shared-step-lifecycle-telemetry#D6 | task | task-5, task-6, task-7, task-8, task-9 | DispatchMeteringTracker counts each invoked provider attempt once and suppresses only its own matching compatibility completion, so interleaved same-name executions retain exact dispatch/token/cost totals. |
| adr-2026-09-10-shared-step-lifecycle-telemetry#D7 | task | task-12, task-13, task-14 | The registry-derived parity fixture fails when a dispatched member's emission is omitted and includes a newly supplied member or proves its real skip; it uses fake providers/exporters, bounded completion evidence and awaited cleanup. |

## Verification

- Every one of the 28 happy/negative criteria maps to concrete task completion checks and lowest-sufficient-layer proof.
- Every new ADR decision maps to behavior-owning tasks; all seven have exact Done-when evidence.
- Dependencies are explicit and acyclic; no task directs amendment of another feature's sealed artifacts.
- No catch-all terminal validation task or ordinary documentation task is included.
- Architecture constraints remain binding: one event spine, one metrics listener, separate policy identity, existing gate ownership, bounded metric dimensions, honest historical incompleteness.

## Verify-claims

CLEAR: existing producer/consumer and test seams were inspected; the precise changes above implement the approved decisions. Claims of implementation success remain for BUILD. Optional context and frozen settlement are planned changes, not statements that current main already supports them.

