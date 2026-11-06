**Status:** Accepted

# Stories: Carry a routed fix up the stack and re-validate the children above (#3212)

Technical track (no PRD). Sources:
- the scope boundary in `.docs/track/a-routed-fix-is-never-carried-up-the-stack-or-foll.md`
  (spec D, the last of the four-spec split #2944, #3210, #3211, #3212);
- `adr-2026-10-12-routed-whole-feature-repair` (decisions 13–16, with decisions 12 and 18 as amended
  on 2026-10-23);
- the conditions C1–C13 of
  `architecture-review-2026-10-23-a-routed-fix-is-never-carried-up-the-stack-or-foll`.

Scope outcomes (from jstoup111/ai-conductor#3212):
1. **Carried up.** A routed fix leaves its host through one journaled restack. That restack moves
   the host's closure only after the host's region passes, and carries the fix into every child
   above.
2. **Children above re-validate.** Every closed child that a restack moved, for any cause, is
   re-validated bottom-up and within bounds. The leaf gates then re-run under their existing lap
   caps.
3. **Return to the leaf.** The engine returns to the leaf only when no round is open and no child
   is waiting for re-validation.
4. **Routing goes live.** Routing is on by default for stacked features, and N=1 features remediate
   exactly as today.

The PR comment on an already-published child, and refreshing a published stack, are excluded: they
belong to #3269 and #3268. A published stack is frozen.

Delivery is three stacked slices. Each story belongs to exactly one:
- Slice 1, exit restack: Stories 1–3.
- Slice 2, progression and return to the leaf: Stories 4–6.
- Slice 3, re-validation and go-live: Stories 7–11.

Terms used below:
- **Routing on:** `stacked_prs.route_whole_feature_fixes` resolves to `true`. Stories 1–10 assume
  routing on. Story 11 makes it the default.
- **Three-child stack:** a stacked feature with slug `demo` and positions `1`, `2` and `3`.
  - `feat/c1/demo` is closed at `refs/conductor/demo/closed/c1`, owns task `T1` and file `src/a.ts`.
  - `feat/c2/demo` is closed at `closed/c2`, owns task `T2` and adds file `src/b.ts`, which imports
    `parseA` from `src/a.ts`.
  - The leaf `feat/daemon-demo` (position 3) owns task `T3`.
  - The feature plan is `.docs/plans/demo.md`.
- **Round `r1`:** route record `refs/conductor/demo/routes/r1`, of kind `audit`, in which host 1
  reached `repairing` through spec C's region entry. The marker `refs/conductor/demo/repairing`
  names host 1 and `r1`.
- **Exit restack:** the `feature-repair` restack the engine requests when a routed host's region
  passes.
- **Queue:** `refs/conductor/demo/revalidate`.
- **Leaf gates:** the leaf's whole-feature gates: `prd_audit`, `architecture_review_as_built`,
  `manual_test`, and post-region custom steps.

## Story 1: A passing host leaves through one exit restack that carries its fix up

**Requirement:** Scope outcome 1; ADR decision 13

As a reviewer of the children above a fix, I want the fix carried into every child above its host
once the host is green, so that no child ships without the correction beneath it.

### Acceptance Criteria

#### Happy Path
- Given round `r1` where host 1 committed a fix on `feat/c1/demo` and child 1's region passes, when region exit runs, then host 1 is marked `built` and an exit restack originating at child 1 replays children 2 and 3, and `closeChild` is never called.
- Given that exit restack, when its branches and closures move, then `closed/c1` points at host 1's repaired tip, and children 2 and 3 are replayed onto it.
- Given that exit restack, when it reaches `applied`, then one ref transaction charges one cascade on child 1, deletes the marker, marks host 1 `restacked` in `r1`, and sets the journal `applied`.
- Given that exit restack, when the events are read, then every `restack_applied` event carries cause `feature-repair` and one `routed_repair_phase` event reports host 1 `restacked`.
- Given host 1's route-record outbox holds an undrained event when the exit restack is requested, when the restack starts, then the outbox is drained before the restack journal is created.

#### Negative Paths
- Given a crash after host 1 is `built` and before a restack journal exists, when the feature resumes, then the stack preflight runs host 1's exit restack itself, host 1 ends `restacked`, and a second preflight creates no journal.
- Given a crash between the restack's `synced` and `applied` states, when recovery completes it, then the marker is deleted and host 1 is `restacked`, and the resulting refs are byte-identical to an uninterrupted run.
- Given the exit restack's move verification fails and the restack rolls back, when its state is read, then the marker, the route record and `closed/c1` are unchanged, host 1 is still `built`, and the feature halts needs-human naming the failed check.
- Given that rollback halt is still live, when the stack preflight runs, then it returns `halted` and does not request the exit restack again.
- Given a concurrent writer changed `routes/r1` after the exit restack's journal was created, when `applied` is attempted, then the transaction fails, and recovery halts needs-human naming `refs/conductor/demo/routes/r1` without retrying.
- Given an exit restack's journal is not terminal, when any other routing writer tries to change `routes/r1` or the marker, then it is refused with `restack-journal-open`, and only the restack's own `applied` transaction writes them.
- Given the outbox drain fails, when the exit is requested, then no restack journal is created and host 1 stays `built`.

### Done When
- [ ] A recording git runner shows the marker deletion, the `restacked` record write and the cascade charge only in the one `update-ref --stdin` transaction that sets `applied`, on both the normal path and recovery.
- [ ] Tests assert rollback leaves the routed refs byte-identical, and that a host left `built` is resumed once by the preflight with no spin.
- [ ] A test asserts the route-record writer fence refuses every writer except the open journal's own `applied` transaction.

## Story 2: A host with no new commits exits without a restack

**Requirement:** Scope outcome 1; ADR decision 13

As an operator, I want a host whose repair produced no commits to leave its round without a
restack, so that a no-op repair never rewrites the stack.

### Acceptance Criteria

#### Happy Path
- Given an `existing-task` repair of `T1` hosted by child 1 that appended no block, when the build makes no commit and region exit runs, then no restack is requested, and one compare-and-swap marks host 1 `done` and deletes the marker.
- Given host 1 at region exit, when the no-op evidence is read, then it reports whether host 1's checked-out HEAD moved from the pinned entry base and whether its tree differs from the pinned entry tree.
- Given host 1 carries only a routed `manual_test` FAIL and its build commits nothing, when region exit runs, then host 1 takes the no-commit exit, the leaf's next `manual_test` PASS is refused by the anti-whitewash check because the leaf HEAD did not move, and the existing no-op escalation handles it.

#### Negative Paths
- Given host 1's tree equals its entry tree but its tip differs from `closed/c1`, when region exit runs, then the host exits through the exit restack, not the no-commit exit.
- Given a stale marker old value, when the no-commit compare-and-swap runs, then it fails, host 1 stays `repairing`, the marker is kept, and no `built` write was made.
- Given host 1 has no pinned entry baseline in the route record, when the no-op evidence is read, then it fails closed with an error naming host 1, and no exit is taken.
- Given host 1 already `restacked`, when an exit is requested again, then nothing is written and no restack journal is created.

### Done When
- [ ] Tests assert that tip equality alone selects the no-commit exit, and that tree equality alone never does.
- [ ] A recording git runner shows the no-commit exit as one `update-ref --stdin` transaction with no `built` write.

## Story 3: The exit restack honours co-origins, the cascade cap and a published stack

**Requirement:** Scope outcome 1; ADR decision 13; publication ADR decision 11

As an operator, I want the exit restack to include operator commits made during the round and to
stop safely at every limit, so that it neither drops work nor rewrites what reviewers already see.

### Acceptance Criteria

#### Happy Path
- Given an operator round `r1` hosted on child 1 that carries closed child 2 with unstamped work, when host 1's exit restack is planned, then its origins are children 1 and 2, and `applied` charges one cascade on each.

#### Negative Paths
- Given child 2's post-closure commits carry a `Round:` stamp of a different round, when host 1's exit restack is planned, then it halts needs-human naming child 2 and creates no journal.
- Given an origin set that does not include host 1, when the exit restack is planned, then it halts needs-human naming child 1 and creates no journal.
- Given child 1 has reached `MAX_RESTACK_CASCADES_PER_CHILD`, when host 1's exit restack is planned, then it halts needs-human with a `cascade-cap` HALT naming child 1, the marker stays set, and the halt detail names the runbook section `Routed repair halted on the cascade cap`.
- Given the feature's stack is already published, when host 1's exit is requested, then it halts needs-human with `published-stack` naming child 1, no restack journal is created, and no branch or closure ref moves.

### Done When
- [ ] Tests assert co-origin cascade charges and the halt on a foreign `Round:` stamp.
- [ ] Tests assert the cascade-cap halt keeps the marker and that its detail names a runbook heading that exists.
- [ ] A test asserts the published-stack refusal on the routed exit path.

## Story 4: Appended rem blocks merge by id when a restack replays the plan

**Requirement:** Scope outcome 1; ADR decision 9

As an operator, I want plan conflicts that are only appended remediation blocks to merge
deterministically, so that carrying a fix up the stack does not halt on the shared plan file.

### Acceptance Criteria

#### Happy Path
- Given child 2 and the leaf both appended distinct `rem-*` blocks to `.docs/plans/demo.md`, when a restack replays them, then the plan holds the authored body followed by every block once, in id order, and the conflict resolver is not invoked.
- Given the same base and the two sides swapped, when the union is computed, then the result is byte-identical.
- Given child 2's replay differs from its old contribution only by `rem-*` blocks inherited from its new parent, when the restack checks child 2's path ownership, then the plan path is accepted.
- Given child 2's replay differs from its old contribution only by inherited `rem-*` blocks, when replay proof is computed, then the replay is proven unchanged.

#### Negative Paths
- Given the two sides hold the same rem id with different bodies, when the restack replays the plan, then it halts needs-human naming that rem id, and no ref moves.
- Given the leaf edited the authored body of `T3` in the plan that child 2 replays, when the conflict is not only appended blocks, then the existing resolver is invoked once.
- Given one side appends a `rem-*` block and also deletes another `rem-*` block, when the restack replays the plan, then the union merge declines and the existing resolver is invoked once.
- Given an N=1 feature, when a rebase conflicts on its plan, then today's conflict handling runs unchanged.
- Given routing is off for a stacked feature, when a restack replays a plan conflict of appended `rem-*` blocks, then the union merge is not applied and today's conflict handling runs unchanged.

### Done When
- [ ] Unit tests assert the union's ordering and its symmetry, and the halt on a body mismatch.
- [ ] A real-git restack test asserts zero resolver calls for append-only plan conflicts.

## Story 5: A round moves from host to host in the recorded order

**Requirement:** Scope outcome 3; ADR decisions 6 and 13

As an operator, I want a round with several hosts to process them in a fixed, recorded order that
survives a crash, so that every host is repaired exactly once and nothing is skipped.

### Acceptance Criteria

#### Happy Path
- Given a round with hosts 1 and 2 pending in that order and host 1 `restacked`, when the loop continues, then the round's current host becomes child 2 and child 2 is admitted.
- Given host 1 settled with its entry baseline still on the route record, when child 2 is admitted, then the same write clears host 1's entry baseline, and the advance is not refused.
- Given a round whose child hosts are all `restacked`, `done` or `rerouted`, whose leaf host is pending, and the queue is empty, when the loop continues, then the leaf host is admitted.
- Given a round whose every host, including the leaf host, is `restacked`, `done` or `rerouted`, when the last host settles, then the round is marked `closed`.
- Given a round's leaf host region passes, when region exit runs, then one compare-and-swap marks the leaf host `done` and deletes the marker, and no restack is requested.

#### Negative Paths
- Given a crash after host 1 is `restacked` and before child 2 is admitted, when the feature resumes, then child 2 is admitted once, and no restack or admission is repeated.
- Given a host marked `rerouted`, when the next host is selected, then that host is never selected again.
- Given a round with a leaf host still pending, when the child hosts are all settled, then the round is not `closed`.
- Given the round's current host is child 1 and still `repairing`, when reconciliation runs on resume, then the loop returns to child 1's region and the current host does not advance.

### Done When
- [ ] Table tests over route-record fixtures assert the selection order for child hosts, then the leaf host, then closure.
- [ ] A crash-injection test asserts that resume follows the record without repeating any ref write.

## Story 6: The leaf gates wait for the stack, then re-run once it is settled

**Requirement:** Scope outcome 3; ADR decision 15

As an operator, I want the whole-feature gates held back while any child is being repaired and
re-run once everything has settled, so that the leaf never passes over a stack still being repaired.

### Acceptance Criteria

#### Happy Path
- Given a round's last host has settled, no other round is open and the queue is empty, when the loop continues, then the worktree is switched to `feat/daemon-demo`, the switch is recorded in the round's route record, the round is `closed`, and the leaf gates are set pending.
- Given the leaf gates are re-pended after a routed round, when the kickback ledger is read, then every lap count and cap is unchanged.
- Given a routed fix changed a file under `.docs/specs/`, when the leaf gates re-run, then the prior `prd_audit` PASS is void and `prd_audit` re-runs.
- Given `manual_test` recorded a FAIL at the leaf's old HEAD, when the fix reaches the leaf through the exit restack, then the anti-whitewash check accepts the next PASS.

#### Negative Paths
- Given a marker names child 1, when the loop selects the next step, then only child 1's region steps can be selected, and no leaf gate, no step of another child and no custom step is dispatched, even when pending.
- Given a marker names the leaf as host, when the loop selects the next step, then only the leaf's region steps can be selected, and no leaf gate is dispatched.
- Given a crash after the worktree switched to the leaf and before the switch was recorded, when the feature resumes, then the switch is recorded without a second checkout before the round is `closed`, and no leaf step is dispatched until then.
- Given no marker and no open round but child 2 queued, when the loop selects the next step, then no leaf gate, no post-region custom step and no FINISH or publication step is dispatched.
- Given no marker, no open round and no queued child, when the loop selects the next step, then the decision is the same as before this spec.
- Given an N=1 feature, when the loop selects the next step, then no marker or queue ref is read.

### Done When
- [ ] Selector tests assert parking for a child-host marker, a leaf-host marker, a queue-only state and an empty routing state.
- [ ] Tests assert the recorded leaf return, the idempotent resume, and the unchanged kickback ledger.

## Story 7: Every restack queues the closed children whose gates it invalidated

**Requirement:** Scope outcome 2; ADR decision 14

As a reviewer of each child PR, I want every closed child whose inputs a restack changed to be
queued for re-validation, so that a lower fix cannot silently break an upper child.

### Acceptance Criteria

#### Happy Path
- Given host 1's exit restack moved closed child 2 and invalidated child 2's `test_suite`, when `applied` commits, then the queue's next generation holds one entry for child 2 with its new closure SHA, its position, its invalidated gates and its old and new replay parent.
- Given a base-refresh restack, or a repair caused by an operator commit on a closed child (carried by an operator round, or with routing off), when its `applied` transaction commits, then every moved closed child with an invalidated gate is queued in that same transaction.
- Given a restack moved closed child 2 whose verdict files are missing or unreadable, when the queue is written, then child 2 is queued.
- Given a delta that changes the signature of `parseA` in `src/a.ts`, a file child 2 does not own, when the restack moves child 2, then child 2 is queued because its `test_suite` is invalidated.
- Given a restack whose replay of child 2 is proven unchanged and which leaves each of child 2's region gate verdicts present and fresh, when the queue is written, then child 2 is not queued.
- Given children 4 and 2 are queued by two restacks of a five-position stack, when the queue is read, then the entries are ordered child 2 then child 4.
- Given child 1 was queued when it became host 1, when host 1's exit restack's `applied` commits, then child 1's own queue entry is removed in that transaction and a `child_revalidated` event with outcome `fixed` is recorded for child 1.
- Given child 1 was queued when it became host 1, when host 1 takes the no-commit exit, then child 1's own queue entry is removed in that compare-and-swap and a `child_revalidated` event with outcome `passed` is recorded for child 1.

#### Negative Paths
- Given two restacks each queue child 2, the first invalidating `test_suite` and the second only `build_review`, when the generations merge, then exactly one child-2 entry remains, with the newest closure SHA and gates `test_suite` and `build_review`.
- Given recovery completes a restack from `synced`, when it writes the queue, then the queue is byte-identical to the uninterrupted run.
- Given a concurrent writer changed the queue after the restack journal was created, when `applied` is attempted, then it fails, and recovery halts needs-human naming `refs/conductor/demo/revalidate`.
- Given routing is off for a stacked feature, when a restack moves closed children, then no queue ref is written.
- Given a restack rolls back, when its state is read, then the queue is unchanged.
- Given a restack that moves only the leaf, when `applied` commits, then the queue's generation and entries are unchanged.
- Given a queue blob with a duplicate child, entries out of position order, or an abbreviated SHA, when it is read, then it is reported unreadable and no partial generation is used.

### Done When
- [ ] A recording git runner shows the queue ref written only inside the `applied` transaction, on every restack cause and on recovery.
- [ ] Tests assert the skip rule, missing verdicts counting as invalidated, the API-change case, and the union of gates on merge.

## Story 8: Queued children are re-validated bottom-up and acknowledged safely

**Requirement:** Scope outcome 2; ADR decisions 12 and 14

As a reviewer of each child PR, I want each queued child re-checked in stack order and acknowledged
only when the check still matches the child, so that no child is marked green on a stale result.

### Acceptance Criteria

#### Happy Path
- Given child 2 is the lowest queued child, no marker exists and no round has a pending child host, when the stack preflight runs, then a `revalidate` round for child 2 is created and the marker names child 2, before any branch or worktree change.
- Given that `revalidate` round, when child 2's region is entered, then only the gates in child 2's entry are re-pended, acceptance runs in verify-green mode against child 2's existing specs, and child 2's other region steps keep their status.
- Given that `revalidate` round, when its budgets are read, then no `prd_audit` or as-built lap and no growth were charged, and child 2 holds one routed-repair credit for the round.
- Given child 2's `build_review` runs in a `revalidate` round, when its base is resolved, then child 2's replayed contribution is graded against the new parent recorded in its queue entry.
- Given child 2's re-validation passes with no new commits, each required gate verdict is fresh, and another queue entry or another open round remains, when region exit runs, then one transaction removes child 2's entry, closes the round, deletes the marker and records a `child_revalidated` event with outcome `passed`.
- Given child 2 is the last queued entry and no other round is open, when its PASS acknowledgement commits, then the transaction removes child 2's entry, deletes the marker and records the `child_revalidated` event, the `revalidate` round stays open, and the round is `closed` only after the switch to `feat/daemon-demo` is recorded in it.
- Given children 2 and 4 are queued, when re-validation runs, then child 4's round starts only after child 2's entry is acknowledged.
- Given a round whose leaf host is still pending and whose child hosts are settled, when the queue holds child 2, then child 2 is re-validated before the leaf host is admitted.

#### Negative Paths
- Given a newer generation replaced child 2's entry while child 2 was being validated, when the PASS acknowledgement is attempted, then the compare-and-swap fails and child 2 stays queued.
- Given child 2's closure moved during validation, when the PASS acknowledgement is attempted, then it fails, and the entry, the round and the marker stay pending.
- Given a queued child and no `revalidate` round for it, when region entry is attempted for that child, then no region step is dispatched before queue admission has created that child's `revalidate` round and repair marker, and a refused admission halts with no region step dispatched.
- Given the same `revalidate` round is entered again after a crash, when region entry runs, then child 2's region is not restaged a second time.
- Given a crash after child 2's `revalidate` record is created in phase `prepared` and before its marker is set, when the feature resumes, then that record is aborted, nothing was mutated, and child 2 stays queued.
- Given child 2's `revalidate` round dispatches BUILD after a failing gate, when the dispatch runs, then no round receipt is settled and no lap or growth is charged.

### Done When
- [ ] Tests assert bottom-up consumption, marker-first round creation, and verify-green acceptance in a revalidate pass.
- [ ] Tests assert the acknowledgement guards and that the acknowledgement is a single transaction.
- [ ] Tests assert the `revalidation` review base reads the replay parents from the queue entry.

## Story 9: A failing re-validation is fixed through the child's own exit, and terminates

**Requirement:** Scope outcome 2; ADR decisions 12 and 14

As an operator, I want a child that fails re-validation to be fixed on its own branch under its own
caps, so that the fix is carried up and re-validation always ends.

### Acceptance Criteria

#### Happy Path
- Given child 2's re-validation fails `test_suite` and child 2's region then fixes it with a commit, when region exit runs, then the fix leaves through an exit restack originating at child 2, and child 2's entry is removed only in that restack's `applied` transaction with outcome `fixed`.
- Given a fix made during re-validation, when `build_review` grades it, then it is graded against child 2's tip pinned at region entry, not against child 2's whole contribution.

#### Negative Paths
- Given child 2's re-validation keeps failing, when child 2's region caps are exhausted, then the feature halts needs-human naming child 2, and child 2 stays queued.
- Given four queued children whose re-validations each fix and restack, when the driven loop runs, then it terminates within `MAX_RESTACK_CASCADES_PER_CHILD` per origin and each child's region caps.

### Done When
- [ ] Tests assert the failure path through child 2's own exit restack, and the `revalidation-fix` base.
- [ ] A driven-loop test asserts that re-validation of four children terminates.

## Story 10: A base refresh waits until repairs and re-validation are finished

**Requirement:** Scope outcome 3; ADR decisions 7 and 14

As an operator, I want a requested base refresh deferred while children are being repaired or
re-validated, and run once they are done, so that the stack is never rebased under unfinished work.

### Acceptance Criteria

#### Happy Path
- Given a base refresh is requested while the queue holds child 2, when the stack preflight runs, then no ref moves, a `restack_refused` event with reason `deferred-base-refresh` is recorded, and the request is retained.
- Given an automatic repair whose base-refresh follow-on is due and whose `applied` transaction queued child 2, when the follow-on would run, in the preflight or in recovery, then it is suppressed, a `restack_refused` event with reason `deferred-base-refresh` is recorded, the repair journal becomes terminal, and the base-refresh request is retained.
- Given the queue then drains and no round is open, when the next stack preflight runs, then the retained base refresh runs.

#### Negative Paths
- Given the queue ref exists with no entries, when the deferral check runs, then the base refresh is not deferred.
- Given the queue ref is unreadable, when the deferral check runs, then the base refresh is deferred.
- Given the queue ref has no entries and an empty outbox, when its last event is drained, then the queue ref is deleted in that same compare-and-swap.

### Done When
- [ ] Tests cover the deferral on both follow-on paths, the retained request, and the empty and unreadable queue cases.

## Story 11: Routing is on by default, with every re-validation visible on the event spine

**Requirement:** Scope outcomes 2 and 4; ADR decisions 16, 17 and 18

As an operator watching the daemon, I want routing enabled for stacked features without a config
change, and each re-validation outcome reported exactly once on the existing event stream.

### Acceptance Criteria

#### Happy Path
- Given a project config with no `stacked_prs.route_whole_feature_fixes` key, when the config is loaded, then the setting resolves to `true`.
- Given a project config that sets `stacked_prs.route_whole_feature_fixes: false`, when the config is loaded, then it resolves to `false`, and a stacked feature remediates exactly as before this spec.
- Given child 2 is re-validated, when `events.jsonl` is read, then it holds one `child_revalidated` event naming child 2, the generation, the closure SHA and an outcome of `passed` or `fixed`.

#### Negative Paths
- Given a crash between the queue transaction that records child 2's outcome and the outbox drain, when the stack preflight runs, then the `child_revalidated` event is delivered once.
- Given the same `child_revalidated` event is delivered twice, when the persister writes it, then `events.jsonl` holds it once.
- Given an N=1 feature with routing on by default, when it remediates, then no `routes`, `repairing` or `revalidate` ref is read or written.

### Done When
- [ ] A config test asserts the new default and an explicit `false` override.
- [ ] Tests assert at-least-once delivery of the queue outbox across a crash, with persister dedup by `eventId`.
- [ ] The N=1 golden routing guard passes with the new default.
