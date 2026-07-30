# Coherence Check: Boundary-aware operator parking

**Date:** 2026-07-29
**Tier:** M
**Track:** Product
**Status:** Approved
**Plan stem:** `park-in-flight-features-at-step-boundaries-after-p`

No outcome rows are required: this is a chat-origin idea with no staged or committed intake
outcomes artifact. The FR, story, and task rows below were checked against the approved PRD,
accepted stories, and approved plan text—not inferred from identifier similarity.

## Traceability mapping

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| fr | fr-1 | story-1 | covered | Story 1 explicitly cites FR-1 and specifies a single running serial invocation draining without cancellation or replacement. |
| fr | fr-2 | story-2 | covered | Story 2 explicitly cites FR-2 and requires all started parallel members to settle before the join and stop. |
| fr | fr-3 | story-3 | covered | Story 3 explicitly cites FR-3 and covers durable natural serial, member, and group statuses plus persistence failure. |
| fr | fr-4 | story-4 | covered | Story 4 explicitly cites FR-4 and asserts zero dispatch for the next pending serial or grouped unit and later ticks. |
| fr | fr-5 | story-5 | covered | Story 5 explicitly cites FR-5 and distinguishes intentional park from DONE, HALT, error, and genuine active-work failure. |
| fr | fr-6 | story-6 | covered | Story 6 explicitly cites FR-6 and covers state-authoritative resume after unpark and restart. |
| fr | fr-7 | story-7 | covered | Story 7 explicitly cites FR-7 and covers late marker arrival, pre-first-unit park, indeterminate read, and in-unit drain. |
| fr | fr-8 | story-8 | covered | Story 8 explicitly cites FR-8 and names configured, SHIP, deterministic BUILD, zero/one-member, future-group, and bypass cases. |
| fr | fr-9 | story-9 | covered | Story 9 explicitly cites FR-9 and pins interactive dispatch/checkpoint behavior with and without a marker. |
| fr | fr-10 | story-10 | covered | Story 10 explicitly cites FR-10 and covers serial, group, and pre-first boundary identity without false terminal presentation. |
| story | story-1 | task-1, task-3, task-16 | covered | Tasks define the unit contract, prove serial drain/no cancellation, and exercise the bounded acceptance seam. |
| story | story-2 | task-1, task-6, task-7, task-8, task-16 | covered | Tasks cover configured, SHIP, deterministic BUILD, and joined-group behavior. |
| story | story-3 | task-1, task-5, task-6, task-7, task-16 | covered | Tasks order step/group identity after persistence and retain incomplete-write/failure authority. |
| story | story-4 | task-1, task-3, task-4, task-6, task-7, task-8, task-10, task-13, task-14, task-16 | covered | Serial/group next-unit blocking, persistent pool behavior, and restart/unpark paths are explicit. |
| story | story-5 | task-1, task-5, task-11, task-12, task-13, task-15, task-16 | covered | Typed termination, fast-unpark classification, genuine failures, pool handling, and distinct reporting are explicit. |
| story | story-6 | task-14, task-16 | covered | State-authoritative same-process and restarted resume are directly planned. |
| story | story-7 | task-3, task-4, task-10, task-11, task-16 | covered | First boundary, late arrival, read failure, main-root wiring, and pre-rebase race are directly planned. |
| story | story-8 | task-6, task-7, task-8, task-16 | covered | Each current group shape and the future dispatch inventory are directly planned. |
| story | story-9 | task-9, task-10, task-16 | covered | Interactive baseline and daemon-only injection are directly planned. |
| story | story-10 | task-1, task-2, task-3, task-6, task-7, task-8, task-15, task-16 | covered | Boundary identity, event registration, every unit shape, rendering, and acceptance are explicit. |
| task | task-1 | story-1, story-2, story-3, story-4, story-10 | covered | Infrastructure task supplies the typed scheduling-unit identity required by the cited stories. |
| task | task-2 | story-10 | covered | Infrastructure task supplies the provider-neutral boundary event required for visibility. |
| task | task-3 | story-1, story-4, story-7 | covered | Serial and first-boundary dispatch behavior is directly asserted. |
| task | task-4 | story-4, story-7 | covered | Late/read-error/skipped-entry negative paths are directly asserted. |
| task | task-5 | story-3, story-5 | covered | Natural status and genuine failure authority are directly asserted. |
| task | task-6 | story-2, story-3, story-4 | covered | Configured-group join, persistence, and next-unit stop are directly asserted. |
| task | task-7 | story-2, story-3, story-4, story-8 | covered | Built-in SHIP join and generic boundary behavior are directly asserted. |
| task | task-8 | story-8 | covered | Deterministic BUILD and future-group inventory criteria are directly asserted. |
| task | task-9 | story-9 | covered | Interactive baseline is directly asserted. |
| task | task-10 | story-4, story-7, story-9 | covered | Infrastructure wiring supplies the daemon-only main-root predicate and typed propagation required by the cited stories. |
| task | task-11 | story-5, story-7 | covered | Pre-rebase and fast-unpark negative paths are directly asserted. |
| task | task-12 | story-5 | covered | Markerless intentional-stop classification and forbidden side effects are directly asserted. |
| task | task-13 | story-4, story-5 | covered | Pool-level parked collection and later-tick suppression are directly asserted. |
| task | task-14 | story-4, story-6 | covered | Durable same-process/restart resume and persistent-park behavior are directly asserted. |
| task | task-15 | story-5, story-10 | covered | Distinct rendering and exact settled-boundary reporting are directly asserted. |
| task | task-16 | story-1, story-2, story-3, story-4, story-5, story-6, story-7, story-8, story-9, story-10 | covered | Bounded acceptance matrix integrates every accepted story without adding a production surface. |

## Coverage-table claims

The plan's `## Coverage Check` table names all ten real stories and one directly citing real task
for each. Those minimal mechanical claims are subsets of the fuller grounded mappings above. No
phantom identifier, self-only mapping, uncovered counterpart, or contradictory row was found.

**Verdict:** CLEAR — 10 FR rows, 10 story rows, and 16 task rows are covered; zero gaps.
