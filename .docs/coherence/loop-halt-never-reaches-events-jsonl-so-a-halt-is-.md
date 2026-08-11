# Coherence: Halt events reach the persisted spine (#1477)

**Date:** 2026-08-11
**Tier:** M
**Track:** technical — the `fr` row class is omitted (no PRD; technical intents TI-1..TI-6 in
the stories file carry the requirement layer).
**Outcome source:** the Desired-outcome bullets of jstoup111/ai-conductor#1477, carried into
the spec by the `.docs/intake/` marker landed with this branch.

| Row class | Cited id | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-7 | covered | "After a build halts, the halt and its cause are recoverable from `.pipeline/events.jsonl` alone." Story 1 persists `loop_halt` with its reason and asserts it via the real persister; Story 7 corrects the two docs pages that currently send an operator to the daemon log instead. |
| outcome | outcome-2 | story-2 | covered | "The recorded halt names the step that actually halted; halting in a step other than `build` is attributed to that step." Story 2 adds the field, stamps it centrally, and asserts a non-`build` halt in both the ledger and the audit record. |
| outcome | outcome-3 | story-3 | covered | "`rebase_conflict_halt` is likewise recoverable from the spine." Story 3 routes it to render+persist and asserts `reason`, `conflicts` and `step: 'rebase'`. |
| outcome | outcome-4 | story-4 | covered | "A halt-count over persisted events reports a non-zero count when halts have occurred." Story 4 covers `rollup.halts`, `aggregateHalts` and `haltRate` — the intake named the first; discovery found the other two dead the same way. |
| outcome | outcome-5 | story-5 | covered | "If the on-disk halt marker cannot be written, that failure is itself visible rather than silent." Story 5 returns a result, adds the `halt_marker_write_failed` variant, and pins the never-throws and no-emitter paths. |
| outcome | outcome-6 | story-6 | covered | "Non-halt event volume does not measurably grow." Story 6 pins the persisted-type set so an unintended addition fails the suite rather than being caught in review. |
| story | story-1 | task-1 | covered | Sink flip plus the synchronous-durability, absent-`prUrl` and unwritable-ledger negatives. |
| story | story-2 | task-4, task-5, task-6, task-7 | covered | Schema field, central stamp, the outside-the-loop and settled-step attribution negatives, and the audit-record agreement. |
| story | story-3 | task-2, task-7 | covered | Render+persist routing, and the `rebase` stamp at the single emission site. |
| story | story-4 | task-10 | covered | Non-zero counts for all three revived consumers, plus the no-halt, missing-reason and malformed-line negatives. |
| story | story-5 | task-8, task-9 | covered | The variant and result contract, then the six call sites including the no-emitter, failed-emit and partial-`HALT.class` failure cases. |
| story | story-6 | task-3 | covered | The pinned persisted-type set and the explicit `persist: false` assertions for the out-of-scope events. |
| story | story-7 | task-11 | covered | Both documentation pages, including the runbook's already-false `kickback` claim. |
| task | task-1 | story-1 | covered | `loop_halt` persists; `persistedEventTypes()` includes it and the record reaches the ledger file. |
| task | task-2 | story-3 | covered | `rebase_conflict_halt` reaches the render and persist sinks for the first time. |
| task | task-3 | story-6 | covered | Persisted set pinned; the guard is proven to bite before it is relied on. |
| task | task-4 | story-2 | covered | Optional `step` added to both halt variants; persister interval bookkeeping undisturbed. |
| task | task-5 | story-2 | covered | One conductor-owned emit path stamps the step; no `loop_halt` literal survives outside it. |
| task | task-6 | story-2 | covered | Backstop, settled-step and `state.last_step` attribution paths, with no per-site step argument. |
| task | task-7 | story-2, story-3 | covered | `rebase` stamp plus the audit translator's step, including the absent-field fallback to `build` for historical records. |
| task | task-8 | story-5 | covered | `halt_marker_write_failed` variant, sink declaration, renderer case, and the result-returning non-throwing writer. |
| task | task-9 | story-5 | covered | All six call sites carry the result; none discards a failure. |
| task | task-10 | story-4 | covered | The three halt counters proven non-zero; defect-encoding assertions corrected with a note. |
| task | task-11 | story-7 | covered | Runbook and artifacts reference corrected; `.pipeline/HALT` still documented as the park signal. |
