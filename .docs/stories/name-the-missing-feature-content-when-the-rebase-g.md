**Status:** Accepted

# Stories: Name the missing feature content when the rebase guard rejects (#1497)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the rejection message the rebase work-preservation guards produce and the resume procedure the halt marker carries. The guards' accept/reject decision itself is unchanged and is pinned here so the diagnostic work cannot loosen it.

## Story 1: A rejected rebase names the feature content that is missing

As an operator triaging a `needs-human` rebase halt, I want the rejection to tell me which feature content is absent and on what evidence, so that I can confirm or refute the loss without reconstructing the guard's reasoning by hand.

### Acceptance Criteria

#### Happy Path

- Given a completed rebase in which one pre-rebase commit subject is absent and the content that commit added is absent from the resulting tree, when the work-preservation guard rejects, then the rejection names that subject, its pre-rebase commit identity, and the file whose content failed the check.
- Given the same condition reached through the shared acceptance-guard entry point used after an automated resolution, when that entry point rejects, then its reason names only the subject that is actually missing and its content evidence, not an unfiltered prefix of the pre-rebase subject list.
- Given several pre-rebase subjects are absent and none of their content survives, when the guard rejects, then the rejection enumerates each missing subject with its own evidence rather than reporting a single unattributed failure.

#### Negative Paths

- Given a missing subject that cannot be resolved back to a pre-rebase commit, when the guard runs, then it still rejects and the rejection states that the subject could not be resolved.
- Given a completed rebase in which git eliminated a commit because the base already carries an equivalent change, when the guard runs, then it reports the feature content preserved and no halt is raised.
- Given a missing commit whose diff cannot be read, is empty, or is binary, when the guard runs, then it still rejects and the rejection states which commit could not be judged.

### Done When

- [ ] Real-local-Git guard cases assert the rejection text contains the absent commit subject, its abbreviated pre-rebase identity, and the path whose content failed.
- [ ] A real-local-Git case with two independently dropped-and-unrecovered commits asserts both subjects appear in one rejection.
- [ ] The already-upstream case and the genuinely-lost case both keep their current verdicts, proving the accept/reject boundary did not move.
- [ ] The shared acceptance-guard entry point's rejection reason contains the missing subject and omits pre-rebase subjects that survived.

## Story 2: The halt tells the operator what to do in the state the repository is actually in

As an operator reading `.pipeline/HALT`, I want the resume procedure to describe the repository state I will find, so that I do not run recovery commands that cannot apply.

### Acceptance Criteria

#### Happy Path

- Given a halt raised by an acceptance guard after the rebase completed, when the halt marker is written, then its resume procedure describes recovery from a completed rebase with a clean tree and instructs no conflict resolution and no rebase continuation.
- Given a halt raised while a rebase is paused mid-flight on conflicted paths, when the halt marker is written, then it carries the existing conflict-resolution-then-continue procedure unchanged.
- Given a halt raised by an acceptance guard, when the halt marker is written, then it still carries the `needs-human` class and the guard's reason line.

#### Negative Paths

- Given a halt whose producer declares no resume shape, when the halt marker is written, then it falls back to the paused-rebase procedure, preserving today's text for every existing caller.
- Given a halt raised by an acceptance guard with no conflicted paths captured, when the halt marker is written, then the marker is still written with the completed-rebase procedure and no empty file list is presented as a resolution instruction.

### Done When

- [ ] A halt-marker case for an acceptance-guard rejection asserts the written body contains no instruction to run a rebase continuation and no instruction to resolve conflicts.
- [ ] A halt-marker case for a paused rebase asserts the existing procedure text is byte-identical to today's.
- [ ] A case with no declared resume shape asserts the paused-rebase procedure, and the `needs-human` class marker is asserted on both shapes.
- [ ] The rebase step and the daemon play-forward halt path both pass the guard's declared resume shape to the marker writer.

## Negative-category review

Invalid and unresolvable input is covered by the unresolvable-subject, unreadable-diff, empty-diff, and binary-diff criteria. Data integrity is covered by pinning the accept/reject boundary in both directions, so a diagnostics change cannot make the guard permissive or make it reject a legitimately superseded commit. Partial failure is covered by the missing-conflict-list and no-declared-shape criteria, both of which must still produce a written marker with the correct class. Dependency unavailability at the git boundary is covered by the unreadable-diff case, which already fails closed. Auth, timeout, concurrency, resource exhaustion, cascade deletion, and idempotency categories are inapplicable: the change performs no network, no external service call, no write outside the halt marker the caller already wrote, and no shared mutable state.
