**Status:** Accepted

# Stories: Routed audit fixes run on the leaf and fold onto their owners once, before publish (#3653)

Technical track; no PRD. The acceptance criteria come from three sources:
- #3653's desired outcomes;
- the operator-confirmed scope in `.docs/track/late-gate-fixes-restack-the-whole-stack-every-repa.md`;
- `adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish` (cited below as "the fold ADR").

**The example stack.** A five-child stacked feature `demo` with `stacked_prs.fold_routed_fixes`
unset (default on) and routing eligible:
- Child 1 first adds `src/server/identity.ts`, which exports `startPlaying(name)`.
- Child 3 first adds `tests/load/ten-players.ts`, which calls `startPlaying(name)`.
- Child 5 is the leaf, `feat/daemon-demo`.

**Terms.**
- "Host k" is child k's entry in an audit round.
- A host's "boundary range" is the leaf's first-parent commits between that host's recorded entry
  tip and exit tip.
- "The fold" is the `fold`-cause restack the FINISH `rebase` step runs.

## Story 1: An audit round's hosts build on the leaf, and the round restacks nothing

**Requirement:** Desired outcome 1; the fold ADR decisions 2, 3 and 5

As an operator, I want each host in a routed audit round to build its fix on the leaf branch, so that a repair round never restacks the children above its hosts.

### Acceptance Criteria

#### Happy Path
- Given a `prd_audit` FIXABLE finding bound to a child 1 task, when the audit round is admitted, then the route record names child 1 as owner and host, the host entry and the repair marker carry `execution: 'leaf'`, and the leaf branch stays checked out.
- Given host 1 is admitted with `execution: 'leaf'`, when its region is entered, then the frozen rem blocks are committed to the leaf's copy of `.docs/plans/demo.md`, and host 1's `acceptance_specs`, `build`, `test_suite` and `build_review` are restaged in child 1's region state.
- Given host 1's region passes on the leaf, when its routed exit runs, then host 1 is marked `done` with `placement: 'deferred'` and its exit tip recorded, the marker is deleted, and no `restack_planned` event is emitted.
- Given a round with hosts 1, 3 and the leaf, when the round runs to `closed`, then the hosts run in that order on the leaf, the leaf's whole-feature gates are re-pended once, and zero restacks are planned during the round.
- Given four audit rounds run before the gates converge, when the feature reaches the FINISH `rebase` step, then the feature has planned zero `feature-repair` restacks for audit hosts.
- Given host 1 is admitted with an `existing-task` item for task T1, when a leaf commit stamped `Task: T1` lands during host 1's region, then the repair obligation, whose boundary branch is the leaf, is resolved.
- Given host 1 executes on the leaf, when a tracked commit is made on `feat/daemon-demo`, then the stack-commit guard admits it.

#### Negative Paths
- Given host 1 executes on the leaf, when its builder returns `blocked-by-prerequisite` naming child 3, then no reroute happens, the claim counts as one failed build attempt under host 1's region caps, and the round stays on host 1.
- Given a round whose only host is the leaf, when its region passes, then the leaf host is marked `done` without `placement: 'deferred'`, and it is never part of a later fold.
- Given host 1's region entry is interrupted after the frozen-block commit, when the feature resumes, then region entry continues on the leaf without writing the blocks a second time, and no child branch is checked out.
- Given host 1's `build_review` runs on the leaf, when it grades the repair, then its base is the leaf tip pinned at host 1's region entry, and child 1's earlier reviewed work is not re-graded.
- Given an audit round is open, when the stack preflight runs, then no automatic `feature-repair` restack runs for any closed child.
- Given host 1 is repairing on the leaf and `closed/c1` still equals the closure recorded at host 1's entry, when the stack preflight runs, then no hand-moved-closure halt is written, even though the leaf entry tip differs from `closed/c1`.
- Given host 1 is repairing on the leaf and `closed/c1` was moved by hand, when the stack preflight runs, then it halts needs-human naming child 1, as today.
- Given host 1 executes on the leaf, when a tracked commit is attempted on `feat/c1/demo`, then the stack-commit guard refuses it, and the refusal names `feat/daemon-demo` as the branch to use.
- Given an operator commits a tracked file on the leaf during host 1's region, when the commit is made, then it carries `Owner: c1` and is folded with host 1's work.
- Given host 2 executes on the leaf and its region ends with no commit in its boundary range, when its exit runs, then host 2 is marked `done` with no placement and is not part of any fold.
- Given host 2 committed only its frozen blocks, when its exit runs, then host 2 is marked `done` with `placement: 'deferred'`.
- Given child 1 has a revalidation queue entry when it becomes leaf-executed host 1, when host 1 exits, then the entry stays queued and is consumed as a `revalidate` round on child 1's own branch.

### Done When
- [ ] A round-admission test asserts `execution: 'leaf'` on the host entry and the marker for an eligible audit round.
- [ ] A host-region-entry test asserts that the leaf branch remains checked out, that the blocks land in the leaf's plan copy, and that child 1's region steps are pending.
- [ ] A routed-exit test asserts `placement: 'deferred'`, the recorded exit tip, and no `runRestack` call for a leaf-executed host.
- [ ] A conductor routing test over a two-host round records no `restack_planned` event before the round closes.
- [ ] Stack-preflight and commit-guard tests assert the recorded-closure comparison and the leaf-admitting guard under `execution: 'leaf'`.

## Story 2: Every commit a leaf-executed host makes is engine-stamped with its round and owner

**Requirement:** Desired outcome 4; the fold ADR decision 4

As an operator, I want the engine, not the builder, to record which child owns each fix commit, so that placement cannot be forged or silently lost.

### Acceptance Criteria

#### Happy Path
- Given host 1's marker carries `execution: 'leaf'`, when a commit is made on the leaf, then its message carries `Round: <roundId>` and `Owner: c1`.
- Given a leaf host's marker carries `execution: 'leaf'`, when a commit is made on the leaf, then its message carries `Owner: leaf`.
- Given host 1's region entry commits the frozen blocks, when the commit is inspected, then it carries the same `Round:` and `Owner: c1` trailers.

#### Negative Paths
- Given a builder writes `Owner: c3` and `Round: r9` into its own commit message while host 1's marker is set, when the commit is made, then both trailers are replaced with the marker's `Round:` and `Owner: c1`.
- Given the round stamp cannot read the marker while it carries `execution: 'leaf'`, when a commit is attempted on the leaf, then the commit is rejected and no unstamped commit is created.
- Given the repository's own chained commit hook strips the `Owner:` trailer, when a commit is attempted on the leaf during host 1's region, then the commit-msg check rejects it.
- Given no marker exists, or the marker's round is an `operator` or `revalidate` round, when a commit is made, then no `Owner:` trailer is added, and `Round:` stamping behaves as today.

### Done When
- [ ] A round-stamp test asserts replacement of builder-supplied `Owner:` and `Round:` under a leaf-executed marker.
- [ ] A hook test asserts that a leaf commit lacking the marker's trailers is rejected while the marker carries `execution: 'leaf'`.
- [ ] A hook test asserts that no `Owner:` is stamped for an `operator` round marker.

## Story 3: The fold places every fix in its owning child's PR, once

**Requirement:** Desired outcomes 1, 2 and 4; the fold ADR decisions 6, 7, 8 and 11

As a reviewer, I want each child's PR to contain the fixes that child owns by the time the stack is published, so that child N's PR shows child N's work complete.

### Acceptance Criteria

#### Happy Path
- Given host 1 is `deferred` with one commit changing `startPlaying(name)` to `startPlaying(name, secret)` in `src/server/identity.ts` and updating `tests/load/ten-players.ts`, when the FINISH `rebase` step runs, then one `fold` restack places the `identity.ts` hunk on child 1 and the `ten-players.ts` hunk on child 3, with reason `introduced-above-owner`.
- Given the fold applies, when each placed commit is inspected, then it keeps the source commit's author and message and carries `Folded-from: <source sha>`.
- Given the fold applies, when the stack is inspected, then the leaf branch no longer contains the folded source commits, and child 1's and child 3's closure refs point at their new tips.
- Given the fold applies, when `fold_planned` is read from `.pipeline/events.jsonl`, then it lists each source commit with its round, its owner, and each placed part's child, paths and reason.
- Given host 1's boundary range contains an empty `tdd` evidence commit, when the fold applies, then that commit is placed on child 1 and remains empty.
- Given hosts from rounds r1 to r4 are all `deferred`, when the FINISH `rebase` step runs, then exactly one `fold` restack is planned for all of them.

#### Negative Paths
- Given the fold applies, when the route records are read, then every folded host carries `placement: 'placed'`, and a second run of the `rebase` step plans no fold.
- Given the leaf has its own build commits and an operator commit outside every boundary range, when the fold applies, then those commits stay on the leaf.
- Given no host is `deferred`, when the FINISH `rebase` step runs, then no fold is planned, and the step's base refresh runs exactly as today.
- Given a host is `deferred`, when publication is attempted without a fold, then `establishChildPrs` refuses with a needs-human halt naming the deferred host, and no child PR is created.
- Given an interactive (non-daemon) run with a `deferred` host, when the `rebase` step runs, then the fold runs before the step's interactive `noop` return.
- Given the fold's journal is written and the process stops before the move, when the feature resumes, then journal recovery completes or aborts the fold with every branch either fully moved or untouched.

### Done When
- [ ] A fold-planner test over the three-child fixture asserts the per-hunk placement and the `introduced-above-owner` reason.
- [ ] A restack-executor test asserts `Folded-from:`, preserved authorship, moved closure refs, and route records marked `placed` in the `applied` transaction.
- [ ] A conductor test asserts that the interactive `rebase` step folds, and that `establishChildPrs` refuses while a host is `deferred`.
- [ ] An event test asserts the `fold_planned` payload shape.

## Story 4: A fix that cannot be placed on its owner halts with the fix and child named, and nothing moves

**Requirement:** Desired outcome 5; the fold ADR decisions 7 and 9

As an operator, I want a fold that cannot place a fix correctly to stop and tell me which fix and which child, so that no fix is ever silently left in a higher PR.

### Acceptance Criteria

#### Happy Path
- Given every deferred host's boundary range carries correct trailers and at least one part placeable on its placement child, when the fold is planned, then no fold halt is written.
- Given the fold's staged leaf tree equals the pre-fold leaf tree, when the fold is accepted, then the move transaction runs.

#### Negative Paths
- Given host 2's boundary range holds only hunks that child 2's tree does not accept and that child 4 does, when the fold is planned, then it halts needs-human with reason `fold-misrouted`, naming host 2, its finding ids and child 4, and no branch or closure ref moves.
- Given a commit inside host 1's boundary range carries `Owner: c2`, when the fold is planned, then it halts needs-human with reason `fold-owner-invalid`, naming the commit and host 1, and nothing moves.
- Given a merge commit lies inside host 1's boundary range, when the fold is planned, then it halts needs-human with reason `fold-owner-invalid`, naming the merge commit.
- Given the resolver's output makes the staged leaf tree differ from the pre-fold leaf tree in `src/server/identity.ts`, when the fold is checked, then `restack_refused` is emitted with reason `fold-tree-mismatch`, the halt names `src/server/identity.ts` and the source commits that touched it, and no ref moves.
- Given the resolver cannot resolve a conflict replaying child 4 onto child 3's placed tip, when the fold runs, then it halts as an unresolved restack conflict naming child 4, and no ref moves.
- Given child 1 has reached its cascade cap, when the fold would place fixes on child 1, then the fold halts with the existing cap evidence naming child 1, before any journal is written.

### Done When
- [ ] Fold-planner tests assert the `fold-misrouted` and `fold-owner-invalid` halts with their named fields and an unchanged ref set.
- [ ] A restack-executor test asserts the `fold-tree-mismatch` refusal names the differing paths, and that branches and closure refs are unmoved.

## Story 5: Every child the fold changed re-validates once before publish

**Requirement:** Desired outcome 3; the fold ADR decision 9

As a reviewer, I want each child to pass its own gates after the fold, so that a child that only works because of a higher child's code never reaches review.

### Acceptance Criteria

#### Happy Path
- Given the fold placed parts on children 1 and 3, when its `applied` transaction commits, then one revalidation generation queues children 1, 2, 3 and 4, and the leaf is not queued.
- Given the queue holds children 1 to 4, when the `rebase` step continues in the same run, then the shared admission helper admits child 1's `revalidate` round on child 1's branch.
- Given each queued child's acceptance verify-green, `test_suite` and `build_review` pass, when the queue drains, then each child has exactly one `child_revalidated` event for the fold's generation.

#### Negative Paths
- Given child 1's `test_suite` fails after the fold because the placed fix needs a symbol only child 3 defines, when child 1 is re-validated, then the failure becomes a kickback in child 1's region under its caps, and its fix exits through a `feature-repair` restack.
- Given child 1's revalidate builder returns `blocked-by-prerequisite` naming child 3, and the claim verifies, when it is handled, then the feature halts needs-human naming the `Folded-from` commit, child 1 and child 3, and no reroute moves the fix upward.
- Given child 2 exhausts its region caps during fold re-validation, when the cap is reached, then the feature halts with the existing cap halt naming child 2, and publication does not start.
- Given the queue is non-empty after the fold, when a base refresh is due, then it is deferred with `restack_refused` reason `deferred-base-refresh`.

### Done When
- [ ] A restack-transition test asserts the queue generation written by a fold names every changed non-leaf child.
- [ ] A conductor test asserts that the `rebase` step admits the lowest queued child in the same run after a fold.
- [ ] A routing test asserts that a verified prerequisite claim in a fold-produced revalidate round halts with the three named fields.

## Story 6: The leaf keeps its whole-feature verdicts through the fold, and the stack then publishes

**Requirement:** Desired outcomes 1 and 2; the fold ADR decisions 9 and 10

As an operator, I want the whole-feature gates the leaf already passed to stand after a fold that changed nothing on the leaf, so that folding does not trigger another audit round.

### Acceptance Criteria

#### Happy Path
- Given the fold left the leaf tree unchanged and fold re-validation committed nothing, when the queue drains, then `returnToLeaf` runs in `fold` mode, re-pends no whole-feature gate, and navigates to the `rebase` step.
- Given the `rebase` step runs again with no host `deferred`, when it completes, then it runs the deferred base refresh, and publication creates child PRs whose branches contain the folded fixes.

#### Negative Paths
- Given child 2's fold re-validation committed a fix that moved the leaf tree, when the queue drains, then `prd_audit`, `architecture_review_as_built` and `manual_test` re-pend on the leaf as today.
- Given those re-run gates open a new audit round, when it closes and the `rebase` step runs, then that round's deferred hosts are folded in a second `fold` restack, and the hosts folded earlier are not.
- Given an `operator` round was abandoned, when it returns to the leaf, then the existing `abandon` mode applies unchanged.

### Done When
- [ ] A routed-exit test asserts that `fold` mode skips `restageLeafGates` when the leaf tree matches the fold's recorded tree, and re-pends otherwise.
- [ ] A conductor test asserts that navigation resumes at `rebase` after a fold-mode leaf return.

## Story 7: Restack spend is attributed per round and per fold, in OTel and the shipped record

**Requirement:** Desired outcome 6; the fold ADR decision 11

As an operator, I want restack resolver spend broken down by round and by fold, so that I can measure the reduction against the $68.55, 33-run baseline.

### Acceptance Criteria

#### Happy Path
- Given the fold's restack invokes the conflict resolver, when its `provider_attempt` is persisted, then the event carries `restack: {opId, cause: 'fold'}` matching the fold's `restack_planned.opId`.
- Given a revalidation repair's `feature-repair` restack in round r5 invokes the resolver, when its `provider_attempt` is persisted, then it carries `restack: {opId, cause: 'feature-repair', roundId: 'r5'}`, and `restack_planned` carries `roundId: 'r5'`.
- Given OTel export is enabled, when a resolver attempt is recorded, then its span carries `conductor.restack.op_id`, `conductor.restack.cause` and `conductor.round` when a round applies, and the feature step cost metric carries the `restack_cause` dimension.
- Given a stacked feature ships, when its shipped record is written, then a `## Restack` block lists one row per round and per fold or base-refresh operation, with resolver runs and cost, plus an `unattributed` row.

#### Negative Paths
- Given a resolver `provider_attempt` was recorded before this change with no `restack` field, when the shipped record is written, then its cost appears in the `unattributed` row, and the block's rows sum to the feature's rebase-step cost.
- Given OTel export is enabled, when restack metrics are recorded, then no metric data point carries a round id or an opId as a label.
- Given an N=1 feature ships, when its shipped record is written, then it carries no `## Restack` block and is otherwise byte-identical to today.
- Given a stacked feature planned no restack, when its shipped record is written, then the `## Restack` block shows zero resolver runs and zero cost rather than being omitted.
- Given a stacked feature's shipped record has a `## Children` block, when the `## Restack` block is written, then it follows `## Children`; with no `## Children` block, it follows `## Time`.
- Given a shipped record carries a `## Restack` block, when the kpi reader computes the feature's cost, then it reads only the `## Cost` block and no `## Restack` row.

### Done When
- [ ] A step-runner test asserts the resolver dispatch passes an execution context carrying the restack opId, cause and round.
- [ ] An OTel span-manager test asserts the three span attributes, and a metrics test asserts the bounded `restack_cause` dimension with no round label.
- [ ] A shipped-record test asserts the `## Restack` rows, the `unattributed` row and the sum.

## Story 8: The fold is scoped to audit rounds, frozen per round, and switchable off

**Requirement:** Operator scope boundary; the fold ADR decision 1

As an operator, I want leaf execution and the fold limited to audit rounds and controlled by one setting, so that operator rounds, revalidate rounds and unstacked features keep today's behaviour.

### Acceptance Criteria

#### Happy Path
- Given `stacked_prs.fold_routed_fixes` is unset, when an eligible audit round is admitted, then its hosts are recorded with `execution: 'leaf'`.
- Given `stacked_prs.fold_routed_fixes: false`, when an audit round is admitted, then its hosts execute on their own branches and exit through `feature-repair` restacks exactly as before this change.

#### Negative Paths
- Given an `operator` round from `stack land`, when it is admitted, then its host executes on the closed child's own branch whatever the setting.
- Given a `revalidate` round, when it is admitted, then it executes on the queued child's own branch whatever the setting.
- Given an N=1 feature, when the FINISH `rebase` step runs, then no route, marker, revalidate or fold ref is read or written, and the #3019 golden suite stays byte-identical.
- Given a round was admitted with the setting on, and the operator then sets it `false`, when that round's hosts run and the `rebase` step is reached, then the hosts still execute on the leaf and their deferred placements are still folded.
- Given `stacked_prs.fold_routed_fixes` holds a non-boolean value, when config loads, then it is rejected with a config error naming the key.
- Given round r2 has host 1 `deferred`, when `ai-conductor stack rounds --slug demo` runs, then it lists host 1 with execution `leaf` and placement `deferred`.
- Given round r2's only unsettled host is `deferred`, when `stack rounds --close r2 --reason <text>` runs, then the close treats host 1 as settled, host 1 keeps `placement: 'deferred'`, and the next `rebase` step still folds it.

### Done When
- [ ] A config test asserts the default `true`, the `false` path, and the rejection of a non-boolean value.
- [ ] A round-admission test asserts that `operator` and `revalidate` rounds never record `execution: 'leaf'`.
- [ ] The N=1 golden suite guard asserts no `fold` cause and no route refs.

## Story 9: Deferred placements survive other restacks until the fold

**Requirement:** Desired outcomes 2 and 5; the fold ADR decisions 6 and 12

As an operator, I want fixes waiting to be folded to stay correctly attributed when something else rewrites the leaf, so that a base refresh or an operator landing between rounds cannot strand or misplace them.

### Acceptance Criteria

#### Happy Path
- Given host 1 is `deferred` and no round is open, when a daemon re-kick requests a base refresh, then no ref moves and `restack_refused` is emitted with reason `deferred-base-refresh`.
- Given host 1 is `deferred`, when an operator round from `stack land` on child 2 restacks the leaf, then its `applied` transaction rewrites host 1's entry and exit tips to the leaf's new commits through the journal's commit map.
- Given host 1's tips were remapped, when the fold runs, then host 1's boundary range is exactly host 1's replayed commits, and they are placed as if no restack had run.
- Given the fold has applied and no host is `deferred`, when the `rebase` step runs, then the deferred base refresh runs.

#### Negative Paths
- Given host 1 is `deferred` and a restack drops host 1's exit-tip commit as empty, when that restack plans its `applied` transaction, then it halts needs-human with reason `fold-boundary-lost` naming host 1, and no ref moves.
- Given host 1 is `deferred`, when a restack's `applied` transaction loses the route record's compare-and-swap to another writer, then the restack rolls back and halts as the existing contested-writer path does, leaving host 1's tips unchanged.
- Given no host is `deferred`, when a base refresh is requested with no round open and an empty queue, then it runs exactly as today.

### Done When
- [ ] A restack-executor test asserts that the deferred hosts' tips are remapped in the `applied` transaction of a `feature-repair` restack that replays the leaf.
- [ ] A stack-preflight test asserts the `deferred-base-refresh` refusal while a host is `deferred`.
- [ ] A restack test asserts the `fold-boundary-lost` halt and an unchanged ref set.

