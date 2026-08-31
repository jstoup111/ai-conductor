**Status:** Accepted

# Stories: existing-task remediation disposition (#2119)

Technical track — acceptance criteria derived from the approved architecture review
(architecture-review-2026-08-31) and adr-2026-08-25 decision 9.

## Story 1: An existing-task disposition routes without growing the plan

As the conductor, I want a finding whose remedy existing plan tasks already own to route back to BUILD without appending tasks, so that plan-growth allowance measures only real scope creep.

### Acceptance Criteria

#### Happy Path
- Given a validated as-built REMEDIABLE finding dispositioned `existing-task` bound to task ids present in the active plan, when remediation routes, then the feature rewinds to `build` and `appendRemediationTasks` is not invoked for that gap
- Given an `existing-task` gap admitted in a round, when budgets are settled, then the kickback ledger's `growth.added` and `growth.remaining` are unchanged and `prdAuditAppendCap` is not consulted for that gap
- Given a prd_audit FIXABLE finding dispositioned `existing-task` bound to its owning plan task id, when remediation routes, then it takes the same non-appending route under gate key `prd_audit`

#### Negative Paths
- Given an `existing-task` gap whose bound id is absent from the active plan, when `resolvePlanTaskReference` fails to resolve it, then the disposition is invalid and the round halts naming the unresolvable id rather than silently appending or dropping the gap
- Given an `existing-task` gap with an empty task-binding list, when the remediation plan is read, then the gap is rejected as malformed rather than admitted as a free lap
- Given a plan whose growth allowance is fully unspent, when every finding in the round is `existing-task`, then no `kickback-cap` halt citing the plan-growth allowance is produced

### Done When
- [ ] A unit test proves an `existing-task` gap admitted through `readRemediationPlan` leaves `growth.added` unchanged and never calls the appender
- [ ] The #2119 reproduction (3 existing-task-owned findings, growth cap 2, 0/2 spent) routes to build instead of halting
- [ ] `remediationDispositionAppendsToPlan('existing-task')` returns false and `remediationDispositionStep('existing-task')` returns `build`

## Story 2: The disposition contract widens fail-closed in one change

As the engine, I want the union, validator, step map, and append predicate widened together, so that a half-landed change cannot silently drop existing-task gaps.

### Acceptance Criteria

#### Happy Path
- Given `.pipeline/remediation.json` containing an `existing-task` gap with resolvable bindings, when `readRemediationPlan` parses it, then the gap survives into the returned plan with its bound task ids intact
- Given the `/remediate` skill contract, when the planner reads its disposition list, then `existing-task` is documented with the ownership test (the owning task's Done-when admits the remedy) alongside `publication`'s exclusion rationale

#### Negative Paths
- Given a remediation plan mixing one valid `existing-task` gap and one gap with an unknown disposition string, when parsed, then only the unknown disposition is dropped and the existing-task gap is still admitted
- Given an `existing-task` gap whose bound reference carries a tolerated trailing parenthesized annotation, when resolved, then the annotation is stripped per adr-2026-08-30 D3 and the bare id resolves — a re-derived `Number()` parse is never used

### Done When
- [ ] `RemediationDisposition` union, `readRemediationPlan`'s valid list, `remediationDispositionStep`, and `remediationDispositionAppendsToPlan` all name `existing-task` in the same diff
- [ ] A test feeds an `existing-task` gap through the full parse-and-admit path and asserts it is not dropped
- [ ] `skills/remediate/SKILL.md` documents the disposition and its exclusion from the append

## Story 3: Every existing-task kickback re-stages its bound tasks for the next dispatch

As the operator, I want the bound unfinished tasks delivered to the next BUILD dispatch, so that a kickback never dispatches a build with nothing pending (the prior restage bug).

### Acceptance Criteria

#### Happy Path
- Given an admitted `existing-task` gap bound to plan tasks currently marked `done` in `.pipeline/task-status.json`, when the route is taken, then those task ids are re-staged to `pending` via the same re-seed seam the appender uses before the rewind
- Given the re-staged task-status, when the next BUILD dispatch starts, then it sees the bound tasks as pending work and executes them

#### Negative Paths
- Given a route where re-staging cannot be performed (task-status.json unreadable or the bound id missing from it), when the route would rewind, then the round halts fail-closed naming the re-stage failure instead of dispatching an empty BUILD
- Given a bound task already `pending`, when re-staging runs, then the route proceeds without error and the task remains pending (idempotent re-stage)

### Done When
- [ ] A test proves bound `done` tasks are `pending` in task-status.json after the route and before dispatch
- [ ] A test proves a failed re-stage halts rather than rewinding

## Story 4: Existing-task laps are bounded and terminate

As the operator, I want the non-appending route bounded by the lap allowance with the no-op escalation armed, so that a finding bound to already-done work cannot loop forever.

### Acceptance Criteria

#### Happy Path
- Given an admitted `existing-task` round, when the route is taken, then exactly one lap is consumed under the owning gate's ledger key (`gates.architecture_review_as_built` or `gates.prd_audit`)
- Given a pending as-built existing-task finding whose lap is authorized, when the binding resolves successfully, then a `pendingAsBuiltRemediationFindings` entry is persisted with the same fail-closed validation and cleared in the step that projects it (adr-2026-08-25 D7 as amended)

#### Negative Paths
- Given a gate whose lap cap is already consumed, when a new `existing-task` round is requested, then the round halts `kickback-cap` with prose naming the lap cap (`lap cap reached (n/n)`) — not the plan-growth allowance
- Given an `existing-task` lap that produces no tree-hash change by the next gate evaluation, when the no-op escalation pair evaluates, then it escalates to a halt instead of admitting another lap
- Given a validation-group round carrying a `manual_test` FAIL alongside as-built gaps, when routing is decided, then the existing-task route does not run and the gaps ride the consolidated dispatch (adr-2026-08-25 D8)

### Done When
- [ ] A test proves lap consumption without growth consumption for an existing-task round
- [ ] A test proves the lap-cap halt prose names the lap budget and the halt class is `kickback-cap`
- [ ] A test proves the consolidated (manual_test FAIL) path never takes the existing-task route

## Story 5: Cap halts name the budget actually exhausted

As the operator, I want a halt on an exhausted budget to say which budget it was, so that I can tell plan growth from unfinished planned work without reading the ledger.

### Acceptance Criteria

#### Happy Path
- Given an appending round that genuinely exceeds the growth cap, when it halts, then the prose still reports the growth figures exactly as today (`n/cap appended; k requested, r remaining`) and lists every finding
- Given any new halt fixture in this feature, when its assertions run, then they assert the kickback-cap halt class and typed ledger figures and no new machinery parses the halt prose for authorization (adr-2026-08-29 D2)

#### Negative Paths
- Given a round whose growth allowance is unspent and whose only exhausted budget is the lap cap, when it halts, then the prose names the lap cap and does not report a growth-cap exhaustion
- Given a mixed round where appending gaps exhaust growth while existing-task gaps are within lap allowance, when it halts, then the prose attributes the exhaustion to the appending gaps' growth draw

### Done When
- [ ] No halt path can emit `plan-growth allowance exhausted (0/N appended)` when nothing drew on growth in that round
- [ ] Halt class remains `kickback-cap` mapped to `needs-human`; no new halt class exists

## Story 6: Appending dispositions behave exactly as today

As the engine, I want genuinely-new-scope findings to keep consuming growth allowance and halting on true exhaustion, so that the carve-out does not weaken the scope-creep bound.

### Acceptance Criteria

#### Happy Path
- Given a REMEDIABLE finding dispositioned `build` with new tasks, when remediation routes, then tasks are appended, `growth.added` increments, and the shared cap is enforced unchanged
- Given `publication` and `halt` gaps, when a round mixes them with existing-task gaps, then their existing handling (finish route, needs-human halt, no append) is byte-for-byte unchanged

#### Negative Paths
- Given appending gaps requesting more tasks than `growth.remaining`, when budgets are checked, then the round halts on the shared growth allowance exactly as today
- Given a planner attempting to disposition genuinely new scope as `existing-task` with a fabricated task id, when the id fails to resolve against the active plan, then the disposition is rejected fail-closed rather than granting a growth-free append

### Done When
- [ ] Existing remediation-budget tests pass unmodified except where they asserted the #2119 defect
- [ ] A regression test covers a mixed round (appending + existing-task) charging each gap to its own budget
