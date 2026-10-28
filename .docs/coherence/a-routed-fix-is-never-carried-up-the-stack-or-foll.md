# Coherence: Carry a routed fix up the stack and re-validate the children above (#3212)

**Plan:** .docs/plans/a-routed-fix-is-never-carried-up-the-stack-or-foll.md
**Stories:** .docs/stories/a-routed-fix-is-never-carried-up-the-stack-or-foll.md
**Track:** technical, so there are no FR rows. **Tier:** L.
**Source-Ref:** jstoup111/ai-conductor#3212

This is spec D, the last of the four specs `adr-2026-10-12-routed-whole-feature-repair` is split into
(decision 18). Three APPROVED ADRs carry #3212 amendment notes in this change set, so each has an ADR
row and every one of their decisions has a row in the plan's Architecture Obligation Coverage. Every
intake outcome is delivered by this spec, so no waiver is needed.

## Traceability

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Quote / Notes |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-1, story-2, story-3, story-4, story-5 | covered | **Carried up.** A routed fix leaves its host through one journaled restack that moves the host's closure only after its region passes. The restack carries the fix into every child above. |
| outcome | outcome-2 | story-6, story-7, story-8, story-9 | covered | **Children above re-validate.** Every closed child a restack moved (for any cause) is re-validated, bottom-up and bounded. The leaf gates then re-run under their existing lap caps. |
| outcome | outcome-3 | story-6, story-10 | covered | **Return to the leaf.** The engine returns to the leaf only when no round is open and no child is waiting for re-validation. |
| outcome | outcome-4 | story-11 | covered | **Routing goes live.** With this spec shipped, routing is enabled for stacked features, and N=1 features remediate exactly as today. |
| story | story-1 | task-1, task-2, task-3, task-4, task-5, task-7, task-9, task-10 | covered | A passing host leaves through one exit restack that carries its fix up |
| story | story-2 | task-6, task-8, task-11 | covered | A host with no new commits exits without a restack |
| story | story-3 | task-12, task-13, task-14 | covered | The exit restack honours co-origins, the cascade cap and a published stack |
| story | story-4 | task-15, task-16, task-17, task-18 | covered | Appended rem blocks merge by id when a restack replays the plan |
| story | story-5 | task-19, task-20, task-21, task-22 | covered | A round moves from host to host in the recorded order |
| story | story-6 | task-23, task-24, task-25, task-26, task-27 | covered | The leaf gates wait for the stack, then re-run once it is settled |
| story | story-7 | task-28, task-29, task-30, task-31, task-32 | covered | Every restack queues the closed children whose gates it invalidated |
| story | story-8 | task-33, task-34, task-35, task-36 | covered | Queued children are re-validated bottom-up and acknowledged safely |
| story | story-9 | task-37, task-38 | covered | A failing re-validation is fixed through the child's own exit, and terminates |
| story | story-10 | task-39, task-40, task-41 | covered | A base refresh waits until repairs and re-validation are finished |
| story | story-11 | task-42, task-43 | covered | Routing is on by default, with every re-validation visible on the event spine |
| task | task-1 | story-1 | covered | Serves story 1. |
| task | task-2 | story-1 | covered | Serves story 1. |
| task | task-3 | story-1 | covered | Serves story 1. |
| task | task-4 | story-1 | covered | Serves story 1. |
| task | task-5 | story-1 | covered | Serves story 1. |
| task | task-6 | story-2 | covered | Serves story 2. |
| task | task-7 | story-1 | covered | Serves story 1. |
| task | task-8 | story-2 | covered | Serves story 2. |
| task | task-9 | story-1 | covered | Serves story 1. |
| task | task-10 | story-1 | covered | Serves story 1. |
| task | task-11 | story-2 | covered | Serves story 2. |
| task | task-12 | story-3 | covered | Serves story 3. |
| task | task-13 | story-3 | covered | Serves story 3. |
| task | task-14 | story-3 | covered | Serves story 3. |
| task | task-15 | story-4 | covered | Serves story 4. |
| task | task-16 | story-4 | covered | Serves story 4. |
| task | task-17 | story-4 | covered | Serves story 4. |
| task | task-18 | story-4 | covered | Serves story 4. |
| task | task-19 | story-5 | covered | Serves story 5. |
| task | task-20 | story-5 | covered | Serves story 5. |
| task | task-21 | story-5 | covered | Serves story 5. |
| task | task-22 | story-5 | covered | Serves story 5. |
| task | task-23 | story-6 | covered | Serves story 6. |
| task | task-24 | story-6 | covered | Serves story 6. |
| task | task-25 | story-6 | covered | Serves story 6. |
| task | task-26 | story-6 | covered | Serves story 6. |
| task | task-27 | story-6 | covered | Serves story 6. |
| task | task-28 | story-7 | covered | Serves story 7. |
| task | task-29 | story-7 | covered | Serves story 7. |
| task | task-30 | story-7 | covered | Serves story 7. |
| task | task-31 | story-7 | covered | Serves story 7. |
| task | task-32 | story-7 | covered | Serves story 7. |
| task | task-33 | story-8 | covered | Serves story 8. |
| task | task-34 | story-8 | covered | Serves story 8. |
| task | task-35 | story-8 | covered | Serves story 8. |
| task | task-36 | story-8 | covered | Serves story 8. |
| task | task-37 | story-9 | covered | Serves story 9. |
| task | task-38 | story-9 | covered | Serves story 9. |
| task | task-39 | story-10 | covered | Serves story 10. |
| task | task-40 | story-10 | covered | Serves story 10. |
| task | task-41 | story-10 | covered | Serves story 10. |
| task | task-42 | story-11 | covered | Serves story 11. |
| task | task-43 | story-11 | covered | Serves story 11. |
| adr | adr-2026-10-12-routed-whole-feature-repair | story-1, story-2, story-3, story-4, story-5, story-6, story-7, story-8, story-9, story-10, story-11 | covered | This spec delivers decisions 13–15, decision 16's queue outbox and decision 9's replay merge, and flips the decision 18 default. Decisions 12, 13, 14 and 18 carry #3212 notes. The decision-by-decision mapping is in the plan's Architecture Obligation Coverage, judged under §4f. |
| adr | adr-2026-10-10-stacked-restack-journaled-replay | story-1, story-3, story-4, story-7, story-10 | covered | #3212 note on decision 7: a deferred follow-on base refresh keeps its request in REKICK (not consumed in the preflight, re-armed by recovery). Mapping judged under §4f. |
| adr | adr-2026-08-25-as-built-remediable-findings-bounded-build-route | story-2 | covered | #3212 note on decision 9: only tip equality selects the no-commit exit. Mapping judged under §4f. |
| criterion | Story 1 happy: Given round `r1` where host 1 committed a fix on `feat/c1/demo` and child 1's region passes, when region exit runs, then host 1 is marked `built` and an exit restack originating at child 1 replays children 2 and 3, and `closeChild` is never called. | 7, 9 | covered | "marks host 1 `built`, then runs a `feature-repair` restack" | diff-local |
| criterion | Story 1 happy: Given that exit restack, when its branches and closures move, then `closed/c1` points at host 1's repaired tip, and children 2 and 3 are replayed onto it. | 7 | covered | "`closed/c1` points at host 1's repaired tip" | diff-local |
| criterion | Story 1 happy: Given that exit restack, when it reaches `applied`, then one ref transaction charges one cascade on child 1, deletes the marker, marks host 1 `restacked` in `r1`, and sets the journal `applied`. | 4 | covered | "only inside the single `update-ref --stdin` transaction that sets the journal `applied`" | diff-local |
| criterion | Story 1 happy: Given that exit restack, when the events are read, then every `restack_applied` event carries cause `feature-repair` and one `routed_repair_phase` event reports host 1 `restacked`. | 9 | covered | "exactly one `routed_repair_phase` event reports host 1 with phase `restacked`" | diff-local |
| criterion | Story 1 happy: Given host 1's route-record outbox holds an undrained event when the exit restack is requested, when the restack starts, then the outbox is drained before the restack journal is created. | 7 | covered | "shows the outbox removal on `routes/r1` before the journal create" | diff-local |
| criterion | Story 1 negative: Given a crash after host 1 is `built` and before a restack journal exists, when the feature resumes, then the stack preflight runs host 1's exit restack itself, host 1 ends `restacked`, and a second preflight creates no journal. | 10 | covered | "runs host 1's exit restack, host 1 ends `restacked`, and a second `runStackPreflight` creates no journal ref" | diff-local |
| criterion | Story 1 negative: Given a crash between the restack's `synced` and `applied` states, when recovery completes it, then the marker is deleted and host 1 is `restacked`, and the resulting refs are byte-identical to an uninterrupted run. | 4 | covered | "byte-identical to the uninterrupted run" | diff-local |
| criterion | Story 1 negative: Given the exit restack's move verification fails and the restack rolls back, when its state is read, then the marker, the route record and `closed/c1` are unchanged, host 1 is still `built`, and the feature halts needs-human naming the failed check. | 10 | covered | "keep their prior values, host 1 is `built`" | diff-local |
| criterion | Story 1 negative: Given that rollback halt is still live, when the stack preflight runs, then it returns `halted` and does not request the exit restack again. | 10 | covered | "returns `halted`, and `requestRoutedExit` is not called" | diff-local |
| criterion | Story 1 negative: Given a concurrent writer changed `routes/r1` after the exit restack's journal was created, when `applied` is attempted, then the transaction fails, and recovery halts needs-human naming `refs/conductor/demo/routes/r1` without retrying. | 5 | covered | "detail naming `refs/conductor/demo/routes/r1`" | diff-local |
| criterion | Story 1 negative: Given an exit restack's journal is not terminal, when any other routing writer tries to change `routes/r1` or the marker, then it is refused with `restack-journal-open`, and only the restack's own `applied` transaction writes them. | 2, 3 | covered | "returns `restack-journal-open`" | diff-local |
| criterion | Story 1 negative: Given the outbox drain fails, when the exit is requested, then no restack journal is created and host 1 stays `built`. | 7 | covered | "no journal ref exists, and host 1 stays `built`" | diff-local |
| criterion | Story 2 happy: Given an `existing-task` repair of `T1` hosted by child 1 that appended no block, when the build makes no commit and region exit runs, then no restack is requested, and one compare-and-swap marks host 1 `done` and deletes the marker. | 8 | covered | "marks host 1 `done` and deletes `refs/conductor/demo/repairing`, with no `built` write and no journal create" | diff-local |
| criterion | Story 2 happy: Given host 1 at region exit, when the no-op evidence is read, then it reports whether host 1's checked-out HEAD moved from the pinned entry base and whether its tree differs from the pinned entry tree. | 6 | covered | "`headMoved: true, treeDiffers: false`" | diff-local |
| criterion | Story 2 happy: Given host 1 carries only a routed `manual_test` FAIL and its build commits nothing, when region exit runs, then host 1 takes the no-commit exit, the leaf's next `manual_test` PASS is refused by the anti-whitewash check because the leaf HEAD did not move, and the existing no-op escalation handles it. | 11 | covered | "refused by the whitewash guard" | diff-local |
| criterion | Story 2 negative: Given host 1's tree equals its entry tree but its tip differs from `closed/c1`, when region exit runs, then the host exits through the exit restack, not the no-commit exit. | 8 | covered | "not the no-commit exit" | diff-local |
| criterion | Story 2 negative: Given a stale marker old value, when the no-commit compare-and-swap runs, then it fails, host 1 stays `repairing`, the marker is kept, and no `built` write was made. | 8 | covered | "returns `cas-failed`, host 1 stays `repairing`" | diff-local |
| criterion | Story 2 negative: Given host 1 has no pinned entry baseline in the route record, when the no-op evidence is read, then it fails closed with an error naming host 1, and no exit is taken. | 6, 8 | covered | "no `update-ref` marking host 1 `done` or `built`, and no restack journal ref is created" | diff-local |
| criterion | Story 2 negative: Given host 1 already `restacked`, when an exit is requested again, then nothing is written and no restack journal is created. | 8 | covered | "returns `noop`, the recording runner shows no `update-ref`" | diff-local |
| criterion | Story 3 happy: Given an operator committed unstamped work on closed child 2 during round `r1`, when host 1's exit restack is planned, then its origins are children 1 and 2, and `applied` charges one cascade on each. | 12 | covered | "increments the `cascades` count for child 1 and for child 2 by one each" | diff-local |
| criterion | Story 3 negative: Given child 2's post-closure commits carry a `Round:` stamp of a different round, when host 1's exit restack is planned, then it halts needs-human naming child 2 and creates no journal. | 12 | covered | "with detail naming child 2, and no journal ref exists" | diff-local |
| criterion | Story 3 negative: Given an origin set that does not include host 1, when the exit restack is planned, then it halts needs-human naming child 1 and creates no journal. | 12 | covered | "with detail naming child 1, and no journal ref exists" | diff-local |
| criterion | Story 3 negative: Given child 1 has reached `MAX_RESTACK_CASCADES_PER_CHILD`, when host 1's exit restack is planned, then it halts needs-human with a `cascade-cap` HALT naming child 1, the marker stays set, and the halt detail names the runbook section `Routed repair halted on the cascade cap`. | 13 | covered | "whose detail contains `Routed repair halted on the cascade cap`" | diff-local |
| criterion | Story 3 negative: Given the feature's stack is already published, when host 1's exit is requested, then it halts needs-human with `published-stack` naming child 1, no restack journal is created, and no branch or closure ref moves. | 14 | covered | "`restack refused (published-stack) child 1`" | diff-local |
| criterion | Story 4 happy: Given child 2 and the leaf both appended distinct `rem-*` blocks to `.docs/plans/demo.md`, when a restack replays them, then the plan holds the authored body followed by every block once, in id order, and the conflict resolver is not invoked. | 16 | covered | "with the resolver spy recording zero calls" | diff-local |
| criterion | Story 4 happy: Given the same base and the two sides swapped, when the union is computed, then the result is byte-identical. | 15 | covered | "yields a byte-identical `merged` text" | diff-local |
| criterion | Story 4 happy: Given child 2's replay differs from its old contribution only by `rem-*` blocks inherited from its new parent, when the restack checks child 2's path ownership, then the plan path is accepted. | 18 | covered | "returns accepted when the plan differs only by inherited `rem-*` blocks" | diff-local |
| criterion | Story 4 happy: Given child 2's replay differs from its old contribution only by inherited `rem-*` blocks, when replay proof is computed, then the replay is proven unchanged. | 18 | covered | "is exactly `unchanged` (the `replay.kind` that `gate-invalidation.ts` treats as proven)" | diff-local |
| criterion | Story 4 negative: Given the two sides hold the same rem id with different bodies, when the restack replays the plan, then it halts needs-human naming that rem id, and no ref moves. | 16 | covered | "whose detail names the rem id" | diff-local |
| criterion | Story 4 negative: Given the leaf edited the authored body of `T3` in the plan that child 2 replays, when the conflict is not only appended blocks, then the existing resolver is invoked once. | 17 | covered | "the resolver spy records exactly one call" | diff-local |
| criterion | Story 4 negative: Given one side appends a `rem-*` block and also deletes another `rem-*` block, when the restack replays the plan, then the union merge declines and the existing resolver is invoked once. | 17 | covered | "`unionRemBlocks` returns `declined`" | diff-local |
| criterion | Story 4 negative: Given an N=1 feature, when a rebase conflicts on its plan, then today's conflict handling runs unchanged. | 17 | covered | "the N=1 plan-conflict rebase records the same resolver calls and outcome" | diff-local |
| criterion | Story 4 negative: Given routing is off for a stacked feature, when a restack replays a plan conflict of appended `rem-*` blocks, then the union merge is not applied and today's conflict handling runs unchanged. | 17 | covered | "with routing off, the append-only rem conflict reaches the resolver" | diff-local |
| criterion | Story 5 happy: Given a round with hosts 1 and 2 pending in that order and host 1 `restacked`, when the loop continues, then the round's current host becomes child 2 and child 2 is admitted. | 20 | covered | "writes `currentHostIndex: 1` and host 2 `admitted`" | diff-local |
| criterion | Story 5 happy: Given a round whose child hosts are all `restacked`, `done` or `rerouted`, whose leaf host is pending, and the queue is empty, when the loop continues, then the leaf host is admitted. | 19, 20 | covered | "writes the leaf host `admitted`" | diff-local |
| criterion | Story 5 happy: Given a round whose every host, including the leaf host, is `restacked`, `done` or `rerouted`, when the last host settles, then the round is marked `closed`. | 20, 25 | covered | "writes `phase: 'closed'` in that same compare-and-swap" | diff-local |
| criterion | Story 5 happy: Given a round's leaf host region passes, when region exit runs, then one compare-and-swap marks the leaf host `done` and deletes the marker, and no restack is requested. | 22 | covered | "marks the leaf host `done` and deletes `refs/conductor/demo/repairing`, and the `runRestack` spy records zero calls" | diff-local |
| criterion | Story 5 negative: Given a crash after host 1 is `restacked` and before child 2 is admitted, when the feature resumes, then child 2 is admitted once, and no restack or admission is repeated. | 21 | covered | "writes exactly one admission for host 2 and no admission write for host 1 or any other host" | diff-local |
| criterion | Story 5 negative: Given a host marked `rerouted`, when the next host is selected, then that host is never selected again. | 19, 21 | covered | "a `rerouted` host is never admitted again" | diff-local |
| criterion | Story 5 negative: Given a round with a leaf host still pending, when the child hosts are all settled, then the round is not `closed`. | 20 | covered | "leaves `phase: 'open'`" | diff-local |
| criterion | Story 5 negative: Given the round's current host is child 1 and still `repairing`, when reconciliation runs on resume, then the loop returns to child 1's region and the current host does not advance. | 21 | covered | "returns host 1's region and `currentHostIndex` is unchanged" | diff-local |
| criterion | Story 6 happy: Given a round's last host has settled, no other round is open and the queue is empty, when the loop continues, then the worktree is switched to `feat/daemon-demo`, the switch is recorded in the round's route record, the round is `closed`, and the leaf gates are set pending. | 25, 26 | covered | "HEAD is `feat/daemon-demo`, `routes/r1` carries `leafReturn`" | diff-local |
| criterion | Story 6 happy: Given the leaf gates are re-pended after a routed round, when the kickback ledger is read, then every lap count and cap is unchanged. | 26 | covered | "so every lap count and cap is unchanged" | diff-local |
| criterion | Story 6 happy: Given a routed fix changed a file under `.docs/specs/`, when the leaf gates re-run, then the prior `prd_audit` PASS is void and `prd_audit` re-runs. | 26 | covered | "returns `prd_audit` rather than treating its prior PASS verdict as satisfied" | diff-local |
| criterion | Story 6 happy: Given `manual_test` recorded a FAIL at the leaf's old HEAD, when the fix reaches the leaf through the exit restack, then the anti-whitewash check accepts the next PASS. | 27 | covered | "accepts the `manual_test` PASS recorded at the leaf's post-restack HEAD" | diff-local |
| criterion | Story 6 negative: Given a marker names child 1, when the loop selects the next step, then only child 1's region steps can be selected, and no leaf gate, no step of another child and no custom step is dispatched, even when pending. | 23, 24 | covered | "never `prd_audit`, `architecture_review_as_built`, `manual_test`, a custom step or another child's step" | diff-local |
| criterion | Story 6 negative: Given a marker names the leaf as host, when the loop selects the next step, then only the leaf's region steps can be selected, and no leaf gate is dispatched. | 23, 24 | covered | "with `routedParking` `leaf-host`" | diff-local |
| criterion | Story 6 negative: Given a crash after the worktree switched to the leaf and before the switch was recorded, when the feature resumes, then the switch is recorded without a second checkout before the round is `closed`, and no leaf step is dispatched until then. | 25 | covered | "resume records `leafReturn` with no second `switch` command" | diff-local |
| criterion | Story 6 negative: Given no marker and no open round but child 2 queued, when the loop selects the next step, then no leaf gate, no post-region custom step and no FINISH or publication step is dispatched. | 24 | covered | "no post-region custom step, no FINISH step and no publication step" | diff-local |
| criterion | Story 6 negative: Given no marker, no open round and no queued child, when the loop selects the next step, then the decision is the same as before this spec. | 24 | covered | "the selected step equals the pre-change selector's choice" | diff-local |
| criterion | Story 6 negative: Given an N=1 feature, when the loop selects the next step, then no marker or queue ref is read. | 24 | covered | "records no command naming `repairing` or `revalidate`" | diff-local |
| criterion | Story 7 happy: Given host 1's exit restack moved closed child 2 and invalidated child 2's `test_suite`, when `applied` commits, then the queue's next generation holds one entry for child 2 with its new closure SHA, its position, its invalidated gates and its old and new replay parent. | 31 | covered | "the queue's next generation holds one child-2 entry" | diff-local |
| criterion | Story 7 happy: Given a base-refresh restack, or a repair caused by an operator commit on a closed child, when its `applied` transaction commits, then every moved closed child with an invalidated gate is queued in that same transaction. | 31 | covered | "each queue every moved closed child with an invalidated gate" | diff-local |
| criterion | Story 7 happy: Given a restack moved closed child 2 whose verdict files are missing or unreadable, when the queue is written, then child 2 is queued. | 30, 31 | covered | "a restack moving child 2 with missing verdict files" | diff-local |
| criterion | Story 7 happy: Given a delta that changes the signature of `parseA` in `src/a.ts`, a file child 2 does not own, when the restack moves child 2, then child 2 is queued because its `test_suite` is invalidated. | 30, 31 | covered | "in a file child 2 does not own, makes `queueInvalidation` return child 2 with `test_suite`" | diff-local |
| criterion | Story 7 happy: Given a restack whose replay of child 2 is proven unchanged and which leaves each of child 2's region gate verdicts present and fresh, when the queue is written, then child 2 is not queued. | 30, 31 | covered | "writes no child-2 entry" | diff-local |
| criterion | Story 7 happy: Given children 4 and 2 are queued by two restacks of a five-position stack, when the queue is read, then the entries are ordered child 2 then child 4. | 29 | covered | "yields entries ordered child 2 then child 4" | diff-local |
| criterion | Story 7 happy: Given child 1 was queued when it became host 1, when host 1's exit restack's `applied` commits, then child 1's own queue entry is removed in that transaction and a `child_revalidated` event with outcome `fixed` is recorded for child 1. | 32 | covered | "with outcome `fixed`" | diff-local |
| criterion | Story 7 happy: Given child 1 was queued when it became host 1, when host 1 takes the no-commit exit, then child 1's own queue entry is removed in that compare-and-swap and a `child_revalidated` event with outcome `passed` is recorded for child 1. | 32 | covered | "with outcome `passed`" | diff-local |
| criterion | Story 7 negative: Given two restacks each queue child 2, the first invalidating `test_suite` and the second only `build_review`, when the generations merge, then exactly one child-2 entry remains, with the newest closure SHA and gates `test_suite` and `build_review`. | 29 | covered | "yields exactly one child-2 entry with the newer `closureSha`" | diff-local |
| criterion | Story 7 negative: Given recovery completes a restack from `synced`, when it writes the queue, then the queue is byte-identical to the uninterrupted run. | 31 | covered | "the recovered restack's queue blob is byte-identical to the uninterrupted run" | diff-local |
| criterion | Story 7 negative: Given a concurrent writer changed the queue after the restack journal was created, when `applied` is attempted, then it fails, and recovery halts needs-human naming `refs/conductor/demo/revalidate`. | 31 | covered | "naming `refs/conductor/demo/revalidate`" | diff-local |
| criterion | Story 7 negative: Given routing is off for a stacked feature, when a restack moves closed children, then no queue ref is written. | 31 | covered | "with routing off, no command names `refs/conductor/demo/revalidate`" | diff-local |
| criterion | Story 7 negative: Given a restack rolls back, when its state is read, then the queue is unchanged. | 31 | covered | "after a rollback, and after a restack that moves only the leaf" | diff-local |
| criterion | Story 7 negative: Given a restack that moves only the leaf, when `applied` commits, then the queue's generation and entries are unchanged. | 31 | covered | "(generation and entries unchanged)" | diff-local |
| criterion | Story 7 negative: Given a queue blob with a duplicate child, entries out of position order, or an abbreviated SHA, when it is read, then it is reported unreadable and no partial generation is used. | 28 | covered | "`readRevalidationQueue` reports `unreadable` and no partial generation is used" | diff-local |
| criterion | Story 8 happy: Given child 2 is the lowest queued child, no marker exists and no round has a pending child host, when the stack preflight runs, then a `revalidate` round for child 2 is created and the marker names child 2, before any branch or worktree change. | 33 | covered | "shows the marker write before any `switch`, `checkout` or branch update" | diff-local |
| criterion | Story 8 happy: Given that `revalidate` round, when child 2's region is entered, then only the gates in child 2's entry are re-pended, acceptance runs in verify-green mode against child 2's existing specs, and child 2's other region steps keep their status. | 34 | covered | "sets only `test_suite` and `acceptance_specs` to `pending`" | diff-local |
| criterion | Story 8 happy: Given that `revalidate` round, when its budgets are read, then no `prd_audit` or as-built lap and no growth were charged, and child 2 holds one routed-repair credit for the round. | 34 | covered | "holds `routedRepairCredit` for the round" | diff-local |
| criterion | Story 8 happy: Given child 2's `build_review` runs in a `revalidate` round, when its base is resolved, then child 2's replayed contribution is graded against the new parent recorded in its queue entry. | 35 | covered | "returns `{kind: 'revalidation', sha: <entry newParent>}`" | diff-local |
| criterion | Story 8 happy: Given child 2's re-validation passes with no new commits, each required gate verdict is fresh, and another queue entry or another open round remains, when region exit runs, then one transaction removes child 2's entry, closes the round, deletes the marker and records a `child_revalidated` event with outcome `passed`. | 36 | covered | "removes child 2's entry, closes `routes/r2`, deletes the marker" | diff-local |
| criterion | Story 8 happy: Given child 2 is the last queued entry and no other round is open, when its PASS acknowledgement commits, then the transaction removes child 2's entry, deletes the marker and records the `child_revalidated` event, the `revalidate` round stays open, and the round is `closed` only after the switch to `feat/daemon-demo` is recorded in it. | 36 | covered | "while `routes/r2` stays `open`" | diff-local |
| criterion | Story 8 happy: Given children 2 and 4 are queued, when re-validation runs, then child 4's round starts only after child 2's entry is acknowledged. | 33 | covered | "no round for child 4 exists until child 2's entry is acknowledged" | diff-local |
| criterion | Story 8 happy: Given a round whose leaf host is still pending and whose child hosts are settled, when the queue holds child 2, then child 2 is re-validated before the leaf host is admitted. | 33 | covered | "the leaf host stays `pending`" | diff-local |
| criterion | Story 8 negative: Given a newer generation replaced child 2's entry while child 2 was being validated, when the PASS acknowledgement is attempted, then the compare-and-swap fails and child 2 stays queued. | 36 | covered | "with a newer generation, the compare-and-swap fails and child 2 is still queued" | diff-local |
| criterion | Story 8 negative: Given child 2's closure moved during validation, when the PASS acknowledgement is attempted, then it fails, and the entry, the round and the marker stay pending. | 36 | covered | "with `closed/c2` moved, it fails" | diff-local |
| criterion | Story 8 negative: Given a queued child and no `revalidate` round for it, when region entry is attempted for that child, then it is refused, and no region step is dispatched. | 34 | covered | "is refused, and the dispatch spy records no region step" | diff-local |
| criterion | Story 8 negative: Given the same `revalidate` round is entered again after a crash, when region entry runs, then child 2's region is not restaged a second time. | 34 | covered | "restages nothing" | diff-local |
| criterion | Story 8 negative: Given a crash after child 2's `revalidate` record is created in phase `prepared` and before its marker is set, when the feature resumes, then that record is aborted, nothing was mutated, and child 2 stays queued. | 33 | covered | "resume deletes the `prepared` record" | diff-local |
| criterion | Story 8 negative: Given child 2's `revalidate` round dispatches BUILD after a failing gate, when the dispatch runs, then no round receipt is settled and no lap or growth is charged. | 34 | covered | "no receipt is settled" | diff-local |
| criterion | Story 9 happy: Given child 2's re-validation fails `test_suite` and child 2's region then fixes it with a commit, when region exit runs, then the fix leaves through an exit restack originating at child 2, and child 2's entry is removed only in that restack's `applied` transaction with outcome `fixed`. | 37 | covered | "child 2's entry is removed only in that restack's `applied` transaction" | diff-local |
| criterion | Story 9 happy: Given a fix made during re-validation, when `build_review` grades it, then it is graded against child 2's tip pinned at region entry, not against child 2's whole contribution. | 37 | covered | "returns `{kind: 'revalidation-fix', sha: <entry pinnedBase>}`" | diff-local |
| criterion | Story 9 negative: Given child 2's re-validation keeps failing, when child 2's region caps are exhausted, then the feature halts needs-human naming child 2, and child 2 stays queued. | 37 | covered | "the queue still holds child 2's entry" | diff-local |
| criterion | Story 9 negative: Given four queued children whose re-validations each fix and restack, when the driven loop runs, then it terminates within `MAX_RESTACK_CASCADES_PER_CHILD` per origin and each child's region caps. | 38 | covered | "every child's cascade count stays at or below `MAX_RESTACK_CASCADES_PER_CHILD`" | diff-local |
| criterion | Story 10 happy: Given a base refresh is requested while the queue holds child 2, when the stack preflight runs, then no ref moves, a `restack_refused` event with reason `deferred-base-refresh` is recorded, and the request is retained. | 39 | covered | "emits one `restack_refused` with reason `deferred-base-refresh`" | diff-local |
| criterion | Story 10 happy: Given an automatic repair whose base-refresh follow-on is due and whose `applied` transaction queued child 2, when the follow-on would run, in the preflight or in recovery, then it is suppressed, a `restack_refused` event with reason `deferred-base-refresh` is recorded, the repair journal becomes terminal, and the base-refresh request is retained. | 40 | covered | "the REKICK sentinel file still exists" | diff-local |
| criterion | Story 10 happy: Given the queue then drains and no round is open, when the next stack preflight runs, then the retained base refresh runs. | 39 | covered | "runs a `base-refresh` restack" | diff-local |
| criterion | Story 10 negative: Given the queue ref exists with no entries, when the deferral check runs, then the base refresh is not deferred. | 39 | covered | "a due base refresh is not deferred" | diff-local |
| criterion | Story 10 negative: Given the queue ref is unreadable, when the deferral check runs, then the base refresh is deferred. | 39 | covered | "with an unreadable queue ref it is deferred" | diff-local |
| criterion | Story 10 negative: Given the queue ref has no entries and an empty outbox, when its last event is drained, then the queue ref is deleted in that same compare-and-swap. | 41 | covered | "deletes `refs/conductor/demo/revalidate` in the same compare-and-swap" | diff-local |
| criterion | Story 11 happy: Given a project config with no `stacked_prs.route_whole_feature_fixes` key, when the config is loaded, then the setting resolves to `true`. | 42 | covered | "with the key absent and with the `stacked_prs` block absent" | diff-local |
| criterion | Story 11 happy: Given a project config that sets `stacked_prs.route_whole_feature_fixes: false`, when the config is loaded, then it resolves to `false`, and a stacked feature remediates exactly as before this spec. | 42 | covered | "with the key set `false`, `loadConfig` resolves `false`" | diff-local |
| criterion | Story 11 happy: Given child 2 is re-validated, when `events.jsonl` is read, then it holds one `child_revalidated` event naming child 2, the generation, the closure SHA and an outcome of `passed` or `fixed`. | 43 | covered | "holds exactly one `child_revalidated` event naming child 2" | diff-local |
| criterion | Story 11 negative: Given a crash between the queue transaction that records child 2's outcome and the outbox drain, when the stack preflight runs, then the `child_revalidated` event is delivered once. | 41 | covered | "holds it exactly once after a second drain" | diff-local |
| criterion | Story 11 negative: Given the same `child_revalidated` event is delivered twice, when the persister writes it, then `events.jsonl` holds it once. | 43 | covered | "writes it once to `.pipeline/events.jsonl`" | diff-local |
| criterion | Story 11 negative: Given an N=1 feature with routing on by default, when it remediates, then no `routes`, `repairing` or `revalidate` ref is read or written. | 43 | covered | "records no git command naming `routes`, `repairing` or `revalidate`" | diff-local |

## Judgement record

- **Criterion coverage (§4g):** independent coverage judges ran four rounds over the 96 criteria.
  Rounds 1–3 refused claims 18, 28, 38 and 86, each over a Done-when check that left one outcome
  implied. Tasks 8, 18, 21 and 40 were tightened, and the fourth round accepted claim 86. Every
  quote is an exact substring of a cited task's Done-when block.
- **Architecture obligations (§4f):** an opus judge reviewed all 40 rows and refused 11. They were
  corrected before this artifact was committed:
  - routed D6, D7, D13, D14, D16 and D18 and restack D4 and D9 now cite the tasks whose checks carry
    the amended obligations (Tasks 2, 4, 6, 7, 10, 13, 14, 19, 25, 28, 32, 34, 36, 39 and 40);
  - Task 20 gains a check that a round with every host settled and a queued child closes with no
    `leafReturn`, before the queue is consumed (routed D6's `closed` row);
  - routed D11 is now a `task` row citing Tasks 24 and 26, which deliver its return path;
  - as-built D2 and D6 are `no-change`, because this spec reads no as-built report and emits no
    classification or remediation-outcome event.

  Every `existing` symbol in the remaining rows was confirmed at its cited path.
- **Operator decisions in this DECIDE pass:**
  - full scope, with no further split; three stacked slices;
  - approach A on the technical track;
  - a published stack refuses, and the PR comment and stack refresh stay with #3269 and #3268;
  - the conflict resolutions in `.docs/conflicts/a-routed-fix-is-never-carried-up-the-stack-or-foll.md`,
    with amendment notes on three ADRs;
  - REKICK is re-armed by recovery when a follow-on base refresh is deferred.
