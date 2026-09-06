**Status:** Accepted

# Stories: Qualify the reported cost figure when it covers only metered dispatches (#1863)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the presentation of the money figure on the whole-feature finish usage line and its arrival at the operator through the daemon event renderer. The rollup arithmetic, the event payload, and the existing exclusion segments keep their present meanings.

## Story 1: The money figure names the dispatches it was summed over

As an operator investigating a cost anomaly, I want the reported dollars to state how many dispatches they cover so that I never read a partial figure as the whole run's cost.

### Acceptance Criteria

#### Happy Path

- Given a build in which every recorded dispatch carried a provider cost, when the whole-feature usage line is composed, then the money figure appears plainly with no added denominator text.
- Given a build in which fewer dispatches carried a cost than the run recorded, when the whole-feature usage line is composed, then the money figure is immediately followed by the count of cost-metered dispatches it was summed over.

#### Negative Paths

- Given a build in which every dispatch reported token usage but none reported a cost, when the whole-feature usage line is composed, then no money figure is rendered while the token figures and the cost-unmetered segment remain.
- Given a build whose unreadable records push the unmetered count above the recorded dispatch count, when the whole-feature usage line is composed, then no money figure is rendered and no negative or invented dispatch count appears.

### Done When

- [ ] A fully cost-metered fixture and a partially cost-metered fixture render lines that differ only by the denominator clause.
- [ ] A fixture whose dispatches all report tokens without cost renders a line containing no dollar sign.
- [ ] A fixture whose unmetered count exceeds its dispatch count renders a line containing no dollar sign and no negative number.

## Story 2: The operator reads the qualified figure where the line is actually logged

As an operator watching the daemon log, I want the qualification to reach the rendered line so that the correction is visible at the place the figure is read, not only inside the formatter.

### Acceptance Criteria

#### Happy Path

- Given a whole-feature usage event whose cost-metered dispatches are fewer than its recorded dispatch count, when the daemon event renderer handles that event, then the logged line carries the money figure with its cost-metered count and leaves the unmetered and cost-unmetered segments unchanged.

#### Negative Paths

- Given a whole-feature usage event in which every recorded dispatch was cost-metered, when the daemon event renderer handles that event, then the logged line carries no denominator clause.

### Done When

- [ ] The daemon event renderer produces exactly one line for a partially cost-metered usage event, and that line names both the money figure and its cost-metered count.
- [ ] The same renderer produces a line with no denominator clause for a fully cost-metered usage event.
- [ ] The rollup projection read from a seeded event log produces the same qualified line as the formatter fixtures.

## Negative-category review

Invalid and degenerate input is covered by the zero-cost-metered case and the unreadable-record case, which are the only two ways this function's inputs can disagree with each other. The formatter is a pure synchronous string composition over a plain value: it performs no input parsing, no authorization, no network or database access, no file or process work, no deletion, no queueing, and no multi-step operation, so the timeout, dependency-unavailability, concurrency, resource-exhaustion, partial-failure, rollback, cascade-deletion, immutability, exception-hierarchy, and idempotency categories are inapplicable by construction. Data integrity is addressed by the standing prohibition the criteria encode — no dispatch acquires an estimated cost to make the denominators agree. Alternate-branch side effects are covered because the money figure and the token figures are now gated on different counts, and the negative criteria assert the token figures still render on the branch that withholds the money.
