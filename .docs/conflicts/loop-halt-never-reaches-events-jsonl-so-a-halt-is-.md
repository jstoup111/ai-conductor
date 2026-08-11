# Conflict Report: Halt events reach the persisted spine (#1477)

**Date:** 2026-08-11
**New stories:** `.docs/stories/loop-halt-never-reaches-events-jsonl-so-a-halt-is-.md` (7 stories)
**Result:** PASS — 0 blocking, 0 degrading. 2 reinforcing overlaps with prior shipped stories
(both are satisfied *more* by this change, not contradicted). 3 coverage notes, 2 of them
routed to `/plan`.

Scope of the scan: every `.docs/stories/` file mentioning `loop_halt`, `events.jsonl`,
`EVENT_SINKS`, `persist`, or `writeHaltMarker`, plus the two documentation pages that describe
the current behavior as a known limitation.

## Overlap 1: Phase 9.1 signal assembly already assumes halts are in the ledger

**Stories involved:** "Derive the signal from data the loop already produces"
(`.docs/stories/phase-9.1-retro-signal-engineer-memory.md:95-105`, FR-4) vs new Stories 1 and 4.

**Type:** reinforcing overlap (verified — the shipped story's happy path reads "Given a
feature's `events.jsonl` contains `kickback`, `loop_halt`, `step_completed` … then `halts[]`
… are populated from them").

**Severity:** none. The prior story's premise is currently unsatisfiable in production —
`halts[]` is always empty because `loop_halt` never reaches the file it names. This feature
makes that shipped acceptance criterion true for the first time rather than contradicting it.
No amendment note is required: the story text is already correct as written and needs no
change.

**Routed to `/plan`:** the revived `aggregateHalts` → `EngineerSignal.halts` → `haltRate`
chain needs explicit non-zero coverage (new Story 4), because the shipped story's own test
could only ever have exercised a synthetic fixture, never a real run.

## Overlap 2: The silent-exit backstop emits `loop_halt` from outside the step loop

**Stories involved:** "conduct loop exits silently between steps — no terminal signal"
(`.docs/stories/conduct-loop-exits-silently-between-steps-no-termi.md:37,57,124,139`) vs new
Story 2's central-stamp requirement.

**Type:** reinforcing overlap (verified — that story requires the daemon-only `finally`
backstop to write `.pipeline/HALT` and emit `loop_halt` with a matching reason).

**Severity:** none, but it constrains the implementation: the backstop's halt is raised
*outside* the step loop, so a naive stamp reading only `breadcrumb.lastAdvancedStep` could
produce no step there. This is exactly why the ADR reuses `resolveLastStep(state, breadcrumb)`,
whose preference order already covers that case — and `resolveLastStep`'s documented purpose is
that very backstop message. The two designs converge rather than collide.

**Routed to `/plan`:** the backstop's `loop_halt` must route through the same central emit path
as every other site, and its existing reason-matching assertions must continue to pass
unchanged.

## Coverage note 1: Tests that encode the current defect

`test/engine/event-sinks.test.ts`, `test/engine/cost-rollup.test.ts` and the
`report-renderer` / `rates` tests may pin today's persisted-type set or today's zero halt
counts. Those are assertions of the defect, not of the contract. New Story 4's Done-When
requires each to be corrected with an explanatory note rather than worked around.

## Coverage note 2: Documentation that states the defect as permanent

`docs/runbooks/stalled-or-stuck-feature.md:540-542` documents "`loop_halt` and `kickback` …
never reach `events.jsonl` and no report can surface them" as a **known limitation**, and
`docs/reference/artifacts.md:633` carries a matching note. Both become false with this change.
New Story 7 covers correcting them; leaving them would send an operator down the fallback
diagnosis path this feature exists to eliminate.

Note for the implementer: the runbook sentence also names `kickback`, which
`event-sinks.ts:57` already declares `persist: true`. That half of the sentence is *already*
wrong today and should be corrected in the same edit.

## Coverage note 3: OTel keeps a second, independent routing table

`OtelVisualizer.start` (`engine/otel/otel-visualizer.ts:298-311`) does not read `EVENT_SINKS`
or `persistedEventTypes()`. It subscribes from a hardcoded twelve-entry list and dispatches
through a matching `switch` (`:394-441`). `loop_halt` is in neither.

This is not a conflict with the new stories — no story claims OTel coverage, and no OTel story
claims sink-table derivation — but it bounds what this feature delivers, and the bound is easy
to misread. After this change a halt is recoverable from the ledger, the audit trail, the cost
rollup and the engineer signal, and is still absent from the OTel trace. A halt mid-step also
leaves an unclosed span there, since only `step_completed`/`step_failed` close one.

**Routed to `/plan`:** nothing. Deliberately out of scope for #1477, whose outcomes are all
stated against `.pipeline/events.jsonl`. Recorded here so the gap is not rediscovered as a
surprise during BUILD, and filed separately as a follow-up intake.

## No conflicts found with

- The OTel observability stories — see coverage note 3; they subscribe to their own list and
  are unaffected by a sink-table change in either direction.
- The rebase-on-latest stories (`phase-9.0-rebase-on-latest.md`) — they specify rebase halt
  *behavior* (park the feature), not its telemetry routing. Adding a sink does not change when
  a rebase parks.
- `daemon-mode-route-halt-user-input-required-through.md:153` — it asserts the `loop_halt`
  reason matches a HALT line. A stamped `step` field is additive and leaves `reason` untouched.
- The pipeline-owned closeout ledger (`adr-2026-08-08-pipeline-owned-closeout-timestamps`) —
  a separate single-writer sibling file in the same schema; this feature adds no writer to it.
