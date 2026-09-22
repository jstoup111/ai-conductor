**Status:** Accepted

# Stories: Mergeable autoresolve tier-2 escalates every content conflict to the operator

Technical track (no PRD). Source: intake jstoup111/ai-conductor#2607. Scope is bound by
`.docs/track/mergeable-autoresolve-tier-2-escalates-every-conte.md`: the judgement exception covers
only conflicts whose every conflicted path is test code, on the mergeable sweep path.

## Story 1: A test-only conflict is resolved and published without the operator

As an operator, I want a conflict confined to test code to be settled by the sweep so that a finished, green pull request returns to mergeable on its own.

### Acceptance Criteria

#### Happy Path
- Given a watched pull request whose only remaining conflicts after tier 1 are in test files, when the resolver declares the replayed commit superseded by upstream and the configured suite command exits zero, then the rebased branch is pushed with lease protection and the sweep outcome for that pull request is refreshed rather than escalated.
- Given a watched pull request whose only remaining conflicts are in test files, when the resolver merges both sides' changes without dropping any commit and the suite command exits zero, then the branch is pushed and no commit is reported as superseded.

#### Negative Paths
- Given a test-only conflict the resolver settled, when the configured suite command exits non-zero, then nothing is pushed and the pull request is escalated at the suite-gate stage with the exit code in the reason.
- Given a test-only conflict, when the resolver reports it cannot choose between the two intents, then nothing is pushed and the escalation comment names the replay commit, the file and region, both intents, and the missing decision.
- Given a test-only conflict, when the resolver's verdict is missing a required field or names an unknown choice, then the verdict is rejected, nothing is pushed, and the pull request is escalated with a reason naming the malformed verdict.
- Given a test-only conflict resolved with a passing suite, when the lease-protected push is rejected because the remote branch moved, then the pull request is escalated and no retry force-pushes over the remote.

### Done When
- [ ] A sweep run over a fixture shaped like pull request #2574 (one replay commit touching one test file, upstream rewrote the same lines) ends with outcome refreshed and a lease-protected push.
- [ ] The daemon log line for that run reads a tier-2 outcome other than conflict_halt.
- [ ] Each negative path ends with zero push invocations reaching the git boundary.

## Story 2: Conflicts touching non-test code keep today's stop

As an operator, I want production-path conflicts and finish-time rebases to behave exactly as before so that the narrow exception cannot ship a guessed runtime behavior.

### Acceptance Criteria

#### Happy Path
- Given a watched pull request with a conflict in a non-test file that the resolver can settle without any intent ambiguity, when the suite passes, then it is published as it is today and no supersession verdict is recorded.

#### Negative Paths
- Given a watched pull request whose conflicts include one test file and one non-test file, when tier 2 is dispatched, then the resolver is not told the exception is in force and an intent conflict in either file returns unresolved and escalates.
- Given a watched pull request with a non-test conflict, when the resolver returns a verdict declaring a commit superseded anyway, then the engine rejects the verdict, publishes nothing, and escalates.
- Given a feature at finish time whose rebase conflict is confined to test files, when the resolver is dispatched, then the exception is not in force and a semantic intent conflict halts the feature exactly as before this change.
- Given a daemon re-kick that resumes a paused rebase with a test-only conflict, when the resolver is dispatched, then the exception is not in force.

### Done When
- [ ] A test proves no dispatch originating from the finish-time rebase step or the re-kick path carries the exception signal.
- [ ] A mixed test and non-test conflict fixture escalates with the same comment shape as before this change.
- [ ] The test-only decision is made by engine code using the existing test-path convention, with no dependence on resolver output.

## Story 3: Only declared, replayed, test-only drops are excused

As an operator, I want the work-preservation guard to excuse exactly the commits the verdict declared so that the exception can never become a general skip.

### Acceptance Criteria

#### Happy Path
- Given a verdict declaring one commit superseded, when that commit was replayed by this rebase and every path it touched is a test path, then the work-preservation guard passes although the commit's subject is absent from the rebased branch.
- Given a declared-superseded commit that passed the guard, when the resolution completes, then the commit is recorded as rebase residue on the existing residue event.

#### Negative Paths
- Given a rebased branch missing a feature commit the verdict did not declare, when the guard runs, then it fails naming the missing subject and the pull request is escalated at the acceptance-guards stage.
- Given a verdict declaring a commit that touched one test file and one non-test file, when the guard runs, then the declaration is refused and the guard fails.
- Given a verdict declaring a commit id that this rebase never replayed, when the verdict is validated, then it is rejected and nothing is published.
- Given a verdict declaring every feature commit superseded, when the guard runs, then each declaration is checked individually and any non-test commit among them fails the guard.

### Done When
- [ ] The guard's result names which commits were excused and why.
- [ ] A finish-time caller that passes no declarations sees byte-identical guard behavior to before this change.
- [ ] A residue event is persisted for each excused commit.

## Story 4: The chosen resolution is recorded for after-the-fact audit

As an operator, I want each judged resolution written on the pull request so that I can audit the choice afterwards instead of deciding it up front.

### Acceptance Criteria

#### Happy Path
- Given a resolution published under the exception, when publication succeeds, then a comment on the pull request names the choice, the rationale, each superseded commit, and the verification command that ran with its passing result.
- Given a resolution published under the exception, when publication succeeds, then one verdict event carrying the same facts is persisted to the feature's event log through the existing emitter.
- Given a second judged resolution on the same pull request, when it is published, then the existing audit comment is updated in place rather than duplicated.

#### Negative Paths
- Given a resolution published under the exception, when posting the audit comment fails, then the push is not reverted, the failure is logged, and the verdict event is still persisted.
- Given a repository with no suite command configured, when a test-only conflict is settled, then nothing is published and no audit comment claims a verification.
- Given a resolution published without the exception, when publication succeeds, then no supersession audit comment is posted.

### Done When
- [ ] The audit comment for the #2574-shaped fixture contains the superseded commit id and the literal verification command.
- [ ] The verdict event type is declared in the event sink registry with persistence on.
- [ ] No code path posts the audit comment before the suite result is known.

## Story 5: A conflict-caused escalation label clears itself

As an operator, I want a pull request I or a later main made conflict-free to become eligible again so that I never remove the sticky label by hand.

### Acceptance Criteria

#### Happy Path
- Given autoresolve escalates a conflicting pull request, when the sweep records the outcome, then the watch entry stores conflict resolution as the escalation cause.
- Given a pull request labeled needs-remediation with a recorded conflict cause, when a sweep tick finds it no longer conflicting and its body carries no halt marker, then the sweep issues the label removal, and once a later read shows the label gone the recorded cause is cleared.
- Given a pull request whose label was cleared this way, when it later becomes conflicting again, then it passes the sticky-label eligibility gate.

#### Negative Paths
- Given a labeled pull request with a recorded conflict cause, when it is still conflicting, then the label stays and eligibility reports the sticky escalation skip.
- Given a pull request labeled after ci-fix exhaustion with no recorded conflict cause, when it is not conflicting, then the sweep never removes the label.
- Given a labeled pull request with a recorded conflict cause, when its body carries a halt marker, then the sweep does not remove the label.
- Given a watch entry written before this change with no cause field, when the sweep reads it, then it is treated as having no recorded cause and the label is left alone.
- Given the sweep issued a label removal and the next read still shows the label, when fewer than three removals have been issued for that pull request, then the recorded cause is retained and the removal is issued again.
- Given three label removals have been issued for a pull request and the label is still present, when the next tick runs, then the recorded cause is cleared, one log line names the pull request, the label is left in place, and no further removal is issued.
- Given the pull request's merge state is unknown, when the sweep evaluates the clear, then the label is left alone.

### Done When
- [ ] Removing the conflict by hand on a labeled fixture results in the label being gone after one sweep tick with no operator label edit.
- [ ] A ci-fix-exhausted fixture keeps its label across ticks while mergeable.
- [ ] The watch registry file round-trips entries with and without the cause field.
