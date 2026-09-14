# Architecture Review: Provider setup failures preserve configured fallback

**Date:** 2026-09-11
**Mode:** Lightweight, Medium complexity
**Input reviewed:** Operator-approved technical scope, approach A, and candidate-execution diagram for issue #1285. Stories and plan are not yet authored.
**Verdict:** APPROVED

## Feasibility

The existing TypeScript provider executor owns ordered candidate selection, provider-native settings, invocation, availability classification, and attempt attribution. Extend that boundary to consume explicitly classified setup unavailability rather than adding another candidate-selection loop or a separate preflight framework. No new package, service, persisted store, configuration key, or network integration is required.

The scope is general provider setup. Self-host isolation is one concrete producer, not a condition for enabling the shared behavior. Existing ordinary, one-shot, and auxiliary callers must retain the classification through their respective result mappings. The fallback provider must actually invoke and complete with its own native settings; a successful helper test or a fallback warning alone cannot establish delivery.

### Setup classification and execution boundary

Use an explicit typed candidate-unavailable outcome or error at setup producers, normalized at the existing executor boundary. The representation must identify the failed provider, diagnostic reason, applicability scope, and that no provider invocation occurred. Do not inspect exception-message fragments or convert arbitrary thrown exceptions into availability.

Known static capability absence is eligible. The current unsupported lifecycle-capability result is the local precedent: it names the selected provider, missing capability, and recovery action, sets invocation-skipped attribution, and enters the existing fallback path. Built-in missing-executable availability remains on its existing path. The missing self-host isolation methods must become another explicit producer.

Inventory candidate preparation on BUILD's current source, including native resolution, candidate options, supervision capability checks, and caller-specific preparation. Classify only verified capability-unavailability cases. Invalid configuration, registry inconsistency, unknown exceptions, authentication failures, required-safety refusals, lifecycle cancellation/timeout, rate limits, and ordinary provider runtime failures retain their existing authority. An arbitrary preparation exception must continue to propagate rather than becoming permission to switch providers.

The catch/normalization boundary must exclude provider invocation and terminal teardown errors. A provider's returned, explicitly classified runtime/model unavailability continues to use the existing fallback policy; this feature does not reinterpret ordinary runtime failures.

### Cleanup before advancing

Preparation owns resources until it successfully transfers a prepared invocation context to the executor. If preparation fails after acquiring any resource, it must release that resource itself before exposing a candidate-unavailable outcome. Once preparation succeeds, the executor retains its existing teardown ownership.

In particular, the current self-host preparation opens a live-boundary coordinator window before checking the reported missing methods. Move a pure capability check ahead of acquisition where possible, and cover partial preparation failures after acquisition. Do not return an unavailable result while a boundary window, scratch home, or observer is still owned by the failed candidate. Cleanup must complete once before the next provider is prepared. A failed required cleanup or safety verification cannot be treated as a clean skip. Preserve boundary-drift and lifecycle-revocation authority; fallback never clears or replaces a revoked spawn permit.

### Exhaustion and retries

Advancing through unavailable candidates stays within the active logical attempt. A setup skip consumes no dispatch retry, model-escalation step, or lifecycle-replacement allowance. Every fallback invocation receives fresh provider-native session and credential context while retaining the same active lifecycle permit.

When every candidate is explicitly unavailable before invocation, preserve a typed terminal exhaustion disposition through the step runner and auxiliary wrapper. Stop after the configured list has been considered; do not repeatedly walk the same deterministic setup failures through ordinary retry handling. The result identifies each skipped candidate and its reason. A candidate that actually executes and returns an ordinary runtime failure retains its existing retry behavior. Mixed exhaustion after real invocations retains existing runtime/model-unavailability policy rather than being incorrectly labeled an all-setup refusal.

Do not overload `commandUnresolved`, authentication flags, or a message substring to suppress retries. Those dispositions represent different domains. Extend the existing provider-result contract and its caller mappings narrowly; preserve a machine-readable distinction between setup-only exhaustion and other terminal results. This is an extension of existing result routing, not a new retry controller.

## Alignment

The APPROVED `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope` governs one resolver/runtime boundary, explicit availability-only fallback, provider-native context, and preferred/actual attribution. Approach A extends its existing unavailable-candidate contract and preserves its session decisions.

The APPROVED `adr-2026-07-30-provider-preparation-lifecycle-supervision` governs preparation fencing and distinguishes fallback inside an active attempt from lifecycle recovery. The proposed change retains that supervisor, its permit, and its timeout/replacement policy.

The applicable local pattern is `unsupportedLifecycleProviderResult` together with `classifyProviderCandidateFailure` and `buildProviderAttemptMetadata` in `provider-execution.ts`. Preserve explicit classification, recovery precedence, no-invocation attribution, per-candidate context, and ordered fallback. Representation may evolve to express setup-only exhaustion, but no alternative selection loop, string-matched error taxonomy, or provider-specific retry controller is authorized.

Scope-check A: consumer-facing shared provider behavior; self-host-specific producer and cleanup stay in their existing repository-local path. B: no new skill or catalog registration. C: provider-agnostic shared contract with both built-in provider directions tested. No shared behavioral-rule change is required.

Event-spine verdict: no new channel. Candidate skips and fallback are occurrences carried by the existing attempt/warning callbacks into `ConductorEventEmitter` and its persister. Reuse the established schema, adding a named field only if needed for an otherwise unrepresentable distinction. Never report a pre-invocation skip as provider usage, a dispatch, or a cached skip unless it was actually cached. Avoid run-wide caching for a capability failure specific to the current setup context.

## Wiring Surface

| Surface | Production integration |
|---------|------------------------|
| Setup-unavailability normalization and terminal exhaustion | `src/conductor/src/engine/provider-execution.ts`, inside `executeProviderCandidates`, reached from normal/one-shot step dispatch and auxiliary execution |
| Setup failure producers | Existing provider preparation and runtime capability checks; `src/conductor/src/engine/conductor.ts` supplies the reported self-host preparation producer; `provider-runtime.ts` is an inspection surface, not a mandate to alter registry failures |
| Preparation resource ownership | Existing self-host preparation closure and provider home/boundary cleanup, before returning the outcome to the shared executor |
| Exhaustion result propagation | `src/conductor/src/execution/llm-provider.ts` and existing provider execution result types as appropriate; `src/conductor/src/engine/step-runners.ts` maps the disposition to its caller without erasing it |
| Retry termination | Existing conductor step-result handling and `executeAuxiliaryProviderCandidates`; only setup-only exhaustion bypasses ordinary retry spending |
| Diagnostics | Existing provider-attempt and fallback-warning callbacks supplied by the step runner; existing event emitter/persister consumers |
| Documentation | Root README, conductor README, and the existing provider-routing configuration/guide sections explain setup skips, exhaustion, and retained failure behavior |

The production proof must exercise real internal configuration-to-runner-to-executor wiring with faithful fakes at provider and other third-party boundaries. Cover normal non-self-host execution and the original self-host failure. Exercise one-shot/auxiliary result propagation at their narrowest real entry points; do not run an unrelated full pipeline to assert one dispatch. Assert actual fallback invocation and success, native settings/session separation, no skip retry consumption, cleanup ordering, and deterministic exhaustion without another list walk. The per-feature plan must name the task owning this integration proof.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|------|------|------------|--------|------------|
| Generic setup catch masks auth or safety failures | Security | Medium | High | Explicit unavailable producers; exclude invocation/cleanup from the catch; negative-path coverage at real boundaries |
| Preparation failure leaks a boundary window or scratch context | Integration | Medium | High | Ownership before transfer; release on partial failure; assert cleanup precedes next preparation |
| Executor passes but callers lose the terminal disposition | Integration | Medium | High | Production runner and auxiliary propagation proofs, including setup-only exhaustion |
| Concurrent specs alter the same conductor source | Integration | Medium | Medium | Resolve symbols against BUILD HEAD and preserve the approved semantics |

## Overlap scan

The advisory scan completed against the Wiring Surface and source ref. It reported overlap on `src/conductor/src/engine/conductor.ts` with `origin/spec/daemon-self-host-guardrails` and `origin/spec/self-host-phase6-wiring`. It reported no open source blockers. The scan cautions that renames or name-only diffs may be missed; this is not proof of absence of all concurrent work.

## ADRs Created

None. The proposal adds explicit cases and result propagation within the existing provider-execution and lifecycle boundaries. It introduces no new component decomposition, persistence authority, integration channel, or foundational technology. The governing APPROVED ADRs cover those structures; a new ADR would duplicate them.

## Verify-Claims Ledger

- [verified] Setup exceptions escape before `classifyProviderCandidateFailure`: `executeProviderCandidates` awaits preparation inside a try/finally without availability normalization.
- [verified] Normal and one-shot dispatch call the shared executor: `DefaultStepRunner.runProviderAwareNormal` and `executeProviderAwareOneShotCore` in `step-runners.ts`.
- [verified] The auxiliary wrapper retries generic failures: `executeAuxiliaryProviderCandidates` returns early only for success or unresolved command and otherwise advances its retry loop. The current candidate-exhaustion result is generic.
- [verified] The reported missing self-host capability check follows boundary-window acquisition in the conductor preparation closure. This is an ownership risk if setup is changed to advance candidates without cleanup.
- [verified] Prior scoped evidence: 95 assertions passed across provider execution, selection, and routing acceptance files; a private-temp rerun passed after the earlier teardown warning. These are fake-provider tests, not a live-provider exercise.
- [unverified] Additional live fallback failures beyond the supplied incident. The operator raised this concern; it motivates production-wiring proof but is not asserted as an established second incident.

No unconfirmed assumption determines the proposed behavior. Verify-claims verdict: CLEAR. Human approval of this review is required by the composer lifecycle before stories.
