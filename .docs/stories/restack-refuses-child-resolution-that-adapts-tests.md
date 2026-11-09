**Status:** Accepted

# Stories: Restack accepts resolutions that adapt the new parent's files (#3598)

Technical track (no PRD). Sources: the scope boundary in `.docs/track/restack-refuses-child-resolution-that-adapts-tests.md`; `adr-2026-10-10-stacked-restack-journaled-replay` decision 3 as amended by #3598; `adr-2026-10-25-operator-recorded-restack-conflict-resolution` decisions 2 and 3 as amended by #3598; `architecture-review-2026-11-07-restack-refuses-child-resolution-that-adapts-tests`; the desired outcomes of #3598.

Terms used below:
- **Stack:** a feature with slug `demo` whose sealed plan declares slices at positions `1`, `2` and `3`, with `stacked_prs.enabled` on. A `feature-repair` restack replays children 2 and 3 onto a repaired child 1.
- **Child 2's owned paths:** the paths child 2's old range changed, `src/c.ts` and `src/main.ts`.
- **New parent's changes:** the paths changed between child 2's old parent and its new parent, the repaired child 1. They are `tests/a.test.ts`, which the repair adds, `tests/b.test.ts`, which it modifies, and `src/c.ts`.
- **Conflict:** replaying child 2's commit `C2` onto the new parent conflicts on `src/c.ts`, so a resolver hand-off runs.
- **Fake resolver:** a test resolver injected at the production resolver seam, which settles the conflict with the tip a scenario names.
- **Adapted path:** a path the resolved tip changes relative to its new parent that is among the new parent's changes but not among child 2's owned paths.
- **Restack-conflict halt:** the `restack conflict child <k>` needs-human HALT with its `Restack-Conflict` line, recipes and conflict record.

## Story 1: A resolved tip may adapt files its new parent changed

**Requirement:** #3598 outcomes 1 and 2 (restack ADR decision 3 as amended)

As an operator, I want a restack resolution that updates the new parent's tests for the child's change to be accepted, so that a stack whose upstream child added tests can restack without my intervention.

### Acceptance Criteria

#### Happy Path
- Given the conflict and a fake resolver tip that resolves `src/c.ts` and edits `tests/a.test.ts`, when acceptance is checked, then the tip is accepted, child 2 is recorded `resolved`, child 3 replays onto child 2's resolved tip, and the restack applies.
- Given that applied restack, when `restack_applied` for child 2 is persisted, then its `adaptedPaths` is `["tests/a.test.ts"]`.
- Given a fake resolver tip whose only change outside child 2's owned paths is an edit to `tests/b.test.ts` that leaves it different from its old-parent content, when acceptance is checked, then the tip is accepted and `adaptedPaths` is `["tests/b.test.ts"]`.
- Given a restack in which child 2 replays with no conflict, or its resolved tip changes only owned paths, when `restack_applied` for child 2 is persisted, then its `adaptedPaths` is `[]`.

#### Negative Paths
- Given a fake resolver tip that also changes `src/other.ts`, which is in neither child 2's owned paths nor the new parent's changes, when acceptance is checked, then the tip is refused with `restack_refused` reason `replay-mismatch` naming `src/other.ts` as unowned, and no branch or closure ref moves.
- Given a fake resolver tip that deletes `tests/a.test.ts`, which the new parent added, when acceptance is checked, then the tip is refused with reason `replay-mismatch` naming `tests/a.test.ts` as a parent revert, and no branch or closure ref moves.
- Given a fake resolver tip that restores `tests/b.test.ts` to its exact content at child 2's old parent, when acceptance is checked, then the tip is refused with reason `replay-mismatch` naming `tests/b.test.ts` as a parent revert.
- Given child 2 replayed with no resolver hand-off, whose replayed result changes `tests/b.test.ts`, when path ownership runs, then the restack halts `replay-mismatch` naming `tests/b.test.ts`, because a clean replay accepts only owned paths.
- Given a fake resolver tip with one accepted adaptation of `tests/a.test.ts` and one change to `src/other.ts`, when acceptance is checked, then the tip is refused and the refusal names only `src/other.ts`.

### Done When
- [ ] A resolved tip is accepted when every path it changes from its new parent is owned or an adapted path that does not restore old-parent content.
- [ ] `restack_applied` carries `adaptedPaths`, sorted, for every replayed child, empty when there are none.
- [ ] A refusal names each refused path with its cause, `unowned` or `parent-revert`.
- [ ] A clean replay's acceptance is unchanged: owned paths only.

## Story 2: An accepted adaptation re-opens the child's review

**Requirement:** #3598 outcome 1 (restack ADR decision 3 as amended: adapted paths count as the child's contribution)

As an operator, I want a child whose resolution changed its parent's tests to be reviewed again, so that a rewritten upstream test cannot hide a regression without anyone judging it.

### Acceptance Criteria

#### Happy Path
- Given child 2 with satisfied `build_review` and `test_suite` verdicts and a resolved tip whose only change beyond a replay of child 2's own commits is the adaptation of `tests/a.test.ts`, when the restack applies, then child 2's `build_review` and `test_suite` verdicts are no longer satisfied and `restack_applied` lists both in `wouldInvalidate`.
- Given that applied restack, when child 2 is next dispatched, then `build_review` runs again for child 2 before child 2 completes.

#### Negative Paths
- Given child 2 with satisfied verdicts and a clean replay whose child-owned content is unchanged and which has no adapted paths, when the restack applies, then child 2's `build_review` verdict stays satisfied, as before this change.
- Given child 2's resolved tip with an adapted path and child 3 replaying cleanly onto it, when the restack applies, then child 3's `restack_applied` has `adaptedPaths: []`.

### Done When
- [ ] The restack transition counts a resolved child's adapted paths as part of its contribution, so a resolution confined to parent-changed paths is not classified as an unchanged replay.
- [ ] Nothing new is stored in the restack journal; adapted paths are recomputed from the child's range, its new parent and its new tip.

## Story 3: A refused resolution keeps the resolver's work and can be recovered

**Requirement:** #3598 outcome 3 (operator-recorded resolution ADR decision 2 as amended)

As an operator, I want a refused restack resolution kept and named in the halt, so that I can fix or reuse the resolver's work instead of paying for it again.

### Acceptance Criteria

#### Happy Path
- Given a fake resolver tip refused for `src/other.ts`, when the restack halts, then `refs/conductor/demo/restack/conflict/refused-tip` names that tip, the conflict record and parent pin are written for child 2, `restack_refused` with reason `replay-mismatch` and `restack_conflict` are persisted, and the HALT carries `Restack-Conflict: 2 <opId>` with both recipes.
- Given that halt, when the operator reads `.pipeline/HALT`, then its detail names `refs/conductor/demo/restack/conflict/refused-tip`, `src/other.ts` with cause `unowned`, and its `--tip` recipe starts from the refused tip.
- Given a merge-bearing child 2 whose settled resolver tip is refused for `src/other.ts`, when the restack halts, then the `--tip` recipe starts from `refs/conductor/demo/restack/conflict/refused-tip`, and `refs/conductor/demo/restack/conflict/flattened-tip` is still pinned with the conflict record.
- Given that halt and a tip the operator made from the refused tip by dropping the `src/other.ts` change, when the operator runs `ai-conductor stack restack-resolve --slug demo --child 2 --tip <sha>` and the daemon next dispatches `demo`, then the command exits 0, the next restack consumes the resolution and applies, and the refused-tip ref, the conflict record and the parent pin no longer exist.

#### Negative Paths
- Given a refused resolver tip, when the restack halts, then no child branch or closure ref has moved and the journal is `aborted`.
- Given a refused resolver tip and a failure writing the refused-tip ref, when the restack halts, then it still halts needs-human naming child 2 and the refused paths, and the HALT states that the refused tip could not be pinned.
- Given the conflict halt with a refused-tip ref, when the stale-resolution path retires the record or the feature's conductor refs are torn down, then the refused-tip ref is deleted with the conflict record and parent pin.
- Given an earlier refused-tip ref for `demo` and a later unresolved conflict on child 2 whose resolver did not settle, when the restack halts, then no refused-tip ref remains, and the `--tip` recipe starts from the base the shipped conflict halt uses.

### Done When
- [ ] An ownership-refused resolver result writes the shipped conflict record, parent pin and refused-tip ref, and a `Restack-Conflict` halt instead of a bare `replay-mismatch` halt.
- [ ] The refused-tip ref is deleted at every site that deletes the conflict parent pin.
- [ ] The HALT detail lists each refused path with its cause.

## Story 4: One rule for the resolver, the operator's tip and recovery

**Requirement:** #3598 outcome 4 (restack ADR decision 3 and operator-recorded resolution ADR decision 3 as amended)

As an operator, I want the same acceptance rule whether a resolution comes from the resolver, my `--tip`, or a resumed restack, so that a resolution accepted in one place is never refused in another.

### Acceptance Criteria

#### Happy Path
- Given the restack-conflict halt on child 2 and an operator tip that resolves `src/c.ts` and edits `tests/a.test.ts`, when the operator runs `ai-conductor stack restack-resolve --slug demo --child 2 --tip <sha>`, then the command exits 0 and `refs/conductor/demo/restack/resolution/c2` names `<sha>`.
- Given that recorded resolution, when the next restack consumes it, then it is accepted and `restack_applied` for child 2 lists `tests/a.test.ts` in `adaptedPaths`.
- Given a restack interrupted after child 2's resolver hand-off whose tip adapts `tests/a.test.ts`, when journal recovery resumes the restack and re-checks the tip, then the tip is accepted and `restack_applied` for child 2 lists `tests/a.test.ts` in `adaptedPaths`.

#### Negative Paths
- Given the restack-conflict halt on child 2 and an operator tip that deletes `tests/a.test.ts`, when the operator runs the command, then it exits non-zero naming `tests/a.test.ts` as a parent revert, writes no resolution ref, and leaves the HALT in place.
- Given the restack-conflict halt on child 2 and an operator tip that changes `src/other.ts`, when the operator runs the command, then it exits non-zero naming `src/other.ts` as unowned, writes no resolution ref, and leaves the HALT in place.
- Given journal recovery resuming a restack whose resolver tip for child 2 restores `tests/b.test.ts` to its old-parent content, when recovery checks the tip, then it takes the Story 3 refusal: the refused-tip ref, the conflict record and the restack-conflict halt naming `tests/b.test.ts` as a parent revert.

### Done When
- [ ] The resolver result and recorded-resolution checks in `runRestack`, the same two in journal recovery, and `stack restack-resolve --tip` all use one resolved-tip acceptance rule.
- [ ] A tip recorded by `stack restack-resolve --tip` is never refused at consumption when the child's range, recorded parent and tip are unchanged.
