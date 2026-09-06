**Status:** Accepted

# Stories: Mechanically enforce OTel handler coverage for traced events (#1490)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the binding between the sink table's traced declaration and the OTel visualizer's per-event routing. Halt outcomes, span closure on termination, and the traced membership of any event type are already delivered and remain unchanged.

## Story 1: Every traced event type reaches a handler

As an engine contributor, I want a traced event type to be routed rather than dropped, so that declaring an event traced is enough to make it visible in the exported trace.

### Acceptance Criteria

#### Happy Path
- Given the sink table declares an event type as traced, when the visualizer starts and that event is emitted, then the visualizer routes it to the handler that owns it and records that type's span or metric effect.
- Given a started visualizer, when its handled event-type set is compared with the traced set derived from the sink table, then the two sets are equal.

#### Negative Paths
- Given a traced event type the visualizer has no handler entry for, when that event is emitted, then the visualizer reports the unhandled type through its injected warning callback and the emit completes without throwing.

### Done When
- [ ] A unit test asserts the visualizer's handled event-type set equals the set returned by the traced-type accessor, with no missing and no extra member.
- [ ] A unit test that makes the traced set contain one type with no handler entry observes exactly one warning naming that type, and the emit resolves without throwing.
- [ ] The sixteen currently traced types keep their existing span and metric effects, proven by the existing OTel visualizer, span-manager, parity, wiring and observability test files passing unchanged.

## Story 2: Untraced event types stay off the OTel surface

As an engine contributor, I want an event declared untraced to remain a recorded exclusion, so that tightening the routing does not quietly export events nobody chose to export.

### Acceptance Criteria

#### Happy Path
- Given an event type declared as not traced, when it is emitted on the bus, then the visualizer never subscribes to it and exports no span, span event, or metric for it.

#### Negative Paths
- Given a handler table that omits a traced event type, or one that names a type the sink table declares untraced, when the repository type-checks its tests, then compilation fails on that table.

### Done When
- [ ] A unit test observes no subscription and no exported span or metric for a declared-untraced event type.
- [ ] The same test's mocked-registry variant observes the subscription appear when that type is declared traced, proving the negative assertion is not vacuous.
- [ ] The test typecheck project passes with assertions proving a handler table missing a traced key and a handler table carrying an untraced key are both unassignable.

## Negative-category review

Invalid input is covered by the unhandled-type path, which is the only malformed input this surface can receive: the emitter delivers a well-typed union member for which routing may be absent. Data integrity is covered by the two compile-time assignability assertions and by the non-vacuity check, which together prevent the guard from passing while asserting nothing. Dependency unavailability and partial failure are covered by the existing bounded-warning contract, which this change reuses rather than extends: the visualizer never throws into `emit()`, so an unroutable event degrades to a warning instead of failing the run. Auth, timeout, concurrency, resource exhaustion, cascade deletion, and immutability categories are inapplicable — the change adds no I/O, no external call, no shared mutable state beyond the existing per-instance table, and no persisted record. Exception-hierarchy and idempotency categories are inapplicable because no exception is caught or rethrown and no deduplication key is introduced.
