# Coherence: Shipped-record timing reaches `measured`, or says why not (#1260)

**Date:** 2026-08-12
**Tier:** M
**Track:** technical — the `fr` row class is omitted (no PRD; technical intents TI-1..TI-5 in the
stories file carry the requirement layer).
**Outcome source:** the Desired-outcome bullets of jstoup111/ai-conductor#1260, carried into the
spec by the `.docs/intake/` marker landed with this branch.

| Row class | Cited id | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-2 | covered | "A feature that ships through a normal daemon run produces a shipped record whose timing state is `measured`, with all three duration values present." Story 1 asserts the `measured` rollup and its rendered block; Story 2 is what makes it reachable, since the measured baseline showed five of six live ledgers blocked solely by unclosed executions. |
| outcome | outcome-2 | story-3 | covered | "When timing genuinely cannot be measured, the committed record states which evidence was missing or inconsistent." Story 3 makes all five degrade routes distinguishable in the committed `## Time` block and carries the open execution keys for the route that fires in practice. |
| outcome | outcome-3 | story-5 | covered | "The aggregate KPI reports how many ships contributed to its averages, so a figure computed over zero samples is visibly distinguishable from a real one." Verified already satisfied on 2026-08-12 — `formatTimingAggregate` emits `measured=/partial=/unavailable=` and early-returns before dividing when `measured === 0`. Story 5 pins it as a regression test rather than re-implementing it; the intake's claim that an average is computed over zero samples does not hold. |
| outcome | outcome-4 | story-4 | covered | "A run with genuinely incomplete evidence still degrades rather than reporting a fabricated `measured` total." Story 4 forbids closing an execution the ledger left open, which is the only route by which a fabricated total could arise, since the missing terminal is also the missing `activeInterval`. |
| outcome | outcome-5 | story-1 | covered | "Ship one feature end to end, then read `.docs/shipped/<slug>.md` — the `## Time` block carries numbers, and `provider_active_ms + no_provider_active_ms` equals `active_ms`." Story 1's happy path asserts that exact equality through the real parser, and its task proves it across an interrupt-and-resume run rather than only a clean one. |
| adr | adr-2026-08-12-execution-lifecycle-completeness-for-timing | story-2, story-3, story-4, task-9, task-15 | covered | The ADR's five decisions each land in the spec below it. Decision 1 (every start emits exactly one terminal, carrying the persister's `activeInterval`) is Story 2 and task-9's single conductor-owned emitter. Decision 2 (the rollup never closes an execution the ledger left open) is Story 4 and task-15's no-fabrication guards. Decision 3 (a `partial` names its route) is Story 3. Decision 4 (backward compatibility in both directions) is Story 5, tasks 6 and 7. Decision 5 (unrecoverable death stays `partial`) is Story 2's third negative path and Story 4. The ADR extends `adr-2026-07-29-engine-observed-provider-time-partition` and supersedes nothing. |
| story | story-1 | task-16 | covered | End-to-end proof that a run interrupted with an execution open still reaches `measured`, with the interrupted execution's time included rather than dropped. |
| story | story-2 | task-8, task-9, task-10, task-11, task-12, task-13, task-14 | covered | Enumeration of the catchable interrupt paths, the single conductor-owned emitter, its three call sites, and the exactly-one-terminal and no-orphan-terminal negatives. |
| story | story-3 | task-1, task-2, task-3, task-4, task-5 | covered | The route returned from the rollup, all five routes distinguished, then rendered, parsed back, and surfaced on the KPI row. |
| story | story-4 | task-15 | covered | Stale start not closed by a later start of the same key, repeated starts counted rather than collapsed, and no provider-evidence combination promoting an open ledger to `measured`. |
| story | story-5 | task-6, task-7, task-17 | covered | Both historical record shapes round-tripped, the zero-measured aggregate pinned, and the two reference pages that document these fields updated. |
| task | task-1 | story-3 | covered | The empty-active-union route returns a distinguishable reason; the partial variant gains the field. |
| task | task-2 | story-3 | covered | The remaining four routes each return a different reason, with open execution keys on the open-executions route. |
| task | task-3 | story-3 | covered | One parseable reason line in the `## Time` block, absent on `measured`, with `unavailable` output byte-identical to today's. |
| task | task-4 | story-3 | covered | The KPI `## Time` parser reads the reason by name; a block without it parses exactly as it does today. |
| task | task-5 | story-3 | covered | The reason reaches the rendered feature row without disturbing `measured` or `unavailable` rows. |
| task | task-6 | story-5 | covered | Reason-free `partial`, no-`## Time`-block, and malformed-block cases all parse to their current results without throwing. |
| task | task-7 | story-5 | covered | Zero-measured aggregate reports counts and no average; mixed sets average only over the measured records. |
| task | task-8 | story-2 | covered | The catchable interrupt paths are enumerated and checked against the open execution keys actually observed on the live ledgers. |
| task | task-9 | story-2 | covered | One private conductor-owned emitter resolves open executions itself, so no call site supplies — or can omit — the step. |
| task | task-10 | story-2 | covered | The halt path closes its open executions and leaves existing `loop_halt` behavior unchanged. |
| task | task-11 | story-2 | covered | The live-boundary abort path closes its open executions with its diagnostic output unchanged. |
| task | task-12 | story-2 | covered | Graceful shutdown closes its open executions. |
| task | task-13 | story-2 | covered | Exactly one terminal per start across a run that completes steps and then halts. |
| task | task-14 | story-2 | covered | An interrupt before any start emits no orphan terminal. |
| task | task-15 | story-4 | covered | The three no-fabrication guards, plus the unparseable-line degrade. |
| task | task-16 | story-1 | covered | Interrupt-and-resume run reaches `measured` with the partition summing exactly and no reason line rendered. |
| task | task-17 | story-5 | covered | `docs/reference/cli.md` and `docs/reference/artifacts.md` describe the reason field and note that older records omit it. |
