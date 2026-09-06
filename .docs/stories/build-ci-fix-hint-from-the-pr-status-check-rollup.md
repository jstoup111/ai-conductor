**Status:** Accepted

# Stories: Build the ci-fix hint from the PR status check rollup (#2153)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the content of the ci-fix RETRY hint and the visibility of every outcome in which that hint comes back empty. The eligibility gates, the non-terminal classification helper, the merge-state rollup type, and the resolver pipeline remain outside this slice.

## Story 1: Name the failing checks in the ci-fix hint

As a daemon operator, I want the ci-fix session prompt to carry the actual failing check names and their detail links so that the fix session starts from evidence instead of guessing.

### Acceptance Criteria

#### Happy Path

- Given a pull request whose fetched check rollup carries a completed failing check run with a name and a details link, when the ci-fix hint is built, then the hint contains that check's name and that details link.
- Given a fetched rollup that mixes passing, still-running, and failing entries, when the hint is built, then the hint names the failing entries and names no passing or still-running entry.
- Given a failing entry whose details link identifies a workflow run, when the hint is built, then the hint contains an excerpt of that run's failed-step log below that entry's name.

#### Negative Paths

- Given a failing entry that reports its outcome as a commit-status state and identifies itself by a context rather than a check-run name, when the hint is built, then the hint names that entry by its context and contains its target link.
- Given a failing entry that reports neither a check-run name nor a context, when the hint is built, then the hint labels that entry with the module's existing unnamed-entry placeholder text rather than an empty label.
- Given the failed-step log fetch for a failing entry throws, when the hint is built, then the builder returns without throwing and the hint still contains that entry's name and its link.
- Given the failing entries and their log excerpts together exceed the hint's declared character budget, when the hint is built, then the returned hint is no longer than that budget and ends with the truncation marker.

### Done When

- [ ] A hint built from a fixture rollup carrying one failing check run contains that run's name and its details link.
- [ ] A hint built from a fixture rollup of passing and still-running entries plus one failing entry contains no passing or still-running entry's name.
- [ ] A hint built from a fixture rollup whose failing entry carries only a commit-status context contains that context and its target link.
- [ ] A hint built from a fixture rollup whose failing entry carries no identifier at all is non-empty and contains the unnamed-entry placeholder text.
- [ ] A hint built from an oversized fixture rollup is within the declared character budget and ends with the truncation marker.

## Story 2: Surface every empty-hint outcome

As a daemon operator, I want each reason the hint came back empty to appear in the daemon log so that a blind ci-fix session is diagnosable instead of silent.

### Acceptance Criteria

#### Happy Path

- Given the rollup fetch succeeds and at least one entry is failing, when the hint is built, then exactly one outcome line records the hint stage and the number of failing entries the hint names.
- Given the daemon dispatches ci-fix for a pull request, when the hint is built, then every outcome line the builder emits is written through the logger the daemon supplies rather than the process's standard output.

#### Negative Paths

- Given the rollup fetch throws, when the hint is built, then the returned hint is empty and exactly one outcome line records the hint stage with the category the module's error classifier returns for that error and the underlying message.
- Given the fetch returns text that is not valid JSON, when the hint is built, then the returned hint is empty and exactly one outcome line records the hint stage with an error result.
- Given the fetched payload carries no rollup or an empty rollup, when the hint is built, then the returned hint is empty and exactly one outcome line records a result text distinct from every other empty-hint result text.
- Given the fetched rollup carries entries but none of them is failing, when the hint is built, then the returned hint is empty and exactly one outcome line records a result text distinct from every other empty-hint result text.

### Done When

- [ ] Each of the four empty-hint fixtures captures exactly one outcome line, and the four captured result texts are pairwise distinct.
- [ ] The thrown-fetch fixture's captured line contains the category the module's error classifier returns for that error and the underlying message text.
- [ ] The successful fixture captures exactly one outcome line naming the count of failing entries the hint names.
- [ ] The ci-fix dispatch call site passes the daemon logger to the hint builder, and no builder line reaches standard output when a logger is supplied.

## Negative-category review

Dependency unavailability and timeouts are covered by the thrown-fetch and thrown-log-fetch criteria, which are the only external boundaries this slice touches. Invalid input is covered by the non-JSON payload, the absent rollup, the identifier-less entry, and the commit-status entry that carries no check-run name. Resource exhaustion is covered by the character budget on the returned hint, which also bounds what a very large failed-step log can contribute. Partial failure is covered by the log-fetch failure leaving the entry's name and link intact rather than discarding the whole hint. Auth and permission failures reach the builder as a thrown fetch and are covered by the classified error criterion. Concurrency, data integrity, cascade deletion, model immutability, dedup keys, and alternate-branch side effects are inapplicable: the builder performs no write, holds no shared mutable state, persists nothing, and has a single return path per outcome.
