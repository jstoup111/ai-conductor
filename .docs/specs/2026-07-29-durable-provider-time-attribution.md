# PRD: Durable Provider-Time Attribution

**Date:** 2026-07-29
**Status:** Approved

## Problem / Background

Harness operators cannot determine how much active feature time was spent waiting on LLM provider
processes versus elsewhere in the harness. Existing timing signals are incomplete, provider-specific,
or lost with the feature workspace. Current durable records can therefore show a plausible zero even
when provider work consumed substantial time, which prevents trustworthy performance prioritization.

## Goals & Non-Goals

**Goals**

- Give operators a durable, trustworthy per-feature split between provider-active elapsed time and
  elapsed time when no provider process was active.
- Measure both built-in providers consistently from the harness's perspective.
- Preserve exact elapsed-time accounting when provider attempts overlap.
- Establish an additive timing contract that later work can refine without changing historical
  meanings.

**Non-Goals**

- Breaking non-provider time into tests, version-control operations, builds, engine work, or waits.
- Reporting cumulative parallel provider work, CPU time, utilization, or provider billing time.
- Adding task or subagent telemetry, external telemetry export, or new observability configuration.
- Backfilling measurements that were never captured for historical features.

## Users / Personas

- **Harness operator:** identifies which portion of active feature execution is provider-bound and
  prioritizes performance work using durable evidence.
- **Harness maintainer:** compares timing across providers and features without depending on a
  feature workspace that is removed after shipment.

## Functional Requirements

- **FR-1:** The harness records engine-observed wall time for every actually invoked built-in provider
  process, from process start through process exit, for both successful and unsuccessful attempts.
- **FR-2:** Provider attempts that fail, are retried, or precede a provider fallback contribute their
  observed elapsed time; candidates skipped without starting a provider process contribute no
  provider-active time.
- **FR-3:** For each shipped feature, the harness reports provider-active elapsed time using the union
  of overlapping provider intervals, so concurrent provider processes count once on the elapsed-time
  axis.
- **FR-4:** For each shipped feature, the harness reports no-provider-active elapsed time as the
  complement of provider-active elapsed time within active harness step intervals, with both values
  forming an exact, non-negative partition of measured active execution time.
- **FR-5:** The per-feature timing partition is stored in the feature's committed shipment record and
  remains available after its feature workspace is removed.
- **FR-6:** The operator's durable performance report reads and displays the timing partition for each
  measured feature without requiring access to transient execution data.
- **FR-7:** Engine-observed provider-process time remains distinct from any provider-reported model or
  service duration; neither value silently replaces or redefines the other.
- **FR-8:** A record with absent, incomplete, malformed, or pre-feature timing evidence reports timing
  as unavailable or partial rather than presenting missing time as zero.
- **FR-9:** Historical shipment records without the new timing data remain readable and continue to
  participate in all previously supported non-timing reporting.
- **FR-10:** The durable timing contract permits future non-provider categories and cumulative-work
  metrics to be added without changing the meaning of the provider-active or no-provider-active
  values already recorded.

## Non-Functional Requirements

- Timing collection is observational: it must not change provider selection, retry, fallback,
  completion, or failure outcomes.
- Timing collection adds no provider invocation, network request, operator configuration, or
  unbounded wait to a harness run.
- Time values remain accurate across wall-clock adjustments and never become negative because of
  overlapping work.
- Durable timing remains tolerant of older and partially populated records.

## Acceptance Criteria / Success Metrics

- A completed feature using Claude and a completed feature using Codex each produce non-zero,
  engine-observed provider-active time in their committed shipment records.
- When provider attempts overlap, provider-active time equals the union of those intervals, and
  provider-active plus no-provider-active time equals measured active execution time exactly.
- Acceptance coverage demonstrates the failed, retried, fallback, and skipped-provider behavior in
  FR-2.
- Removing the feature workspace does not remove the reported timing partition.
- Historical records with no timing section remain readable and show timing as unavailable rather
  than zero.
- The durable report presents measured, partial, and unavailable timing states without ambiguity.

## Scope

### In Scope

- Engine-observed process timing for both built-in providers.
- Overlap-safe per-feature elapsed-time attribution across active harness steps.
- Durable per-feature timing and read/report behavior.
- Compatibility behavior for historical and incomplete timing evidence.
- Regression coverage and affected operator documentation.

### Out of Scope

- OpenTelemetry wiring, exporters, task spans, or subagent spans.
- Fine-grained local-command or engine-operation timing.
- Cumulative provider-capacity accounting and provider-side model latency analysis.
- Pricing, cost estimation, token metering, or changes to existing cost semantics.
- Historical timing reconstruction.

## Key Decisions & Rationale

- **Partition elapsed time, not cumulative parallel work.** Operators need to understand elapsed
  feature latency; counting overlapping providers twice would break the wall-time partition.
- **Name the residual no-provider-active time.** It may contain engine work, local commands, and
  waits, so calling it code-execution time would overstate what was measured.
- **Treat missing evidence as unknown.** A zero is a measurement only when the harness observed zero;
  absence must remain visibly different.
- **Grow timing additively.** Later detailed instrumentation may subdivide the residual or add a
  cumulative-work view without reinterpreting shipped history.

## Dependencies

- Existing provider invocation lifecycle, active-step lifecycle events, committed shipment records,
  and durable performance reporting.
- No dependency on OpenTelemetry Phase 2 or Phase 3 work.

## Open Questions

- Which engine boundary should own process timing so both providers expose identical semantics across
  normal, interactive, failed, and self-host invocation paths?
- What additive representation best preserves exact overlap intervals through transient events and
  into tolerant historical record parsing?
