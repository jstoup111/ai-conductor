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
- Given an `existing-task` gap whose bound id is absent from the active plan, or is not the finding's owning task, when the engine validator checks the plan, then the whole plan is rejected naming the unresolvable or non-owning id (and the owner) rather than silently appending or dropping the gap
- Given an `existing-task` gap with an empty task-binding list, when the engine validator checks the plan, then the whole plan is rejected naming the empty binding field rather than admitting the gap as a free lap
- Given a plan whose growth allowance is fully unspent, when every finding in the round is `existing-task`, then no `kickback-cap` halt citing the plan-growth allowance is produced

### Done When
- [ ] A unit test proves an `existing-task` gap admitted from a validated typed plan leaves `growth.added` unchanged and never calls the appender
- [ ] The #2119 reproduction (3 existing-task-owned findings, growth cap 2, 0/2 spent) routes to build instead of halting
- [ ] `remediationDispositionAppendsToPlan('existing-task')` returns false and `remediationDispositionStep('existing-task')` returns `build`

## Story 2: The disposition contract widens fail-closed in one change

As the engine, I want the union, validator, step map, and append predicate widened together, so that a half-landed change cannot silently drop existing-task gaps.

### Acceptance Criteria

#### Happy Path
- Given a structured remediation result containing an `existing-task` disposition bound to the finding's owning task in the active plan, when the engine validator checks it, then the disposition survives into the validated typed plan with its bound task ids intact
- Given the `/remediate` skill, when the planner reads its judgment guidance, then it explains when a remedy is owned by the finding's existing task (the owning task's Done-when admits the remedy) and why `publication` is not an appending route, while the accepted disposition values themselves come from the engine vocabulary in the projection

#### Negative Paths
- Given a remediation result mixing one valid `existing-task` disposition and one with an unknown disposition string, when the engine validator checks it, then the whole plan is rejected naming the unknown value and the accepted set, the `existing-task` disposition is not admitted from that attempt, and the attempt is retried within `remediate`'s retry allowance
- Given an `existing-task` gap whose bound reference carries a tolerated trailing parenthesized annotation, when resolved, then the annotation is stripped per adr-2026-08-30 D3 and the bare id resolves — a re-derived `Number()` parse is never used

### Done When
- [ ] The engine disposition enum in the native schema, the engine validator's accepted set, `remediationDispositionStep`, and `remediationDispositionAppendsToPlan` all name `existing-task`
- [ ] A test feeds an `existing-task` disposition through the full validate-and-admit path and asserts it is admitted, and a mixed fixture with an unknown value asserts whole-plan rejection
- [ ] `skills/remediate/SKILL.md` carries only the judgment guidance on existing-task ownership, with no disposition vocabulary table

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
- Given an admitted `existing-task` round, when build dispatches on its re-staged tasks, then exactly one lap is consumed at that dispatch under the owning gate's ledger key (`gates.architecture_review_as_built` or `gates.prd_audit`)
- Given a pending as-built existing-task finding whose lap is authorized, when the binding resolves successfully, then a `pendingAsBuiltRemediationFindings` entry is persisted with the same fail-closed validation and cleared in the step that projects it (adr-2026-08-25 D7 as amended)

#### Negative Paths
- Given a gate whose lap cap is already consumed, when a new `existing-task` round is requested, then the round re-stages its bound tasks pending and halts `kickback-cap` at the build transition with no lap charged, with prose naming the lap cap (`lap cap reached (n/n)`) — not the plan-growth allowance
- Given an `existing-task` lap that produces no tree-hash change or net resolved-count progress and whose next effective gate verdict still fails unchanged, when the no-op escalation pair evaluates, then it escalates to a halt instead of admitting another lap; a passing effective verdict ends the cycle even when current valid completion evidence required no tree change
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
- Given a planner attempting to disposition genuinely new scope as `existing-task` with a fabricated task id, when the id fails to resolve against the active plan or is not the finding's owning task, then the whole plan is rejected fail-closed rather than granting a growth-free append

### Done When
- [ ] Existing remediation-budget tests pass unmodified except where they asserted the #2119 defect
- [ ] A regression test covers a mixed round (appending + existing-task) charging each gap to its own budget
