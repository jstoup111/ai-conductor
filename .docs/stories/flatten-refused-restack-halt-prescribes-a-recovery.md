**Status:** Accepted

# Stories: Stacked restacks recover merge-bearing conflicts automatically (#3438)

Technical track (no PRD). Sources: the scope boundary in `.docs/track/flatten-refused-restack-halt-prescribes-a-recovery.md`; `adr-2026-10-10-stacked-restack-journaled-replay` decision 6 as amended by #3438; `adr-2026-10-25-operator-recorded-restack-conflict-resolution` decision 8 as amended by #3438; `architecture-review-2026-11-01-flatten-refused-restack-halt-prescribes-a-recovery`; the desired outcomes of #3438.

Terms used below:
- **Stack:** a feature with slug `demo` whose sealed plan declares slices at positions `1`, `2` and `3`, with `stacked_prs.enabled` on. `feat/c1/demo` and `feat/c2/demo` are closed at `refs/conductor/demo/closed/c1` and `closed/c2`. The leaf is `feat/daemon-demo`.
- **Merge-bearing child 2:** child 2's first-parent range holds ordinary commit `C`, which edits `shared.txt`; merge `M`, whose side `Q` the new parent does not contain and whose result carries a hand edit to `hand.txt`; and ordinary commit `T`.
- **Merge-bearing conflict:** a restack of the stack in which replaying commit `C` conflicts on `shared.txt` against the new parent.
- **Fake resolver:** a test resolver injected at the production resolver seam. It records the todo and context it receives and settles the conflict unless a scenario says otherwise.
- **Ordinary conflict halt:** the `restack conflict child <k>` needs-human HALT with its `Restack-Conflict` line, recipes and conflict record.

## Story 1: A merge-bearing conflict reaches the resolver and keeps the merge's content

**Requirement:** #3438 outcome 1 (ADR decision 6 as amended)

As an operator, I want a merge-bearing restack conflict settled under the same bounded resolver as any other conflict, so that a rare merge does not cost me an intervention.

### Acceptance Criteria

#### Happy Path
- Given a merge-bearing conflict during a `base-refresh` restack, when the restack runs, then the fake resolver is dispatched, its todo has one entry each for `C`, `M` and `T` in that order, and no `restack_refused` event is emitted.
- Given a merge-bearing conflict during a routed `feature-repair` restack, when the restack runs, then the fake resolver is dispatched and no `restack_refused` event is emitted.
- Given a planned restack journal that journal recovery resumes and whose replay hits a merge-bearing conflict, when recovery runs, then the fake resolver is dispatched and no `restack_refused` event is emitted.
- Given the fake resolver settles a merge-bearing conflict, when the restack applies, then child 2's tree holds the hand edit in `hand.txt` and `Q`'s content, child 2's new range contains no merge commit, and the commit carrying `M`'s subject has the trailer `Flattened-merge: <M>`.
- Given a merge whose side the new parent already contains and whose result carries a hand edit, when the fake resolver settles the conflict, then only the hand-resolved part is applied and a later main edit to the side's lines survives in child 2.
- Given a merge whose side the new parent already contains and whose result equals the automatic merge, when the todo is built, then the merge has no todo entry and its subject is not required in the result.
- Given a settled merge-bearing conflict, when the restack applies, then exactly one `rebase_merge_audit` event lists `M` as flattened, and the journal's rewrites for child 2 map `M` to its rebuilt commit.

#### Negative Paths
- Given a settled result missing `M`'s subject, when the acceptance guards run, then the result is rejected, the ordinary conflict halt is written, and no branch or closure ref moves.
- Given a settled result that changes a path outside child 2's owned paths, when path ownership runs, then the restack halts `replay-mismatch` naming that path and no branch or closure ref moves.
- Given a flattened merge whose change the new parent already contains, when the todo is built, then the merge has no todo entry, the rebase does not stop on an empty pick, and its subject is not in the recorded candidate subjects.
- Given a merge-bearing conflict with no resolver supplied, when the restack runs, then the ordinary conflict halt is written with the reason `restack resolver unavailable` and no branch or closure ref moves.
- Given a fake resolver that never settles the conflict, when the attempt budget is exhausted, then it was dispatched no more times than the budget allows and the ordinary conflict halt is written.
- Given a side-lineage commit of `M`, when the settled result is inspected, then that commit is not replayed as its own commit and its subject is not required.

### Done When
- [ ] Real-git tests drive merge-bearing conflicts through `runRestack` for both causes and through journal recovery, and assert the resolver dispatch and the absence of `restack_refused`.
- [ ] A real-git test asserts the settled child's file contents, its lack of merge commits, and the `Flattened-merge:` trailer.
- [ ] A test asserts the `rebase_merge_audit` event and the journal's rewrite for `M`.

## Story 2: An unsettled merge-bearing conflict has a recovery that works when followed literally

**Requirement:** #3438 outcomes 1 and 2 (ADR decisions 6 and 8 as amended)

As an operator facing a merge-bearing conflict the resolver could not settle, I want every step the halt prints to carry the feature forward with the merge's content intact, so that I am never sent down a dead end.

### Acceptance Criteria

#### Happy Path
- Given an unsettled merge-bearing conflict, when the halt is written, then `.pipeline/HALT` begins `restack conflict child 2` and contains `Restack-Conflict: 2 <opId>`, `git switch -c restack-resolve/demo/c2 <flattened-tip>`, `git rebase --onto <new-parent> <old-parent>`, the `--tip` command and the `--decision` command, with real shas.
- Given the same halt, when the refs are read, then the conflict record names child 2 with its candidate subjects, the parent pin is set, and `refs/conductor/demo/restack/conflict/flattened-tip` equals the printed tip, whose tree equals the tree of child 2's old tip and whose range from the old parent contains no merge commit.
- Given that halt and an unchanged parent tree, when the operator runs the printed `--tip` recipe, settles `shared.txt` and records the tip, then the command exits 0, the next restack emits `restack_resolution` with `action: consumed`, and child 2 holds the hand edit in `hand.txt` and `Q`'s content.
- Given that halt, when the operator records a decision with `--decision "<answer>"`, then the command exits 0, the next restack delivers the answer to the resolver, and a settled result applies.
- Given a consumed recovery whose restack applies, when the refs are read, then the flattened tip pin is deleted along with the record and the parent pin.

#### Negative Paths
- Given the same halt, when the operator reads its text, then it contains neither `resolve the conflict on child branch` nor any instruction to rebase or commit on `feat/c2/demo` or `feat/daemon-demo` nor any instruction to move a `refs/conductor/demo/closed/*` ref.
- Given the halt, when the refs are compared to their state before the restack, then no `feat/` branch and no closure ref has moved.
- Given a tip built by plain rebase of child 2's merge-bearing old tip, when it is recorded with `--tip`, then the command refuses it naming `M`'s missing subject and the HALT stays in place.
- Given the flattened tip pin cannot be written because its ref changed concurrently, when the halt is raised, then the needs-human HALT is still written, it names the write failure, and no branch or closure ref has moved.
- Given a restack that halts again before applying, when the refs are read, then the record, the parent pin and the flattened tip pin of the latest halt are present and the earlier pin value is replaced.
- Given feature teardown after a merge-bearing halt, when conductor refs are deleted, then `refs/conductor/demo/restack/conflict/flattened-tip` is deleted by name.

### Done When
- [ ] A real-git test asserts the HALT text and the absence of each forbidden instruction.
- [ ] A real-git test follows the printed `--tip` recipe literally through `stack restack-resolve` and the next restack, and asserts child 2's file contents.
- [ ] A real-git test follows `--decision` through the next restack with the fake resolver.
- [ ] A test asserts the flattened tip pin's lifecycle: written at the halt, replaced by a later halt, deleted on apply and at teardown.

## Story 3: Everything without a merge conflict in a stacked child behaves as before

**Requirement:** #3438 outcome 3 (ADR decision 9 parity)

As an operator, I want this change confined to merge-bearing stacked conflicts, so that ordinary restacks and N=1 rebases do not shift under me.

### Acceptance Criteria

#### Happy Path
- Given a stacked child with no merge in its range whose replay conflicts and is unsettled, when the halt is written, then its text and conflict record are unchanged, its `--tip` recipe starts from the child's old tip, and no `flattened-tip` ref exists.
- Given a stacked child with no merge in its range and a resolver that settles the conflict, when the restack runs, then the resolver's todo lists the child's original commits by their own shas.
- Given a merge-bearing child whose plumbing replay is clean, when the restack runs, then no resolver is dispatched and the child is replayed as today.

#### Negative Paths
- Given a feature without children whose first dry-run conflict falls on a flattened merge, when `performRebase` runs, then it still returns `flatten_refused` with its recipe and the gated resolver is not dispatched.
- Given a stacked child with no merge in its range, when the resolver hand-off starts its rebase, then the command is `git rebase -i --onto <new-parent> <old-parent>` with no empty-commit option.
- Given a merge-bearing child whose plumbing replay is clean, when the restack applies, then no `flattened-tip` ref exists.

### Done When
- [ ] The existing no-merge restack conflict tests pass with unchanged expectations.
- [ ] The existing N=1 `flatten_refused` tests pass with unchanged expectations.
- [ ] A test asserts that a no-merge conflict halt and a clean merge-bearing replay write no `flattened-tip` ref.
