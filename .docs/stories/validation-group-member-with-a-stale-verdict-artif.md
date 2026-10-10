**Status:** Accepted

# Stories: Validation-group member with a stale verdict artifact re-dispatches instead of remediating

Source-Ref: jstoup111/ai-conductor#2553. Track: technical (no PRD). Tier: S.

Scope boundary (from `.docs/track/validation-group-member-with-a-stale-verdict-artif.md`): only the
SHIP validation group (`manual_test`, `prd_audit`, `architecture_review_as_built`) running with
artifact verification on. A "handshake failure" below means the engine's post-dispatch verdict write
handshake found no verdict produced by the current dispatch — the artifact is missing, older than the
dispatch start, carries another run's identity, or is an incomplete/rejected structured result. A
member "genuinely fails" when its handshake passes and its own objective gate verdict is unsatisfied.

Today a member whose dispatch settles successfully but fails the handshake is scored as an
unsatisfied gate and sent to gap remediation, which can only conclude there is nothing to fix and
halts `needs-human` (observed on `one-transient-failure-in-a-validation-group-member`, 2026-09-14).

## Story 1: A member that wrote no current verdict is re-dispatched within its retry budget

**Requirement:** #2553 desired outcomes 1, 2

As a daemon operator, I want a validation-group member whose dispatch left no current verdict to be
re-run by the engine, so that I am not paged to clear a halt the engine could have recovered from.

### Acceptance Criteria

#### Happy Path
- Given artifact verification is on and a member's resolved retry budget is at least 2, when that member's first dispatch settles successfully but fails the handshake and its second dispatch writes a current passing verdict, then that member is dispatched exactly twice, each sibling is dispatched exactly once, and the group joins all-green with every member `done` and no HALT written.
- Given the same first-dispatch handshake failure, for each of `manual_test`, `prd_audit`, and `architecture_review_as_built`, when the member is re-dispatched, then a `step_retry` event is emitted for that member whose `reason` contains the handshake failure text.

#### Negative Paths
- Given a member's dispatch failed the handshake and its re-dispatch then passed, when the round settles, then no remediation planner (`remediate`) dispatch occurs and no `kickback` event is emitted for that round.
- Given a member's dispatch failed the handshake while its siblings passed theirs, when the member is re-dispatched, then no sibling is dispatched a second time.

### Done When
- [ ] A conductor test with a stale-then-fresh `prd_audit` observes the dispatch sequence (`prd_audit` twice, each sibling once), an all-green join, and no `.pipeline/HALT`.
- [ ] The same scenario, parametrized over all three members, observes a `step_retry` event for the member whose `reason` carries the handshake failure, zero `remediate` dispatches, and zero `kickback` events.

## Story 2: Exhausting the budget halts naming the handshake failure, not a content gap

**Requirement:** #2553 desired outcomes 2, 4

As a daemon operator, I want a member that never writes a current verdict to halt with the real
cause, so that I fix the dispatch instead of hunting for a gap that does not exist.

### Acceptance Criteria

#### Happy Path
- Given artifact verification is on and every dispatch of `prd_audit` settles successfully but fails the handshake, when its resolved retry budget of N attempts is spent, then the loop writes a `needs-human` HALT whose reason names `prd_audit`, the attempt count N, and the handshake failure text, and `prd_audit` is recorded `failed`.
- Given that halt, when its siblings' dispatches passed with satisfied gate verdicts, then those siblings are recorded `done` (bare and group-member keys) in the same state commit, as for any other no-verdict member.

#### Negative Paths
- Given the handshake-exhausted halt, when the round settles, then no remediation planner (`remediate`) dispatch occurs, no `kickback` event is emitted, and the kickback ledger records no new entry for `prd_audit`.
- Given a member whose resolved retry budget is 1, when its only dispatch fails the handshake, then it is not re-dispatched and the loop halts `needs-human` naming the handshake failure.

### Done When
- [ ] A conductor test with an always-stale `prd_audit` observes N dispatches, the HALT reason containing `prd_audit`, N, and the handshake text, `.pipeline/HALT.class` = `needs-human`, and the retained siblings.
- [ ] The same test observes zero `remediate` dispatches, zero `kickback` events, and an unchanged kickback ledger; a budget-1 variant observes exactly one dispatch before the halt.

## Story 3: A member that genuinely fails its gate still routes to remediation

**Requirement:** #2553 desired outcome 3

As a daemon operator, I want real findings to keep their existing remediation route, so that this
fix does not hide genuine gaps behind a retry.

### Acceptance Criteria

#### Happy Path
- Given artifact verification is on and `prd_audit`'s first dispatch writes a current verdict (handshake passes) whose gate is unsatisfied, when the join runs, then `prd_audit` is dispatched exactly once and the join dispatches the remediation planner (`remediate`) as it does today.

#### Negative Paths
- Given artifact verification is off (the mocked-dispatch mode), when a member's dispatch settles successfully and its handshake would fail, then the member is dispatched exactly once and the join's outcome is unchanged from today.
- Given a member's runner result is unsuccessful (not a handshake failure), when the branch retries it, then the retry counts against the same single retry budget, so the total dispatches of that member never exceed its resolved `max_retries`.

### Done When
- [ ] A conductor test with a fresh, unsatisfied `prd_audit` verdict observes one `prd_audit` dispatch followed by a `remediate` dispatch.
- [ ] A conductor test with artifact verification off observes one dispatch per member for a handshake-failing member, and a group-core test observes a mix of runner failures and handshake failures never exceeding the member's budget.
