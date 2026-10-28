**Status:** Accepted

# Stories: Halt records committed on stacked child branches make every restack conflict

Source: jstoup111/ai-conductor#3451. Track: technical (no PRD). Tier: M.

A stacked feature commits its halt record (`.docs/halted/<slug>.md`) on whichever child branch is
active when a halt is written or cleared. Each halt or clear adds another copy of that record to a
child's history. A later restack replays those copies across children. They conflict with each
other, and with any real code conflict in the same range they reach the provider resolver, which
cannot reconcile them. These stories make every stacked restack treat halt-record bookkeeping
mechanically: halt-record-only commits never conflict and never reach the resolver, and the
replayed child ends with the newest record. Halt records stay committed on the active child; moving
them off the child branches is out of scope.

Notation: "halt-record-only commit" means a commit whose changed paths are exactly
`.docs/halted/<slug>.md`. A record's age is its `Resolved at:` time, or its `Halted at:` time when
it is unresolved.

## Story 1: A stacked restack never escalates halt-record bookkeeping to the resolver

**Requirement:** #3451 desired outcomes 1, 2

As an operator of a stacked feature that has halted and resumed several times, I want a restack to
complete without a conflict halt or a resolver call when the only divergence between children is
halt-record bookkeeping, so that routine halts do not make the stack un-restackable.

### Acceptance Criteria

#### Happy Path
- Given a two-child stacked feature where child 1 has a repair commit to `src/r.ts` followed by 3 halt-record-only commits appended past its closure, and child 2's range holds 2 halt-record-only commits with different record text plus 2 code commits that touch other paths, when a feature-repair restack carries child 1's change to child 2, then the restack is applied, no conflict halt is written, the provider resolver is never invoked, and child 2's new branch tip descends from child 1's new closure.
- Given a two-child stacked feature where child 2's range holds a code commit that conflicts with child 1's repair in `src/a.ts` and also 4 halt-record-only commits that differ from child 1's record, when the routed-exit restack falls back to the provider resolver, then the resolver's conflict context names only `src/a.ts`, never `.docs/halted/<slug>.md`, and the rebase todo it replays lists none of the 4 halt-record-only commits.
- Given that same conflicted restack where the resolver resolves `src/a.ts`, when the resolved tip is checked against FR-9, then FR-9 passes and its expected subject list contains every code commit's subject and none of the omitted halt-record-only commits' subjects.
- Given a kept commit in child 2's range that changes both `src/b.ts` and the halt record, while child 1's new closure also changed the halt record, when the restack replays that commit on either replay path, then `src/b.ts` is applied, the halt record does not conflict, and the commit is replayed as one commit with its original subject and body.

#### Negative Paths
- Given a child range commit that changes `.docs/halted/<slug>.md` and `.docs/plans/<stem>.md`, when the restack classifies it, then it is kept and replayed as an ordinary commit, never omitted as bookkeeping, and its plan change is present at the new child tip.
- Given a child range commit that changes only `.docs/halted/<other-slug>.md`, a different feature's record, when the restack classifies it, then it is kept and replayed, never omitted as this feature's bookkeeping.
- Given a merge commit in a child's range whose changes include `.docs/halted/<slug>.md`, when the restack classifies it, then it is never omitted as bookkeeping and goes through the existing merge handling (`flatten_refused` when it conflicts).
- Given a resolver-fallback restack whose code conflict the resolver cannot resolve, when the restack halts needs-human, then the conflict halt names only the code paths, never `.docs/halted/<slug>.md`, and no child ref or closure ref has moved.
- Given a resolver-fallback restack has run, when the feature worktree's `.git/config`, `.git/info/attributes` and tracked `.gitattributes` are compared with their state before the restack, then all three are byte-identical; the halt-record merge rule existed only for that rebase.
- Given a stacked feature whose leaf is unentered and whose leaf tip is a pre-region halt-record-only commit inside child 1's range, when a base-refresh restack omits that commit from child 1's replay, then the leaf moves in the same transaction to exactly one rewritten commit on child 1's new history and the restack does not throw `cannot resolve unentered leaf`.
- Given a halt-record-only commit at the end of a child's range, after its last kept commit, when the restack journals that child's rewrites, then the omitted commit maps to the child's final new tip, a halt-record-only commit between two kept commits maps to the rewrite of the kept commit before it, and a halt-record-only commit whose only earlier range commit was dropped as patch-equivalent maps to the new parent.

### Done When
- [ ] A real-git restack test over the issue's shape (halt-record-only commits on both children plus a code conflict) produces a resolver conflict context, rebase todo and FR-9 subject list with no halt-record entries.
- [ ] A real-git restack test whose only cross-child divergence is halt-record bookkeeping is applied with zero resolver invocations and no `.pipeline/HALT`.
- [ ] Tests show a mixed commit and another feature's halt-record commit are both kept, and the repository config and attributes are unchanged after a resolver run.
- [ ] A test shows an unentered leaf at an omitted pre-region halt-record commit moves to exactly one rewrite.

## Story 2: The replayed child carries the newest halt record

**Requirement:** #3451 desired outcome 3

As an operator reading a stacked feature's halt record after a restack, I want the record at each
replayed child's tip to be the newest one, never an older copy replayed over it, so that the record
and the recovery that reads it reflect the feature's current halt state.

### Acceptance Criteria

#### Happy Path
- Given child 1's new closure carries a record resolved at `2026-10-26T12:30:00.000Z` and child 2's old tip carries a record halted at `2026-10-26T11:00:00.000Z`, when the restack replays child 2, then child 2's new tip carries child 1's resolved record byte-for-byte, and no commit is added for the halt record.
- Given child 1's new closure carries a record resolved at `2026-10-26T10:00:00.000Z` and child 2's old tip carries a record halted at `2026-10-26T12:05:00.000Z`, when the restack replays child 2 on the plumbing path, then child 2's new tip carries child 2's halted record byte-for-byte, added by exactly one commit with subject `halt record: <slug>` on top of the replayed commits.
- Given the same records and a code conflict that sends child 2 to the provider resolver, when the resolver's tip is accepted, then the accepted tip carries child 2's halted record through exactly one `halt record: <slug>` commit, and the path-ownership check accepts the tip.
- Given the restack has applied with child 2's newer halted record at its tip, when the stack preflight next reads the record at child 2's tip, then it reads `Status: halted`, the same status the newest record states.

#### Negative Paths
- Given child 1's new closure and child 2's old tip carry records with the same age, when child 2 is replayed, then child 2's new tip carries child 1's record byte-for-byte and no halt-record commit is added.
- Given child 2's old-tip record has an unreadable `Halted at:` value and child 1's new-closure record has a readable `Resolved at:`, when child 2 is replayed, then child 1's record is kept and no halt-record commit is added.
- Given child 2's old-tip record is readable and child 1's new-closure record has no readable `Resolved at:` or `Halted at:` line, when child 2 is replayed, then child 2's record is carried by one `halt record: <slug>` commit.
- Given neither record has a readable time, when child 2 is replayed, then child 2's new tip carries child 1's record byte-for-byte and no halt-record commit is added.
- Given child 1's new closure carries a record resolved at `2026-10-26T12:30:00.000Z`, and child 2's range holds a kept commit that changes `src/m.ts` and cleanly replaces the halt record with one halted at `2026-10-26T11:00:00.000Z` (child 1's record is unchanged from that commit's base), when child 2 is replayed on either replay path, then child 2's new tip carries child 1's record byte-for-byte, restored by exactly one `halt record: <slug>` commit, and `src/m.ts` carries the kept commit's change.
- Given child 2's range never changed `.docs/halted/<slug>.md`, when child 2 is replayed onto a new parent whose record is older than the one at child 2's old tip, then no halt-record commit is added, and the path-ownership check does not halt `replay-mismatch` on `.docs/halted/<slug>.md`.
- Given child 1's new closure has no `.docs/halted/<slug>.md` and child 2's range created it, when child 2 is replayed, then child 2's new tip carries the record from child 2's old tip.

### Done When
- [ ] Tests on both replay paths show the newer record survives at the tip byte-for-byte whichever side it came from.
- [ ] Tests cover the tie, one-side-unreadable, both-unreadable, untouched-range and parent-without-record cases with the outcomes above.
- [ ] A test shows the bookkeeping commit's subject is `halt record: <slug>` and that it changes only `.docs/halted/<slug>.md`.

## Story 3: Flat features and ordinary stacked commits keep today's behavior

**Requirement:** #3451 desired outcome 4

As an operator of a non-stacked feature, I want halt records and rebases to behave exactly as they
do today, so that the stacked-restack fix cannot change or break a flat feature.

### Acceptance Criteria

#### Happy Path
- Given a flat (non-stacked) feature that halts needs-human and is later resolved, when the halt is written and cleared, then `.docs/halted/<slug>.md` is committed and pushed on its feature branch exactly as before, with subjects `halt record: <slug>` and `halt record resolved: <slug>`.
- Given a flat feature with halt-record commits whose FINISH rebase onto the default branch conflicts on the halt record, when the rebase runs, then it follows the existing `performRebase` behavior, with no halt-record commit omitted and no halt-record bookkeeping commit added.
- Given a stacked restack over a child range with no halt-record commits, when it replays, then the new tip, its commits and the journal rewrites are identical to those produced before this change.

#### Negative Paths
- Given a stacked restack whose child range contains a code commit that becomes empty against the new parent, when it replays, then that commit is dropped as today, and an originally-empty evidence commit in the same range is still kept.
- Given a stacked restack whose kept code commit reverts a path outside the child's owned paths, when it replays, then it still halts `replay-mismatch` naming the path, and the halt-record bookkeeping does not mask the refusal.
- Given a stacked restack where the resolver drops a code commit's subject, when FR-9 runs, then FR-9 still rejects the tip and names the missing code-commit subject.

### Done When
- [ ] Existing flat-feature halt-record and FINISH rebase tests pass unchanged.
- [ ] A test shows a stacked restack over a range without halt-record commits yields the same tip and rewrites as before.
- [ ] Tests show the empty-commit, path-ownership and FR-9 refusals still fire for non-bookkeeping commits.
