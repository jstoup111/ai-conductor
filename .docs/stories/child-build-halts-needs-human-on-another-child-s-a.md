**Status:** Accepted

# Child BUILD halts needs-human on another child's already-resolved build-review case

Technical track for jstoup111/ai-conductor#3658. Design:
`adr-2026-11-15-remediation-build-inputs-are-region-state-retired-on-settlement`.

In these stories, the **remediation inputs** are the build-review work order, the case judgement,
the typed gap plan, and the captured stall question. A **region** is one child's
`.pipeline/children/<k>/` directory in a stacked feature. A **stale citation** is a BUILD stall
question that names a case which is resolved, or which is open only in another child's case store.

## Story 1: A stacked child's remediation inputs live in that child's region

As the engine running a stacked feature, I want each child's remediation inputs kept in that child's region so that one child's BUILD is never handed another child's remediation work.

### Acceptance Criteria

#### Happy Path
- Given a stacked feature whose active child is 4 and whose build review admits a repair, when the engine publishes the work order, then the order is written under child 4's region and no work order exists at the feature-level `.pipeline/` path.
- Given child 4 has an open admitted repair with its work order in child 4's region, when child 4's BUILD is dispatched, then the BUILD prompt carries that work order's tasks.
- Given a stacked feature whose active child is 3 and a stall remediation that returns a typed gap plan, when the engine persists and reads the plan, then it is written under and read from child 3's region.
- Given a stacked feature whose active child is 3 and a BUILD stall with a question, when the engine captures the stall question, then the evidence file is written under child 3's region and the remediation dispatch cites that region path.
- Given a feature with no children and an admitted repair, when the engine publishes the work order, the gap plan, and the stall question, then each is written at the feature-level `.pipeline/` path exactly as before.

#### Negative Paths
- Given child 4's region holds a work order for an open case and child 3's case store has no open case, when child 3's BUILD is dispatched, then the BUILD prompt carries no work order content.
- Given child 3 has its own open admitted repair and child 4's region also holds a work order, when child 3's BUILD is dispatched, then the prompt carries only child 3's tasks and the run does not halt on a foreign work order.
- Given child 3's region holds a gap plan from an earlier attempt, when child 4 runs a stall remediation, then child 4's read does not return child 3's plan.
- Given child 3's region holds a captured stall question, when child 4 stalls with a different question, then child 4's remediation dispatch cites only child 4's question.
- Given a feature with no children and a work order whose case store has an open case, when BUILD is dispatched, then the prompt carries that work order's tasks.

### Done When
- [ ] A stacked-feature test shows the work order, gap plan, and stall question each written under the active child's region and absent from the feature-level path.
- [ ] A test with open cases in two children shows each child's BUILD prompt carrying only its own tasks, with no halt.
- [ ] A no-children test shows all three files at the feature-level path.

## Story 2: The engine moves the case judgement into the owning region

As the engine, I want the case judgement moved into the active child's region after I have read it so that it does not stay at a path every child's BUILD shares.

### Acceptance Criteria

#### Happy Path
- Given a stacked feature whose active child is 4 and a remediate session that wrote a fresh case judgement at `.pipeline/remediation.json`, when the engine has parsed it, then the judgement exists under child 4's region and no longer exists at the feature-level path.
- Given child 4 has an open admitted repair and its judgement in child 4's region, when child 4's BUILD is dispatched, then the BUILD prompt names that region path as the judgement the session may read.
- Given a stall remediation routed a typed gap plan back to child 3's BUILD, when that BUILD is dispatched, then the BUILD prompt names the gap plan's region path as an input the session may read.
- Given the BUILD skills, when a BUILD session needs finding detail for a repair, then the skills direct it to the remediation input paths named in its prompt and name no fixed feature-level path.

#### Negative Paths
- Given a remediate session wrote a judgement that fails to parse, when the engine handles the failed judgement, then the outcome is the same failure as before and no file is created in any region.
- Given child 3 has no open admitted repair, when child 3's BUILD is dispatched, then the BUILD prompt names no judgement path.
- Given child 3 has no gap plan in its region, when child 3's BUILD is dispatched, then the BUILD prompt names no gap plan path.
- Given a feature with no children and a parsed judgement, when BUILD is dispatched for an open admitted repair, then the prompt names the feature-level judgement path and the file is still there.

### Done When
- [ ] A stacked-feature test shows the judgement at the region path and absent from the feature-level path after a parsed lap.
- [ ] A prompt-content test shows the named judgement path present for an open repair and absent without one, and the same for a routed gap plan.
- [ ] `skills/tdd/SKILL.md` and `skills/pipeline/SKILL.md` refer to the prompt-named remediation input paths and no longer state that reading `.pipeline/remediation.json` is allowed.

## Story 3: Remediation inputs leave the live path when nothing open depends on them

As the engine, I want a remediation input deleted once nothing open depends on it so that a later BUILD cannot find settled remediation work on disk.

### Acceptance Criteria

#### Happy Path
- Given a region whose only open case is resolved by a clean build review, when settlement completes, then that region's work order and judgement no longer exist.
- Given a stall remediation routed a typed gap plan back to BUILD, when that BUILD passes its gate, then that gap plan no longer exists.
- Given a BUILD stall that has been routed back to BUILD or halted, when the stall handling ends, then that stall's captured question no longer exists.
- Given a region's work order and judgement were deleted on settlement, when the feature's event log and case store are read, then the resolved case and its reconciliation event are still recorded.

#### Negative Paths
- Given a region with two open cases, when one of them is resolved, then the work order and judgement remain and the next BUILD for that child still receives the remaining case's tasks.
- Given a case that BUILD attempted and whose finding is absent on the next lap, when the lap settles the case, then the case resolves as it did before and the work order is deleted only after that settlement.
- Given child 4's cases all resolve while child 3 has an open case, when child 4's settlement completes, then child 3's work order and judgement are untouched.
- Given the work order file cannot be deleted because of a filesystem error, when settlement completes, then the case stays resolved, the run continues, and the next settlement or dispatch tries the deletion again.
- Given a stall remediation whose dispatch throws before a plan is read, when the stall halts, then no gap plan from an earlier attempt remains in that region.
- Given a gap plan routed to BUILD and that BUILD has not yet passed its gate, when the BUILD session reads the path its prompt names, then the gap plan is still there.

### Done When
- [ ] A settlement test shows the work order and judgement gone once a region has no open case, and present while one remains.
- [ ] A test shows an attempted, now-absent case still retires with the order deleted afterwards.
- [ ] A stall-path test shows the stall question gone after the stall is routed and after it halts, and the gap plan present until the routed BUILD passes its gate and gone afterwards or after a halt.

## Story 4: A feature-level file left by an older engine is adopted or removed once

As the engine resuming a stacked feature an older engine left mid-remediation, I want its feature-level remediation inputs moved to their owner or removed so that the feature continues without a human and without stale files.

### Acceptance Criteria

#### Happy Path
- Given a stacked feature with a feature-level work order whose effect is recorded on an open case in child 4's store, when a child's BUILD is about to be dispatched, then the order is moved into child 4's region and child 4's BUILD receives its tasks.
- Given a stacked feature with a feature-level work order whose cases are all resolved, when a child's BUILD is about to be dispatched, then the order is deleted and no region gains a work order.
- Given a stacked feature with a feature-level judgement, gap plan, or stall question, when a child's BUILD is about to be dispatched, then each of those files is deleted.

#### Negative Paths
- Given a feature-level work order owned by child 4's open case and the active child is 3, when child 3's BUILD is dispatched, then the order is in child 4's region, child 3's prompt carries no work order content, and the run does not halt.
- Given a feature-level work order that cannot be parsed, when a child's BUILD is about to be dispatched, then the file is deleted and BUILD proceeds for a child with no open case.
- Given a feature with no children and a feature-level work order for an open case, when BUILD is dispatched, then the file is neither moved nor deleted.

### Done When
- [ ] A test starting from the mixed layout (child case store, feature-level order) shows the order adopted by its owning region and delivered to that child's BUILD.
- [ ] A test shows a fully settled feature-level order, judgement, gap plan, and stall question removed before a child's BUILD.
- [ ] A no-children test shows feature-level files left in place.

## Story 5: A stale citation re-dispatches BUILD instead of asking for a remediation plan

As the engine, I want a BUILD stall that only cites settled or foreign remediation work to be answered by me so that it does not consume a remediation dispatch or stop the feature.

### Acceptance Criteria

#### Happy Path
- Given child 3's BUILD stalls with a question naming a case that is resolved in child 4's store, when the engine handles the stall, then no remediation session is dispatched, the stall marker is cleared, and BUILD is dispatched again for child 3 in the same run.
- Given child 3's BUILD stalls with a question naming a case that is open only in child 4's store, when the engine handles the stall, then BUILD is dispatched again for child 3 and no remediation session is dispatched.
- Given a stale citation of a case owned by child 4, when BUILD is dispatched again, then its prompt states that the case is settled or belongs to child 4 and is not this session's work.
- Given a stale citation, when the engine handles it, then the feature event log records one stale-citation event carrying the case id, the owning child, whether the case is resolved or foreign, and the attempt number.
- Given a stale citation is re-dispatched, when the run's remediation round count is read, then it is unchanged.

#### Negative Paths
- Given child 3's BUILD stalls with a question naming a case that is open in child 3's own store, when the engine handles the stall, then stall remediation is dispatched exactly as before and no stale-citation event is recorded.
- Given a BUILD stall whose question names no case known to any child's store, when the engine handles the stall, then stall remediation is dispatched exactly as before.
- Given a BUILD stall with no question because no task progressed, when the engine handles the stall, then the existing zero-work stall path runs unchanged.
- Given a child's case store cannot be read while the engine checks a stall question, when the engine handles the stall, then it treats the question as naming no known case and dispatches stall remediation as before.
- Given a question that names both a resolved case and a case open in the active child's store, when the engine handles the stall, then stall remediation is dispatched as before.

### Done When
- [ ] A stall-seam test for each of resolved and foreign shows no remediate dispatch, a cleared marker, and a second BUILD dispatch whose prompt names the case and its owner.
- [ ] The stale-citation event appears in `.pipeline/events.jsonl` with case id, owner, state, and attempt.
- [ ] Tests for an owned open case, an unknown id, a zero-work stall, and an unreadable store show the existing remediation path taken.

## Story 6: Repeated stale citations stop the feature under a bound

As an operator, I want repeated stale citations of the same case to stop after a fixed number of attempts, first as a retryable stop and then as one I can clear, so that the feature neither loops without end nor needs me while it can still recover.

### Acceptance Criteria

#### Happy Path
- Given two consecutive stale citations of the same case have been re-dispatched, when a third occurs with no task completed between them, then the engine writes a `mechanical` HALT that carries the session's question verbatim, names the case and its owning child, and dispatches no further BUILD in that run.
- Given a `mechanical` HALT from a third stale citation, when the daemon re-kicks the feature and a fourth stale citation of the same case occurs, then the engine writes a `needs-human` HALT naming the case and its owning child.
- Given a `needs-human` HALT from a stale citation, when the operator runs the existing halt clear command, then the HALT is cleared and the feature is dispatched again.
- Given two stale citations of one case followed by a completed task, when a stale citation of the same case occurs again, then it is counted as attempt 1 and BUILD is re-dispatched.

#### Negative Paths
- Given two stale citations of one case, when a stale citation of a different case occurs, then it is counted as attempt 1 for that case and BUILD is re-dispatched.
- Given the stale-citation event cannot be written to the event log, when the engine handles the stale citation, then it writes a `needs-human` HALT and does not re-dispatch BUILD.
- Given a stale citation HALT of either class, when the operator runs `ai-conductor build-review resolve-case` for the cited case, then the command still refuses a resolved case and the HALT text names halt clear as the way forward and does not suggest resolve-case.
- Given the engine process restarts after two stale citations of the same case, when a third occurs, then it is counted as attempt 3 and halts `mechanical`.

### Done When
- [ ] A test drives attempts 1 to 4 across a simulated re-kick and observes two re-dispatches, a `mechanical` HALT, then a `needs-human` HALT.
- [ ] The HALT body carries the session's question verbatim and names the case id, its owning child, and the halt clear command.
- [ ] Tests show the count reset by a completed task and by a different case, and preserved across a restart.
- [ ] A test with a failing event write shows a `needs-human` HALT and no re-dispatch.
