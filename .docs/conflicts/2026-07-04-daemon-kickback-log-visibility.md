# Conflict Check: Daemon kickback log visibility

**Date:** 2026-07-04
**New stories:** .docs/stories/daemon-logs-surface-kickback-steps-visibly.md (4 stories)
**Scanned against:** all .docs/stories/ files; grep sweep for renderer-format, kickback,
navigation_back, and daemon-log assertions across existing stories and specs.

## Conflict: Front-half kickback-cap enforcement

**Stories involved:** "Front-half amendment kickback emits one event at detection time" vs
decide-pipeline-restructure S8 ("architecture-review is convergent under kickback", FR-12)
**Files:** .docs/stories/daemon-logs-surface-kickback-steps-visibly.md vs .docs/stories/decide-pipeline-restructure.md
**Type:** contradiction
**Severity:** degrading (as originally drafted)

**Description:**
S8's negative path asserts "architecture re-opened past the kickback cap → HALT for a human."
The new story as first drafted asserted the front-half scan does NOT halt past the cap
(observability-only scope). Both could not be true as system-behavior statements for
front-half-origin re-opens. Root cause was found upstream during architecture review:
adr-2026-06-29 declares the cap "applies to the new targets," but the implementation only
counts and enforces in the tail scan — front-half re-opens were neither counted nor capped.

**Resolution options presented:**
1. Accept as degrading — defer front-half cap enforcement to a follow-up issue (matched the
   then-approved observability-only ADR).
2. Expand scope — enforce the cap in the front-half scan too, closing adr-2026-06-29's
   implementation gap in this feature (requires ADR amendment).

**Resolution chosen (operator):** Option 2. Rooted in the design per §5c, so architecture
was re-opened in amendment mode: adr-2026-07-04-kickback-event-emission-and-log-prominence
amended (front-half scan enforces the cap via the tail's exact HALT sequence, one shared
per-gate counter), architecture-review condition 2 replaced, Story 3 re-derived
(cap-exceeded → HALT negative path + shared-counter negative path).

## Re-check (post-resolution)

- decide-pipeline-restructure S8 vs amended Story 3: **consistent** — both now assert
  cap-exceeded re-opens HALT; the amendment implements S8's intent for front-half origins.
- otel-observability (kickback/gate_verdict as span events): additive-only — event shape
  unchanged, more emissions, between-step arrival already handled. No conflict.
- wave-c JSON-stdout / telemetry event-log stories: consume the event stream generically;
  additive events and a new rendered case do not contradict any assertion. No conflict.
- No other story or spec asserts exact daemon log-line formats (grep sweep for the dim-·
  chrome, ↩, KICKBACK, renderDaemonEvent: only this feature's artifacts match).
- Resource contention: renderer test contract (`daemon-render.test.ts`) is claimed only by
  this feature; event union change is additive (`navigation_back` already exists). None.
- Sequencing: no ordering assumptions against other open specs. None.

**Result: PASS — zero blocking conflicts, zero remaining degrading conflicts** (the one
degrading conflict was eliminated by scope expansion, not accepted as a compromise).
