# Conflict Check — Durable provider-time attribution (#1101)

**Status:** Accepted
**Date:** 2026-07-29
**Stories checked:** `.docs/stories/durable-provider-time-attribution.md` (5 stories, FR-1 through FR-10)
**Comparison inventory:** 266 story files, 41 product specs, and 139 prior conflict reports

## Result

**CLEAN — no blocking or degrading conflicts.** The five #1101 stories form a producer-to-consumer
chain: provider interval capture → propagation → interval union and partition → durable writer/reader
→ historical/additive compatibility. Their field meanings, evidence states, and concurrency rules are
consistent. Six existing-system overlaps are real but managed below.

## Internal story consistency

- Provider capture and propagation share one plural interval contract; failed/retried/fallback
  attempts contribute only when a provider process actually starts.
- Provider-active and active-step intervals are both unioned before subtraction, so concurrency does
  not create a negative residual or double-count elapsed time.
- Measured, partial, and unavailable states are used consistently by the rollup, shipment record, and
  report. Missing evidence is never a measured zero.
- Historical compatibility and future additive fields preserve the meanings established by the
  capture, partition, and persistence stories.

## Managed overlaps

### C1 — Provider-reported duration and engine-observed intervals are distinct

`TokenUsage.durationMs` already means provider-reported duration where a provider supplies one;
Codex deliberately leaves it absent. Reusing that field would contradict the accepted cost-metering
contract and fabricate provider parity.

**Resolution:** #1101 adds plural engine-observed intervals outside `TokenUsage`. Existing duration,
usage, cost, and metering classifications remain unchanged. This separation is pinned by FR-7 and the
approved ADR.

### C2 — Model and provider fallback must retain every started interval

The model-availability ladder and provider-candidate execution may start several subprocesses while
returning only a terminal result. Retaining only the final attempt would undercount provider-active
time.

**Resolution:** interval metadata is plural; the model ladder concatenates all started attempts and
provider-aware attempt evidence copies the full list. Skipped candidates add no interval. Producer
and propagation work must precede the rollup in the implementation plan. This is a sequencing
dependency, not a semantic conflict.

### C3 — Explicit active-step timing coexists with timestamp-derived reporting and OTel

Wave C's existing report derives step durations from persisted event timestamps. OTel is an optional,
additive event listener with its own export lifecycle. Neither contract guarantees the exact monotonic
active interval required by #1101's wall-time partition.

**Resolution:** #1101 adds engine-observed active-step interval evidence for its dedicated timing
rollup and does not redefine existing `conduct --report` or make OTel a dependency. Persistence
timestamps remain audit timestamps. Any future OTel consumer may read the additive fields without
owning them.

### C4 — Shipment timing writer and reader share an atomic additive contract

The shipped record already carries an additive `## Cost` body block while frontmatter is
load-bearing for daemon dedup. A new writer without tolerant readers, or a parser that treats absence
as zero, could produce plausible but incorrect output.

**Resolution:** timing uses its own body section after the closing frontmatter fence. Writer, parser,
and durable performance report land together; old records yield `unavailable`, malformed/mixed
records yield `partial` or `unavailable`, and unknown additive fields are ignored safely. Cost parsing
and frontmatter stay unchanged.

### C5 — Timing evidence must be committed before workspace teardown

Existing shipped-record and deferred-worktree-reap work treats the committed record as the durable
source of truth and the feature workspace as disposable only after shipment evidence is retained.

**Resolution:** the timing rollup is written into the committed shipped record on the existing ship
path. Reporting reads committed records and does not depend on `.pipeline/` after cleanup. This aligns
with, rather than competes with, the retention/reap lifecycle.

### C6 — Active v1 branches touch the same integration hotspots

The advisory overlap scan reports broad path overlap around provider adapters, conductor result
types, event handling, shipped records, KPI/reporting, and their documentation. This is expected for
the v1 performance intake and creates merge/rebase risk, but no reviewed story assigns a conflicting
meaning to #1101's timing fields.

**Resolution:** the implementation plan must name the dependency chain, keep writer/reader changes
atomic, run a fresh pre-build overlap scan, and expect finish-time rebase. Path overlap alone is not a
story contradiction.

## Five conflict types

| Type | Finding | Disposition |
|---|---|---|
| Contradiction | None after separating engine intervals from provider-reported duration. | Clear |
| Overlap | Six managed overlaps above; all retain one owner and additive semantics. | Managed |
| State conflict | No new mutable lifecycle; append-only feature evidence rolls into a committed record. | Clear |
| Resource contention | Per-feature event/worktree inputs and read-only committed reporting add no shared external resource. | Clear |
| Sequencing | Capture → propagation → rollup → writer/reader is load-bearing; writer and reader land atomically. | Managed in plan |

## Out-of-scope boundaries reaffirmed

- OTel exporters, task/subagent spans, and provider-independent trace topology.
- Local-command categories, CPU/utilization metrics, and cumulative parallel provider work.
- Changes to cost, token, provider-reported duration, existing `conduct --report`, or daemon
  build-to-PR/stall timing semantics.
- Reconstruction of timing that was never captured for historical shipments.

## Verdict

**CLEAN.** All five conflict types were checked. There are no unresolved contradictions or degrading
conflicts, and no conflict-review marker is required. Safe to proceed to implementation planning once
the operator accepts this report.
