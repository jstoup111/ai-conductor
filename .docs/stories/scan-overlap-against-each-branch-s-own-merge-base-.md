**Status:** Accepted

# Stories: Scan overlap against each branch's own merge-base diff (#1650)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the advisory overlap scan's per-branch comparison and the advisory note covering a branch that cannot be compared. Branch enumeration policy, the path-intersection rule, the blocker sweep, the command surface, and the behaviour of a candidate path that does not exist remain outside this slice.

## Story 1: Report a branch only for paths its own commits change

Track: technical

As a spec author running the pre-plan overlap scan, I want each reported pair to reflect work that branch actually carries, so that the report is short enough to read and every line in it is worth acting on.

### Acceptance Criteria

#### Happy Path

- Given an unmerged sibling branch whose own commits change a candidate path, when the scan runs, then the report names that branch together with that path.
- Given an unmerged sibling branch whose own commits change one candidate path and not another, when the scan runs, then the report names only the changed path for that branch.

#### Negative Paths

- Given the base branch has advanced with commits changing a candidate path after a sibling branch forked, and that branch's own commits never touch that path, when the scan runs, then the report does not name that branch for that path.
- Given no unmerged sibling branch's own commits change any candidate path, when the scan runs, then the scan renders the single clean no-overlap line and names no branch.

### Done When

- [ ] A real-git fixture that advances the base after a sibling branch forks yields a report naming no branch for the advanced path.
- [ ] A real-git fixture in which a sibling branch's own commit changes a candidate path still yields a report naming that branch and that path.
- [ ] Unit fixtures prove the per-branch comparison starts at the merge base of the base ref and the branch rather than at the base tip.

## Story 2: Announce a branch that cannot be compared instead of guessing

Track: technical

As a spec author, I want a branch the scan could not compare to be named as a degradation, so that a quiet report means checked-and-clean rather than silently skipped.

### Acceptance Criteria

#### Happy Path

- Given every unmerged sibling branch shares history with the base ref, when the scan runs, then it compares each branch from that branch's merge base with the base ref and adds no advisory note.

#### Negative Paths

- Given the merge base between the base ref and one sibling branch cannot be computed, when the scan runs, then that branch produces an advisory note naming it and contributes no overlap claim.
- Given one sibling branch's diff fails after its merge base resolved, when the scan runs, then that branch produces an advisory skip note and the remaining branches' overlaps are still reported.

### Done When

- [ ] A unit fixture with a failing merge-base call for one branch produces an advisory note naming that branch and no overlap entry for it.
- [ ] A unit fixture with a failing diff for one branch still reports another branch's genuine overlap in the same run.
- [ ] The merge-base helper returns the branch's changed paths since its merge base, and a distinguishable no-result value when that merge base is uncomputable.

## Negative-category review

Invalid and indeterminate input is covered by the uncomputable-merge-base and failing-diff criteria, which are the only two ways the git boundary can refuse an answer here. Dependency unavailability is the same pair: the scan's sole dependency in this slice is the injected git runner, and both of its refusal modes degrade to a named advisory note rather than a silent drop or a fabricated overlap. Data integrity is covered by the false-report criterion, which is the defect itself: an overlap claim must be traceable to the branch's own commits. Authorisation, concurrency, resource exhaustion, partial rollback, cascade deletion, and immutability categories are inapplicable — the scan is read-only, stateless, single-pass, and writes nothing, so there is no protected resource, shared mutable state, transaction, or record to violate. Idempotency is inapplicable for the same reason: repeating the scan re-derives the report from git and persists nothing. The blocker sweep's own failure modes are unchanged by this slice and retain their existing coverage.
