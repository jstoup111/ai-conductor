**Status:** Accepted

# Stories: Keep containment advisories out of build_review's failure reason (#1651)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the placement of the containment floor's advisory lines inside the `build_review` step result and the operator-visible reason derived from it. The floor's own checks, the retry ladder's budget policy, and a future enforcing containment mode remain outside this slice.

## Story 1: Keep a failing build_review result's own reason first

### Acceptance Criteria

#### Happy Path

- Given the containment floor produced advisory lines and the review result succeeded, when the build_review step returns, then the advisory lines precede the review output so a passing lap still reports them.
- Given the containment floor produced advisory lines and the review result failed, when the build_review step returns, then the review's own failure reason opens the output and the advisory lines follow it.

#### Negative Paths

- Given the containment floor produced no advisory lines, when the build_review step returns a passing or a failing review result, then the output is that review result's output unchanged.
- Given advisory lines are attached to a review result, when the build_review step returns, then the returned success value is exactly the review result's success value.
- Given a review result carries no string output, when advisory lines exist, then the step returns that result without synthesizing an output field.

### Done When

- [ ] Ordering unit cases cover a passing result, a failing result, an empty advisory list, and a non-string output.
- [ ] A build_review runner fixture with containment enforcement on and an injected failing review observes the review reason at the head of the returned output.

## Story 2: Show the operator the real cause on the retry and failure lines

### Acceptance Criteria

#### Happy Path

- Given a failed build_review output carrying advisory lines, when the daemon formats its single-line retry reason, then the visible text names the review's own failure rather than an advisory.
- Given the containment floor produced advisory lines, when the build_review step runs, then every advisory line is still written to the runner's warning log.

#### Negative Paths

- Given a failed build_review output whose own reason is longer than the single-line reason budget, when the daemon formats the retry reason, then the truncated text still begins with the review reason and never with an advisory.

### Done When

- [ ] A reason-formatter fixture built from a failing build_review output returns text that starts with the review reason under both the short and the truncated case.
- [ ] The runner fixture captures the injected warning log and finds each rendered advisory line in it.

## Negative-category review

Empty advisory input and a non-string output cover input integrity at the ordering seam. Success preservation covers the contract that an advisory is never an enforcing verdict, which is the classification the report asks to protect. The truncation case covers the boundary where the operator-visible text is lossy. The change performs no deletion, no queue or datastore work, no upload, no transaction, and no permission or network access, so those categories are inapplicable. The containment floor's own failure handling is already fail-soft and unchanged, and its existing coverage remains authoritative for it.
