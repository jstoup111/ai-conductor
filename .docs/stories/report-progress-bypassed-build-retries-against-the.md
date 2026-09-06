**Status:** Accepted

# Stories: Report progress-bypassed build retries against their own allowance (#1513)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the retry event emitted when a build attempt is refunded for making forward progress, and the four consumers that report it: the daemon log line, the two terminal renderers, and the OpenTelemetry retry span. Retry budgets, the progress-attempt ceiling policy, and halt classification remain outside this slice.

## Story 1: A refunded build retry reports the allowance it actually consumed

As an operator reading a running build, I want a progress-granted retry to name the allowance it spent so that I can tell forward progress from an exhausted retry budget without opening the engine.

### Acceptance Criteria

#### Happy Path

- Given a build attempt resolves more tasks than the previous attempt and the progress-attempt ceiling has not been reached, when the retry is emitted, then its fixed-retry attempt number is the slot the next attempt reuses and is never greater than the stated maximum on the same event.
- Given that same refunded retry, when it is emitted, then it additionally carries the number of progress attempts consumed so far and the configured progress-attempt ceiling.
- Given a refunded retry, when the daemon log line and both terminal renderers render it, then each line shows the in-range fixed counter and, distinctly from it, the consumed progress-attempt count and its ceiling.
- Given a refunded retry, when the OpenTelemetry span recorder consumes it, then the retry span event carries the consumed progress-attempt count and its ceiling alongside the existing fixed attempt and maximum.

#### Negative Paths

- Given a build retry whose attempt resolved no additional tasks, when it is emitted and rendered, then it carries no progress-attempt count and no ceiling, and every rendered line reads exactly as it did before this change.

### Done When

- [ ] A conductor test driving consecutive task-resolving build attempts observes every emitted retry with an attempt number no greater than its own maximum.
- [ ] The same test observes the consumed progress-attempt count rising by one per refunded retry and the ceiling equal to the configured attempt ceiling.
- [ ] Renderer fixtures for the daemon log line, the terminal renderer, and the create renderer each produce a line containing both the in-range fixed counter and the progress-allowance fragment.
- [ ] A span-manager fixture records the consumed progress-attempt count and its ceiling as attributes on the retry span event.

## Story 2: Every other retry reports exactly as it did before

As an operator reading any retry that is not a refunded build retry, I want its line and its span unchanged so that a familiar signal keeps its familiar meaning.

### Acceptance Criteria

#### Happy Path

- Given a step retry that consumed a fixed retry, when the daemon log line and both terminal renderers render it, then the line carries the plain fixed counter and no progress-allowance fragment.

#### Negative Paths

- Given a retry record carrying no progress-attempt fields, such as one replayed from an event log written before those fields existed, when the renderers and the span recorder consume it, then they report the fixed pair alone and add no text fragment or span attribute holding an undefined value.

### Done When

- [ ] The pre-existing retry fixtures in the daemon-render, terminal-renderer, and create-renderer test files pass unchanged and their output contains no progress-allowance fragment.
- [ ] A formatter unit case with no progress fields returns exactly the bare fixed counter string.
- [ ] A span-manager fixture for a retry with no progress fields records only the pre-existing attempt, maximum, and reason attributes.

## Negative-category review

Invalid input is covered by the partially-populated retry record, which is the only malformed shape reachable once the fields are optional on a union member: a consumer replaying an older event log, or a future emit site that sets one field and not the other. Data integrity is covered by the fixed-counter invariant itself, asserted on every emitted retry rather than on the refunded ones alone, and by the unchanged-output guard on Story 2. Partial failure is covered by the refunded and non-refunded retries being asserted in the same run, so a change that fixes one shape by breaking the other fails. Auth, timeouts, network, dependency unavailability, concurrency, resource exhaustion, cascade deletion, and idempotency categories are inapplicable: this slice adds no external call, no shared mutable state, no persistence, no deletion, and no new writer, and the emitter is a single in-process synchronous path. Model-level immutability and exception-hierarchy categories are inapplicable because no record type and no rescue clause is introduced. The invariant-side-effect category is addressed by covering the refunded branch and the ordinary branch of the same retry decision, which are the only two branches that reach the emit.
