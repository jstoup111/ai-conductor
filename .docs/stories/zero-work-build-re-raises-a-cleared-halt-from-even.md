**Status:** Accepted

# Stories: BUILD settles without a dispatch when no work is owed (#3659)

Technical track. Design: `adr-2026-11-15-build-settles-without-dispatch-when-no-work-is-owed` and
`adr-2026-07-10-daemon-stall-remediation` as amended. "No work owed" means: the engine's existing
BUILD completion check reports every planned task in scope complete, and the execution child has no open remediation case eligible for BUILD, no
hosted taskless obligation, no pending repair authorization and no gate kickback pending against
BUILD. The existing completion check is unchanged: it never reports complete from task status
rows alone, for a plan with no parseable tasks, or while the halt marker is present.

## Story 1: A BUILD with no work owed settles without a provider session

As an operator running the daemon, I want a BUILD that has nothing to do to finish by itself so
that no agent session is paid for and none can raise a halt.

### Acceptance Criteria

#### Happy Path
- Given a stacked child with no work owed and BUILD not yet done, when the engine reaches BUILD for that child, then BUILD is marked done, no provider session is dispatched, and the run continues to the child's next gate.
- Given a flat feature with no children, no work owed and BUILD not yet done, when the engine reaches BUILD, then BUILD is marked done and no provider session is dispatched.
- Given a BUILD settled this way, when the event ledger is read, then it holds a `gate_verdict` for `build` and a `step_completed` for `build` marked unmetered, and the stored BUILD verdict records the outcome `no-work-owed` produced at the dispatch boundary.
- Given a BUILD settled this way, when the run state is read, then no retry attempt, kickback budget or remediation round was consumed and no HALT file exists.

#### Negative Paths
- Given a child with one planned task still pending, when the engine reaches BUILD, then a provider session is dispatched as it is today and the verdict does not record `no-work-owed`.
- Given a child whose tasks are all complete and that has an open remediation case eligible for BUILD, when the engine reaches BUILD, then a provider session is dispatched with that case's work order.
- Given a child whose tasks are all complete and that hosts a taskless obligation, when the engine reaches BUILD, then a provider session is dispatched with the obligation's retry hint.
- Given a child whose tasks are all complete and a pending repair authorization, when the engine reaches BUILD, then BUILD is not settled as `no-work-owed` and the existing kickback no-op guard decides the outcome.
- Given a child whose tasks are all complete and a failed gate that sent the run back to BUILD, when the engine reaches BUILD, then BUILD is not settled as `no-work-owed` and the existing no-op-cycle refusal decides the outcome.
- Given a child whose task status file is missing or is not valid JSON, when the engine reaches BUILD, then a provider session is dispatched and BUILD is not marked done.
- Given a feature whose plan file is missing or has no parseable tasks, when the engine reaches BUILD, then BUILD is not settled as `no-work-owed` and the existing empty-plan path is taken.
- Given a child with all tasks complete and the halt marker file present, when the engine reaches BUILD, then BUILD is not settled as `no-work-owed` and the marker is handled as it is today.
- Given a child whose task status rows all read completed and whose branch holds no commits for those tasks, when the engine reaches BUILD, then BUILD is not settled as `no-work-owed`.
- Given a child with all tasks complete and uncommitted paths in the worktree, when the engine reaches BUILD, then a provider session is dispatched and BUILD is not marked done.
- Given a run started with `--from build` on a feature with no work owed, when the engine reaches BUILD, then a provider session is dispatched.
- Given an operator round entering a host with no work owed, when the engine reaches BUILD, then a provider session is dispatched.
- Given the engine stopped after the BUILD verdict was written and before BUILD was marked done, when the feature is dispatched again, then BUILD settles as `no-work-owed` once and the ledger holds no second provider dispatch for BUILD.

### Done When
- [ ] An engine test drives a stacked child with no work owed through the step loop and observes BUILD `done`, zero provider dispatches for `build`, and the next gate started.
- [ ] The same test observes the `gate_verdict` and unmetered `step_completed` events and the `no-work-owed` outcome on the stored verdict.
- [ ] One engine test per negative path above observes a provider dispatch, or the named existing guard, and no `no-work-owed` outcome.

## Story 2: A revalidate round with BUILD queued settles BUILD and runs its other gates

As an operator of a stacked feature, I want a restack re-validation that has no build work to go
straight to its tests and review so that a closed child is re-validated without an idle BUILD.

### Acceptance Criteria

#### Happy Path
- Given a revalidate round for a closed child whose queued gates are `build` and `test_suite`, with no work owed, when the engine reaches BUILD in that round, then BUILD settles without a provider session, `test_suite` runs, and the queue entry is acknowledged when the gates pass.
- Given a revalidate round with no items for a child whose 88 planned tasks are all complete, and an event ledger that holds an earlier `loop_halt` for that child's BUILD, when the engine reaches BUILD in that round, then no BUILD provider session is dispatched and no HALT is written.

#### Negative Paths
- Given a revalidate round whose BUILD settled as `no-work-owed` and whose `test_suite` then fails, when the failure sends the run back to BUILD, then BUILD is not settled again, and it is dispatched with the failure as its hint unless the existing no-op-cycle refusal applies.
- Given a revalidate round for a child with a planned task still pending, when the round is entered, then a BUILD provider session is dispatched as it is today.
- Given a revalidate round whose host is entered, when region entry runs, then no no-op settle and no no-op halt is applied at region entry, as today; the settle happens only when the engine reaches the BUILD step.
- Given an audit round whose host has every routed task complete, when the host is entered, then it takes the existing `derived-already-complete` exit unchanged and no `no-work-owed` outcome is recorded.

### Done When
- [ ] An engine test enters a revalidate round with `build` and `test_suite` queued and observes zero BUILD dispatches, a `test_suite` run, and the queue entry acknowledged.
- [ ] An engine test reproduces the observed case (no items, all tasks complete, earlier `loop_halt` on the ledger) and observes no BUILD dispatch and no HALT.
- [ ] An engine test observes the BUILD dispatch after a `test_suite` failure in the same round.
- [ ] The existing audit-round `derived-already-complete` tests pass unchanged.

## Story 3: A build stall whose question is moot ends without a human

As an operator, I want a build stall that asks about work nobody owes to resolve itself so that I
am not asked a question with no answer.

### Acceptance Criteria

#### Happy Path
- Given a halt-marker build stall on a child with no work owed and a remediation result of `no-work-owed`, when the engine consumes the result, then BUILD is marked done, no HALT is written, and the run continues to the next gate.
- Given that settle, when the stored BUILD verdict is read, then it records the outcome `no-work-owed` produced by a remediation verdict.
- Given a build-stall remediation result of `no-work-owed`, when the engine validates the remediation plan, then the plan is accepted.

#### Negative Paths
- Given a halt-marker build stall on a child with a planned task still pending and a remediation result of `no-work-owed`, when the engine consumes the result, then BUILD is not marked done, a BUILD provider session resumes with a hint naming the pending work, and no remediation round is charged beyond the one already charged for dispatching that remediation.
- Given that contradicted result repeated until the remediation round budget is exhausted, when the next halt-marker stall occurs, then the run halts as it does today with the stall question as the first line of the HALT.
- Given a `no_task_progress` build stall and a remediation result of `no-work-owed`, when the engine consumes the result, then BUILD is not marked done, BUILD resumes with a hint naming the pending work, and that stall's existing rule that it never halts from the remediation outcome is unchanged.
- Given a remediation plan from a source other than a build stall that carries `no-work-owed`, when the engine validates the plan, then the plan is rejected as a planner fault and no step is marked done.
- Given a build-stall remediation result of `unanswerable`, when the engine consumes the result, then the run halts as it does today with the question preserved.
- Given a build stall on a child with no work owed and a remediation result that routes to BUILD with an answer, when the engine consumes the result, then BUILD resumes with that answer as it does today.

### Done When
- [ ] An engine test feeds a `no-work-owed` plan for a build stall on a child with no work owed and observes BUILD `done`, no HALT file, and the next gate started.
- [ ] An engine test feeds the same plan on a child with a pending task and observes a resumed BUILD dispatch whose hint names the pending task, and exactly one remediation round charged for the stall.
- [ ] A plan-contract test accepts `no-work-owed` for the build-stall sources and rejects it for every other source.
- [ ] The existing tests for `route`, `architectural-clarity`, `product-scope` and `unanswerable` stall outcomes pass unchanged.

## Story 4: The stall remediation is told which halt reasons were already cleared

As an operator, I want the remediation to know that a halt it is reading was already cleared so
that a cleared halt is raised again only when live state still supports it.

### Acceptance Criteria

#### Happy Path
- Given a build stall for a child whose event ledger holds two earlier `loop_halt` entries for that child's BUILD, when the engine dispatches the stall remediation, then the remediation input lists both reasons and labels them as no longer in force.
- Given a stall question that repeats a cleared halt reason, on a child with a planned task still pending, when the remediation policy is applied, then the policy directs a route to BUILD whose answer says the halt was cleared and the planned work continues.
- Given a stall question that repeats a cleared halt reason, on a child with no work owed, when the remediation policy is applied, then the policy directs the `no-work-owed` verdict.

#### Negative Paths
- Given a build stall for child 3 and a ledger whose only earlier `loop_halt` entries belong to child 4 or to a step other than BUILD, when the engine dispatches the stall remediation, then the remediation input lists no earlier halt reasons.
- Given an event ledger that is missing or holds a line that is not valid JSON, when the engine dispatches the stall remediation, then the remediation is dispatched with no earlier halt reasons and the stall question unchanged.
- Given a ledger with twenty earlier `loop_halt` entries for the child's BUILD, eighteen of them with identical text, when the engine dispatches the stall remediation, then the input lists each distinct reason once and no more than the engine's fixed bound.
- Given a stall question that repeats a cleared halt reason and an open remediation case that still supports it, when the remediation policy is applied, then the policy directs the halt category that fits the question and does not direct `no-work-owed`.

### Done When
- [ ] An engine test seeds a ledger with `loop_halt` entries for two children and two steps and observes that the stall remediation input holds only the matching child's BUILD reasons, labelled as no longer in force.
- [ ] An engine test covers the missing ledger, the malformed line and the duplicate-and-bound cases.
- [ ] The `/remediate` skill and the remediation-planner persona state the `no-work-owed` verdict, when it applies, and how earlier halt reasons are to be weighed; the skill contract check passes.

## Story 5: Clearing a halt on a BUILD with nothing to do advances the child

As an operator, I want the existing halt clear command to be enough to move a child past a BUILD
with nothing to do so that I never edit engine state by hand.

### Acceptance Criteria

#### Happy Path
- Given a child halted on BUILD with BUILD recorded as in progress and no work owed, when the operator clears the halt with the existing halt clear command and the feature is dispatched again, then BUILD is marked done without a provider session and the child's next gate starts.
- Given that recovery, when the operator's actions are listed, then the only command used is the existing halt clear command and no state file was edited.

#### Negative Paths
- Given a child halted on BUILD with a planned task still pending, when the operator clears the halt and the feature is dispatched again, then a BUILD provider session is dispatched and BUILD is not marked done.
- Given a child halted on BUILD by a `needs-human` HALT with no work owed, when the daemon considers the feature again without the halt being cleared, then nothing is dispatched and BUILD stays as recorded.

### Done When
- [ ] An engine test starts from the observed state (BUILD in progress, HALT present, all tasks complete, no open case), clears the halt through the production halt clear path, re-dispatches, and observes BUILD `done`, zero BUILD provider dispatches, and the next gate started.
- [ ] An engine test observes the BUILD dispatch for the pending-task case and no dispatch for the uncleared case.
