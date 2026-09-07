**Status:** Accepted

# Stories: Refuse daemon auto-resume of an operator-action halt class (#1713)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the two daemon auto-resume paths that do not consult the halt classification today: the progress-gated cross-dispatch re-kick and the rate-limit episode-end halt sweep. The base-advance re-kick sweep already honours the classification and is unchanged. The wider inherited-halt audit remains outside this slice.

## Story 1: A progressing build that halted for a human stays halted

As an operator, I want a halt only I can resolve to survive the daemon's progress-gated re-kick so that a stop I was promised is not converted into a dispatch spin.

### Acceptance Criteria

#### Happy Path

- Given a parked feature whose live halt is classed mechanical and whose last dispatch made forward progress, when the daemon polls for work, then the feature is re-dispatched exactly as it is today, bounded by the existing per-feature dispatch ceiling.
- Given a parked feature whose live halt is classed legacy and whose last dispatch made forward progress, when the daemon polls for work, then the feature is re-dispatched, preserving pre-classification compatibility behavior.

#### Negative Paths

- Given a parked feature whose live halt is classed needs-human and whose live resolved-task count exceeds the count its last dispatch recorded, when the daemon polls for work, then the feature is not dispatched on that poll or any later poll of the same run.
- Given a parked feature with a live halt whose class is missing, unreadable, or unrecognized, and a positive resolved-task delta, when the daemon polls for work, then the feature is not dispatched.
- Given the daemon declines a progress-gated re-kick on classification, when it records that decision, then the operator-visible line names the feature and the halt disposition that blocked it, and it is recorded once per feature rather than on every poll.

### Done When

- [ ] A daemon fixture with a dispatch ceiling above one and a permanently positive progress delta dispatches a needs-human-classed feature exactly once and returns exactly one outcome for it.
- [ ] The same fixture with an absent class sidecar dispatches the feature exactly once.
- [ ] The same fixture with a mechanical class, and again with a legacy class, dispatches the feature more than once up to the configured ceiling.
- [ ] The declined run's captured log lines contain exactly one line naming both the feature and the blocking disposition.
- [ ] The production daemon entrypoint supplies the classification reader for the feature's own worktree to the daemon loop.

## Story 2: An episode-end sweep leaves an operator-action halt in place

As an operator, I want the rate-limit episode recovery sweep to clear only halts the daemon may clear so that a halt awaiting my decision is not silently cleared because a rate-limit episode happened to be running when it was written.

### Acceptance Criteria

#### Happy Path

- Given a feature stamped as halted during a rate-limit episode whose live halt is classed mechanical, when the episode ends and the recovery sweep runs, then its marker is cleared and the recovery is recorded exactly as it is today.

#### Negative Paths

- Given a feature stamped as halted during a rate-limit episode whose live halt is classed needs-human, when the episode ends and the recovery sweep runs, then its marker is left in place and the recorded line names the disposition that blocked the clear.
- Given a feature stamped as halted during a rate-limit episode whose halt class is missing or unreadable, when the episode ends and the recovery sweep runs, then its marker is left in place.
- Given a stamped feature is also operator-parked, when the episode ends and the recovery sweep runs, then the existing operator-park refusal still wins and no marker is cleared.

### Done When

- [ ] A sweep fixture over real temporary worktrees leaves the marker file present for a needs-human-classed feature and for a feature with no class sidecar.
- [ ] The same fixture removes the marker file for a mechanical-classed feature in the same sweep.
- [ ] The sweep's captured lines name the blocked feature and its disposition, and the pre-existing operator-park refusal line is unchanged.

## Negative-category review

Invalid and missing input is covered by the absent, unreadable, and unrecognized class sidecar cases, which are the classification reader's fail-closed direction and the second desired outcome of the source issue. Dependency unavailability and partial failure are covered by the same cases: the marker and its class sidecar are two files written in sequence, so the window in which the marker exists without a readable class is the exact partial state under test, and both paths must treat it as blocking rather than resumable. Concurrent access is covered by the once-per-feature recording assertion, which is what keeps a repeated poll from converting one refusal into an unbounded log. Auth, permission, resource exhaustion, cascade deletion, immutability, exception hierarchy, and dedup categories do not apply: no request, no principal, no datastore, no deletion, and no idempotency key is introduced. Data integrity applies only in that no marker, class sidecar, ledger, or config value is written by this change — both sites only decline an action they perform today.
