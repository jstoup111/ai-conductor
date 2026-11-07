# Architecture Review: Feature active duration is dropped from OTEL whenever the timing rollup is partial

**Date:** 2026-10-26
**Mode:** Lightweight (Tier M): Technical Feasibility and Architectural Alignment only
**Inputs reviewed:** explore output and scope boundary (`.docs/track/feature-active-duration-is-dropped-from-otel-whene.md`),
complexity (`.docs/complexity/feature-active-duration-is-dropped-from-otel-whene.md`), approved diagram
(`.docs/architecture/feature-active-duration-is-dropped-from-otel-whene.md`)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

All six technical-intent items are buildable on the current stack with no new dependency,
service, migration, or configuration key.

| Intent item | Assessment | Basis |
|---|---|---|
| Listener records `activeMs` whenever present | Feasible; one projection change in the `feature_shipped` handler plus a recorder signature extension. | verified: `src/conductor/src/engine/otel/metrics-listener.ts` gates on `active.state === 'exact'`; `MetricsRecorder.onFeatureDuration` already records any finite `activeMs`. |
| Missing-measurement counter | Feasible; one counter instrument beside the existing histogram, registered in the same instrument table. | verified: `src/conductor/src/engine/otel/metrics.ts` builds every feature instrument in one factory. |
| `feature_shipped.active.reason` | Feasible; additive optional field. The rollup already computes the reason and `daemon-runner.ts` `emitShipped` drops it. | verified: `timing-rollup.ts` `PartialTimingReason`; `daemon-runner.ts` `emitShipped`. |
| Retired-step identities resolve in the rollup | Feasible; identity resolution for the rollup's correlation keys must accept a retired built-in lifecycle step name without widening the global `isStepName` domain. | verified: replay of five live worktrees shows every `active-evidence-incomplete` trigger is a `coverage_binding` start/terminal pair whose `executionKey` is undefined. |
| Pre-spawn failures recorded as not invoked | Feasible; adapters return before spawning on git-guard and native-schema setup failure without any disposition, and attempt metadata derives `invoked` from `providerInvocationSkipped` alone. | verified: `claude-provider.ts`, `codex-provider.ts`, `pi-provider.ts` invoke(); `provider-execution.ts` `buildProviderAttemptMetadata`. Codex `readinessFailure` already stamps `executionDisposition: 'not-started'`. |
| Remediation-closure judgement supplies its scratch home | Feasible; the dispatch passes no `nativeSchemaScratch`, unlike the other native-schema auxiliary dispatches. | verified: all 18 invoked-without-interval attempts across live worktrees are this member failing `requested native schema requires an owned Codex scratch home`. |

Prerequisites: none. Worktree isolation: unaffected; the scratch home is the existing
worktree-local mechanism. Performance: listener work stays O(1) per event (ADR-014 Decision 4).

## Alignment

- **adr-014-otel-observability-exporter Decision 9 (APPROVED)** omits `feature.duration.active` on
  every `partial`. This spec reverses that for the one partial route whose active total is measured.
  Resolved by an operator-approved in-place amendment to Decision 9 (2026-10-26). The omission
  discipline for an incomplete active union is retained; no value is estimated.
- **ADR-014 closed label vocabulary (#1940 amendment) and Decision 10.** New label names would
  violate it. The design reuses the existing `state` and `reason` label names with closed value sets
  (operator-approved 2026-10-26); open execution keys are collapsed to the `open-executions` class.
- **adr-2026-07-29-engine-observed-provider-time-partition (APPROVED).** Contract 5 keeps
  `provider-evidence-incomplete` a `partial`; the rollup's state semantics are unchanged and the
  recorded point carries `state=partial`. Contract 1 scopes interval evidence to actual provider
  subprocesses, so an attempt that never spawned has no expected interval; recording it as not
  invoked is consistent.
- **adr-2026-08-12-execution-lifecycle-completeness-for-timing (APPROVED).** Decision 3 requires a
  partial to name its route; carrying the reason onto `feature_shipped` and the metric extends that.
  Decision 2 (never close an open execution) is untouched.
- **adr-2026-10-23-slice-topology-from-sealed-plan Decision 6 (APPROVED).** Leftover
  `coverage_binding` state "never block" and historical `events.jsonl` lines are never rejected.
  Today's rollup degrades every pre-retirement ledger to `partial`; resolving the retired identity
  brings the rollup into compliance.
- **Event spine.** Additive optional field on an existing variant; no new channel.
- **Existing affirmative signal.** `executionDisposition: 'not-started'` is documented on
  `InvokeResult` as affirmative evidence that an invocation never reached provider execution;
  reusing it adds no new state. The execution-layer `providerInvocationSkipped` flag and its
  unavailable/fallback routing are unchanged (operator-approved 2026-10-26).
- **Domain integrity.** `reason` is a closed union, not free text; `state` stays the existing
  three-value union.

## Wiring Surface

| Surface | Production caller |
|---|---|
| `feature_shipped.active.reason` | Emitted by the existing `daemon-runner.ts` `emitShipped`; consumed by the existing `MetricsListener` `feature_shipped` handler. |
| `conductor.feature.duration.active.missing` counter | Recorded by `MetricsRecorder.onFeatureDuration`, called from the same `feature_shipped` handler. |
| `state` / `reason` on `conductor.feature.duration.active` | Same recorder call. |
| Retired-step identity resolution | Called by `timing-rollup.ts` `executionKey`, reached from `computeTimingRollup` in `daemon-runner.ts` and `shipped-record-cli.ts`. |
| Adapter `not-started` stamping | Inside each adapter's `invoke()`, reached by every provider dispatch. |
| `invoked` derivation | `buildProviderAttemptMetadata`, reached from every candidate attempt in `provider-execution.ts`. |
| Closure-judgement `nativeSchemaScratch` | The existing remediation-closure judgement dispatch in `step-runners.ts`. |

Advisory overlap scan over these paths: no overlap detected. Open PR #3454 (source-layer
refactor) touches some of the same files; rebase concern only.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Datadog dashboards that sum `duration.active` start including partial points | Integration | Medium | Low | Every point carries `state`; filter on `state=exact` for the strict series. |
| `not-started` reclassifies a CI-fix repair session's pre-spawn failure from failed to not-started | Technical | Low | Low | Operator-accepted; the affirmative signal is more accurate. |
| A future partial route appears | Technical | Low | Medium | The missing counter with `reason` makes it visible immediately. |

## ADRs Created

None. Amended in place: `adr-014-otel-observability-exporter` Decision 9 (operator-approved
2026-10-26). Reused: adr-2026-07-29, adr-2026-08-12, adr-2026-10-23.

## Conditions

- C1. Metric labels reuse `state` and `reason`; no new label name is introduced.
- C2. `activeMs` is never synthesized: it is recorded only when the rollup returns it.
- C3. Retired-step acceptance is confined to the timing rollup's identity resolution; the global
  `isStepName` domain is not widened.
- C4. `providerInvocationSkipped` semantics and the unavailable/fallback routing are unchanged.
