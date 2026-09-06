# Implementation Plan: Render every declared render event in inline runs

**Date:** 2026-09-06
**Stories:** .docs/stories/render-every-declared-render-event-in-inline-runs.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent consumes the existing event bus and the existing sink registry without adding a union member, a sink declaration, or a second telemetry channel, so it cannot contradict an in-flight declaration change.

## Summary

Three bounded tasks deliver #2167. The terminal subscriber stops hand-maintaining its subscription and derives it from the sink registry; the inline dashboard renderer gains purpose-written lines for the four operator-critical loop events; and every other renderable event gets a one-line fallback so an inline run is never silent about an occurrence the registry declares renderable. Renderer unification, daemon forwarding behavior, sink declaration changes, and the separate OTel sink drift are outside this slice.

## Technical Approach

The subscriber's hardcoded array is replaced by a derived union of two sources: `renderedEventTypes()` from the sink registry, and a small exported constant naming the event types the inline dashboard subscribes to today that the registry declares non-renderable. That constant exists only to preserve current dashboard refreshes (checkpoint, recovery, dashboard refresh, tier and config skips, blocked gates, feature completion, auto-heal, mode skip) and to add the parallel-failure type the dashboard renderer already has a branch for but never receives. Duplicates between the two sources collapse, and the resulting order is irrelevant because each type is registered independently on the emitter. The forwarding predicate that routes a subset of events to the injected terminal renderer keeps its exact current membership, but that membership becomes an exported constant rather than an inline three-way comparison, so the dashboard renderer can exclude precisely those types from its fallback.

The dashboard renderer gains four dedicated switch branches — halt, kickback, gate verdict, convergence — whose text mirrors the class-based terminal renderer's existing lines so daemon and inline output stay recognizably the same. The gate branch keeps the established policy of printing only unsatisfied verdicts. Optional fields are read defensively exactly as the existing branches read them, so an absent evidence or reason string yields a shorter line rather than a throw.

Coverage becomes total through a default branch. The renderer computes, once at construction, a set of renderable types from the sink registry and subtracts the exported forwarded set; the default branch prints one dim summary line naming the event type, plus the step when the event carries one, for any type in that set. Types outside it fall through silently, so a non-renderable event with no dedicated branch stays as quiet as it is today. Subtracting the forwarded set is load-bearing rather than cosmetic: the inline path passes a single live region into both the callback renderer and the class renderer, so a fallback that overlapped the forwarded types would print the same occurrence twice into one region.

Tests are unit-level against the seams that already exist. The subscriber suite injects a plain emitter and a recording callback and asserts set membership on the subscribed types. The renderer suite already builds a live region over a capture stream; new cases reuse it, drive individual events, and read the captured text. Nothing in this change requires a conductor run, a temporary repository, a provider, or a network boundary, and no fixture may introduce one.

Reader-visible behavior changes, so the inline command reference gains a short paragraph stating that an inline run prints every event the sink registry declares renderable, with dedicated lines for halts, kickbacks, unsatisfied gates and convergence.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, the derived-subscription-plus-fallback approach, and both stories on 2026-09-06 (delegated).
- Verified: `src/conductor/src/ui/subscriber.ts:27-54` declares a 27-entry hardcoded `eventTypes` array, and `:59-64` forwards only `halt_marker_write_failed`, `renderer_error` and `pipeline_tail_diagnostic` to the injected renderer.
- Verified: `src/conductor/src/engine/event-sinks.ts:145` exports `renderedEventTypes()`, and 62 declarations in `EVENT_SINKS` carry `render: true`, including `loop_halt`, `loop_converged`, `kickback`, `gate_verdict`, `when_skip`, `parallel_started` and `parallel_completed`.
- Verified: `src/conductor/src/daemon-cli.ts:1147` already subscribes its per-feature bus with `renderedEventTypes()`, so the accessor is the established pattern and needs no new export.
- Verified: `src/conductor/src/ui/create-renderer.ts:97` opens a switch over 24 event types with no branch for the four loop events, while `src/conductor/src/ui/terminal-renderer.ts` carries all four.
- Verified: `src/conductor/src/index.ts:1091` constructs one live region, `:1369` puts it in the shared renderer options, `:1373` builds the callback renderer from those options, and `src/conductor/src/engine/plugin-loader.ts:227` builds the class renderer from the same options — one region, two writers.
- Verified: `src/conductor/test/ui/create-renderer.test.ts` already drives the renderer through a capture stream backed live region, and `src/conductor/test/ui/subscriber.test.ts` already drives the subscriber with a plain emitter and a mocked callback.
- Verified: `src/conductor/src/types/events.ts:751-757, 812-818, 836-848, 904-905` define the four loop event shapes this change formats.
- Scope check: consumer-facing engine behavior; no new skill; provider-agnostic. Event spine: no channel added, no union member added — an existing bus consumer is corrected.
- Verify-claims verdict: CLEAR. Every path, symbol and line above was read in the working tree; no unconfirmed assumption gates the approach.

## Tasks

### Task 1: Derive the terminal subscription from the sink registry
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/ui/subscriber.ts, src/conductor/test/ui/subscriber.test.ts
**Dependencies:** none

**Steps:**
1. Add failing unit assertions to the subscriber suite: start the subscriber against a plain emitter, capture which types it registered, and assert the captured set contains every type the sink registry's renderable accessor returns.
2. Add a second failing assertion that the set also contains each non-renderable type the current array subscribes to, enumerated explicitly so a later removal is loud.
3. Establish RED, then export a constant naming those non-renderable dashboard types plus the parallel-failure type, and replace the hardcoded array with a de-duplicated union of that constant and the renderable accessor.
4. Export the forwarded-to-renderer type list as a constant and rewrite the forwarding predicate to test membership in it, preserving its exact current three members.
5. Run the focused subscriber tests plus the project typecheck target that includes test files, then commit.

**Done when:**
1. A subscriber unit assertion proves every type returned by the sink registry's renderable accessor is subscribed on start.
2. A subscriber unit assertion proves the previously subscribed non-renderable types are still subscribed on start.
3. The forwarding predicate resolves through the exported constant and still forwards exactly the three types it forwarded before.

### Task 2: Give the inline renderer dedicated loop-event lines
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/ui/create-renderer.ts, src/conductor/test/ui/create-renderer.test.ts
**Dependencies:** 1

**Steps:**
1. Add failing renderer cases driving a halt event with a reason, a kickback with from, to and count, a converged event, an unsatisfied gate verdict with a reason, and a satisfied gate verdict.
2. Add failing cases for a kickback with no evidence and a gate verdict with no reason, asserting the returned promise resolves and the line is still produced.
3. Establish RED, then add the four switch branches, mirroring the class renderer's wording and its print-only-when-unsatisfied gate policy, and reading optional fields defensively.
4. Run the focused renderer tests plus the project typecheck target that includes test files, then commit.

**Done when:**
1. A renderer unit fixture emitting a loop-halt event captures terminal output containing the exact reason string supplied in the event.
2. A renderer unit fixture emitting a kickback event captures one line containing the from step, the to step and the count.
3. A renderer unit fixture emitting a satisfied gate verdict captures zero new output lines, and the unsatisfied fixture captures exactly one line naming the step and its reason.
4. A renderer unit fixture emitting a loop-converged event captures one convergence line.
5. Renderer unit fixtures with omitted optional fields resolve without a rejected promise and still produce their line.

### Task 3: Fall back to one summary line for every other renderable event
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/src/ui/create-renderer.ts, src/conductor/test/ui/create-renderer.test.ts, docs/reference/cli.md
**Dependencies:** 2

**Steps:**
1. Add a failing renderer assertion that iterates every renderable type which has neither a dedicated branch nor sink forwarding, drives a minimal event of that type, and expects exactly one captured line naming the type.
2. Add failing assertions that each sink-forwarded renderable type produces no line from this renderer, and that a non-renderable branchless type produces none either.
3. Establish RED, then compute the fallback set once at renderer construction as the renderable types minus the exported forwarded constant, and add a default branch printing one dim line naming the type and, when present, the step.
4. Add a short paragraph to the inline command reference stating that an inline run now prints every event the registry declares renderable, with dedicated lines for halts, kickbacks, unsatisfied gates and convergence.
5. Run the focused renderer tests plus the project typecheck target that includes test files, then commit.

**Done when:**
1. A renderer unit assertion drives every renderable type that has no dedicated branch and no sink forwarding, and captures exactly one line naming the type for each.
2. A renderer unit assertion drives each sink-forwarded renderable type and captures zero lines from the dashboard renderer.
3. A renderer unit assertion drives a non-renderable, branchless type and captures zero lines.
4. The inline command reference names the renderable-event rendering behavior this change introduces.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an inline run whose gate loop halts, when the conductor emits a loop-halt event, then the terminal prints one line containing that event's halt reason. | 2 | "A renderer unit fixture emitting a loop-halt event captures terminal output containing the exact reason string supplied in the event." | diff-local |
| Story 1 happy: Given an inline run whose gate re-opens an earlier step, when the conductor emits a kickback event, then the terminal prints one line naming the originating step, the re-opened step and the re-open count. | 2 | "A renderer unit fixture emitting a kickback event captures one line containing the from step, the to step and the count." | diff-local |
| Story 1 happy: Given an inline run whose gate loop converges, when the conductor emits a loop-converged event, then the terminal prints one convergence line. | 2 | "A renderer unit fixture emitting a loop-converged event captures one convergence line." | diff-local |
| Story 1 happy: Given an inline run whose gate reports an unsatisfied verdict, when the conductor emits that gate-verdict event, then the terminal prints one line naming the step and the stated reason. | 2 | "A renderer unit fixture emitting a satisfied gate verdict captures zero new output lines, and the unsatisfied fixture captures exactly one line naming the step and its reason." | diff-local |
| Story 1 negative: Given an inline run whose gate reports a satisfied verdict, when the conductor emits that gate-verdict event, then the terminal prints no gate line, because a satisfied gate is routine. | 2 | "A renderer unit fixture emitting a satisfied gate verdict captures zero new output lines, and the unsatisfied fixture captures exactly one line naming the step and its reason." | diff-local |
| Story 1 negative: Given an inline run emits a kickback or gate-verdict event whose optional evidence or reason field is absent, when the renderer handles it, then it prints its line without throwing and the run continues. | 2 | "Renderer unit fixtures with omitted optional fields resolve without a rejected promise and still produce their line." | diff-local |
| Story 2 happy: Given the event-sink registry declares an event type renderable, when the terminal subscriber starts, then that event type is among the types it subscribes to. | 1 | "A subscriber unit assertion proves every type returned by the sink registry's renderable accessor is subscribed on start." | diff-local |
| Story 2 happy: Given an event type that the terminal subscriber subscribed to before this change is declared non-renderable in the registry, when the terminal subscriber starts, then that event type is still subscribed so no existing inline dashboard refresh is lost. | 1 | "A subscriber unit assertion proves the previously subscribed non-renderable types are still subscribed on start." | diff-local |
| Story 2 happy: Given a renderable event type for which the inline dashboard renderer has no dedicated branch, when that event is emitted during an inline run, then the terminal prints exactly one summary line that names the event type. | 3 | "A renderer unit assertion drives every renderable type that has no dedicated branch and no sink forwarding, and captures exactly one line naming the type for each." | diff-local |
| Story 2 negative: Given a renderable event type that the subscriber already forwards to the injected terminal renderer sink, when that event is emitted during an inline run, then exactly one line is printed rather than a duplicated pair, because both inline renderers share one live region. | 1, 3 | "A renderer unit assertion drives each sink-forwarded renderable type and captures zero lines from the dashboard renderer." | diff-local |
| Story 2 negative: Given an event type declared non-renderable that the inline dashboard renderer has no dedicated branch for, when that event is emitted during an inline run, then no summary line is printed. | 3 | "A renderer unit assertion drives a non-renderable, branchless type and captures zero lines." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local against controlled unit fixtures. Task 1 owns the subscriber-to-registry correspondence at the emitter registration boundary. Task 2 owns the four dedicated renderer lines and their optional-field robustness. Task 3 owns fallback totality, forwarded-type suppression, and non-renderable silence. All three exercise the real production modules with an injected emitter or an injected live region over a capture stream; no third-party boundary, provider, network call, temporary repository, or conductor run participates, and none may be introduced. The existing class-renderer suite remains authoritative for the daemon-facing renderer, which this slice does not change. No terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 3
