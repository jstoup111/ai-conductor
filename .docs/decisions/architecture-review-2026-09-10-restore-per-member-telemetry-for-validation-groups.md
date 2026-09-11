# Architecture Review: Sequential and parallel telemetry parity

**Date:** 2026-09-10
**Mode:** Full, Tier L, technical track
**Input reviewed:** Approved track, component diagram, source issue #2414, and the operator-approved architecture proposal.
**Stories reviewed:** Not yet authored; this is the pre-stories review.
**Verdict:** APPROVED

## Feasibility

Verified existing seams support this design without an external dependency: conductor execution tracking, group-core callbacks, typed events, EventPersister, timing-rollup, MetricsListener, SpanManager, and DispatchMeteringTracker. The event schema evolves additively with explicit legacy fallback. No new infrastructure or credentials are needed. Source facts and evidence are recorded in adr-2026-09-10-shared-step-lifecycle-telemetry.

## Complexity

Large because identity, terminal races, and compatibility cross multiple producers and consumers. Shared instrumentation limits this work to observability; execution policy is preserved.

## Alignment

Reuse adr-2026-07-10-concurrent-group-core, adr-2026-07-10-validation-group-join, adr-2026-08-12-execution-lifecycle-completeness-for-timing, adr-2026-08-24-refused-step-status, and adr-014-otel-observability-exporter. The new ADR covers the previously unspecified cross-module identity and instrumentation ownership contract. No governing decision is superseded. The diagram passed render validation and was approved with the proposal.

## Domain Integrity

Execution subjects distinguish lifecycle steps from configured members; neither arbitrary member strings nor provider session IDs become lifecycle policy identities. Typed terminal outcomes retain refusal versus failure. Transient correlation maps are bookkeeping; durable evidence remains events.jsonl. Metrics do not grant gate satisfaction or mutate conductor state.

## Wiring Surface

The shared lifecycle seam is called by conductor.ts serial dispatch, dispatchGroupRound, runParallelGroupViaCore, and shutdown. group-core.ts reports branch observations through a production-required observer. Per-invocation context flows through StepRunOptions and step-runners.ts event callbacks. types/events.ts carries optional identity to EventPersister, daemon forwarding, timing-rollup, MetricsListener, SpanManager/visualizer, and dispatch-metering/presentation consumers. No new CLI or configuration key is introduced. The detailed caller/consumer mapping is in the approved ADR.

## Risks

High-impact risks are member/gate status conflation, late-terminal collisions, duplicate cost accounting, legacy ledger breakage, and exporter failure affecting execution. The approved ADR records likelihoods and mitigations: separate authority, execution-scoped correlation, provider-attempt deduplication, historical fixtures and interval unions, and failure-isolated projections. Queue/sibling timing and metric cardinality receive dedicated criteria. No risk is accepted as an unmitigated delivery compromise.

## ADRs Created

adr-2026-09-10-shared-step-lifecycle-telemetry — APPROVED by operator 2026-09-10. Structural prerequisite: shared cross-module execution identity and lifecycle ownership. Existing decisions did not define that contract; they remain in force.

## Overlap

ai-conductor overlap-scan over the candidate event, conductor, group, persistence, timing, metrics, and span paths reported no overlap and no open blockers. Advisory only; BUILD resolves source positions against its own checkout.

## Verification and approval

The operator approved the complete proposal and diagram on 2026-09-10. Verify-claims: CLEAR. Integrity validation before this record: 302 passed, 0 failed, one model-table warning; final spec validation must cover the completed artifact set.
