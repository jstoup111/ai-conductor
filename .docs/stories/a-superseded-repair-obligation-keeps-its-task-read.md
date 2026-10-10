**Status:** Accepted

# Stories: A superseded repair obligation keeps its task reading as open (#2598)

Technical track (no PRD). Source: jstoup111/ai-conductor#2598. Tier: S. Scope: one shared
supersession rule for repair obligations, applied by every reader that decides whether a task is
open or complete. No repair-state schema change.

**Intent.** A task can collect more than one repair obligation as a feature goes through halt and
remediation laps. Each admission records itself as the task's *current* obligation
(`currentByPlan[plan][task]`). `RepairObligationStore.close` already treats an older obligation
from the **same** source authority as superseded and refuses to close it. The readers do not apply
that rule. The completion resolver, `openRepairForTask`, the Done-when task close and task seeding
all still treat the superseded record as open. Nothing can ever close it, so the task can stay open
for good. That is the failure #2598 describes (reverted commit `a2809fbd9`).

Terms used below:

- **Superseded.** An obligation O is superseded for task T when T's current obligation is a
  different record that exists and has the same source authority as O.
- **Live.** Every other obligation that binds T is live. That includes an older obligation from a
  *different* authority: obligations from different authorities each still need their own closure,
  and that stays unchanged.
- **Current-less.** A task is current-less when an open obligation binds it but T has no current
  entry, or the entry names a record that does not exist.

## Story 1: Completion ignores a superseded obligation and still honours live ones

As the build loop deciding whether a plan task is complete, I want a superseded repair obligation
to stop counting against its task. A feature that went through several remediation laps can then
finish once its current repair is done, and no task is let through while a live repair is open.

### Acceptance Criteria

#### Happy Path
- Given task 2 with an older open `build_review` obligation and a newer `build_review` obligation that is current and resolved, when the completion resolver evaluates task 2, then task 2 is resolved and no unavailable reason is recorded for it.
- Given the same two obligations with their baseline heads translated by a rebase rewrite, when the completion resolver evaluates task 2, then the newer obligation is still current, the older one is still superseded, and task 2 is still resolved.

#### Negative Paths
- Given task 2 whose current `build_review` obligation is open with no `Task:` trailer after its baseline, and an older superseded `build_review` obligation, when the completion resolver evaluates task 2, then task 2 is unresolved.
- Given task 2 with an open `prd_audit` obligation and a newer resolved `build_review` obligation that is current, when the completion resolver evaluates task 2, then task 2 is unresolved because the `prd_audit` obligation is live and has no closure evidence.
- Given task 2 whose older superseded obligation has a baseline head that no longer exists and no rebase successor, and whose current obligation is resolved, when the completion resolver evaluates task 2, then task 2 is resolved and no unavailable reason names the missing boundary.

### Done When
- [ ] `resolveTaskIdsWithDiagnostics` resolves a task whose only open obligations are superseded and whose live obligations are all resolved or evidenced.
- [ ] A live open obligation, from the same or a different authority, still keeps its task unresolved until its own closure or a post-boundary `Task:` trailer.
- [ ] Rewriting obligation baselines does not change which obligation the resolver treats as current or superseded.

## Story 2: Closing a task skips superseded obligations and closes every live one

As a build agent running `task done` on a repaired task, I want the close to succeed when an older
superseded obligation is still recorded. The repair can then finish instead of being refused with
"superseded" forever.

### Acceptance Criteria

#### Happy Path
- Given task 2 with an older open superseded `build_review` obligation and a newer open current `build_review` obligation, when `task done 2` closes the task with valid Done-when evidence, then it exits 0, the current obligation is resolved with `current-done-when` evidence, the superseded record is left unchanged, and the task-status row is `completed`.
- Given task 2 whose only open obligation is superseded, when `openRepairForTask` is asked about task 2, then it reports no open repair. Given task 2 whose current obligation is open, it reports that current obligation's id, not the superseded one's.

#### Negative Paths
- Given task 2 with an open `prd_audit` obligation and a newer open current `build_review` obligation, when `task done 2` closes the task with valid Done-when evidence, then both obligations are resolved, because a different-authority obligation is live and is not skipped.
- Given a superseded obligation, when `RepairObligationStore.close` is called for it directly, then it is still refused as `stale` with the message "Repair obligation has been superseded for this task", and the record stays open.

### Done When
- [ ] `completeTaskDoneWhen` closes exactly the live open obligations for the task and never tries to close a superseded one.
- [ ] `openRepairForTask` and `RepairObligationStore.close` agree on which obligation is superseded, because they share one definition.

## Story 3: Task seeding does not reopen a task for a superseded obligation

As the engine re-seeding task status before a BUILD dispatch, I want a task that has only
superseded open obligations to keep its completed row. A completed repair then does not flip back
to `pending` on the next seed.

### Acceptance Criteria

#### Happy Path
- Given task 2 with a `completed` task-status row, an older open superseded `build_review` obligation and a newer resolved current `build_review` obligation, when task status is seeded, then task 2's row stays `completed`.

#### Negative Paths
- Given task 2 with a `completed` task-status row and an open current obligation, when task status is seeded, then task 2's row is restaged to `pending`.

### Done When
- [ ] `seedTaskStatus` restages to `pending` only the tasks that have an open live obligation.

## Story 4: A task with an open obligation but no current entry fails closed with a named reason

As an operator diagnosing a stalled build, I want a task whose repair state is current-less to stay
open with a reason that says why. Such a task should never read as complete or fail with a
misleading "superseded" message.

### Acceptance Criteria

#### Happy Path
- Given task 2 with an open obligation and no `currentByPlan` entry for task 2, when the completion resolver evaluates task 2, then task 2 is unresolved and its unavailable reason is `repair state is unavailable: task 2 has an open repair obligation but no current obligation is recorded for it`, and the build completion check's pending reason contains that text.
- Given the same state, when `task done 2` runs, then it exits 1 and prints that same reason, and no obligation or task-status row changes.

#### Negative Paths
- Given task 2 whose `currentByPlan` entry names an obligation id that has no record, when the completion resolver, `openRepairForTask` and task seeding evaluate task 2, then each treats it as current-less: unresolved with the named reason, `unavailable` with the named reason, and a `pending` row respectively.
- Given task 3 in the same plan with no repair obligation and a `completed` row, and task 4 whose obligations are all resolved but which has no current entry, when the completion resolver evaluates tasks 3 and 4, then both are resolved and neither records an unavailable reason.

### Done When
- [ ] A current-less task is unresolved in `resolveTaskIdsWithDiagnostics`, `unavailable` in `openRepairForTask`, refused by `completeTaskDoneWhen`, and `pending` after seeding, and every refusal carries the named reason.
- [ ] Tasks with no open obligation are unaffected by the current-less rule.
