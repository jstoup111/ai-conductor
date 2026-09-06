**Status:** Accepted

# Stories: Heal pre-rebase untracked-file collisions and park them accurately (#415)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the rebase step's behaviour when git
refuses to start a rebase at all. Mid-rebase conflict handling, the gated resolver sub-loop, and
every other refusal class keep their current behaviour.

## Story 1: Complete a rebase blocked only by colliding untracked files

As a daemon operator, I want a rebase blocked solely by stray untracked files that the advanced base
now tracks to complete on its own, so that a feature is not parked for a blocker no human judgement
is needed to clear.

### Acceptance Criteria

#### Happy Path

- Given a feature worktree holds an untracked file at a path the base introduces as tracked, when the rebase step runs, then the colliding file is moved into a quarantine directory under the worktree's pipeline directory and the rebase completes with its ordinary clean outcome.
- Given a rebase completed only after colliding untracked files were moved aside, when the rebase step reports its outcome, then the event ledger records one occurrence naming every quarantined path and the quarantine directory holding them.

#### Negative Paths

- Given git names a colliding path that is not reported as untracked in the worktree, when the rebase step runs, then no file is moved, the rebase is not retried, and the feature parks.
- Given the quarantine destination for a colliding path is already occupied, when the rebase step runs, then no file is moved or overwritten, the rebase is not retried, and the feature parks.
- Given colliding untracked files were moved aside but the retried rebase stops on a genuine content conflict, when the rebase step reports its outcome, then the quarantined paths are still recorded and the conflict follows the existing paused-rebase handling.

### Done When

- [ ] A real-git test proves a rebase that git refuses to start because of an untracked collision completes after the heal and leaves the collided file's base content checked out.
- [ ] A real-git test proves the quarantined bytes are recoverable from the quarantine directory after the heal.
- [ ] Tests prove no move and no retry occur when a named path is not untracked, and when the quarantine destination already exists.
- [ ] An emitted-event assertion shows one occurrence carrying the quarantined paths and the quarantine directory.

## Story 2: Park a rebase that never started with an accurate diagnosis

As a daemon operator, I want a rebase that git refused to start to park with the actual git refusal
and a recovery procedure that works, so that I am not sent to resolve conflicts and continue a
rebase that does not exist.

### Acceptance Criteria

#### Happy Path

- Given git refused to start the rebase and no heal was possible, when the feature parks, then the halt note states that no rebase is in progress, carries git's own refusal text, and gives a recovery procedure that does not instruct continuing a rebase.

#### Negative Paths

- Given a rebase actually paused on unmerged files, when the feature parks, then the halt note keeps the existing conflict resume procedure unchanged.
- Given a rebase was already in progress when the step ran, when the feature parks, then the existing in-progress refusal message and its resume procedure are unchanged.

### Done When

- [ ] A test asserts the halt marker written for a refused-before-start outcome contains git's refusal text and no instruction to continue a rebase.
- [ ] A test asserts the halt marker written for a genuine unmerged-path conflict is byte-identical to the note produced today.
- [ ] Both the finish-time rebase step and the play-forward re-kick path select the halt note from the same outcome, proven at each call site.

## Negative-category review

Data integrity is the dominant category and is covered twice: quarantine never deletes, and a
would-be overwrite of an existing quarantine entry refuses rather than clobbering. Invalid input is
covered by the not-actually-untracked case, which rejects a path git named but the worktree does not
confirm. Partial failure and rollback is covered by the retried rebase stopping on a genuine
conflict, where the quarantine record survives and the existing paused-rebase path takes over.
Regression of the adjacent branches is covered by the unchanged conflict and already-in-progress
halt notes. Concurrency, authorisation, timeouts, dependency unavailability, and cascade deletion
are inapplicable: the step is a single-writer local git operation inside one worktree with no
network call, no external service, no shared mutable record, and no deletion.
