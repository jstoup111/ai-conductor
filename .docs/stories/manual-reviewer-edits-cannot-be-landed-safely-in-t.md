**Status:** Accepted

# Stories: Land manual changes in the stacked child that owns them, and rewind closed children (#3203)

Technical track (no PRD). Sources:
- the scope boundary in `.docs/track/manual-reviewer-edits-cannot-be-landed-safely-in-t.md`;
- `adr-2026-10-24-operator-route-round-for-closed-stacked-children` decisions 1–19;
- the conditions of `architecture-review-2026-10-24-manual-reviewer-edits-cannot-be-landed-safely-in-t`.

Terms used below:
- **Three-child stack:** a feature with slug `demo` whose sealed plan declares slices at positions
  `1`, `2` and `3`, with `stacked_prs.enabled` and `stacked_prs.route_whole_feature_fixes` on.
  - `feat/c1/demo` and `feat/c2/demo` are closed at `refs/conductor/demo/closed/c1` and `closed/c2`,
    each with a `refs/conductor/demo/red/c<k>` verify-green contract.
  - The leaf `feat/daemon-demo` (position 3) is checked out in the clean feature worktree
    `.worktrees/demo`.
  - No route round, re-validation queue entry, restack journal or publication record exists, and
    no work is running.
- **Landing on child 1:** the operator round that
  `ai-conductor stack land --slug demo --child 1 --reason "rename the flag the reviewer asked for"`
  opens on the three-child stack.
- **Flat feature:** a feature with no child branch, closure ref or `.pipeline/children/`
  directory.
- **Live dispatch:** a daemon dispatch, re-kick or interactive conductor run of `demo` whose
  process is alive and holds the feature dispatch lease.

## Story 1: A landing opens on the closed child that owns the change

**Requirement:** #3203 outcome 1 (ADR decisions 1, 4 and 5)

As an operator or agent with a reviewer's change for a closed child, I want one command to open that child for editing, so that I never hand-edit branches or engine state.

### Acceptance Criteria

#### Happy Path
- Given the three-child stack, when the operator runs `ai-conductor stack land --slug demo --child 1 --reason "rename the flag the reviewer asked for"`, then the command exits 0, the feature worktree is on `feat/c1/demo`, `refs/conductor/demo/repairing` names host 1, the open route record has kind `operator`, origin `land` and the given reason, and child 1's region shows `acceptance_specs`, `test_suite` and `build_review` pending with `build` done.
- Given the three-child stack whose `feat/c1/demo` already carries two commits past its closure, when the operator opens a landing on child 1, then the command exits 0, carries both commits into the round, and the round's pinned review base is child 1's closure, not the branch tip.
- Given the three-child stack whose child 1 owns no acceptance criteria and has no `red/c1` ref, when the operator opens a landing on child 1, then the command exits 0 and child 1's later verify-green pass is vacuous.
- Given the three-child stack and no live lease owner, when the operator opens a landing on child 1, then `stack land` holds the feature dispatch lease until its last mutation and releases it before exiting, while the park stays.
- Given a landing on child 1 that crashed after its marker transaction and before the worktree switched, when the operator re-runs the same `stack land --child 1` command, then it completes the switch, the entry pin and the restage once each, exits 0, and the feature still has exactly one open route record.

#### Negative Paths
- Given the three-child stack with an active publication record, when the operator runs `stack land --child 1`, then it exits non-zero naming `published-stack` and #3268, and no ref, park marker or state file changes.
- Given the three-child stack, when the operator runs `stack land --child 3`, then it exits non-zero naming child 3 as the leaf; and when the operator names a position the plan does not declare, then it exits non-zero naming the declared positions `1`, `2` and `3`.
- Given a flat feature, when the operator runs `stack land --child 1`, then it exits non-zero naming the feature as not stacked, and no routing ref or lease is read or written.
- Given the three-child stack with `stacked_prs.route_whole_feature_fixes: false`, when the operator runs `stack land --child 1`, then it exits non-zero naming that setting.
- Given the three-child stack with an open `audit` round, a non-empty re-validation queue, or a non-terminal restack journal, when the operator runs `stack land --child 1`, then it exits non-zero naming which of the three is open, and the existing round, queue and journal are unchanged.
- Given the three-child stack whose feature worktree has an uncommitted change to a tracked file, when the operator runs `stack land --child 1`, then it exits non-zero naming the dirty worktree, and the worktree stays on `feat/daemon-demo` with the change intact.
- Given the three-child stack, when the operator runs `stack land --child 1` with an empty or whitespace-only `--reason`, then it exits non-zero naming the missing reason.
- Given the three-child stack whose child 1 owns acceptance criteria but has neither `refs/conductor/demo/red/c1` nor `.pipeline/children/1/acceptance-specs-run.json`, when the operator runs `stack land --child 1`, then it exits non-zero naming the missing verify-green contract.
- Given a live dispatch of `demo`, when the operator runs `stack land --child 1`, then it exits non-zero naming the lease owner's purpose and pid, and no ref, park marker or state file changes.
- Given a lease owner record that cannot be parsed, when the operator runs `stack land --child 1`, then it exits non-zero naming the unreadable lease and does not reclaim it.
- Given a process carrying `CONDUCT_DAEMON_SESSION=1`, when it runs `stack land --child 1`, then the command is refused as not sanctioned in a daemon session, and nothing changes.
- Given the three-child stack whose `feat/c2/demo` carries a commit past its closure, when the operator runs `stack land --child 1` without `--carry 2`, then it exits non-zero naming child 2 and the command `ai-conductor stack land --slug demo --child 1 --carry 2 --reason "<why>"`.
- Given the three-child stack whose `feat/c1/demo` carries a commit past its closure, when the operator runs `stack land --child 2 --carry 1`, then it exits non-zero, because an carried child must sit above the host, and names `stack land --child 1 --carry 2`.

### Done When
- [ ] A real-git test opens a landing on child 1 of a three-child stack and asserts the checked-out branch, the marker host, the route record's kind, origin and reason, and child 1's region statuses.
- [ ] A test per refusal asserts its exit code, its named cause, and that refs, the park marker and state files are byte-identical before and after.

## Story 2: A feature dispatch lease keeps the daemon and operator commands apart

**Requirement:** #3203 outcome 6 (ADR decision 2)

As an operator, I want an operator command and a dispatch never to mutate the same stacked feature at once, so that a landing never races the daemon's own git work in the same worktree.

### Acceptance Criteria

#### Happy Path
- Given the three-child stack, when the daemon dispatches `demo`, then the dispatch acquires the feature dispatch lease before preparing the worktree and releases it when the unit ends, and the lease owner record names the dispatching process's pid, start time and purpose.
- Given the three-child stack and no live lease owner, when an operator command acquires the feature dispatch lease, then it holds the lease until it releases it, and the owner record names the command's pid, start time and purpose.
- Given a lease whose owner pid no longer exists, or whose pid now has a different process start time, when the next dispatch or operator command needs the lease, then it reclaims the lease and proceeds.

#### Negative Paths
- Given a live dispatch of `demo`, when an operator command requests the feature dispatch lease, then the request is refused naming the owner's purpose and pid, and the lease owner record is unchanged.
- Given an operator command holds the lease, when the daemon tries to dispatch `demo`, then the dispatch does not acquire the lease, skips the unit without writing a HALT, and leaves the worktree untouched.
- Given a daemon dispatch or re-kick that acquires the lease and then finds `.daemon/parked/demo` present, when it re-checks the park, then it releases the lease and skips the unit without preparing the worktree or writing a HALT.
- Given `.daemon/parked/demo` present and no live lease owner, when the operator starts an interactive conductor run on `demo`, then the run acquires the lease and proceeds without consulting the park marker, exactly as interactive runs do today.
- Given a live dispatch of `demo`, when the operator starts an interactive conductor run on `demo`, then the run refuses to start, naming the lease owner.
- Given a lease owner record that cannot be parsed, when the lease is requested, then the request returns an unreadable-owner refusal naming the lease and does not reclaim it.
- Given each enumerated dispatch path (daemon dispatch, daemon re-kick, and the interactive conductor run on a stacked feature), when it starts a unit for `demo`, then the lease is acquired before its first mutation, which a per-path test asserts against worktree preparation.
- Given a flat feature, when it is dispatched, then no lease directory is read or written.

### Done When
- [ ] A test per dispatch path asserts the lease is acquired before worktree preparation and released at unit end.
- [ ] A test asserts an operator command refuses against a live owner, naming its pid, and reclaims a lease whose owner process is dead.

## Story 3: A landing releases only a park it took

**Requirement:** #3203 outcome 6 (ADR decision 3)

As an operator, I want a landing to park the feature for me and to leave my own park alone, so that I do not have to remember to park, and a landing never unparks a feature someone else parked.

### Acceptance Criteria

#### Happy Path
- Given the three-child stack with no park marker, when the operator opens a landing on child 1 and later runs `stack land --done`, then `.daemon/parked/demo` exists from the open until the declaration and is removed by `--done`.
- Given the three-child stack that the operator parked with `ai-conductor daemon park demo` before landing, when the landing opens and is declared done, then `.daemon/parked/demo` still exists after `--done`.

#### Negative Paths
- Given a landing on child 1 that created the park, when the park marker is removed and re-created by another `daemon park demo` before `--done`, then `--done` leaves the re-created marker in place.
- Given two processes parking `demo` at the same moment, when the landing's park loses the exclusive create, then the round records that it owns no park and never removes the marker.
- Given `stack land` crashes after creating the park and before writing its route record, when the operator inspects the feature, then `.daemon/parked/demo` still exists and the daemon does not dispatch `demo`.
- Given `kickback-budget raise` on a feature it parked temporarily, when another process re-parked the feature in between, then the command leaves the other process's park in place.

### Done When
- [ ] A test asserts a park created by the landing is released by `--done`, and an operator's earlier park survives `--done`.
- [ ] A test asserts release never deletes a park marker whose token differs from the one the round recorded.

## Story 4: Commits on the wrong branch are refused while a round is open

**Requirement:** #3203 outcome 2 (ADR decision 6)

As a reviewer's change author, I want a commit on the wrong child refused at commit time, whether or not it has a `Task:` trailer, so that a change cannot land in a child that does not own it.

### Acceptance Criteria

#### Happy Path
- Given a landing on child 1, when the person commits a change to a tracked file on `feat/c1/demo` in the feature worktree, then the commit succeeds.
- Given a landing on child 1, when a commit on `feat/daemon-demo` stages only `.docs/halted/demo.md`, then the commit succeeds.
- Given a flat feature, when someone commits on its branch, then the commit guard exits 0 without reading any routing ref.

#### Negative Paths
- Given a landing on child 1, when the person commits a tracked-file change on `feat/c2/demo` or on `feat/daemon-demo` with no `Task:` trailer, then the pre-commit hook refuses the commit, naming `feat/c1/demo` as the open host and `stack land --abandon`.
- Given a landing on child 1, when the person commits on `feat/c2/demo` with a `Task: 4` trailer, then the commit is refused the same way.
- Given an open `audit` round hosted on child 1, when someone commits a tracked-file change on `feat/c2/demo` in the feature worktree, then the commit is refused naming host child 1.
- Given a landing on child 1 that has been declared done, when the person commits on `feat/c1/demo` outside a daemon session, then the commit is refused naming the declaration; and when the region's repair commits there inside a daemon session, then the commit succeeds.
- Given a landing on child 1 whose route record cannot be read while the marker exists, when someone commits on `feat/c2/demo`, then the commit is refused naming the unreadable record.
- Given the feature worktree was last prepared before this change shipped, when the operator opens a landing on child 1, then the worktree's pre-commit hook contains the commit guard before the command exits.

### Done When
- [ ] A real-git hook test asserts refusal of non-host commits with and without a `Task:` trailer, and acceptance of host and halt-record-only commits.
- [ ] A test asserts the guard abstains on a flat feature with no read of `refs/conductor/<slug>/repairing` or `routes`.

## Story 5: Commits the hook could not see are caught before anything moves

**Requirement:** #3203 outcomes 2 and 3 (ADR decision 7)

As an operator, I want a commit made with `--no-verify` or from another checkout detected before declaration or dispatch, so that the hook is not the only guard.

### Acceptance Criteria

#### Happy Path
- Given a landing on child 1 where no other branch of the feature moved, when the person runs `stack land --done`, then the declaration is recorded.
- Given a landing on child 1 whose exit restack has moved `feat/c2/demo` and `feat/daemon-demo`, when the preflight runs after a crash between the restack and the round's close, then it reports no moved branch and resumes the round.

#### Negative Paths
- Given a landing on child 1 and a commit made with `git commit --no-verify` on `feat/c2/demo`, when the person runs `stack land --done`, then it exits non-zero naming `feat/c2/demo` and its recorded and current tips, and no declaration is recorded.
- Given a landing on child 1 and a commit pushed onto `feat/daemon-demo` from another checkout, when the stack preflight runs, then it halts `needs-human` with reason `operator-round-branch-moved` naming `feat/daemon-demo`, and runs no restack.
- Given an `operator-round-branch-moved` HALT for a declared landing on child 1 and the moved branch restored to its recorded tip, when the operator re-runs `stack land --slug demo --child 1`, then the HALT is cleared and the round is unchanged.
- Given a landing on child 1 that carried child 2, when `feat/c2/demo` gains a commit after the landing opened, then `--done` refuses naming child 2's recorded and current tips.

### Done When
- [ ] A test asserts `--done` refuses after a bypassed commit on another branch, naming the branch and both tips.
- [ ] A test asserts the preflight never reports a branch the exit restack moved.

## Story 6: An undeclared landing is never dispatched or closed over

**Requirement:** #3203 outcome 3 (ADR decision 10)

As a change author, I want the engine to leave my half-built change alone until I declare it complete, so that it is never restacked or re-validated mid-edit.

### Acceptance Criteria

#### Happy Path
- Given a declared landing on child 1, when the daemon dispatches `demo`, then the run enters child 1's region with no HALT.

#### Negative Paths
- Given an undeclared landing on child 1 and someone unparks `demo`, when the daemon dispatches it, then the preflight halts `needs-human` with reason `operator-round-undeclared`, naming the round, child 1, `stack land --done` and `stack land --abandon`, and no restack, region step or routed exit runs.
- Given an undeclared landing on child 1 and a due base refresh, when the preflight runs, then it halts `operator-round-undeclared` before the base-refresh deferral, moves no ref, keeps the re-kick request, and emits no `deferred-base-refresh` event.
- Given an undeclared landing on child 1, when a running conductor reaches region entry for child 1, then region entry refuses the undeclared round and the conductor halts `needs-human` without dispatching a provider.

### Done When
- [ ] A test drives a dispatch against an undeclared landing and asserts the HALT reason and text, and that no branch, closure ref or route record changed.

## Story 7: Raw closed-child commits halt and are carried, never closed over

**Requirement:** #3203 outcome 3, operator decision 2026-10-24 (ADR decision 8)

As an operator, I want a commit made directly on a closed child's branch, outside a landing, held for a landing, so that nothing reaches the stack without its author declaring it complete.

### Acceptance Criteria

#### Happy Path
- Given the three-child stack whose `feat/c1/demo` carries a raw commit past its closure, when the stack preflight runs, then it halts `needs-human` with reason `unlanded-closed-child-commits`, naming child 1 and `ai-conductor stack land --slug demo --child 1 --reason "<why>"`, and runs no restack.
- Given raw commits past the closures of both child 1 and child 2, when the preflight halts, then the printed command is `ai-conductor stack land --slug demo --child 1 --carry 2 --reason "<why>"`, and running it opens one round with child 1 as host and child 2 carried.
- Given a declared landing on child 1 that carried child 2, when the region passes, then the exit restack originates at children 1 and 2, and child 2 is queued for re-validation.
- Given routing turned off for the three-child stack, when the preflight finds a raw commit past child 1's closure, then it runs the automatic `feature-repair` restack exactly as before this change.

#### Negative Paths
- Given an open `audit` round hosted on child 1 and an unstamped commit on `feat/c2/demo` made from another checkout, when the routed exit runs, then it halts `needs-human` with reason `unlanded-closed-child-commits` naming child 2, and runs no restack.
- Given the three-child stack with an active publication record and a raw commit past child 1's closure, when the preflight runs, then it halts `needs-human` with the shipped `published-stack` reason naming child 1, and writes no `unlanded-closed-child-commits` halt.
- Given the three-child stack whose `feat/c1/demo` carries only a commit that changes `.docs/halted/demo.md`, when the preflight runs, then it reports no unlanded commit and does not halt.
- Given an `unlanded-closed-child-commits` HALT naming child 1, when the operator opens the printed landing, then the command clears that HALT; and when the HALT names children 1 and 2 and the operator lands child 1 without carrying 2, then the command refuses and the HALT stays.

### Done When
- [ ] A test asserts a raw commit past a closure with routing on halts with the carrying command and moves no ref.
- [ ] A test asserts an uncarried co-origin halts the routed exit of an `audit` round.

## Story 8: Declaring a landing done re-validates the child and every child above it

**Requirement:** #3203 outcomes 3 and 4 (ADR decision 9)

As a change author, I want `--done` to hand my change to the engine for the same checks a routed fix gets, so that the changed child, every closed child above it, and the whole-feature gates are re-judged.

### Acceptance Criteria

#### Happy Path
- Given a landing on child 1 with one commit renaming a flag, when the person runs `stack land --done`, then the command exits 0, records the declaration with the host tip, writes the reason into child 1's work order, releases the park it took, and prints the next step.
- Given that declared landing, when the daemon dispatches `demo`, then child 1's region starts at `acceptance_specs` in verify-green mode, then runs `test_suite`, then `build_review` against the closure, with the reason among its inputs, and no provider `build` runs before `acceptance_specs`.
- Given child 1's region passes, when the routed exit runs, then a `feature-repair` restack originates at child 1, child 2 is re-validated from the queue, the worktree returns to `feat/daemon-demo`, and the leaf's whole-feature gates are re-pended.
- Given child 1's `build_review` fails on the landed change, when the kickback runs, then a provider `build` repairs inside child 1 with the reason in its work order, under child 1's caps, and the round still exits through child 1.

#### Negative Paths
- Given an undeclared landing on child 1 and a live dispatch of `demo`, when the person runs `--done`, then it exits non-zero naming the lease owner and records no declaration.
- Given a landing on child 1 with no commit past the closure, when the person runs `--done`, then it exits non-zero naming the empty landing and `stack land --abandon`, and records no declaration.
- Given a landing on child 1 whose only commit past the closure changes `.docs/halted/demo.md`, when the person runs `--done`, then it exits non-zero naming the empty landing and records no declaration.
- Given a landing on child 1 while the feature worktree is on `feat/daemon-demo`, when the person runs `--done`, then it exits non-zero naming the host branch `feat/c1/demo`.
- Given a landing on child 1 with an uncommitted change, when the person runs `--done`, then it exits non-zero naming the dirty worktree.
- Given a declared landing on child 1 and an engine restart between `test_suite` and `build_review`, when the run resumes, then the kickback build's work order still carries the reason.
- Given an `operator-round-undeclared` HALT for the round, when the person runs `--done`, then the command clears that HALT; and given an unrelated `needs-human` HALT, then `--done` leaves it in place and reports it.

### Done When
- [ ] A real-`Conductor` integration test drives a landing from `--done` through verify-green, `test_suite`, `build_review`, the exit restack, re-validation of child 2 and the leaf return, asserting the step order.
- [ ] A test asserts the reason reaches the `build_review` inputs and survives a restart in the build work order.

## Story 9: Abandoning a landing restores the child exactly

**Requirement:** #3203 outcome 1 (ADR decision 13)

As a change author, I want to abandon a landing I no longer want, so that the child returns to its closed state with my work still reachable.

### Acceptance Criteria

#### Happy Path
- Given a landing on child 1 with two commits, when the person runs `stack land --abandon`, then `feat/c1/demo` points at its closure, `refs/conductor/demo/rejected/<roundId>/1` points at the abandoned tip, child 1's region statuses and verdict files equal their pre-landing contents, the worktree is on `feat/daemon-demo`, the route record is closed with host `abandoned`, the marker is gone, and the park the landing took is released.
- Given that abandon, when the leaf's whole-feature gates are read, then their statuses and verdicts are unchanged from before the landing.

#### Negative Paths
- Given an abandon that crashed after the branch reset and before the worktree sync, when the operator re-runs `stack land --abandon`, then it completes the sync from the recorded tips on the host branch, the restore and the leaf return once, and never runs the sync from the leaf branch.
- Given a landing on child 1 and a live dispatch of `demo`, when the person runs `--abandon`, then it exits non-zero naming the lease owner, and the branch, marker and route record are unchanged.
- Given a declared landing on child 1 whose host is `built`, when the person runs `--abandon`, then it exits non-zero naming the exit restack in progress, and nothing changes.
- Given a landing on child 1 whose `feat/c1/demo` history was rewritten past its closure, when the person runs `--abandon`, then the abandon proceeds and pins the rewritten tip.
- Given a landing on child 1 that carried child 2, when the person abandons, then `feat/c2/demo` keeps its commits and the next preflight halts `unlanded-closed-child-commits` naming child 2.
- Given a landing on child 1 with an `operator-round-undeclared` HALT, when the person runs `--abandon`, then the HALT is cleared, and no HALT naming the abandoned round remains.
- Given a landing on child 1 with an uncommitted change in the worktree, when the person runs `--abandon`, then it exits non-zero naming the dirty worktree, and the change is intact.

### Done When
- [ ] A real-git test asserts the branch, pin, region state, verdicts, worktree branch and record after `--abandon`.
- [ ] A crash-injection test per abandon stage asserts the re-run completes it exactly once.

## Story 10: A closed child can be rewound

**Requirement:** #3203 outcome 5 (ADR decision 11)

As an operator, I want `rewind --child <k>` on a closed child to re-open its work safely, so that I can re-run a closed child's steps instead of being refused.

### Acceptance Criteria

#### Happy Path
- Given the three-child stack halted `needs-human`, when the operator runs `ai-conductor rewind --child 1 --to test_suite --reason "re-run after flaky fixture"`, then the command exits 0, opens a declared `operator` round with origin `rewind` on child 1, sets child 1's `test_suite` and `build_review` to pending, clears the HALT, and does not demote child 2 or the leaf.
- Given that rewind, when the daemon dispatches `demo`, then child 1's region starts at `test_suite`.
- Given that rewound child 1 passes with no new commit, when the round exits, then it takes the no-commit exit, the worktree returns to the leaf, and the leaf's whole-feature gates are re-pended.
- Given that rewound child 1 gains a repair commit, when the round exits, then the exit restack originates at child 1 and child 2 is re-validated from the queue.

#### Negative Paths
- Given the halted three-child stack whose worktree was recreated, so `.pipeline/children/1/` does not exist, when the operator runs `rewind --child 1 --to test_suite --reason "re-run"`, then the command exits 0, validating child 1 by its closure ref, and child 1's region state shows `acceptance_specs` and `build` done and `test_suite` and `build_review` pending.
- Given the three-child stack with no HALT, when the operator runs `rewind --child 1 --to test_suite --reason "x"`, then it exits non-zero naming the missing HALT, as rewind does today.
- Given the halted three-child stack, when the operator runs `rewind --child 1 --to test_suite` with no `--reason`, then it exits non-zero naming the missing reason.
- Given the halted three-child stack with an active publication record, when the operator rewinds closed child 1, then it exits non-zero naming #3268.
- Given the halted three-child stack and a live dispatch, when the operator rewinds closed child 1, then it exits non-zero naming the lease owner.
- Given an open child that is the cursor's active child, when the operator runs `rewind --child <k> --to build`, then the rewind behaves exactly as before this change.

### Done When
- [ ] A test asserts the closed-child rewind opens a declared round, restages only child 1 from the target, clears the HALT, and leaves child 2's and the leaf's state unchanged.
- [ ] A test asserts `ai-conductor rewind --help` lists `--child` and `--reason`.

## Story 11: An operator round spends no gate budget and is never rerouted

**Requirement:** #3203 outcome 4 (ADR decisions 1 and 12)

As an operator, I want a landing not to consume the whole-feature gates' kickback budgets and not to be moved to another child, so that a reviewer's change neither exhausts audit budgets nor leaves the child that owns it.

### Acceptance Criteria

#### Happy Path
- Given a declared landing on child 1, when child 1's `build` is dispatched after a kickback, then no gate lap, growth or taskless charge is added to the feature's kickback ledger, and the round's receipt is acknowledged without settlement.
- Given a declared landing on child 1, when a restack originates at child 1, then one cascade is charged to child 1.

#### Negative Paths
- Given a declared landing on child 1, when a kickback build in child 1 returns a `blocked-by-prerequisite` claim, then the engine does not reroute, the host stays child 1, and `feat/c1/demo` is not reset.
- Given a declared landing on child 1 whose kickbacks exhaust child 1's `build_review` cap and the round's credit, when the next kickback is due, then the feature halts with today's cap halt class, naming child 1.

### Done When
- [ ] A test asserts the feature ledger is unchanged by an operator round's build dispatch.
- [ ] A test asserts an operator round never reaches the reroute transaction.

## Story 12: `stack owners` shows which child introduced each path

**Requirement:** #3203 outcome 1 (ADR decision 14)

As a person deciding where a reviewer's change belongs, I want to see which child introduced the code I am about to change, so that the owner choice rests on facts.

### Acceptance Criteria

#### Happy Path
- Given the three-child stack where child 1 added `src/flag.ts` and child 2 modified it, when the operator runs `ai-conductor stack owners --slug demo --path src/flag.ts`, then the JSON output lists children 1 and 2 for that path, with positions, branch names and slice titles.
- Given a diff range, when the operator runs `stack owners --slug demo --diff <range>`, then every path changed in the range is reported with the children that touched it.

#### Negative Paths
- Given a path no child touched, when the operator asks for it, then the output reports it with an empty child list and the command exits 0.
- Given a flat feature, when the operator runs `stack owners`, then it exits non-zero naming the feature as not stacked.
- Given a stack whose topology the #3365 loader reports `unavailable`, when the operator runs `stack owners`, then it exits non-zero naming the loader cause.
- Given any `stack owners` call, when it completes, then no ref, lease, park marker or state file changed.

### Done When
- [ ] A real-git test asserts the per-path child lists for added, modified and untouched paths.

## Story 13: A shipped skill picks the owning child and drives the landing

**Requirement:** #3203 outcome 1 (ADR decision 15)

As an operator or agent handed a reviewer's request, I want a skill that works out which child owns the change and walks me through the landing, so that I make the judgement with the facts in front of me.

### Acceptance Criteria

#### Happy Path
- Given an installed harness, when the skill catalog is listed for either provider, then the landing skill is present under the naming rule in force and is marked operator-invoked.
- Given the skill is invoked with a reviewer's request, when it proposes an owner, then it has run `ai-conductor stack owners` for the paths involved, names the proposed child with its title and the evidence, and asks the person to confirm before running `stack land`.

#### Negative Paths
- Given the person rejects the proposed child, when the skill continues, then it does not run `stack land` for that child and asks which child to use.
- Given `stack land` refuses, when the skill reports it, then it relays the refusal's cause and next command and does not work around it.

### Done When
- [ ] The integrity suite passes with the skill in the shipped catalog, carrying metadata for both providers.

## Story 14: Operator rounds are visible on the spine and in daemon status

**Requirement:** #3203 outcome 1 (ADR decision 16)

As an operator, I want every landing step recorded on the event spine and shown in daemon status, so that I can see an open landing and what it waits for.

### Acceptance Criteria

#### Happy Path
- Given a landing on child 1 that is opened, declared and exits, when `.pipeline/events.jsonl` is read, then the events appear in this order: `operator_round` `opened`, `remediation_routed`, `routed_repair_phase` for `admitted` and `repairing`, `operator_round` `declared`, `routed_repair_phase` for `built` and `restacked`, then `child_revalidated` for child 2; and each `operator_round` event carries the round id, child 1, origin `land` and the reason.
- Given an undeclared landing on child 1, when the operator runs `ai-conductor daemon status`, then the `demo` line shows an operator landing open on child 1 awaiting `--done`.

#### Negative Paths
- Given a crash after a routing transaction and before its outbox drained, when the next command drains the outbox, then each `operator_round` event appears in `events.jsonl` exactly once.
- Given an abandoned landing, when the events are read, then they contain `operator_round` with action `abandoned` and no `child_revalidated` for the round.

### Done When
- [ ] A test asserts the `operator_round` event sequence for open, declare and abandon, and dedup by `eventId` after a replayed drain.

## Story 15: Flat features and routing-off stacks behave exactly as before

**Requirement:** #3203 outcome 7 (ADR decision 17)

As an operator of single-PR features, I want nothing in this change to touch my features, so that it carries no N=1 risk.

### Acceptance Criteria

#### Happy Path
- Given a flat feature, when it is dispatched, built and finished, then the N=1 golden suite passes unchanged and no `routes`, `repairing` or `revalidate` ref and no lease directory is touched.

#### Negative Paths
- Given a flat feature, when someone runs `stack land`, `stack owners` or `rewind --child 1`, then each exits non-zero naming the feature as not stacked, and nothing changes.
- Given a stacked feature with `stacked_prs.route_whole_feature_fixes: false`, when the preflight finds a raw commit past a closure, then the automatic `feature-repair` restack runs as before, and no operator halt is written.

### Done When
- [ ] The N=1 golden suite's ref guard also asserts that no lease directory is read or written.
