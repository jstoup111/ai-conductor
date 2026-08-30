**Status:** Accepted

# Technical Stories: build_review post-join remediation adjudication

**Decision baseline:** `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication`
supersedes and incorporates the non-conflicting case/effect decisions from
`adr-2026-08-29-build-review-remediate-case-adjudication`. “Successor” and “incorporated” below
refer to those two documents respectively.

## Story 1: Settle every rubric before one content adjudication

**Requirement:** Successor D1-D2

As an operator, I want independent rubric outcomes to meet in one post-join judgement so that no
rubric can erase a sibling or independently order contradictory rework.

### Acceptance Criteria

#### Happy Path

- Given two or more enabled rubrics produce valid judged findings for one frozen lap, when the raw join settles, then exactly one `remediate` session receives every operator-unresolved finding from that lap.
- Given every raw finding is already covered by a current operator disposition, when the raw join settles, then the effective gate passes without dispatching `remediate`, creating a case, applying an effect, or consuming a kickback.
- Given an exhausted infrastructure result has exact current operator reduced coverage and content siblings remain unresolved, when the aggregate is evaluated, then the infrastructure branch stays outside autonomous judgement and exactly one `remediate` session receives the content findings.
- Given one rubric has an uncovered infrastructure failure while siblings have valid unresolved content findings, when every branch settles, then the current-lap aggregate preserves both kinds, exactly one `remediate` session receives only the content findings, and a new actionable work order may take the existing one semantic BUILD route while infrastructure remains independently blocking.

#### Negative Paths

- Given one rubric produces an infrastructure failure with mechanical allowance remaining and no sibling has an operator-unresolved content finding, when the group settles, then the lap follows the existing non-publishing mechanical path with no remediation, external effect, or semantic kickback.
- Given an exhausted infrastructure result has no exact current operator reduced-coverage decision and content settlement yields no actionable BUILD route, when the effective transition is chosen, then the infrastructure result remains blocking and follows the existing exhaustion path; finalized content outcomes cannot produce autonomous PASS.
- Given one rubric branch is missing, stale, malformed, or belongs to another lap while a sibling has a valid content finding, when the group settles, then the invalid branch is represented only as an infrastructure blocker, the valid sibling still enters the source-complete content adjudication, and no case outcome can clear the invalid branch.

### Done When

- [ ] A multi-rubric acceptance test observes one remediate dispatch containing every unresolved
      current finding and no sibling-aware rubric prompt.
- [ ] Accepted-risk-only and infrastructure-only below-allowance tests observe zero remediate
      dispatches, zero case effects, and zero semantic kickback increments.
- [ ] Mixed-lap tests preserve the infrastructure blocker, send every valid content sibling through
      one remediate dispatch, charge only a newly actionable BUILD route, and never derive PASS from
      autonomous case state.
- [ ] A covered exhausted-infrastructure test sends only content siblings to `remediate` and proves
      autonomous state never writes reduced coverage.
- [ ] Raw per-rubric artifacts and the mechanically valid raw aggregate retain their existing shapes.

## Story 2: Judge current findings against complete prior case history

**Requirement:** Successor D2; incorporated D3

As an operator, I want the judge to see every prior outcome and its resolution state so that wording
drift does not restart an already decided case.

### Acceptance Criteria

#### Happy Path

- Given a settled current-lap FAIL has valid content findings and feature-local prior cases, whether or not a sibling failed mechanically, when remediation is dispatched, then its bounded input contains every current unresolved content finding and every prior case with outcome, source links, effect status, and mechanically derived resolution evidence.
- Given no prior case exists, when remediation is dispatched, then the same contract carries an empty prior-case collection and the judge can propose new cases without reading sibling prompts or re-auditing the source tree.

#### Negative Paths

- Given the complete bounded case projection would exceed the configured hard byte ceiling, when context assembly runs, then the gate halts `needs-human` naming the overflow and dispatches no partial history.
- Given a prior case contains an over-limit field or an unrepresentable resolution/effect state, when context assembly runs, then it fails closed before the provider dispatch rather than omitting or coercing that case.

### Done When

- [ ] Context tests prove first, middle, and oldest prior cases all reach one remediate input.
- [ ] Empty-history behavior produces the same current-finding projection without a synthetic case.
- [ ] Total-byte and per-field overflow tests halt without a provider call, effect, PASS, or kickback.

## Story 3: Account for every current finding exactly once

**Requirement:** Incorporated D4

As an operator, I want a source-complete constrained result so that no finding disappears between the
raw join and the effective gate decision.

### Acceptance Criteria

#### Happy Path

- Given a valid remediation result, when it is validated, then every current unresolved finding has exactly one source outcome—`acted`, `deferred`, `rejected`, or `merged`—every merged source names a canonical case, and every canonical case has exactly one `act`, `defer`, or `reject` judgement.
- Given several rubric findings describe one repair, when the judge merges them, then every raw finding remains traceable to the one canonical case and its single priority/route.

#### Negative Paths

- Given a result omits a current finding, repeats one finding, references an unknown finding/case, or leaves a merged source without a target, when validation runs, then the whole result is rejected before any case mutation, effect, PASS, or kickback.
- Given one case contains contradictory dispositions/routes, an action has no concrete work, or a deferral has no current-plan exclusion rationale, when validation runs, then valid sibling rows are not partially applied and the gate fails closed with the named contract defects.

### Done When

- [ ] A contract test accepts acted/deferred/rejected/merged coverage and reconstructs every raw
      finding’s canonical case.
- [ ] Omission, duplication, dangling merge, unknown reference, contradictory route, taskless action,
      and unjustified deferral fixtures each produce zero persisted mutations and effects.
- [ ] Provider-supplied durable case/effect ids are rejected; only engine-stamped ids reach state.

## Story 4: Persist cases without borrowing operator authority

**Requirement:** Incorporated D2 and D5

As an operator, I want autonomous adjudication history to survive daemon redispatch while remaining
separate from accepted-risk decisions.

### Acceptance Criteria

#### Happy Path

- Given a valid new case judgement, when reconciliation commits, then the engine stamps its case and effect ids, atomically records the versioned case/source state under the feature worktree, and a later process reads the same state.
- Given a current source is judged equivalent to a prior case, when reconciliation commits, then the current source trace is appended to that case without rewriting or deleting its earlier traces.
- Given a prior open case is absent from a later mechanically complete lap, when reconciliation runs, then its resolution state is updated from current-lap absence and available action evidence while its history remains inspectable.

#### Negative Paths

- Given the case store is unreadable, malformed, version-incompatible, or its lease cannot be acquired, when the gate evaluates, then it blocks without treating the store as empty or falling back to raw direct routing.
- Given autonomous reconciliation runs, when it persists outcomes, then it never writes the operator disposition store or makes an autonomous outcome render as operator-accepted risk.
- Given two processes concurrently attempt to reconcile the same result, when the lease serializes them, then the final store contains one case/effect identity and no lost or duplicated source link.

### Done When

- [ ] Cross-process reload tests preserve case ids, source history, disposition, resolution, and
      effect status.
- [ ] Corrupt/version/lease-contention tests block with zero PASS, route, or operator-store mutation.
- [ ] Concurrent same-result writers converge on one case and one effect under the store lease.

## Story 5: Preserve current and late operator dispositions

**Requirement:** Incorporated D2; successor D3

As an operator, I want accepted-risk authority checked before and at every exit so that autonomous
work cannot override a human decision made during the lap.

### Acceptance Criteria

#### Happy Path

- Given some raw findings have exact current operator dispositions, when adjudication input is built, then only the remaining unresolved findings enter case judgement and the accepted findings retain their existing publication evidence.
- Given the operator accepts the final unresolved finding while adjudication or effect preparation is in flight, when the engine reaches a BUILD-route, HALT, or PASS exit, then it re-reads the current disposition and suppresses obsolete autonomous rework for that finding.

#### Negative Paths

- Given an autonomous prior case looks semantically similar to an operator-accepted finding but the exact operator identity does not match, when the reducer runs, then the autonomous case cannot broaden the operator disposition or mark the distinct finding accepted.
- Given the operator disposition store cannot be read or validated at an exit, when the effective verdict is derived, then the gate fails closed rather than assuming no acceptance or publishing autonomous PASS.

### Done When

- [ ] Mixed accepted/unresolved tests send only unresolved sources to `remediate` and retain accepted-
      risk evidence separately.
- [ ] Race tests record an acceptance between adjudication and each exit and observe no obsolete
      work order, charge, or halt for the accepted source.
- [ ] Similar-but-not-exact and unreadable-store tests never widen operator authority.

## Story 6: Route one prioritized BUILD work order and charge it once

**Requirement:** Incorporated D6-D7; architecture-review Condition 1

As an operator, I want all newly actionable cases consolidated into one durable BUILD route so that
findings do not compete and budget reflects actual remediation attempts.

### Acceptance Criteria

#### Happy Path

- Given one or more new `act` cases in a valid adjudication, when effects settle, then the engine publishes one prioritized durable BUILD work order, consumes the existing `build_review` kickback once for its stable effect id, emits one BUILD route, and BUILD receives the same work after an ordinary process restart.
- Given an adjudication contains only deferred, rejected, and merged outcomes, when their required effects settle, then no build_review kickback is consumed and no BUILD work order is dispatched.

#### Negative Paths

- Given actionable work is present but the per-tree or cumulative build_review cap is exhausted, when routing is evaluated, then no BUILD navigation occurs and the existing `needs-human` cap halt names the cases and current counter evidence.
- Given a build_review action is published, when all persistence is inspected, then the approved plan, task-status plan membership, and plan-growth ledger are unchanged; any attempted plan append is a failing acceptance result.

### Done When

- [ ] Multi-action input yields one ordered work order, one charged effect id, one counter increment,
      one kickback event, and one BUILD navigation.
- [ ] Non-action outcomes yield zero BUILD charges/routes.
- [ ] Cap tests halt before navigation, and a plan/growth snapshot test proves byte-for-byte no plan
      append attributable to build_review.
- [ ] BUILD reconstructs the work order by effect id without relying on an in-memory retry hint.

## Story 7: Resume interrupted actions but halt repeated attempted cases

**Requirement:** Incorporated D7

As an operator, I want crash recovery to resume the same action without charging twice while genuine
semantic non-progress stops instead of cycling.

### Acceptance Criteria

#### Happy Path

- Given a work-order effect was reserved or charged but BUILD was not yet attempted, when the daemon resumes, then it completes the same effect id and BUILD route without creating a second case, work order, or kickback increment.
- Given a later finding is materially distinct from every prior case, when it is adjudicated as a new action, then it may create a new engine-stamped case/effect and consume the next permitted kickback.

#### Negative Paths

- Given BUILD already attempted an action case and a later complete lap binds a current finding to that unresolved case, when routing is derived, then no new or free BUILD route occurs and the gate halts `needs-human` with both current and prior evidence even if the tree moved.
- Given an action case was marked resolved and an equivalent finding reappears, when reconciliation runs, then the gate halts as a regression of the prior case rather than resetting its history or consuming another kickback.

### Done When

- [ ] Restart tests after reservation, charge, work-order persistence, and navigation each converge
      on at most one case, effect, charge, and BUILD attempt.
- [ ] Attempted-repeat tests halt on unchanged and changed trees with no second counter increment.
- [ ] Resolved-case regression halts with the original case id and both source traces.
- [ ] A similar-looking but materially distinct judgement can create a new permitted case, proving
      prior-case dedup does not block legitimate operations.

## Story 8: File each genuine deferral exactly once

**Requirement:** Incorporated D6

As an operator, I want a genuinely out-of-scope finding filed through intake exactly once so that it
is neither silently lost nor duplicated by retries.

### Acceptance Criteria

#### Happy Path

- Given a valid `defer` case, when its effect is reserved, then the engine searches the configured intake repository for the exact hidden effect marker across open and closed issues, reuses a match, or files one sanitized issue through the existing intake adapter and records its reference.
- Given two distinct deferral cases with different effect ids but similar prose, when effects run, then each receives its own issue; similarity alone does not cause a false deduplication.

#### Negative Paths

- Given issue lookup/create fails because of timeout, authentication, permission, rate limit, or response failure, when the effect runs, then its state remains reserved/failed, the gate cannot PASS or route mixed actionable work, and a retry searches by the same marker before creating.
- Given the process crashes after GitHub creates the issue but before the local reference is recorded, when the effect resumes, then marker lookup records the existing issue and does not create a second one.

### Done When

- [ ] New, open-match, and closed-match tests record exactly one issue reference with the reserved
      effect marker and the expected intake body sections.
- [ ] Distinct-key tests create two issues even when title/body text is otherwise equivalent.
- [ ] Timeout/auth/rate-limit and post-create-crash tests produce no PASS/BUILD route until recovery
      and never create a duplicate issue.

## Story 9: Derive one traceable effective gate outcome

**Requirement:** Successor D3

As an operator, I want every outer decision traceable to raw evidence, judgement, and effects so that
an effective PASS or route never hides what the rubrics reported.

### Acceptance Criteria

#### Happy Path

- Given every current raw finding is operator-resolved or finalized as deferred, rejected, or merged, every required effect is applied, and every infrastructure branch is healthy or exactly covered by the operator, when the effective verdict is derived, then it is PASS while the raw FAIL and each source-to-case/effect link remain inspectable.
- Given at least one new action and all sibling deferral effects are applied, when the effective verdict is derived, then it emits the single BUILD route with a report that includes every source outcome and canonical case.

#### Negative Paths

- Given any required case/effect is missing, reserved, failed, contradictory, or unrenderable, when the effective verdict is derived, then it cannot PASS or partially route and names the blocking state.
- Given raw evidence contains a below-allowance infrastructure failure or an exhausted failure without exact operator reduced coverage, when effective derivation is attempted, then autonomous case state cannot convert that mechanical blocker into PASS.

### Done When

- [ ] PASS and BUILD-route reports reconstruct every raw finding through disposition/case/effect to
      the terminal decision without mutating the raw aggregate.
- [ ] Mixed action+failed-deferral, missing-effect, invalid-state, and unrenderable-state tests block
      both PASS and route.
- [ ] Infrastructure-failure fixtures remain blocking regardless of autonomous history; mixed-lap
      fixtures still admit one newly actionable BUILD route without treating infrastructure as PASS.

## Story 10: Make case mutations and charges restart-safe

**Requirement:** Incorporated D5-D7; architecture-review Condition 3

As an operator, I want every state boundary to be recoverable so that daemon death cannot duplicate a
charge/effect or lose an accepted work order.

### Acceptance Criteria

#### Happy Path

- Given the process stops after any successful state transition, when a new process resumes, then it derives the next legal transition from durable case, kickback, work-order, and engine state without relying on timestamps or prior process memory.
- Given two processes race to apply the same stable action effect, when they serialize state changes, then exactly one kickback charge and one applied work order result.

#### Negative Paths

- Given persistence fails during atomic replace or a durable state combination is impossible, when recovery reads the files, then the engine fails closed with the last complete state rather than accepting a partial write.
- Given case state says an effect is reserved while the kickback ledger already records its charge, when recovery runs, then it reconciles and resumes that same effect without incrementing again; it never treats the mismatch as a fresh case.

### Done When

- [ ] A fault-injection matrix covers process death after validation, reservation, charge, work-order
      persistence, navigation, remote issue creation, and finalization.
- [ ] Every matrix row asserts at-most-once charge/issue creation, at-least-once resumable work, and
      no PASS from an incomplete effect.
- [ ] Atomic-write and concurrent-executor tests leave parsable versioned state with one legal next
      transition.

## Story 11: Preserve legacy remediation and expose lifecycle occurrences

**Requirement:** Incorporated D9-D10

As an operator, I want the feature observable and reversible without changing existing remediation
callers so that rollout does not destabilize SHIP or stall recovery.

### Acceptance Criteria

#### Happy Path

- Given adjudication is enabled, when a case proceeds through judgement and effects, then start, completion/failure, reconciliation, effect, and semantic-repeat occurrences travel through the existing `ConductorEvent` union, declared sinks, and `.pipeline/events.jsonl` persister.
- Given an existing prd_audit, as-built, finish, or build-stall remediation artifact has the legacy shape, when it is read and routed, then its parsed plan and effects are unchanged by the additive build_review case mode.
- Given `build_review.adjudication.enabled` is false, when raw content FAIL occurs, then the engine follows the pre-feature direct BUILD route and neither reads nor writes remediation case state.

#### Negative Paths

- Given a new event type lacks an explicit sink declaration or renderer decision, when the project compiles/tests, then exhaustiveness fails rather than silently dropping the occurrence.
- Given a case-mode discriminator is unknown, absent where required, or mixed with legacy fields, when the artifact parser runs, then build_review fails closed while a genuine legacy artifact still uses the legacy parser.
- Given the config block or `enabled` value is malformed or has unknown keys, when configuration is validated, then startup rejects it with a specific path/type diagnostic rather than guessing a rollout mode.

### Done When

- [ ] Event tests observe every lifecycle occurrence through the existing emitter/persister and pass
      the total `EVENT_SINKS` contract.
- [ ] Legacy fixture tests for all existing remediation sources remain byte-for-byte equivalent in
      parsed disposition and route.
- [ ] Flag-off integration tests observe the old direct route and no case-store access.
- [ ] Unknown/mixed case schema and invalid config fixtures fail with deterministic diagnostics.
