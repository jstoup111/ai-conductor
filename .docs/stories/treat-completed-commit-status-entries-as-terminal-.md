**Status:** Accepted

# Stories: Treat completed commit-status entries as terminal for ci-fix eligibility (#2164)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the terminal-CI eligibility gate for CI-fix dispatch and the deferral reason it produces. The auto-merge readiness classifiers over the same rollup shape remain outside this slice.

## Story 1: Stop deferring CI-fix on completed commit-status entries

**Requirement:** #2164 desired outcome, first bullet

As a daemon operator, I want a completed commit-status entry to count as finished CI so that CI-fix remediation is not wedged on pull requests whose external status checks have already reported.

### Acceptance Criteria

#### Happy Path

- Given a pull request rollup carrying a completed commit-status entry reporting SUCCESS alongside a completed failing check run, when CI-fix eligibility is evaluated, then the terminal-CI gate passes and the pull request is eligible.
- Given a rollup carrying a completed commit-status entry reporting FAILURE or ERROR alongside a completed check run, when CI-fix eligibility is evaluated, then the terminal-CI gate passes and the pull request is eligible.
- Given a sweep observes a pull request whose fetched rollup mixes a completed commit-status entry with a failed check run, when the sweep runs one tick, then it dispatches CI-fix for that pull request and records the attempt.

#### Negative Paths

- Given a rollup carrying a commit-status entry reporting PENDING alongside a completed failing check run, when CI-fix eligibility is evaluated, then the pull request is ineligible for the checks-not-terminal reason and no attempt is recorded.
- Given a rollup carrying a check-run entry with no reported conclusion and no reported state, when CI-fix eligibility is evaluated, then the pull request stays ineligible for the checks-not-terminal reason exactly as before this change.
- Given a sweep observes a pull request whose fetched rollup carries a pending commit-status entry alongside a failed check run, when the sweep runs one tick, then it dispatches nothing and leaves the recorded attempt count unchanged.

### Done When

- [ ] Eligibility fixtures covering SUCCESS, FAILURE, and ERROR commit-status entries return an eligible verdict while a pending one returns the checks-not-terminal refusal.
- [ ] A check-run fixture reporting neither a conclusion nor a state still returns the checks-not-terminal refusal.
- [ ] A sweep fixture driven through the real sweep entry point with an injected command runner dispatches for the completed commit-status payload and dispatches nothing for the pending one.

## Story 2: Name the entry that is actually pending

**Requirement:** #2164 desired outcome, second bullet

As a daemon operator reading a deferral line, I want the reason to identify the entry that is still running so that I can tell which external check the sweep is waiting on.

### Acceptance Criteria

#### Happy Path

- Given a pending rollup entry that reports an identifying context but no check-run name, when the deferral reason is produced, then the reason contains that context.
- Given every entry in a rollup has reached a completed state, when eligibility is evaluated, then the deferral reason is not produced at all and no placeholder label reaches the log.

#### Negative Paths

- Given a pending rollup entry that reports neither a name nor a context, when the deferral reason is produced, then the reason falls back to the existing placeholder label rather than an empty or malformed entry name.
- Given a pending rollup entry whose name or context is only whitespace, when the deferral reason is produced, then the reason falls back to the existing placeholder label rather than a blank entry name.

### Done When

- [ ] A pending commit-status fixture that carries only a context produces a refusal reason containing that context.
- [ ] Fixtures whose pending entry carries no identifier, or a whitespace-only identifier, produce the existing placeholder label and never an empty name.
- [ ] An all-completed fixture produces an eligible verdict and emits no deferral line.

## Negative-category review

Invalid and partial input is the dominant category here and is covered directly: absent conclusion, absent state, absent identifier, and whitespace-only identifier all have explicit scenarios. Dependency unavailability and timeouts are already owned by the merge-state fetcher's existing error sentinels, which this slice does not touch, and an absent rollup already yields an empty non-terminal list whose behavior is unchanged. Auth and permission failures, concurrency, resource exhaustion, partial rollback, cascade deletion, and datastore integrity are inapplicable: this is a pure classification over an already-fetched, read-only payload with no writes, no shared mutable state, and no external call of its own. Idempotency is inherent because the classification is a pure function of its input.
