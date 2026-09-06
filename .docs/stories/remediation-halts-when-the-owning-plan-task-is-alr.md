**Status:** Accepted

# Stories: Reopened task resolution (#1831)

Technical track. Medium complexity. Source: jstoup111/ai-conductor#1831.

Derived from the operator-approved scope and `adr-2026-09-06-reopened-task-resolution`. These stories define observable behavior; the ADR and plan own the implementation mechanism.

## Story 1: An admitted repair reaches its owning task

As the operator, I want an actionable finding delivered to its owning task even after earlier completion, so the engine repairs the defect instead of refusing dispatch.

### Acceptance Criteria

#### Happy Path
- Given an admitted existing-task repair whose owning task has prior completion evidence, when the repair route is taken, then BUILD is dispatched for that task with the current finding and repair instruction, without appending a duplicate plan task.
- Given one admitted round binding several valid task references, including tolerated aliases, when the round is dispatched, then each distinct owning task receives its relevant findings and the existing gate lap is charged once for the round while plan-growth usage remains unchanged.

#### Negative Paths
- Given old completion evidence for an explicitly reopened task, when completion is checked before the repair has supplied current evidence, then the task remains unresolved and the route is not refused as already complete.
- Given an unknown task reference or a finding not authorized for existing-task repair, when admission runs, then the engine refuses that repair with the finding and invalid ownership/authority identified and does not append substitute work or grant an extra lap.

### Done When
- [ ] A captured BUILD dispatch names the bound task and current finding despite preexisting completion, with no added plan task.
- [ ] The round's recorded lap delta is one, its growth delta is zero, and repeated aliases produce one task obligation.
- [ ] Refused ownership leaves a named diagnostic and no dispatched unauthorized task.

## Story 2: A reopened task has a reachable current-evidence close path

As the operator, I want real repair to finish using current work or valid completion evidence, so old evidence cannot skip the repair and unnecessary commits are not required.

### Acceptance Criteria

#### Happy Path
- Given an open repair obligation and a later matching task commit, when shared task resolution evaluates the current repair, then the task can route forward to its governing review while all applicable completion checks still apply.
- Given an open repair whose applicable Done when checks are satisfied and freshly evidenced, including the existing permitted verify-only path, when the engine accepts task close, then the repair resolves and may reach a passing review without requiring another commit.
- Given a plan task that has never been explicitly reopened, when completion is evaluated, then its existing terminal-row, trailer, and legacy task-close behavior remains unchanged.

#### Negative Paths
- Given only a pre-reopen commit, an unrelated later commit, or a manually flipped completed row, when the current repair is evaluated, then none of those inputs alone resolves the repair.
- Given a repair close missing required current evidence or evidence belonging only to a prior repair, when closure is attempted, then the close is refused and the current repair remains open with the missing evidence identified.
- Given an unavailable repair freshness boundary, when historical commit evidence is examined, then older branch history is not substituted to close the repair; the affected task remains unresolved with a diagnostic, while a valid current evidence-based close remains usable.

### Done When
- [ ] A resolution result distinguishes the old task commit from a matching post-reopen task commit and from unrelated work.
- [ ] An evidence-only repair closes successfully on an unchanged commit, and its subsequent passing review ends that repair.
- [ ] Unreopened legacy fixtures retain their original resolution results; invalid current closure leaves the obligation open.

## Story 3: Restart resumes the same repair instead of forgetting or duplicating it

As the operator, I want an interrupted repair to resume with its finding and accounting intact, so restart does not skip unfinished work or charge another repair lap.

### Acceptance Criteria

#### Happy Path
- Given a durable admitted repair interrupted before or after its tasks are restaged, when the process resumes, then it uses the same repair obligation and original evidence boundary, dispatches its outstanding work with the finding context, and does not charge the admitted round again.
- Given an open repair and a missing task-status file while the durable repair state survives, when task state is reconstructed, then the reopened task remains unresolved and untouched previously completed tasks are restored according to their existing rules.
- Given a repair whose current closure was durably accepted before interruption, when the process resumes, then that repair remains resolved rather than being reopened by replay of the same admitted round.

#### Negative Paths
- Given an interruption between admission persistence, lap settlement, restaging, and dispatch, when recovery runs, then it does not omit outstanding work, advance the original evidence boundary, duplicate a charge, or create a second obligation for that same effect.
- Given a later genuinely distinct admitted repair for the same task, when it is reopened, then the previous repair's closure does not close the new one and replay deduplication does not suppress the new work.
- Given a task id reused in another active plan, when recovery evaluates current work, then completion or repair state from the previous plan does not resolve or reopen the new plan's task.

### Done When
- [ ] Before/after interruption observations show one obligation, one original boundary, one admitted-round charge, and retained finding context.
- [ ] Reconstructed state shows the open repair unresolved and an untouched completed sibling resolved.
- [ ] A completed repair stays completed on replay; a distinct later repair stays open until it has current evidence.

## Story 4: Concurrent and failed writes preserve trustworthy repair state

As the operator, I want state updates to preserve other work and refuse unsafe completion when persistence fails, so a write race cannot silently erase a repair.

### Acceptance Criteria

#### Happy Path
- Given concurrent updates for distinct tasks and ordinary plan bookkeeping, when those updates finish, then each successful update remains visible and no sibling repair or unrelated bookkeeping is lost.
- Given a legacy run without repair state, when it enters the shared state path, then normal operation continues under the prior completion rules until an explicit repair is admitted.

#### Negative Paths
- Given a persistence failure or unavailable mutation lease during repair admission or close, when the operation reports its result, then it reports the failure and does not dispatch an unrecorded repair or claim an unpersisted closure; previously durable sibling state remains intact.
- Given malformed or incompatible present repair state, when an affected task is evaluated, then the engine identifies the unreadable state and refuses to derive completion from historical evidence rather than treating the state as a legacy absence.

### Done When
- [ ] Concurrent successful operations leave all expected task obligations, closures, active-plan data, and appended-task bookkeeping readable together.
- [ ] Injected contention and write failures produce a named failure with no false dispatch or false close.
- [ ] Missing legacy state and malformed present state have distinct observed outcomes.

## Story 5: Explicit acceptance closes a completed scope objection

As the operator, I want a valid acceptance of completed scope to take effect, so approving that work does not lead to another reopen/build/accept cycle.

### Acceptance Criteria

#### Happy Path
- Given completed work whose only remaining blocker is a current OVER_SCOPE finding, when a valid explicit acceptance of that finding is recorded and effective evaluation runs, then the blocker is resolved and the workflow advances without reopening the task, dispatching BUILD, demanding a new commit, or charging a repair lap.
- Given that acceptance and an unchanged code tree, when the process restarts or the same pending route is reevaluated, then the acceptance remains effective under the existing decision authority and that accepted finding does not create a repair obligation.
- Given a valid acceptance covering one scope finding alongside an independent actionable defect, when routing runs, then the acceptance closes only its covered scope blocker and the remaining defect is handled through its existing authorized path.

#### Negative Paths
- Given only permission for another attempt, a budget increase, an inert halt clear, or an invalid acceptance, when completion is evaluated, then the engine does not treat it as acceptance of completed scope or proof of repair.
- Given a refused or still-unaccepted scope finding, when the workflow resumes, then that finding remains blocking with its actual decision status identified rather than being silently accepted or repeatedly offered as though no decision had been made.
- Given an acceptance for a different finding or only part of the current blocking set, when effective evaluation runs, then unrelated findings and missing completion evidence remain blocking.

### Done When
- [ ] An accepted-only fixture advances with zero BUILD calls, zero repair charges, and unchanged HEAD, including after restart.
- [ ] A mixed fixture retains the independent defect while reporting the accepted scope decision.
- [ ] Attempt-only, invalid, refused, and partial decisions cannot produce completion of the uncovered work.

## Story 6: Repair reaches review and unresolved work remains bounded

As the operator, I want the engine to recognize successful repair while stopping repeated unresolved work, so the fix cannot replace a dead end with an endless loop.

### Acceptance Criteria

#### Happy Path
- Given a repaired task with valid current completion evidence, when the governing effective review passes, then the repair cycle ends and the workflow advances even when no code-tree change was necessary.
- Given a genuinely new admitted repair within the existing allowance, when the round runs, then the existing progress and review safeguards remain active and its budget accounting follows the owning gate's existing rules.

#### Negative Paths
- Given a repair that only reopens and recloses task status without net progress and whose effective review still fails unchanged, when the existing no-progress check runs, then it stops the cycle with the prior and current failure context rather than granting another lap because status moved.
- Given exhausted existing lap allowance, or a repeated unresolved semantic case where the existing adjudicator governs it, when another repair route is considered, then the existing bound stops the route; reopening does not reset counters or bypass that authority.

### Done When
- [ ] A passing effective review is a terminal observation for the repair cycle, including an evidence-only close.
- [ ] The unchanged-failure fixture ends in the existing bounded halt with no further BUILD dispatch.
- [ ] Budget and configured semantic-repeat observations remain enforced across replay and task reopening.

## Story 7: No-work and refused-work diagnostics identify different causes

As the operator, I want a halt to identify whether remediation emitted nothing or the engine rejected emitted work, so recovery starts from the actual failure.

### Acceptance Criteria

#### Happy Path
- Given remediation that emits no concrete work and no valid owning-task binding, when the route cannot proceed, then its diagnostic identifies empty output rather than claiming completed tasks prevented dispatch.
- Given emitted work that cannot be dispatched, when the engine refuses it, then its diagnostic identifies the relevant cause and finding/task context: unresolved ownership, persistence/restaging failure, unavailable current evidence, or genuinely already-resolved emitted work.

#### Negative Paths
- Given a valid outstanding owning-task repair with historical completion, when diagnostics are produced, then it is not mislabeled as empty output or genuinely already-resolved work.
- Given a malformed remediation result or an unrecognized disposition, when it is rejected, then the existing failure is surfaced with its rejected input identified and is not silently converted into an accepted repair or a generic empty-work success.

### Done When
- [ ] Empty-output and emitted-but-refused fixtures expose different actionable reasons.
- [ ] Refusal observations retain source finding and task identity when available through the existing diagnostic/event path.
- [ ] Historical completion alone produces neither a false empty-work reason nor a false already-resolved halt for an admitted repair.

## Negative-category evaluation

Invalid input, authorization, concurrent updates, resource exhaustion, partial failure, dependency unavailability, data integrity, deduplication, and alternate-branch side effects are covered by the stories above. Local Git unavailability and file/lease failures are the relevant dependencies; this change introduces no hosted service or network protocol. Schema validation rejects incompatible present state rather than broadly catching it as absent. Cascade deletion and model immutability do not introduce separate scenarios because this feature deletes no entity and deliberately models explicit repair transitions; prior evidence and operator decisions remain preserved. Exception behavior is covered by the observable filesystem/Git failure outcomes, not by prescribing an exception class hierarchy.
