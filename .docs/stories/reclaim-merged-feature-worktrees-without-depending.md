**Status:** Accepted

# Stories: Reclaim merged feature worktrees without depending on the mergeable watch registry

**Source:** jstoup111/ai-conductor#1510 (technical track — criteria derived from the technical
intent, adr-2026-08-01-multi-proof-park-deletion-authority D6–D8 and
adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main D8–D9 as amended 2026-09-14,
and architecture-review-2026-09-14-reclaim-merged-feature-worktrees-without-depending)

## Story 1: The reconciliation sweep enumerates every registered worktree

As an operator, I want the parked-feature reconciliation sweep to consider every git-registered
worktree under `.worktrees/` so that a merged worktree is reclaimable whether or not it was ever
parked or enrolled in the mergeable watch registry.

### Acceptance Criteria

#### Happy Path
- Given a checkout whose `git worktree list --porcelain` reports three worktrees directly under `.worktrees/` and no park markers, when the sweep runs, then all three are evaluated as candidates and the summary reports three candidates
- Given a checkout with one parked slug that has no worktree on disk and two registered worktrees that are not parked, when the sweep runs, then the candidate set is the union of the three and no slug appears twice
- Given a registered worktree at `.worktrees/hotfix-x` whose listed branch is `hotfix/x`, when the sweep builds its candidate for it, then the candidate carries slug `hotfix-x` and branch `hotfix/x` exactly as listed
- Given a checkout with no `.daemon/mergeable-watch.jsonl` at all, when the sweep runs, then candidates are still enumerated and the registry's absence is not logged as an error

#### Negative Paths
- Given a registered worktree at a nested path `.worktrees/feat/daemon-x`, when the sweep enumerates, then it is not treated as a candidate named `feat` and is retained with reason `invalid-slug`
- Given a plain directory under `.worktrees/` that `git worktree list` does not report, when the sweep enumerates, then it is not a candidate and nothing under that directory is removed
- Given a registered worktree outside `.worktrees/` (for example the project root or `.claude/worktrees/x`), when the sweep enumerates, then it is never a candidate
- Given `git worktree list --porcelain` fails, when the sweep runs, then every candidate for that pass is retained with reason `listing-unavailable` and no removal is attempted

### Done When
- [ ] A unit test with a scripted `git worktree list --porcelain` proves the candidate set is the union of parked slugs and depth-1 registered worktrees under `.worktrees/`, with the listed branch attached to each
- [ ] A unit test proves a nested path and an unregistered directory produce no removal and the named retention reasons
- [ ] A unit test proves a failed worktree listing retains every candidate with reason `listing-unavailable`

## Story 2: Non-reclaimable worktrees are retained with a named reason

As an operator, I want in-flight, halted, and foreign-lifecycle worktrees never touched by the
sweep so that automatic reclamation cannot destroy work I still need.

### Acceptance Criteria

#### Happy Path
- Given a candidate slug for which the sweep context reports `isFeatureInFlight` true, when the sweep evaluates it, then the guarded helper is not invoked for it and it is retained with reason `in-flight`
- Given a candidate whose directory name starts with `engineer-` or `resolve-`, when the sweep evaluates it, then the guarded helper is not invoked and it is retained with reason `foreign-lifecycle`
- Given a candidate whose worktree contains a live `.pipeline/HALT`, when the sweep evaluates it, then the guarded helper is not invoked and it is retained with reason `halted`
- Given a candidate whose slug fails the single-slug pattern, when the sweep evaluates it, then it is retained with reason `invalid-slug`

#### Negative Paths
- Given a candidate that is in flight and also carries every merge proof and a shipped record, when the sweep evaluates it, then it is still retained with reason `in-flight` and no path is removed
- Given a candidate whose `.pipeline/HALT` is unreadable for a reason other than absence, when the sweep evaluates it, then it is retained with reason `halted` rather than proceeding to the helper
- Given a candidate whose slug is operator-parked and whose park marker read throws, when the sweep evaluates it, then it is retained and no removal is attempted
- Given a sweep over N candidates of which exactly one is proven merged and eligible, when the sweep completes, then exactly one worktree path is removed and N-1 candidates are retained with named reasons

### Done When
- [ ] A unit test proves each of `in-flight`, `foreign-lifecycle`, `halted`, and `invalid-slug` short-circuits before the guarded helper is called
- [ ] A unit test proves the in-flight exclusion wins over full merge proof
- [ ] A unit test proves the single-removal property over a mixed candidate set

## Story 3: Merge proofs are keyed on the worktree's listed branch

As an operator, I want the guarded helper to prove merge status against the branch that actually
backs the worktree so that hand-named and daemon-named worktrees are both evaluated correctly.

### Acceptance Criteria

#### Happy Path
- Given a candidate at `.worktrees/hotfix-x` on branch `hotfix/x` that is an ancestor of `origin/main`, when the helper runs with that branch, then ancestry proves it merged without consulting `gh`
- Given a candidate at `.worktrees/<slug>` on branch `feat/daemon-<slug>` that is not an ancestor but whose MERGED PR `headRefOid` equals the branch tip, when the helper runs with that branch, then head identity proves it merged
- Given a candidate whose listed branch is proven merged, when the helper completes, then the proven branch is the one deleted, not a branch that merely shares the slug's final path segment

#### Negative Paths
- Given a candidate whose listed branch is not an ancestor and has no merged PR, when the helper runs, then it refuses with `no-merge-proof` and nothing is removed
- Given a candidate whose listed branch has advanced past its merged PR head, when the helper runs, then it refuses with `unmerged-commits` naming the dropped commits and nothing is removed
- Given a candidate whose listed branch no longer exists locally and no shipped record is on `origin/main`, when the helper runs, then it refuses with `branch-missing` and nothing is removed
- Given `gh` reports a capability error while proving head identity, when the helper runs, then it refuses with `no-merge-proof` and nothing is removed

### Done When
- [ ] A unit test proves `hotfix-x`/`hotfix/x` and `<slug>`/`feat/daemon-<slug>` both reach a proof via the listed branch, where the pre-change slug-segment lookup found no branch
- [ ] A unit test proves each refusal reason in this story leaves every path and branch untouched

## Story 4: The shipped-record precondition applies only to daemon branches

As an operator, I want a merged hotfix or spec worktree reclaimed on merge proof alone so that the
bulk of the leak is reclaimed, while daemon feature worktrees still wait for their shipped record.

### Acceptance Criteria

#### Happy Path
- Given a proven-merged candidate on branch `feat/daemon-<slug>` with `.docs/shipped/<slug>.md` on `origin/main`, when the helper runs, then the worktree is reclaimed
- Given a proven-merged candidate on branch `hotfix/x` with no shipped record on `origin/main`, when the helper runs, then the worktree is reclaimed
- Given a proven-merged candidate on branch `spec/<slug>` with no shipped record, when the helper runs, then the worktree is reclaimed and no record repair is requested

#### Negative Paths
- Given a proven-merged candidate on branch `feat/daemon-<slug>` with no shipped record on `origin/main`, when the helper runs, then it refuses with `record-missing`, defers, and requests record repair exactly as before
- Given a candidate on branch `hotfix/x` with no merge proof and no shipped record, when the helper runs, then the absence of the record requirement does not make it reclaimable and it refuses with `no-merge-proof`
- Given the `origin/main:.docs/shipped` listing cannot be read, when the helper evaluates a `feat/daemon-*` candidate, then it refuses with `ancestry-check-failed` rather than treating the record as absent

### Done When
- [ ] A unit test proves the record precondition gates `feat/daemon-*` candidates and does not gate other branch kinds
- [ ] A unit test proves a non-daemon candidate without merge proof is still refused
- [ ] The existing parked-feature record-missing deferral tests pass unchanged

## Story 5: Reclamation runs through the guarded helper one slug at a time

As an operator, I want every removal to be the existing guarded single-slug operation so that the
enumerated set is never itself the unit of deletion.

### Acceptance Criteria

#### Happy Path
- Given a proven, eligible candidate, when the sweep reclaims it, then project teardown runs on the worktree path before `git worktree remove --force` of that single path
- Given a proven, eligible candidate that is not parked, when the helper completes, then it reports reconciled without attempting an unpark
- Given a proven, eligible candidate that is parked, when the helper completes, then the park marker is removed last, as today
- Given two proven, eligible candidates, when the sweep reclaims them, then two separate helper invocations occur, each with exactly one slug

#### Negative Paths
- Given a candidate whose `git worktree remove` fails on a path git owns, when the helper runs, then it refuses with `worktree-remove-failed` and the branch is not deleted
- Given a candidate whose branch deletion fails after the worktree was removed, when the helper runs, then it refuses with `branch-delete-failed` and the outcome is reported as failed, not reclaimed
- Given the helper is invoked with a list or a glob instead of one slug, when it validates input, then it refuses with `invalid-slug` before any evidence is gathered
- Given a candidate whose evidence was classified merged by the sweep but changes before the helper re-derives it, when the helper runs, then the helper's own re-derived evidence decides and the stale classification is not trusted

### Done When
- [ ] A unit test proves a non-parked reclaim reports reconciled with no unpark step and a parked reclaim keeps its unpark step
- [ ] A unit test proves each helper refusal in this story maps to the correct outcome and leaves the remaining state intact
- [ ] The existing single-slug input validation tests pass unchanged

## Story 6: Reclaim outcomes ride the event spine

As an operator, I want each reclaim, retention, and failure recorded as a typed event so that the
daemon's ledger, not a worktree that no longer exists, holds the durable record of why each worktree
was reclaimed or kept.

### Acceptance Criteria

#### Happy Path
- Given a candidate is reclaimed, when the sweep completes it, then a `worktree_reclaim_reclaimed` event carrying the slug, branch, and proof kind is emitted on the daemon's emitter
- Given a candidate is retained, when the sweep completes it, then a `worktree_reclaim_retained` event carrying the slug and a closed-union reason is emitted
- Given a removal or branch deletion fails, when the sweep completes it, then a `worktree_reclaim_failed` event carrying the slug and the refusal is emitted
- Given the three variants exist, when the sink registry is read, then each has a declaration with `persist: true`, `retained` has `render: false`, and `reclaimed` and `failed` have `render: true`

#### Negative Paths
- Given a `worktree_reclaim_retained` event, when the daemon renders its log, then no per-slug line is printed for it and the sweep's existing summary line still reports counts
- Given a new `ConductorEvent` variant is added without a sink declaration, when the exhaustiveness guard runs, then it fails naming the variant
- Given the emitter is absent (no root emitter injected), when the sweep runs, then it completes without throwing and the summary line is still logged
- Given a reclaim removes the worktree, when the pass completes, then the reclaim event is present in the daemon-root ledger even though the worktree's own `.pipeline/events.jsonl` no longer exists

### Done When
- [ ] The union carries the three variants at its end with closed-union `reason` fields, and `EVENT_SINKS` declares each with the stated render and persist values
- [ ] A unit test proves each of reclaimed, retained, and failed emits exactly one event with the expected fields
- [ ] A unit test proves the sweep tolerates a missing emitter

## Story 7: The widened path is gated by its own config key

As an operator, I want a single boolean to turn the enumerated reclamation on or off so that a
consumer can observe a report-only first pass before allowing removals.

### Acceptance Criteria

#### Happy Path
- Given `reclaim_merged_worktrees` is absent from config, when the daemon reads its config, then the enumerated path is enabled
- Given `reclaim_merged_worktrees: true`, when the sweep runs, then enumerated candidates are evaluated and eligible ones are reclaimed
- Given `reclaim_merged_worktrees: false`, when the sweep runs, then enumerated candidates are evaluated and every eligible one is retained with reason `disabled` and emitted, and none is removed

#### Negative Paths
- Given `reclaim_merged_worktrees: "yes"` (a non-boolean), when config validation runs, then it returns an error naming the key and the daemon does not start
- Given `reclaim_merged_worktrees: false` and `reconcile_parked_auto_cleanup: true`, when the sweep runs, then parked merged slugs are still reclaimed exactly as today and only the enumerated non-parked candidates are held
- Given the key is added to the documented key list, when the config-key consumer registry test runs, then it fails unless the key declares its consumer

### Done When
- [ ] `config.ts` validates the key as a boolean defaulting to `true`, and the consumer registry declares its consumer
- [ ] A unit test proves `false` evaluates candidates, emits `disabled` retentions, and removes nothing
- [ ] A unit test proves `false` leaves the parked path's behavior unchanged

## Story 8: Existing parked-feature reconciliation is preserved

As an operator, I want the parked-only behavior of the sweep to be unchanged so that widening the
candidate set adds reclamation without altering what already worked.

### Acceptance Criteria

#### Happy Path
- Given only parked slugs on `feat/daemon-*` branches and no registered worktrees beyond them, when the sweep runs, then classifications, counts, refusal breakdown, and the de-duplicated summary line are identical to the pre-change behavior
- Given a parked slug that is orphaned (closed source issue, not merged), when the sweep runs, then it is annotated `orphan` and never deleted, as today

#### Negative Paths
- Given the record listing is unreadable, when the sweep runs over parked slugs, then each is classified `unclassified` and no removal occurs, as today
- Given a parked slug whose worktree was already removed by the enumerated path in the same pass, when the parked classification reaches it, then it is not evaluated a second time and is not double-counted

### Done When
- [ ] The existing `park-reconciliation` test suites pass unchanged apart from fixtures that now supply a worktree listing and the record-missing case re-pinned to a `feat/daemon-*` branch
- [ ] A unit test proves a slug present both as parked and as a registered worktree is evaluated once
