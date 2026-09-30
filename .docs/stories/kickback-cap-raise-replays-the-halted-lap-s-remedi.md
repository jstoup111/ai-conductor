**Status:** Accepted

# Stories: Kickback cap halts at the remediation→build transition (#2753)

## Story 1: A raised lap-cap halt resumes straight into build on the planned repair

**Requirement:** Technical intent TI-1: an exhausted prd_audit remediation lap halts with the lap's repair already planned and pending, and a consumed raise builds that exact repair without re-auditing.

As an operator, I want a kickback-budget raise to spend its first lap building the fix remediate already planned so that I stop paying for a full re-audit of unchanged code.

### Acceptance Criteria

#### Happy Path

- Given a feature whose prd_audit lap allowance is exhausted and whose audit reports FIXABLE findings, when the remediation round runs, then remediate is dispatched, its admitted tasks are appended to the plan and committed, and the feature halts with class kickback-cap before build is dispatched.
- Given that halt, when the plan task status is read, then every appended remediation task is present as pending with the same id and title remediate wrote, and the build step is recorded as not done.
- Given that halt and a consumed kickback-budget raise for prd_audit, when the feature next dispatches, then the first step dispatched is build, the pending remediation tasks are the tasks it builds, and prd_audit, manual_test and architecture_review_as_built are not dispatched before that build completes.

#### Negative Paths

- Given an exhausted prd_audit lap allowance, when the remediation round is evaluated, then no halt fires before remediate is dispatched, and the halt fires only at the build transition after the append is committed.
- Given the halted feature with no raise recorded, when the daemon evaluates it for dispatch, then it stays halted with class kickback-cap and neither build nor any audit gate is dispatched.
- Given the halted feature and a raise bound to an older halt generation, when the daemon evaluates the authorization, then the authorization is not consumed and the feature stays halted without dispatching build.

### Done When

- [ ] A conductor test drives an exhausted prd_audit lap with FIXABLE findings and asserts the dispatch order remediate, then halt, with no build dispatch and a kickback-cap HALT.class.
- [ ] The same test asserts that task-status lists every appended remediation task as pending and that the conduct state records build as not done.
- [ ] A resume test after a consumed raise asserts that build is the next dispatched step and that no validation-group member dispatches before build completes.
- [ ] The halt text names every finding and the prd_audit recovery hint, as today's lap-cap halt does.

## Story 2: Growth and as-built caps halt at the same transition, all or nothing

**Requirement:** Technical intent TI-2: plan-growth and architecture_review_as_built cap halts follow Story 1's transition behavior, and a round that feeds several gates is authorized for all of them or none.

As an operator, I want every remediation cap halt to behave the same way so that any raise resumes into build regardless of which allowance ran out.

### Acceptance Criteria

#### Happy Path

- Given a prd_audit round whose admitted tasks exceed the remaining plan-growth allowance, when the round runs, then the tasks are appended and pending and the feature halts kickback-cap at the build transition naming the growth allowance and every finding.
- Given an as-built REMEDIABLE round whose lap allowance is exhausted, when the round runs, then its tasks are appended and pending and the feature halts kickback-cap at the build transition naming the as-built lap allowance.
- Given a mixed prd_audit and as-built round where both allowances are available, when build dispatches, then both gates are charged their lap and growth together and build runs.

#### Negative Paths

- Given a mixed prd_audit and as-built round where only the as-built lap is exhausted, when build would dispatch, then the feature halts kickback-cap and neither gate's lap nor growth is charged.
- Given a growth-cap halt and a consumed growth raise too small for the pending tasks, when build would dispatch, then the feature halts kickback-cap again with a new halt generation and nothing is charged.
- Given a growth-cap halt and a consumed raise for the wrong gate, when build would dispatch, then the feature halts kickback-cap again on the still-exhausted allowance and build is not dispatched.

### Done When

- [ ] Tests cover growth-cap and as-built lap-cap rounds, asserting appended pending tasks, a kickback-cap halt at the build transition, and halt text naming the allowance and findings.
- [ ] A mixed-round test with one exhausted gate asserts that the ledger laps and growth values for both gates are unchanged after the halt.
- [ ] A mixed-round test with both gates available asserts that both gates' laps and growth advance by exactly one round's charges when build dispatches.

## Story 3: Allowance is charged when build dispatches, not when tasks are appended

**Requirement:** Technical intent TI-3: laps and plan growth are charged once, at the build dispatch that uses them, and appended but uncharged tasks never count as authored plan work.

As an operator, I want kickback accounting to reflect repairs actually built so that a halted repair neither spends nor refunds allowance.

### Acceptance Criteria

#### Happy Path

- Given a remediation round within its allowances, when its tasks are appended, then the gate's laps and the growth added count are unchanged until build dispatches, and at that dispatch they advance by one lap and by the appended task count.
- Given an existing-task disposition round, when build dispatches, then the gate's laps advance by one and the growth added count does not change.
- Given a halted repair with appended uncharged tasks, when the plan-growth allowance is read, then the authored count excludes those tasks and the remaining allowance is computed as if they were not yet added.
- Given an existing-task round whose gate lap allowance is exhausted, when the round runs, then its bound tasks are re-staged pending and the feature halts kickback-cap at the build transition with no lap charged.

#### Negative Paths

- Given a charged repair whose build has dispatched, when the same build step is re-dispatched after a retry or restart, then the lap and growth are not charged a second time.
- Given a halted repair with appended uncharged tasks and no prior growth record, when growth is derived from the active plan, then the appended tasks are not counted as authored and the 25 percent growth denominator is unchanged by them.
- Given a remediation round whose append fails, when the round completes, then no pending charge is recorded and the laps and growth values are unchanged.
- Given a plan that already contained rem- prefixed tasks before this feature's growth record existed, when growth is derived with a pending repair recorded, then those earlier tasks still count as authored and only the tasks named by the pending charge are excluded.
- Given an unreadable kickback ledger, when a remediation round would append, then the feature halts fail-closed and no task is appended and no pending charge is recorded.
- Given a kickback ledger whose pending repair record is present but malformed, when build would dispatch or a budget is read, then the prd_audit, as-built and growth allowances read as exhausted and build is not dispatched.
- Given an existing-task round replayed after a crash, when admission runs again for the same repair obligation, then no second pending charge is recorded and only one lap is charged at build dispatch.

### Done When

- [ ] Ledger tests assert that laps and growth added are unchanged after append and advance exactly once at build dispatch.
- [ ] A retry and restart test asserts that no double charge occurs for one repair.
- [ ] Growth-derivation tests with and without a stored growth record assert that pending tasks are excluded from authored.
- [ ] An existing-task round test asserts one lap and zero growth charged at dispatch, and no lap charged at restage.
- [ ] An existing-task round at an exhausted lap cap is shown re-staging its bound tasks pending and halting at the build transition with no lap charged.
- [ ] Growth-derivation tests assert that exclusion keys on the recorded pending charge, never on the rem- task-id prefix, and that an unreadable ledger appends nothing.

## Story 4: A resume that rebases builds first, then re-runs re-opened gates

**Requirement:** Technical intent TI-4: rebase-first resume after a raise treats the halted repair as unfinished build work, and gates re-opened by the rebase run after that build.

As an operator, I want a raise that coincides with a rebase to build the fix first so that the rebase does not skip the build or halt the feature.

### Acceptance Criteria

#### Happy Path

- Given a raised cap halt whose resume rebase changes code, when the re-kick applies rebase verdicts, then build is dispatched on the pending remediation tasks before any re-opened gate.
- Given a raised cap halt whose resume rebase is a no-op, when the feature resumes, then build is dispatched on the pending remediation tasks.

#### Negative Paths

- Given a raised cap halt with pending remediation tasks, when the rebase re-kick evaluates build, then it does not report build re-verified mechanically, does not skip the build dispatch, and does not halt with completed BUILD evidence unavailable.
- Given a raised cap halt whose resume rebase re-opens coverage_binding, test_suite, build_review, prd_audit and architecture_review_as_built, when the feature resumes, then none of those gates dispatches before build completes.

### Done When

- [ ] A daemon re-kick test with a changed rebase asserts that build dispatches first and re-opened gates follow.
- [ ] A re-kick test asserts that no completed BUILD evidence unavailable halt is written for a feature halted at the transition.

## Story 5: Halts without a planned repair, and over-scope decisions, keep today's behavior

**Requirement:** Technical intent TI-5: only a halt that carries an appended or bound repair takes the new path, and scope decisions still gate remediation.

As an operator, I want the change confined to cap halts with a planned repair so that other halts and scope decisions behave exactly as before.

### Acceptance Criteria

#### Happy Path

- Given a remediation round that halts needs-human before appending, such as a remediation plan with no recognized disposition, when the halt is written, then no pending charge is recorded and the halt class and text are unchanged from today.
- Given a prd_audit report with an undecided OVER_SCOPE finding alongside FIXABLE findings, when the round runs, then the feature halts on the scope decision before remediate is dispatched and no remediation task is appended.
- Given a prd_audit report whose OVER_SCOPE findings are all accepted and FIXABLE findings remain, when the round runs, then remediation proceeds under the new transition behavior.

#### Negative Paths

- Given a halt for an undecided or refused OVER_SCOPE finding, when an operator runs a kickback-budget raise, then the raise does not clear that halt and remediate is not dispatched.
- Given a build_review, test_suite or manual_test kickback, when build dispatches, then no prd_audit or as-built pending charge is settled and those gates' existing accounting is unchanged.
- Given the route-into-no-op guard fires after an append, when the halt is written, then it is a needs-human halt as today, the pending repair is discarded without charging any lap or growth, and a later build dispatch settles nothing for it.
- Given a coverage_binding existing-task reopen, when its tasks are re-staged, then its lap is charged at restage exactly as today and no pending repair is recorded for it.

### Done When

- [ ] Tests assert that no-repair halts write no pending charge and keep their current class and text.
- [ ] An over-scope test asserts the scope halt precedes remediate and a raise cannot clear it.
- [ ] A non-prd_audit kickback test asserts unchanged ledger accounting at build dispatch.
