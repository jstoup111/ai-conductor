**Status:** Accepted

# Stories: Render every declared render event in inline runs (#2167)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the inline terminal subscriber's subscription and forwarding, and the inline dashboard renderer's event coverage. Renderer unification, daemon forwarding, and sink declaration changes remain outside this slice.

## Story 1: An inline operator sees why the run stopped

As an operator running the pipeline in the foreground, I want halts, kickbacks, unsatisfied gates and convergence to appear in my terminal, so that a run that stops explains itself instead of appearing to hang.

### Acceptance Criteria

#### Happy Path
- Given an inline run whose gate loop halts, when the conductor emits a loop-halt event, then the terminal prints one line containing that event's halt reason.
- Given an inline run whose gate re-opens an earlier step, when the conductor emits a kickback event, then the terminal prints one line naming the originating step, the re-opened step and the re-open count.
- Given an inline run whose gate loop converges, when the conductor emits a loop-converged event, then the terminal prints one convergence line.
- Given an inline run whose gate reports an unsatisfied verdict, when the conductor emits that gate-verdict event, then the terminal prints one line naming the step and the stated reason.

#### Negative Paths
- Given an inline run whose gate reports a satisfied verdict, when the conductor emits that gate-verdict event, then the terminal prints no gate line, because a satisfied gate is routine.
- Given an inline run emits a kickback or gate-verdict event whose optional evidence or reason field is absent, when the renderer handles it, then it prints its line without throwing and the run continues.

### Done When
- [ ] A renderer unit fixture emitting a loop-halt event captures terminal output containing the exact reason string supplied in the event.
- [ ] A renderer unit fixture emitting a kickback event captures one line containing the from step, the to step and the count.
- [ ] A renderer unit fixture emitting a satisfied gate verdict captures zero new output lines, and the unsatisfied fixture captures exactly one line naming the step and its reason.
- [ ] A renderer unit fixture emitting a loop-converged event captures one convergence line.
- [ ] Renderer unit fixtures with omitted optional fields resolve without a rejected promise and still produce their line.

## Story 2: Inline coverage cannot drift from the sink declarations

As a maintainer adding an event to the union, I want the inline terminal to follow the event-sink registry automatically, so that declaring an event renderable is enough and a hand-maintained list can no longer silently omit it.

### Acceptance Criteria

#### Happy Path
- Given the event-sink registry declares an event type renderable, when the terminal subscriber starts, then that event type is among the types it subscribes to.
- Given an event type that the terminal subscriber subscribed to before this change is declared non-renderable in the registry, when the terminal subscriber starts, then that event type is still subscribed so no existing inline dashboard refresh is lost.
- Given a renderable event type for which the inline dashboard renderer has no dedicated branch, when that event is emitted during an inline run, then the terminal prints exactly one summary line that names the event type.

#### Negative Paths
- Given a renderable event type that the subscriber already forwards to the injected terminal renderer sink, when that event is emitted during an inline run, then exactly one line is printed rather than a duplicated pair, because both inline renderers share one live region.
- Given an event type declared non-renderable that the inline dashboard renderer has no dedicated branch for, when that event is emitted during an inline run, then no summary line is printed.

### Done When
- [ ] A subscriber unit assertion proves every type returned by the sink registry's renderable accessor is subscribed on start.
- [ ] A subscriber unit assertion proves the previously subscribed non-renderable types are still subscribed on start.
- [ ] A renderer unit assertion drives every renderable type that has no dedicated branch and no sink forwarding, and captures exactly one line naming the type for each.
- [ ] A renderer unit assertion drives each sink-forwarded renderable type and captures zero lines from the dashboard renderer.
- [ ] A renderer unit assertion drives a non-renderable, branchless type and captures zero lines.

## Negative-category review

Invalid input is covered by the omitted-optional-field criteria, which are the only malformed shapes a typed union can present to a renderer. Duplicate output is the idempotency category for a shared live region and is covered by the sink-forwarding criterion. Data integrity for this change is the registry-to-subscription correspondence, covered by both drift criteria in Story 2. Auth, timeout, network, concurrency, resource exhaustion, partial rollback, cascade deletion and datastore categories are inapplicable: the change is a synchronous, in-process, read-only projection of an existing in-memory event bus onto a terminal region, with no external dependency, no persistence, no deletion and no shared mutable state beyond the live region already owned by the run. Renderer exceptions are already isolated by the existing dispatcher, whose behavior this slice does not alter.
