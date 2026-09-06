**Status:** Accepted

# Stories: Accept bold Outcome delivered line in as-built parser (#2175)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the accepted style set of the two
as-built label lines and the engine readers a PLAN_GAP report passes through. The heading form of
the verdict line and the conductor's duplicate blocked-detection regex remain outside this slice.

## Story 1: A bold outcome line is read the same as a plain one

As a reviewer writing an as-built report, I want the bold spelling of the outcome line to be read
the same as the plain one, so that an ordinary formatting choice does not burn review dispatches
and end in a halt.

### Acceptance Criteria

#### Happy Path

- Given a PLAN_GAP as-built report whose outcome line carries bold markers around the label, when the as-built completion gate classifies the report, then it classifies as a delivered plan gap and the step is satisfied.
- Given a PLAN_GAP as-built report whose outcome line carries bold markers around only the value, or around the whole line, when the gate classifies the report, then the result equals the result for the unstyled spelling of that same line.
- Given a PLAN_GAP as-built report whose bold outcome line records no, when the gate classifies the report, then it classifies as an undelivered plan gap and the step stays unsatisfied.

#### Negative Paths

- Given a PLAN_GAP as-built report whose bold outcome line carries a value that is neither yes nor no, when the gate classifies the report, then it stays invalid for a missing outcome and the operator reason still names the required yes-or-no outcome line.
- Given a PLAN_GAP as-built report whose outcome line carries marker characters but no value, when the gate classifies the report, then it stays invalid for a missing outcome rather than being read as delivered.

### Done When

- [ ] The as-built completion predicate reports done for a PLAN_GAP report whose outcome line is written with bold markers around the label.
- [ ] Bold-label, bold-value, and wholly bold outcome lines classify identically to the unstyled line, for both yes and no.
- [ ] A bold outcome line whose value is neither yes nor no, and one carrying markers but no value, both still classify as the missing-outcome invalid cause.

## Story 2: Every reader of the two label lines accepts the same styles

As an operator, I want each engine reader of the as-built verdict and outcome lines to accept one
agreed style set, so that a report accepted by the gate is read the same way by everything
downstream and the readers cannot drift apart again.

### Acceptance Criteria

#### Happy Path

- Given a spelling of an as-built label line that is accepted for the verdict label, when the same spelling is applied to the outcome-delivered label, then it is accepted with the same extracted value.
- Given a shipped record assembled from a PLAN_GAP as-built report whose verdict and outcome lines both carry bold markers, when the recorded review findings are computed, then the delivered plan-gap finding is retained exactly as it is for the unstyled report.

#### Negative Paths

- Given an as-built label line whose only content after the colon is marker characters, when either label is read, then both readers report no value rather than an empty one.
- Given a shipped record assembled from a bold-styled PLAN_GAP as-built report that records an outcome of no, when the recorded review findings are computed, then no delivered plan-gap finding is retained.

### Done When

- [ ] One spelling corpus is defined once and drives assertions for both label names, so a style asserted for one label is asserted for the other.
- [ ] A bold-styled delivered PLAN_GAP report produces a recorded finding deep-equal to the one produced by its unstyled counterpart.
- [ ] A bold-styled PLAN_GAP report recording an outcome of no produces no delivered plan-gap finding.

## Negative-category review

Invalid input is the whole subject and is covered per story: an unrecognized outcome value, a
value-less label line, and a marker-only value each keep the existing fail-closed result. Data
integrity is covered by the shipped-record criteria, which assert that a newly accepted report
neither gains nor loses a recorded finding relative to its unstyled counterpart. Partial failure is
covered by the requirement that both readers agree, so a report cannot pass one gate and be dropped
by the next. Authentication, permissions, timeouts, network and dependency unavailability,
concurrency, resource exhaustion, cascade deletion, immutability, and idempotency-key categories are
inapplicable: the change is a pure in-memory read of report text, performs no input or output, holds
no state, contacts nothing, and deletes nothing. The invariant side-effect category is explicitly
addressed by Story 2 — the shipped-record projection is the alternate branch that would otherwise
bypass the widened acceptance.
