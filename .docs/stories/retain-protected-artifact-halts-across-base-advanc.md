# Stories: Retain protected-artifact halts across base-advance sweeps

Source: jstoup111/ai-conductor#2199

## Story 1: A seal refusal waits for operator recovery

**Requirement:** Issue outcomes 1 and 2.

As a daemon operator, I want a protected-artifact halt to survive new base commits so that a refused protected-artifact change cannot resume without review.

### Acceptance Criteria

#### Happy Path
- H1: Given an unprocessed, non-operator-parked feature with a protected-artifact halt, when successive sweeps observe different advanced base SHAs, then every sweep reports the feature skipped and retains its halt and classification.
- H2: Given that retained halt, when the sweep reports the skip, then the existing log names the feature and `protected-artifact` disposition.

#### Negative Paths
- N1: Given the retained feature also has an in-progress rebase, when a sweep runs, then it neither probes nor aborts that rebase, clears the halt, creates a re-kick sentinel, nor records a last-re-kick SHA. A base advance alone authorizes none of those actions.

### Done When
- [ ] Calling the production sweep at two distinct base SHAs returns the feature in `skipped` on both calls and never in `cleared`.
- [ ] The injected operation trace has no rebase-probe, abort, clear, or sentinel operation for that feature, the SHA map is unchanged, and both skip reports identify its protected-artifact disposition.

## Story 2: Every class has a deliberate retry disposition

**Requirement:** Issue outcomes 3 and 4.

As a maintainer, I want the sweep's class coverage to be exhaustive so that adding a halt class cannot silently make it retryable.

### Acceptance Criteria

#### Happy Path
- H1: Given the complete current class and read-disposition set, when the production sweep evaluates each, then `needs-human`, `plan-gap`, `protected-artifact`, and `unclassified` are retained, while `mechanical` and `legacy` use the existing clear-and-re-kick path.
- H2: Given a new member is added to the production halt-class type, when test sources are typechecked before supplying its expected disposition, then the exhaustive sweep matrix fails compilation until the maintainer chooses and tests its disposition.

#### Negative Paths
- N1: Given retryable mechanical or legacy halts, when the base advances, then retention does not prevent their clear operation or triggering-SHA update; their existing per-SHA bound still prevents a repeat retry at the same SHA.
- N2: Given a missing/invalid/unreadable class, or an earlier operator-park/shipped guard, when the sweep runs, then the existing unclassified retention and earlier-guard behavior are preserved.

### Done When
- [ ] The sweep matrix exercises all six current dispositions and asserts the exact retained and retryable sets through the production sweep.
- [ ] The matrix's keys are checked against the production disposition union, including all writable halt classes, by the test-inclusive TypeScript check.
- [ ] Existing unreadable-class, park/shipped precedence, and per-SHA bound tests still prove their named behavior.

## Coverage dispositions and negative-category review

Story 1 H1/H2/N1: scoped sweep unit tests using real `rekickSweep` and its real imported predicate, with injected Git/filesystem operations. Story 2 H1/N1: the same sweep boundary's exhaustive matrix; H2: test-inclusive TypeScript checking of a literal `satisfies Record<HaltDisposition, ...>` matrix. Story 2 N2: the matrix's unclassified row, existing sweep tests for earlier guards, and existing marker-reader tests for invalid/absent/unreadable sidecars. No new acceptance/system test is needed for this single deterministic selection boundary.

All criteria are diff-local: the runtime behavior is determined by this feature's predicate and existing sweep contract, not the completion of another issue. Invalid input, dependency failure, data integrity, repeated calls, and alternate branches are covered above. The change introduces no authentication, network call, timeout, resource allocation, concurrent writer, deletion, or exception hierarchy.

**Status:** Accepted
