# Implementation Plan: Provider setup failures preserve configured fallback

**Date:** 2026-09-11
**Source:** jstoup111/ai-conductor#1285
**Stories:** .docs/stories/unusable-provider-candidate-throws-instead-of-fall.md
**Design:** .docs/decisions/architecture-review-2026-09-11-unusable-provider-candidate-throws-instead-of-fall.md
**Conflict check:** PASS, operator-approved; .docs/conflicts/2026-09-11-unusable-provider-candidate-throws-instead-of-fall.md
**Tier:** M

## Summary

Seven behavior-owning tasks extend the existing provider candidate executor and preserve its outcome through callers. Explicit setup unavailability can reach a usable configured fallback; a list exhausted without invocation stops once, while actual runtime failures retain their retry policy.

## Technical Approach

Use an engine-owned typed setup error at verified capability checks, normalized only before provider invocation. Reuse the existing candidate ordering and safety wrapper. Add a typed `providerSetupExhaustion` result carrying ordered candidate reasons, propagated through ordinary, one-shot, and auxiliary mappings before they collapse failures into domain categories. The existing conductor stop machinery owns terminal handling. Candidate preparation owns resources until it transfers a successful invocation context; the executor owns teardown afterward. Existing attempt events and metering distinguish skips from work.

`unsupportedLifecycleProviderResult`, `classifyProviderCandidateFailure`, and `buildProviderAttemptMetadata` are the local pattern basis: explicit cause, recovery precedence, no-invocation attribution, and candidate-native context. Preserve those traits; exact symbol locations may move. This is semantic reuse, not an exact-copy declaration. No new provider selection loop, retry controller, external dependency, persistent store, or configuration option is authorized.

General scope includes ordinary and self-host execution. Readiness probe degradation, selected-policy loading/discovery errors, authentication failure, required-safety refusal, cancellation, and arbitrary exceptions are not setup-unavailability producers. Runtime provider/model unavailability keeps its established classification. A missing builtin isolation method is the reported concrete producer, not the general feature boundary.

## Prerequisites

Accepted Stories 1–4, approved lightweight architecture review, and clean conflict report are present. No new ADR was introduced, so there are no change-set ADR decision rows to author. Relevant existing approved decisions are cited in the architecture review. BUILD resolves symbol hints on its current checkout and must preserve the accepted behavior if overlapping work moved a seam.

The acceptance author owns any story-level acceptance fixtures before implementation. Each task below owns its scoped RED/GREEN proof and production edits; it is not permitted to add a terminal whole-feature verification task. All tests fake third-party providers, process creation, GitHub, and network calls. Process refusal fixtures must demonstrate the injected process boundary is effective before exercising unsafe arguments. Conductor fixtures declare the first step, expected dispatches, completion prerequisites, and an explicit termination point.

## Tasks

### Task 1: Represent explicit setup unavailability

**Story:** Story 1
**Type:** infrastructure

**Steps:**
Define engine-owned ProviderSetupUnavailable details (provider, reason, recovery action, and optional capability name), a branded ProviderSetupUnavailableError for verified setup producers, and a ProviderSetupExhaustion payload carrying a nonempty ordered candidate list. Add the optional providerSetupExhaustion result member to the shared invocation result contract; adapters do not author this terminal engine classification. Reject empty diagnostics or a mismatched provider at normalization. No error-message matching or run-wide setup cache is allowed. Keep the error constructor and predicate in the new engine module and transport-only types in the existing execution contract. The local precedent is unsupportedLifecycleProviderResult: explicit cause and not-invoked attribution, not arbitrary exception conversion. Write unit RED/GREEN cases for typed errors, ordinary Errors with identical text, plain objects, invalid payloads, and wrong-provider payloads. Commit: feat(provider): represent explicit setup unavailability.

**Done when:**
1. The provider-setup-failure constructor and normalizer accept a valid provider-owned setup error and reject ordinary Errors, plain objects, empty required diagnostics, and a payload naming another provider.
2. The shared result type carries a nonempty ProviderSetupExhaustion candidate list without overloading commandUnresolved, authFailure, permissionDenied, or modelUnavailable.

**Files:** `src/conductor/src/execution/llm-provider.ts`, `src/conductor/src/engine/provider-setup-failure.ts`, `src/conductor/test/engine/provider-setup-failure.test.ts`

**Dependencies:** none

### Task 2: Advance candidates for classified setup failure and preserve exhaustion

**Story:** Story 1
**Story:** Story 3
**Type:** happy-path

**Steps:**
Refactor the existing executeProviderCandidates iteration so candidate-native options/preparation can yield the explicit setup failure from Task 1. Normalize only within the pre-invocation preparation boundary; do not include actual adapter invocation, required-safety rejection, cancellation, or teardown errors in that catch. Integrate the existing missing-lifecycle-capability producer into the same explicit skipped-candidate accounting. Preserve existing candidate order, native model ladder, and recovery precedence. Keep a current-execution record of whether any candidate actually invoked; terminal setup-only exhaustion requires every candidate to have a classified unavailable result and no invocation, including correctly identified existing cached skips. Mixed exhaustion must retain existing runtime policy. Newly observed setup gaps remain candidate-local and do not write runWideUnavailable. Return providerSetupExhaustion when the list is exhausted before invocation; do not fabricate actualProvider or success. Write focused executor RED/GREEN cases for skip-to-success, early success, scalar exhaustion, two-candidate exhaustion, cached skip provenance, context-local eligibility on a later call, ordinary setup error, invalid configuration/registry, and an invoked failure followed by exhaustion. Commit: fix(provider): preserve setup skips inside candidate execution.

**Done when:**
1. executeProviderCandidates invokes the next configured candidate after explicit setup unavailability, stops on success, and never invokes an unconfigured provider; executor fixtures assert exact candidate call order.
2. executeProviderCandidates returns providerSetupExhaustion with every skipped reason only when no candidate invoked; scalar, two-candidate, and mixed post-invocation fixtures assert the exact distinction.
3. executeProviderCandidates retains ordinary preparation errors and configuration/registry failures without fallback, while a context-specific setup skip leaves the provider eligible in a later compatible execution.

**Files:** `src/conductor/src/engine/provider-execution.ts`, `src/conductor/test/engine/provider-execution.test.ts`

**Dependencies:** 1

### Task 3: Make the reported self-host capability failure release owned setup state

**Story:** Story 1
**Story:** Story 2
**Type:** happy-path

**Steps:**
Replace the verified missing Codex prepareSelfHostAuth/resolveSelfHostExecutable/provisionProviderHome capability throw with the explicit Task 1 error. Check known missing methods before acquiring the live-boundary window or scratch resources. Keep the source classification in the existing self-host preparation closure, while the shared executor remains general. Establish preparation-owned cleanup until an invocation context is returned; after return, existing executor teardown owns it. Use try/finally or an explicit ownership transfer to release a window/home acquired before subsequent preparation fails. Do not catch authentication or filesystem errors as capability absence. Reuse self-host wiring fixture traits: disposable feature roots, fake guardrail/provider boundaries, no real credential or process access. This task owns the original self-host regression integration: enter the real conductor-to-runner preparation flow, inject missing Codex capabilities, observe a successful fake Claude invocation, and stop at that dispatch result. Also inject allocation failure after window acquisition and overlapping independent setup contexts. Commit: fix(self-host): unwind unavailable candidate preparation.

**Done when:**
1. The real conductor self-host preparation and shared runner path skip Codex with missing required isolation methods and return successful Claude execution in provider-setup-self-host.integration.test.ts, with zero Codex invocations.
2. Self-host preparation releases each window and scratch context it acquired exactly once before the next candidate prepares, including allocation failure after window acquisition.
3. The self-host cleanup fixtures preserve another execution's resources, and filesystem/allocation errors retain their original failure rather than becoming provider unavailability.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/self-host/wiring.test.ts`, `src/conductor/test/integration/provider-setup-self-host.integration.test.ts`

**Dependencies:** 1, 2

### Task 4: Keep cleanup and lifecycle failures outside availability fallback

**Story:** Story 2
**Type:** negative-path

**Steps:**
Close the failure paths introduced by setup normalization. Ensure each preparation observer closes once and an already-transferred invocation context tears down once, without catching cleanup/verification failures as candidate unavailability. Preserve the withCandidateSafety wrapper and active spawnPermit; replacement candidate options cannot replace it. Before converting a setup failure, retain any existing cancellation or terminal safety authority. Preserve authentication, required permission/safety, readiness-probe degradation, and selected-policy loading failures; their existing typed paths remain outside the new capability-error producer. Write RED/GREEN cases injecting required cleanup failure, verification refusal, auth rejection, canceled/superseded preparation, and late completion after timeout. Use the existing lifecycle integration pattern: deterministic timer, fake process boundary, and assertions on permit and replacement counts. This task owns lifecycle/safety integration for the new branch, not a full conductor workflow. Commit: fix(provider): preserve lifecycle authority during setup fallback.

**Done when:**
1. The executor and candidate safety boundary refuse to start the next provider after required cleanup failure, verification refusal, authentication failure, or required permission/safety rejection.
2. The lifecycle-supervision integration observes the identical active spawnPermit on eligible fallback, zero replacements for a setup skip, and zero process creations after cancellation, timeout revocation, or supersession.
3. Observer and invocation-context teardown observations show exactly one release per acquired owner on the new setup-failure branch without masking the original terminal failure.

**Files:** `src/conductor/src/engine/provider-execution.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/provider-execution.test.ts`, `src/conductor/test/integration/provider-lifecycle-supervision.integration.test.ts`

**Dependencies:** 2, 3

### Task 5: Propagate setup-only exhaustion through ordinary step routing

**Story:** Story 1
**Story:** Story 3
**Type:** happy-path

**Steps:**
Carry providerSetupExhaustion from ProviderExecutionResult through DefaultStepRunner.toStepRunResult and StepRunResult. Handle that typed terminal disposition in the conductor before ordinary retry/escalation/kickback handling, while retaining auth/permission/lifecycle precedence. Use existing closeOpenExecutions, state persistence, writeHaltMarker and loop-halt publication rather than writing a new HALT path or ledger. An all-unusable setup is an operator-actionable needs-human stop naming the providers, reasons, and recovery actions; preserve the existing branch-visible halt record mechanism. Do not equate the new signal to commandUnresolved or create an unrelated automatic remediation dispatch. This task owns normal production configuration-to-runner-to-executor proof: use the real runner and executor, real config resolution and bounded conductor failure handling, faithful fake providers, and disposable state. Demonstrate either built-in provider missing the required lifecycle capability during non-self-host daemon execution followed by a supported successful provider. Add runner fixtures for ordinary setup callbacks, preferred success, provider-native model/effort/prompt/session/permission context, and no unconfigured/later invocation. With max_retries greater than one, distinguish all-setup exhaustion from a fallback runtime failure whose next normal retry succeeds. Commit: fix(conductor): stop setup exhaustion without spending retries.

**Done when:**
1. provider-setup-routing.integration.test.ts enters real non-self-host dispatch with Codex-first and Claude-first configuration and observes zero calls to the setup-unavailable provider, one successful native-context fallback invocation, and no retry or lifecycle replacement for the skip.
2. DefaultStepRunner.toStepRunResult retains providerSetupExhaustion, and conductor routing with retry allowance greater than one performs one all-setup pass then emits an operator-actionable stop with candidate reasons and no ordinary retry scheduling.
3. The real ordinary routing fixture gives a fallback runtime failure its normal retry and reaches scripted success on the next invocation; it does not relabel runtime failure, rate limit, session expiry, cancellation, or auth failure as setup-only exhaustion.
4. Runner invocation captures prove actual-candidate model, effort, skill syntax, fresh session, authentication and permission context, and early-success fixtures observe no later or unconfigured invocation.

**Files:** `src/conductor/src/engine/step-runners.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/step-runners.test.ts`, `src/conductor/test/integration/provider-setup-routing.integration.test.ts`

**Dependencies:** 2, 4

### Task 6: Preserve exhaustion across one-shot and auxiliary callers

**Story:** Story 3
**Type:** happy-path

**Steps:**
Thread the terminal signal through executeProviderAwareOneShotCore consumers and rubric result mappings, including preserveInvocationFailure and early branch-failure handling. Make executeAuxiliaryProviderCandidates return setup-only exhaustion immediately instead of advancing its ordinary retry loop. Inspect the actual one-shot result consumers on BUILD HEAD; where a domain decoder would collapse all failure into provider_unavailable or a generic branch failure, propagate the setup-only signal before that conversion. Preserve existing PrProseJudgmentResult timed_out/provider_unavailable mapping and existing policy-loading/auth/readiness result categories. The build-review aggregate must still block as an infrastructure failure with the terminal setup signal available to its owning step, never report accepted findings. Add a narrowly typed carrier in an existing aggregate result only where the real mapping needs it; do not add a new invocation loop or synthetic step. This task owns one-shot/auxiliary integration: exercise real runner/coordinator mapping with fake external adapters, retry allowance greater than one, all-setup failure, actual runtime retry, and mixed exhaustion. Bound each fixture at the result under test. Commit: fix(provider): retain setup exhaustion across auxiliary callers.

**Done when:**
1. Real one-shot and auxiliary caller fixtures preserve providerSetupExhaustion to their owning step after one ordered setup pass, with zero provider invocations and zero ordinary retry scheduling despite an allowance greater than one.
2. executeAuxiliaryProviderCandidates retries an ordinary invoked runtime failure according to its configured budget, while mixed post-invocation exhaustion is not marked setup-only.
3. Rubric and one-shot mappings retain setup-only failure before domain decoding; existing publication timed_out/provider_unavailable, policy-loading, readiness, auth and cancellation categories keep their original handling and no successful judgment is fabricated.

**Files:** `src/conductor/src/engine/step-runners.ts`, `src/conductor/src/engine/provider-execution.ts`, `src/conductor/src/engine/build-review-coordinator.ts`, `src/conductor/test/engine/step-runners.test.ts`, `src/conductor/test/integration/provider-setup-auxiliary.integration.test.ts`

**Dependencies:** 2, 5

### Task 7: Attribute setup skips through the existing event consumers

**Story:** Story 4
**Type:** happy-path

**Steps:**
Record normalized setup skips through buildProviderAttemptMetadata and existing onAttempt/warn callbacks. Preserve outcome unavailable and invoked false; omit invented model usage and provider-active intervals on skipped candidates. Add an optional closed skipReason discriminator (setup-unavailable or cached-unavailable) only where needed to carry that distinction through ProviderAttemptEvent; absent historical values retain existing behavior. Correct exhaustion formatting that currently calls every non-invoked attempt a cached skip. Keep a setup reason and recovery action in redacted diagnostic text and the configured next-provider transition. The existing event emitter/persister and invocation-based metering own delivery and counts; update a consumer only if it currently counts or labels the new branch incorrectly. This task owns event-consumer integration: emit through actual provider-attempt callbacks and the event spine into a fixture persister/renderer/metric sink, using fake provider usage. Assert ordered setup skip then actual fallback, all-skipped exhaustion, no phantom usage/dispatch, redaction canary removal, and unchanged success when the attempt sink throws. Reuse the existing observational onAttempt error handling; do not add a channel or give sink errors retry authority. Commit: fix(telemetry): distinguish setup skips from provider dispatches.

**Done when:**
1. Existing provider-attempt event consumers observe the skipped provider, redacted reason/recovery action and next provider with invoked false, followed by actual fallback attribution, in daemon-provider-event-persistence.integration.test.ts.
2. The existing metering/metrics path counts only the actual fallback invocation and its usage; all-setup exhaustion has no fabricated actualProvider, dispatch, usage or provider-active interval.
3. Exhaustion diagnostics distinguish new setup-unavailable skips from cached-unavailable skips, preserve every candidate reason, and emit no sensitive canary through attempt, fallback or terminal text.
4. An injected onAttempt sink failure leaves the successful fallback result unchanged and does not authorize retries or alter candidate order.

**Files:** `src/conductor/src/engine/provider-execution.ts`, `src/conductor/src/types/events.ts`, `src/conductor/src/ui/terminal-renderer.ts`, `src/conductor/src/engine/otel/metrics-listener.ts`, `src/conductor/src/engine/dispatch-metering.ts`, `src/conductor/test/integration/daemon-provider-event-persistence.integration.test.ts`, `src/conductor/test/engine/provider-execution.test.ts`

**Dependencies:** 2, 5, 6

## Task Dependency Graph

Task 1 -> Task 2 -> Task 3 -> Task 4 -> Task 5 -> Task 6 -> Task 7

Task 2 also directly supplies Task 4 and Task 6. Dependencies encode shared classification and result-contract prerequisites, not a final test-only phase. The last task implements concrete diagnostic/consumer behavior.

## Integration Ownership

| Changed boundary behavior | Owning task |
|---------------------------|-------------|
| Original self-host setup producer and resource transfer | 3 |
| Cleanup/cancellation/safety on the new candidate branch | 4 |
| Ordinary configuration-to-runner dispatch, success and terminal retry routing | 5 |
| One-shot/auxiliary result propagation and retry termination | 6 |
| Existing event consumers and metering of skipped/actual candidates | 7 |

Tasks 1–2 are internal classification/executor work; they do not substitute for the caller proofs owned above.

## Coverage Check

Every criterion is diff-local: it describes this feature's scoped production behavior under controlled inputs and faithful fake external boundaries, not a promise about mutable live provider availability, operator credentials, or future unrelated deployments. Preserved neighboring policy remains exercised with its actual mechanism. There is no outside-diff/live-state acceptance assertion or coherence waiver.

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given ordinary non-self-host execution with an ordered provider list and an explicitly classified setup capability failure on its first candidate, when the step runs, then the unusable candidate is not invoked, the next usable configured candidate actually invokes and completes the step, and the skip consumes no dispatch retry or lifecycle replacement; this holds with either built-in provider first. | 5 | "provider-setup-routing.integration.test.ts enters real non-self-host dispatch with Codex-first and Claude-first configuration and observes zero calls to the setup-unavailable provider, one successful native-context fallback invocation, and no retry or lifecycle replacement for the skip." | diff-local |
| Story 1 happy: Given self-host execution configured with Codex followed by Claude and Codex's required isolation capability absent, when the step runs, then Codex is not invoked, Claude completes using its own native settings and fresh execution context, and the step completes within the same attempt. | 3 | "The real conductor self-host preparation and shared runner path skip Codex with missing required isolation methods and return successful Claude execution in provider-setup-self-host.integration.test.ts, with zero Codex invocations." | diff-local |
| Story 1 happy: Given an earlier candidate is skipped and the next candidate succeeds, when execution returns, then later candidates and unconfigured providers are not invoked, and the successful candidate receives its own model, effort, session, authentication, and permission context. | 5 | "Runner invocation captures prove actual-candidate model, effort, skill syntax, fresh session, authentication and permission context, and early-success fixtures observe no later or unconfigured invocation." | diff-local |
| Story 1 negative: Given the first candidate throws an unexpected preparation error, including an ordinary error whose text says it is unavailable, when the step runs, then the error retains its existing failure disposition and no later provider invokes on the strength of that text. | 2 | "executeProviderCandidates retains ordinary preparation errors and configuration/registry failures without fallback, while a context-specific setup skip leaves the provider eligible in a later compatible execution." | diff-local |
| Story 1 negative: Given setup encounters invalid configuration or an inconsistent provider registry, when execution rejects the input, then it does not treat that defect as permission to run a different provider. | 2 | "executeProviderCandidates retains ordinary preparation errors and configuration/registry failures without fallback, while a context-specific setup skip leaves the provider eligible in a later compatible execution." | diff-local |
| Story 1 negative: Given a candidate is unusable only in one setup context, when a later eligible execution does not require that missing capability, then the earlier skip does not permanently exclude it from that later context. | 2 | "executeProviderCandidates retains ordinary preparation errors and configuration/registry failures without fallback, while a context-specific setup skip leaves the provider eligible in a later compatible execution." | diff-local |
| Story 1 negative: Given the first candidate completes successfully, when a configured fallback exists, then the first candidate remains the actual provider and the fallback does not run. | 5 | "Runner invocation captures prove actual-candidate model, effort, skill syntax, fresh session, authentication and permission context, and early-success fixtures observe no later or unconfigured invocation." | diff-local |
| Story 2 happy: Given setup allocates resources before discovering explicit capability unavailability, when fallback proceeds, then every resource allocated by that failed setup is released exactly once before the next candidate begins preparation, and the fallback can acquire what it needs and complete. | 3 | "Self-host preparation releases each window and scratch context it acquired exactly once before the next candidate prepares, including allocation failure after window acquisition." | diff-local |
| Story 2 happy: Given a supervised attempt skips one candidate and proceeds to another, when the fallback reaches process creation, then it is governed by the same active lifecycle authority and the skipped candidate has not consumed a replacement allowance. | 4 | "The lifecycle-supervision integration observes the identical active spawnPermit on eligible fallback, zero replacements for a setup skip, and zero process creations after cancellation, timeout revocation, or supersession." | diff-local |
| Story 2 negative: Given failed setup cannot complete required cleanup or verification, when the executor considers fallback, then the unresolved failure is reported and no later provider starts. | 4 | "The executor and candidate safety boundary refuse to start the next provider after required cleanup failure, verification refusal, authentication failure, or required permission/safety rejection." | diff-local |
| Story 2 negative: Given the attempt is cancelled, superseded, or times out during preparation or cleanup, when pending work later resumes, then no provider can spawn using the revoked authority, and existing lifecycle recovery limits remain in force. | 4 | "The lifecycle-supervision integration observes the identical active spawnPermit on eligible fallback, zero replacements for a setup skip, and zero process creations after cancellation, timeout revocation, or supersession." | diff-local |
| Story 2 negative: Given setup encounters an authentication failure, a required permission refusal, or a required safety failure, when other providers are configured, then the original recovery or blocking disposition is retained and fallback does not bypass it. | 4 | "The executor and candidate safety boundary refuse to start the next provider after required cleanup failure, verification refusal, authentication failure, or required permission/safety rejection." | diff-local |
| Story 2 negative: Given partial preparation fails from a filesystem or resource-allocation error without an explicit capability-unavailability classification, when execution unwinds, then owned resources are released and the original failure does not become a candidate skip. | 3 | "The self-host cleanup fixtures preserve another execution's resources, and filesystem/allocation errors retain their original failure rather than becoming provider unavailability." | diff-local |
| Story 2 negative: Given another execution holds its own setup resources, when this execution skips a candidate, then it releases only its own resources and does not revoke or clean up the other execution's context. | 3 | "The self-host cleanup fixtures preserve another execution's resources, and filesystem/allocation errors retain their original failure rather than becoming provider unavailability." | diff-local |
| Story 3 happy: Given every configured candidate is explicitly unavailable before provider invocation and more than one retry is configured, when ordinary step execution, one-shot execution, or auxiliary execution exhausts the list, then it returns terminal setup-only exhaustion after one ordered pass, invokes no provider, schedules no ordinary dispatch retry, and reports each candidate's reason; the same rule holds for a single-candidate list. | 5, 6 | "DefaultStepRunner.toStepRunResult retains providerSetupExhaustion, and conductor routing with retry allowance greater than one performs one all-setup pass then emits an operator-actionable stop with candidate reasons and no ordinary retry scheduling." | diff-local |
| Story 3 happy: Given an unavailable setup candidate is skipped and a usable fallback invokes but returns an ordinary runtime failure, when retry policy permits another attempt, then that runtime failure consumes its normal retry allowance and is not misreported as setup-only exhaustion. | 5 | "The real ordinary routing fixture gives a fallback runtime failure its normal retry and reaches scripted success on the next invocation; it does not relabel runtime failure, rate limit, session expiry, cancellation, or auth failure as setup-only exhaustion." | diff-local |
| Story 3 negative: Given every candidate is unavailable before invocation, when the result crosses intermediate execution wrappers, then no wrapper turns it into a generic retryable failure or repeats the same list solely to spend the remaining retry allowance. | 6 | "Real one-shot and auxiliary caller fixtures preserve providerSetupExhaustion to their owning step after one ordered setup pass, with zero provider invocations and zero ordinary retry scheduling despite an allowance greater than one." | diff-local |
| Story 3 negative: Given at least one candidate actually invoked before the list was exhausted, when execution reports the terminal result, then it does not claim that no invocation occurred and existing runtime/model-unavailability retry policy remains authoritative. | 2, 6 | "executeProviderCandidates returns providerSetupExhaustion with every skipped reason only when no candidate invoked; scalar, two-candidate, and mixed post-invocation fixtures assert the exact distinction." | diff-local |
| Story 3 negative: Given the fallback returns authentication failure, rate limiting, session expiry, cancellation, or an ordinary failure, when a further provider exists, then each result retains its existing recovery, retry, or stop policy rather than being reclassified as setup unavailability. | 6 | "Rubric and one-shot mappings retain setup-only failure before domain decoding; existing publication timed_out/provider_unavailable, policy-loading, readiness, auth and cancellation categories keep their original handling and no successful judgment is fabricated." | diff-local |
| Story 4 happy: Given a candidate is skipped for explicit setup unavailability and another is selected, when the existing diagnostic consumers receive the execution record, then they identify the skipped provider, capability/reason, recovery action, and next provider, and show the skipped candidate as not invoked. | 7 | "Existing provider-attempt event consumers observe the skipped provider, redacted reason/recovery action and next provider with invoked false, followed by actual fallback attribution, in daemon-provider-event-persistence.integration.test.ts." | diff-local |
| Story 4 happy: Given the fallback invokes and completes, when its execution and usage are recorded, then the actual provider owns its native model, effort, usage, and invocation attribution, while the skipped candidate contributes no fabricated usage or dispatch. | 7 | "The existing metering/metrics path counts only the actual fallback invocation and its usage; all-setup exhaustion has no fabricated actualProvider, dispatch, usage or provider-active interval." | diff-local |
| Story 4 negative: Given every candidate is skipped before invocation, when exhaustion is reported, then all skipped providers and reasons remain visible, no successful actual provider is invented, and a newly observed setup skip is not described as a cached skip. | 7 | "Exhaustion diagnostics distinguish new setup-unavailable skips from cached-unavailable skips, preserve every candidate reason, and emit no sensitive canary through attempt, fallback or terminal text." | diff-local |
| Story 4 negative: Given a setup diagnostic contains sensitive text, when skip, fallback, and terminal messages are emitted, then established redaction removes the sensitive value while retaining the actionable reason. | 7 | "Exhaustion diagnostics distinguish new setup-unavailable skips from cached-unavailable skips, preserve every candidate reason, and emit no sensitive canary through attempt, fallback or terminal text." | diff-local |
| Story 4 negative: Given the existing attempt-recording sink throws, when fallback is otherwise eligible, then that observational failure does not change execution authority or prevent the fallback from completing. | 7 | "An injected onAttempt sink failure leaves the successful fallback result unchanged and does not authorize retries or alter candidate order." | diff-local |

## Verification and limits

All 24 extracted criteria have exact-text coverage rows and task completion quotes. Each task supplies 2–4 single-line, mechanism-specific completion checks and declared files/dependencies. No task directs changes to another feature's protected artifacts. No task is a catch-all validation or speculative remediation task.

Existing scoped evidence is 95 passing assertions on unchanged source; it is not RED/GREEN evidence for the new implementation. BUILD must establish its own failing tests and passing scoped proof, using `ai-conductor scoped-run` for the affected tests. The native test-suite and SHIP gates own completed-feature validation.

Verify-claims: the candidate loop, setup callback, normal and one-shot result mapping, auxiliary retry loop, shared event fields, and conductor terminal-stop seams were read directly. New type/symbol names here are deliberate implementation choices within the approved design, not claims they already exist. Additional live fallback failures remain unverified and impose no invented reproduction requirement. Verdict: CLEAR.

## Advisory overlap scan

```text
Overlap with origin/spec/daemon-self-host-guardrails: src/conductor/src/engine/conductor.ts
Overlap with origin/spec/self-host-phase6-wiring: src/conductor/src/engine/conductor.ts, src/conductor/test/engine/self-host/wiring.test.ts
Note: renames or name-only diffs may not be detected by this scan.
```

The approved sequence diagram remains accurate: the tasks add explicit result propagation to its existing setup, cleanup, next-candidate, and terminal branches without changing its component relationships. No diagram topology change is needed.
