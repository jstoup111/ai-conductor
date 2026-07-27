# ADR 2026-07-27-b — The `## Cost` block evolves by addition, and cost aggregates split from token aggregates

Status: APPROVED
Date: 2026-07-27
Feature: 2026-07-27-codex-usage-metering-and-cost-attribution-906 (#906, absorbs #1008)

## Context

ADR 2026-07-27-a introduces a `cost-unmetered` state, which needs to reach the committed
record. That record is a **two-sided serialized contract already in the wild**: written by
`renderShippedRecordWithCost` (`shipped-record.ts:146-172`) and read back by regex in
`parseCostBlock` (`kpi-report.ts:37-67`). Shipped records exist on main today, and issue #906
requires that "cost rollups continue to work for Claude and mixed historical event logs".

Two further facts constrain the design:

1. **`kpi-report.ts:125-136` excludes a partial feature from *all* aggregates**, verbatim:
   ```ts
   const partial = feature.cost.unmeteredCount > 0;
   ...
   if (partial) { continue; }          // skips tokens AND cost
   ```
   Once Codex is correctly flagged, every mixed-provider feature becomes partial — and this
   repo builds on Codex — so a naive change would empty the KPI aggregate entirely.

2. **#1008 already documents the reporting half of this gap.** `docs/reference/artifacts.md:534-540`
   records that six parsed fields are never rendered and that the `providers:` sub-block "has no
   parser at all". #906 absorbs that scope, so the writer and reader are being changed together
   anyway — the right moment to fix the contract once rather than twice.

## Decision

### 1. The block grows by addition only; no existing line changes

`cost_unmetered:` is added as a new top-level line, and per-provider entries gain a
`cost_unmetered:` field. No existing field is renamed, reordered, reformatted, or given new
meaning. `unmetered:` keeps its current semantics precisely so historical records are not
silently reinterpreted.

Two properties of the current code make this safe in both directions, and both are load-bearing
enough to be pinned by tests:

- **New reader / old record:** `parseCostBlock` resolves each field by name and defaults it
  (`num('cache_read') ?? 0`), so a record written before this change parses cleanly with the
  new field defaulted.
- **Old reader / new record:** unknown lines are ignored — the parser only looks for fields it
  names. And because top-level lookups anchor `^name:` under the `m` flag while provider lines
  are two-space indented (`  codex: input: …`), a new top-level field can never be shadowed by,
  nor shadow, a provider line.

### 2. Cost aggregation and token aggregation are decoupled

The single `partial` gate is split:

- a **`unmetered`** dispatch (no usage at all) continues to disqualify the feature from both
  token and cost aggregates — unchanged behavior;
- a **`cost-unmetered`** dispatch disqualifies the feature from **cost** aggregates only. Its
  tokens are real and measured, so they still aggregate.

Feature lines render the distinction explicitly rather than with one undifferentiated
`[PARTIAL]` marker, so an operator can tell "we failed to measure this" from "this provider
has no per-run price".

### 3. #1008's rendering gap is closed in the same change

`conduct kpi` gains a parser and renderer for the `providers:` sub-block and surfaces the six
recorded-but-unrendered fields (`cacheRead`, `cacheCreation`, `dispatches`, `retries`, `halts`,
`unmeteredDurationMs`). The "Known limitation" note at `docs/reference/artifacts.md:534-540` is
removed in the same PR, and #1008 closes as covered.

This is a deliberate scope merge: leaving it out would ship a per-provider cost-metering state
that no reporting surface can display, which is not a completed outcome.

## Consequences

- Writer and reader must change together in one commit; a split lands a record no reader
  understands. The round-trip (render → parse → render) is the natural test seam and is pinned
  by a test that includes a record captured **before** this change.
- The `## Cost` block is now formally an evolvable schema. Future fields follow the same
  additive rule; a breaking reformat would require its own ADR and a migration story for
  committed records.
- `conduct kpi` output grows. It is a read-only reporting command with no machine consumers
  identified, so no migration block is required for its output shape.
- Per-provider cost attribution becomes visible for the first time, which is what makes the
  Codex/Claude split legible to an operator at all.
