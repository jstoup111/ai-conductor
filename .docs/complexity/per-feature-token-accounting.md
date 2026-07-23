# Complexity: Per-feature token accounting

Tier: M

## Rationale

Scored against conduct's signals (models, integrations, auth, state machines, story count):

- **New data models:** none. Reuses existing `TokenUsage` type and the `.pipeline/events.jsonl`
  event stream; adds one committed rollup section to the existing `.docs/shipped/<slug>.md` record.
- **Integrations:** a handful of *internal* seams, all existing code paths — the provider dispatch
  (`claude-provider.ts`), the step-runner result thread (`step-runners.ts`), the conductor emit
  (`conductor.ts`), the shipped-record writer, the retro step, and a read-only KPI/trend surface.
  No external services.
- **Auth:** none.
- **State machines:** none. No new lifecycle; the rollup is written once at ship.
- **Story count:** ~6–8 (capture wire, threading, per-feature rollup at ship, unmetered handling,
  KPI/trend read surface, retro read, keep-OTel-fed).

Not Small: it is cross-cutting (multiple integration seams) and carries a measurement-correctness
requirement (unmetered sessions must be *visibly* incomplete), so conflict-check and architecture
artifacts are warranted. Not Large: no new subsystem, data model, auth, or state machine; the
dominant risk is a single output-format change on the dispatch path.

Architecture-review depth for M: **lightweight** — focus on the one load-bearing decision (where the
per-feature ledger lives + how "unmetered" is represented) and forward-compatibility with the
deferred OTel (C) work.
