**Status:** Accepted

# Stories: Recoverable resolution worktree after a crashed attempt (#2157)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the transient resolution worktree helper's own leftover handling. Repository-wide registration sweeps and the daemon's per-feature worktree lifecycle remain outside this slice.

## Story 1: A crashed attempt no longer strands the next attempt for the same slug

As an operator running the daemon, I want a resolution attempt to clear its own leftover registration so that a crashed prior attempt does not require me to run a git prune by hand.

### Acceptance Criteria

#### Happy Path

- Given the transient resolution path for a slug is still registered with git but its directory is gone after a crashed prior attempt, when a new attempt runs for that slug, then the attempt creates a fresh detached checkout at the branch tip and returns its result without operator intervention.
- Given the transient resolution path for a slug is still registered with git and its directory is still present after a crashed prior attempt, when a new attempt runs for that slug, then the attempt creates a fresh detached checkout at the branch tip carrying none of the leftover files.

#### Negative Paths

- Given no leftover registration and no leftover directory exist for a slug, when an attempt runs for that slug, then the attempt succeeds and no failure from the leftover handling is surfaced to the caller.
- Given a leftover directory exists for a slug but is not registered with git, when an attempt runs for that slug, then the leftover directory is removed and the fresh checkout carries none of its files.

### Done When

- [ ] An integration case against a real local git repository registers the transient path, deletes its directory, and then observes a subsequent attempt returning its function's value.
- [ ] An integration case observes the fresh checkout containing the branch-tip file and none of the leftover files, for both the registered-and-present and unregistered leftover shapes.
- [ ] The no-leftover integration case still returns its function's value with no error propagated from the leftover handling.

## Story 2: Leftover reaping is scoped to the attempt's own path and does not accumulate

As an operator running the daemon, I want an attempt to reap only its own leftover so that a sibling slug's worktree is never destroyed and stale registrations do not pile up across repeated crashes.

### Acceptance Criteria

#### Happy Path

- Given a stale registration exists for the attempt's slug and a separate registered worktree exists for a different slug, when the attempt runs, then the attempt completes and the other slug's worktree stays registered and present on disk.
- Given a slug's transient path has been left registered by two successive crashed attempts, when a third attempt runs and completes, then git reports no registration for that transient path afterwards.

#### Negative Paths

- Given the daemon holds an active work claim for the slug, when an attempt is requested, then it is refused with the active-claim error and the slug's existing registration and directory are left exactly as they were.

### Done When

- [ ] An integration case asserts a sibling slug's worktree is still listed and its directory still readable after the attempt for the stale slug completes.
- [ ] An integration case repeats the crash-then-attempt cycle and asserts the porcelain worktree listing contains no entry for the transient path after the final attempt returns.
- [ ] An integration case with an injected active-claim predicate asserts the attempt rejects and the pre-existing registration is unchanged in the porcelain listing.

## Negative-category review

Partial failure and recovery is the subject of both stories: the crashed-mid-attempt state is exactly a partially applied multi-step operation, and every leftover shape (registered-and-missing, registered-and-present, unregistered directory, nothing) is enumerated as a criterion. Concurrent access is covered by the sibling-slug scoping criterion and by the active-claim refusal, which together assert that one attempt's cleanup cannot reach another slug's state; the helper's existing in-process serial guard for the same slug is unchanged and retains its own coverage. Data integrity is covered by asserting the fresh checkout carries branch-tip content and no leftover files. Dependency unavailability reduces here to the git subprocess refusing a command that names a path it does not know; that refusal is asserted as tolerated rather than fatal. Invalid input, authentication, resource exhaustion, cascade deletion, immutability, exception-hierarchy, and deduplication categories are inapplicable: the helper takes no user input, contacts no service, holds no records, and performs no dedup.
