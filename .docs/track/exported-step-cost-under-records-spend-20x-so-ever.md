# Track: exported-step-cost-under-records-spend-20x-so-ever

Track: technical

Scope boundary: balanced — fix the OTel cost export so a feature's recorded spend equals its own
finish-line/shipped-record total (within rounding) across every daemon process lifetime, with exact
per-step, per-model, per-project, and spend-over-time splits, on any OTLP backend (no dependence on
Prometheus reset/delta semantics). Covers both jstoup111/ai-conductor#2095 (source ref) and
jstoup111/ai-conductor#2086 (folded in). Includes (operator extension 2026-08-30): token counts ride the same ledger-derived snapshot as cumulative per step × model × kind gauges and the per-process `conductor.step.tokens` counter is removed, because it shares the splice defect exactly. Includes: shutting down each run's meter provider on stop so
dead runs stop re-exporting frozen values; surfacing export failures in the daemon log; retiring the
counter-based dashboard queries. Excludes: trace/span linkage across runs (#2011), delta temporality,
the `conductor.step.dispatches` counter, any change to how costs are measured per provider (claude/codex/pi all flow through the existing
provider_attempt rollup unchanged).

Telemetry-export correctness and observability infrastructure with no product-facing capability;
acceptance criteria live in stories, no PRD.
