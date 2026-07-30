# ADR: Engine-observed provider intervals form an overlap-safe elapsed-time partition

**Date:** 2026-07-29
**Status:** APPROVED (operator-approved 2026-07-29)
**Deciders:** James Stoup (operator), engineer session for ai-conductor#1101

## Context

The harness durably reports provider usage and cost but cannot report how much active feature time
was occupied by provider subprocesses. Claude exposes a provider-reported duration; Codex exposes no
duration. The approved cost-metering architecture explicitly distinguishes that provider-reported
quantity from engine wall time, so reusing the existing duration field would change its meaning.

Concurrency makes a simple duration sum invalid for latency attribution: validation branches and
future BUILD task fan-out may overlap provider processes. Model-availability fallback also may launch
several subprocesses while returning only the final invocation result. The design therefore needs an
exact per-process observation that survives every result conversion and supports interval union.

Existing authoritative constraints:

- `adr-2026-07-27-cost-unmetered-is-a-first-class-state` requires unknown measurements to remain
  absent rather than fabricated and keeps provider-reported duration semantically distinct.
- `adr-2026-07-22-per-feature-cost-rollup-in-shipped-record` establishes the committed shipped record
  as the durable per-feature history and requires partial totals to be visibly partial.
- `adr-2026-07-10-concurrent-group-core` establishes capped concurrent branch execution and
  attributable branch events.
- `adr-014-otel-observability-exporter` keeps OTel as an optional event listener; durable timing must
  not depend on that exporter being configured.

## Options Considered

### Option A: Exact adapter-owned intervals with a dedicated timing rollup

- **Pros:** Measures the agreed subprocess boundary; preserves provider-reported semantics; captures
  both providers and all outcomes; supports overlap-safe elapsed attribution; creates a clean
  extension point for future local categories.
- **Cons:** Both built-in adapters require capture wiring; plural interval metadata must survive the
  model ladder and every provider-result conversion; active-step intervals also need an explicit
  engine-owned timing contract.

### Option B: Time the whole provider interface call

- **Pros:** One provider-neutral wrapper; naturally covers custom providers and model fallback.
- **Cons:** Includes readiness, adapter parsing, and other work outside the provider subprocess, so it
  does not measure the operator-approved quantity.

### Option C: Instrument all local execution boundaries now

- **Pros:** Immediately provides tests/git/build/engine categories.
- **Cons:** Materially larger; still leaves idle and in-process gaps; does not remove the need for an
  exact provider interval or an unclassified residual.

## Decision

Choose **Option A** with these contracts:

1. Each built-in provider adapter observes every actual provider subprocess from spawn through exit
   on normal, interactive, failed, and self-host paths. Elapsed duration comes from a monotonic clock;
   the interval also carries a common time-axis anchor for overlap calculations.
2. Engine-observed intervals are a separate, plural field on provider results. They are not part of
   token usage and never overwrite provider-reported duration.
3. Model-availability fallback concatenates intervals from every attempted model into the terminal
   result. Provider-candidate execution copies the complete interval list into candidate-attempt
   evidence. Scalar, provider-aware, grouped, and auxiliary result conversions must preserve it; a
   propagation-matrix test is required.
4. Step lifecycle terminal evidence carries an engine-observed active interval using the same clock
   semantics. Persistence timestamps remain audit timestamps, not the duration measurement.
5. A dedicated timing rollup reads feature events, unions all valid active-step intervals, unions all
   valid provider intervals, and partitions active elapsed time into provider-active and
   no-provider-active time. Provider evidence outside the active-step union, missing expected
   intervals, or malformed evidence yields `partial`; no timing evidence yields `unavailable`.
6. Timing is persisted in a separate additive shipment-record section with an explicit evidence
   state. Historical records without the section remain readable and report timing unavailable.
7. The durable performance report reads the timing section independently of cost parsing. Missing
   timing never becomes a measured zero.
8. OTel wiring, task/subagent spans, cumulative provider work, and local execution categories remain
   outside this decision. Future categories may subdivide no-provider-active time or add cumulative
   work without changing the two elapsed-time fields.

## Consequences

### Positive

- Provider-active plus no-provider-active time is an exact, non-negative partition even with
  concurrent provider processes.
- Claude and Codex use identical engine-owned semantics while provider-native duration remains intact.
- Failed models, retries, and provider fallbacks are not silently omitted.
- Historical records and the existing cost contract remain backward compatible.
- Approach C can extend the timing section additively instead of replacing #1101.

### Negative

- Timing metadata must be threaded through several result adapters; one missed conversion silently
  creates partial evidence.
- The event schema and shipped-record body gain additional additive fields and tolerant parsing.
- Active-step timing becomes explicit engine telemetry instead of relying only on persistence
  timestamps, increasing the implementation surface beyond a two-line provider timer.

### Follow-up Actions

- [ ] Implement and test exact interval capture for both built-in provider adapters and every process outcome.
- [ ] Preserve plural intervals through model fallback and the full provider-result propagation matrix.
- [ ] Add explicit active-step intervals and overlap-safe timing rollup states.
- [ ] Persist and report the additive timing section with historical compatibility.
- [ ] Update operator documentation and acceptance coverage; leave OTel work to its existing roadmap.
