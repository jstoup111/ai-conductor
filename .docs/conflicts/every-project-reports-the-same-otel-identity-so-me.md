# Conflict Check: OTel two-layer identity (#1938)

**Date:** 2026-08-26
**Stories checked:** .docs/stories/every-project-reports-the-same-otel-identity-so-me.md (Stories 1-3)
**ADR corpus:** repo_wide (conflict_check.adr_corpus)
**Result:** PASSED — zero blocking, zero degrading conflicts

## Corpus record (repo_wide)

Examined (subject overlaps telemetry/identity; all APPROVED):
adr-014-otel-observability-exporter (as amended 2026-08-26 by #1938),
adr-2026-07-22-per-feature-cost-rollup-in-shipped-record,
adr-2026-07-26-event-sink-registry-exhaustiveness,
adr-2026-07-27-cost-unmetered-is-a-first-class-state,
adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates,
adr-2026-07-27-cold-start-within-step-retries (§7 run-id contract),
adr-2026-07-29-engine-observed-provider-time-partition,
adr-2026-08-09-worktree-local-provider-scratch,
adr-2026-08-19-live-provider-stream-observation,
adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope,
adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity,
adr-2026-07-21-demote-task-stamping-to-telemetry,
adr-2026-07-01-machine-scoped-operator-identity.
Narrowed out: the remaining ~500 decision files — subjects (build gates, daemon lifecycle,
release/finish, intake, seals, provider routing, docs guards) touch no story behavior, entity,
field, or gate in this spec. No partially-superseded ADR in the examined set was excluded.

## Pairs examined (both directions)

- **Story 1 vs Story 2** (run id off data points vs run id on resource): satisfying either leaves
  the other intact — different carriers. No conflict.
- **Story 1 vs otel-observability.md "Run correlation via resource attributes" (FR-6)**: FR-6
  requires the four resource attributes non-empty; Story 1/2 preserve all four and only add.
  Both directions hold. No conflict.
- **Story 2 vs adr-2026-07-27-cold-start-within-step-retries §7**: `service.instance.id` uses the
  existing session-file source chain untouched; "per-invocation provider identity does not churn
  the run id" still holds. No conflict.
- **Story 2 vs adr-2026-08-25 (ship-tail attempt.id)**: distinct identifiers, distinct sinks;
  amendment text names the distinction explicitly. No conflict.
- **Story 1 vs #1941 (cost/dispatch counters, merged spec, stories not yet in this worktree's
  base)**: #1941 asserts its counters' attributes are *present* (`step`, `model`, `source`,
  `metering`) — never exclusive. Story 1's identity attributes are additive on every instrument.
  Both directions hold; overlap is textual (same file/tests), resolved mechanically at rebase.
  Not a story conflict.
- **Story 3 (`unknown` feature passthrough) vs adr-2026-07-27-cost-unmetered**: that ADR governs
  cost/metering states, not label values; no opposing sentence exists in either direction.
  The passthrough keeps unattributed runs visible rather than fabricating identity. No conflict.
- **Oscillation sweep**: no pair yields "no" in both directions.

## Notes

- Rebase-time check (carried from architecture review, not a conflict): if
  `origin/spec/pipeline-run-state-lives-inside-the-worktree-cwd-r` lands first, reuse its
  `projectKey` token for the project-name derivation.
