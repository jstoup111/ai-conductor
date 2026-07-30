# Coherence Mapping: Durable Provider-Time Attribution (#1101)

**Status:** Accepted
**Date:** 2026-07-29
**Tier:** M
**Track:** Product
**Plan stem:** `no-durable-llm-time-vs-code-execution-time-breakdo`
**PRD:** `.docs/specs/2026-07-29-durable-provider-time-attribution.md`
**Stories:** `.docs/stories/durable-provider-time-attribution.md`
**Plan:** `.docs/plans/no-durable-llm-time-vs-code-execution-time-breakdo.md`

The staged intake-outcomes file contains the source reference and an empty Desired outcome section,
but no outcome bullets. Per the coherence contract, the outcome row class is therefore not required
and is omitted rather than represented by a placeholder.

## Traceability

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| fr | fr-1 | story-1 | covered | Story 1 requires one engine-observed interval for each started built-in provider process. |
| fr | fr-2 | story-1 | covered | Story 1 includes failed, retried, fallback, and skipped-candidate behavior. |
| fr | fr-3 | story-2 | covered | Story 2 defines overlap-safe provider interval union. |
| fr | fr-4 | story-3 | covered | Story 3 defines the exact active/provider/no-provider partition. |
| fr | fr-5 | story-4 | covered | Story 4 commits the timing partition to the shipped record. |
| fr | fr-6 | story-4 | covered | Story 4 reports committed timing after workspace removal. |
| fr | fr-7 | story-1 | covered | Story 1 keeps provider-reported and engine-observed durations distinct. |
| fr | fr-8 | story-5 | covered | Story 5 distinguishes partial, unavailable, and historical absence from zero. |
| fr | fr-9 | story-5 | covered | Story 5 preserves existing non-timing behavior for historical records. |
| fr | fr-10 | story-5 | covered | Story 5 permits unknown additive timing fields without semantic reinterpretation. |
| story | story-1 | task-1, task-2, task-3, task-4, task-5, task-6, task-7, task-8, task-9, task-10 | covered | Tasks 1–10 define, capture, accumulate, propagate, and persist every provider interval. |
| story | story-2 | task-13 | covered | Task 13 covers the complete deterministic interval-union corpus, including malformed inputs. |
| story | story-3 | task-11, task-12, task-14, task-15 | covered | Tasks 11–15 capture active intervals and compute measured/partial/unavailable partitions. |
| story | story-4 | task-16, task-17, task-18, task-20 | covered | Tasks 16–20 persist, report, and prove timing after workspace removal. |
| story | story-5 | task-19 | covered | Task 19 owns historical, malformed, mixed-version, and future-additive read behavior. |
| task | task-1 | story-1 | covered | Shared interval contract supports provider capture without changing TokenUsage. |
| task | task-2 | story-1 | covered | Captures successful Claude process timing. |
| task | task-3 | story-1 | covered | Covers Claude interactive and failure invariants. |
| task | task-4 | story-1 | covered | Captures Codex and self-host process timing. |
| task | task-5 | story-1 | covered | Covers Codex interactive, failure, and skip invariants. |
| task | task-6 | story-1 | covered | Retains every model-ladder interval. |
| task | task-7 | story-1 | covered | Attributes provider fallback and cached-skip evidence. |
| task | task-8 | story-1 | covered | Preserves intervals through primary result conversions. |
| task | task-9 | story-1 | covered | Closes grouped and auxiliary propagation gaps. |
| task | task-10 | story-1 | covered | Persists provider intervals on existing feature events. |
| task | task-11 | story-3 | covered | Records serial active-step intervals and excludes parked gaps. |
| task | task-12 | story-3 | covered | Records concurrent-group and incomplete active evidence. |
| task | task-13 | story-2 | covered | Implements deterministic provider interval union. |
| task | task-14 | story-3 | covered | Computes the measured exact feature-time partition. |
| task | task-15 | story-3 | covered | Classifies incomplete or absent partition evidence honestly. |
| task | task-16 | story-4 | covered | Renders an additive durable Time section. |
| task | task-17 | story-4 | covered | Wires timing into non-blocking shipped-record creation. |
| task | task-18 | story-4 | covered | Parses and reports measured timing from committed records. |
| task | task-19 | story-5 | covered | Makes timing reports historical and corruption tolerant. |
| task | task-20 | story-4 | covered | Proves the committed ship-to-report path after workspace removal. |

## Bidirectional checks

- **FR → story:** all ten PRD FRs are cited by a real story's singular `**Requirement:**` line.
- **Story → task:** all five machine-readable story IDs are cited by at least one real plan task.
- **Task → story/purpose:** every non-supporting task cites a real story ID; infrastructure Tasks 1,
  8, 10, 13, and 17 also state their non-empty supporting purpose.
- **Negative paths:** provider failure/skip, malformed intervals, incomplete steps, parked gaps,
  unavailable history, corrupt records, and mixed-version/additive compatibility all have named tasks.
- **Coverage-table consistency:** the plan has no mechanically separate `## Coverage Check` claim
  table; its acceptance-criterion table cites only real task numbers and is consistent with this map.

## Verdict

**Coherent.** No outcome row is required, all 10 FRs are transitively covered, all five stories have
real tasks, all 20 tasks have a real story or supporting purpose, and there are no gap rows.
