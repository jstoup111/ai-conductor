**Status:** Accepted

# Stories: New review concern at a resolved anchor halts as malformed case state

Source: jstoup111/ai-conductor#2464 (technical track, Medium). Governing decision:
adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication D6, with
adr-2026-09-07-durable-prd-widening-decision-reconciliation D2.1 and
adr-2026-09-10-portable-build-review-policy D9.1.

Shared fixture used throughout: a feature case store holding resolved action case R, whose effect is
applied and whose single link to source S has outcome `acted`, so S is still live on the next lap.
That is the shape saved on the halted `no-daemon-level-metrics-queue-depth-halts-and-gate` feature.

## Story 1: A declared new concern at a resolved action case's source becomes actionable

**Requirement:** intake outcome 1

As the build_review adjudication lap, I want a judge-declared new concern at source S to open its own
action case, so that a genuinely new problem at a previously reviewed test anchor reaches BUILD.

### Acceptance Criteria

#### Happy Path
- Given the shared fixture and a case-v2 judgement whose unbound action row for S carries `distinctFrom` naming exactly R, when the lap reconciles, then a new open action case is stamped for S, R keeps its resolution, effect, and link unchanged, and the store reads back valid.
- Given the issue's recorded judgement, with a declared action row for S and an unrelated sibling action row, when the lap reconciles and publishes, then both new action cases appear in one BUILD work order and the lap does not halt.

#### Negative Paths
- Given the shared fixture and a declared row for S, when the store already holds a different unresolved case linking S, then the lap is rejected with the typed reason for a second unresolved owner, the event names both case ids and S, and no case is added.
- Given a declared row for S whose sibling row in the same judgement is invalid, when the lap reconciles, then neither case is stamped and the persisted store is byte-identical to its pre-lap content.

### Done When
- [ ] A reconciler test over the shared fixture shows the new open case for S and R unchanged field for field.
- [ ] A coordinator test replaying the issue-shaped store and judgement publishes one work order holding both action cases.
- [ ] The second-unresolved-owner rejection is asserted with its typed reason and the named case and source ids.

## Story 2: An undeclared reuse is a recurrence that keeps history and limits

**Requirement:** intake outcome 2

As the operator, I want a concern the judge did not declare as new to be treated as R recurring, so
that a regressed fix still halts and cannot reopen an unbounded repair route.

### Acceptance Criteria

#### Happy Path
- Given the shared fixture and an unbound action row for S with no `distinctFrom`, when the lap reconciles, then it halts needs-human as a regression of R, a semantic repeat halt event with reason `regressed` names R, and no new case is stamped.
- Given an admitted distinct case for S that BUILD attempted, when the next lap reports S again and the judge again proposes action on it, then the lap halts as an attempted repeat exactly as any action case does.
- Given an admitted distinct case for S, when its work order is published, then the build_review kickback is charged exactly once for that route.

#### Negative Paths
- Given the shared fixture and an undeclared reuse row in case-v1 mode, when the lap reconciles, then it halts as a regression of R and never as a malformed case store.
- Given the kickback budget is exhausted, when a judgement declares a distinct case for S, then no BUILD route is granted and the existing exhaustion halt applies.
- Given two resolved action cases R and R2 both linking S, when an undeclared reuse row for S arrives, then the halt names both R and R2 with one regressed event each.

### Done When
- [ ] A reconciler or coordinator test shows the undeclared reuse halting as regression with R named, in both case-v1 and case-v2 modes.
- [ ] A test shows the admitted distinct case charging the kickback ledger once and halting as an attempted repeat on its next unresolved recurrence.

## Story 3: A distinctness declaration is validated against durable state, never prose

**Requirement:** intake outcome 2

As the engine, I want every `distinctFrom` declaration checked mechanically, so that the declaration
cannot be used to bypass a recurrence.

### Acceptance Criteria

#### Happy Path
- Given the shared fixture, when a declared row for S names exactly the set of resolved action cases linking its sources, then validation admits it regardless of the row's rationale text.

#### Negative Paths
- Given the shared fixture, when `distinctFrom` names a case id absent from the prior-case context, then the judgement is rejected with a typed unknown-reference reason and no case is stamped.
- Given the shared fixture, when `distinctFrom` names an open case, a non-action case, or a case whose link to S is finalized as merged, then the judgement is rejected with a typed invalid-declaration reason naming that case.
- Given two resolved action cases linking S, when `distinctFrom` names only one of them, then the judgement is rejected as an incomplete declaration naming the omitted case.
- Given a row that binds `existingCaseId`, when it also carries `distinctFrom`, then the judgement is rejected as malformed.
- Given a row whose sources are linked by no resolved case, when it carries `distinctFrom`, then the judgement is rejected as an unnecessary declaration.
- Given an unbound `refute` row that carries `distinctFrom`, when the judgement is validated, then it is rejected with the existing refute-without-binding reason, which takes precedence over any declaration reason.

### Done When
- [ ] Validator tests cover each rejection above with its typed reason.
- [ ] The remediate skill's case-v2 section and its pinned contract test describe `distinctFrom` as an optional field of unbound rows only.

## Story 4: A rejected transition is distinguishable from corrupt persisted history

**Requirement:** intake outcome 3

As the operator, I want a rejected proposed change reported differently from a corrupt store, so
that I know my saved history is intact and what to fix.

### Acceptance Criteria

#### Happy Path
- Given a valid persisted store and a proposed next state that violates the source ownership rule, when the store applies the mutation, then it returns a rejected-transition reason distinct from `malformed-state` and writes nothing.
- Given any rejected transition or invalid declaration in a lap, when the adjudication fails, then `remediation_adjudication_failed` carries the typed reason, the affected case ids, and the affected source ids as structured fields, and the needs-human HALT reason states that persisted history is valid.

#### Negative Paths
- Given a persisted store file that itself repeats S across two unresolved cases, when it is read, then the read still fails as `malformed-state` and the event's typed reason identifies persisted corruption, not a rejected transition.
- Given a persisted store file that is not valid JSON, when it is read, then it still fails as `malformed-json`, unchanged from today.
- Given an event carrying the new structured fields, when every registered sink handles it, then each sink accepts it with no unknown-key failure.

### Done When
- [ ] Store tests distinguish the rejected-next-state reason from the malformed persisted reason for the same duplicate shape.
- [ ] The event type and every sink registration carry the additive fields, and a coordinator test asserts their values on a rejected lap.

## Story 5: Readers use the current owner of a source

**Requirement:** intake outcome 1

As the gate's routing logic, I want a source's outcome read from its unresolved owner, so that a
resolved link never contradicts the current case.

### Acceptance Criteria

#### Happy Path
- Given the shared fixture after Story 1 admits a new open case for S with a different outcome from R's link, when the lap's routing is derived, then source coverage is consistent and the route follows the new case.
- Given R's link to S is `acted` and the new case for S is open, when the settled-recurrence predicate runs, then S stays live.

#### Negative Paths
- Given the new case for S later resolves as a finalized deferral, when the next lap reports S, then S is removed from the live set by the settled predicate and no regression halt is written.
- Given the declared distinct case for S was attempted and then resolved by refutation with effect `none` or an applied residual deferral, when the next lap reports S, then S is settled and no regression halt is written for R or for the refuted case.
- Given a store where S is linked only by resolved cases, when routing is derived for a lap that does not report S, then no resolved case for S blocks PASS or contributes a decision stop.

### Done When
- [ ] Reducer tests over the shared resolved-plus-open fixture show consistent coverage and the expected route.
- [ ] Settled-predicate tests cover the open-owner, finalized-deferral, and refuted-distinct-case transitions for S.

## Story 6: Recovery keeps applied effects and resolved evidence

**Requirement:** intake outcome 4

As the operator recovering a feature halted by this defect, I want to resume without editing case
history, so that applied work and resolved evidence survive.

### Acceptance Criteria

#### Happy Path
- Given a store saved by the defective engine and its halted lap, when the HALT is cleared and the lap re-runs on the fixed engine with a declared judgement, then the lap admits the new case and R's applied effect and resolution evidence are preserved byte for byte.
- Given any store written before this change, when the fixed engine reads it, then it parses unchanged with no migration and no rewrite on read.

#### Negative Paths
- Given the re-run judgement again omits the declaration, when the lap re-runs, then it halts as a regression of R with history intact and never asks the operator to delete cases or accept the finding.
- Given a store file declaring an envelope version the fixed engine does not know, when the fixed engine reads it during recovery, then the read fails closed as an unknown version and the file is left byte-identical.

### Done When
- [ ] A recovery test replays the issue-shaped store through clear-and-re-run and asserts R's record is unchanged.
- [ ] Compatibility tests read a pre-change store fixture and an unknown-version fixture through the fixed store without any write.

## Story 7: The operator can see a declared lineage

**Requirement:** intake outcome 3

As the operator, I want the findings view to show that a case was declared distinct from earlier
cases, so that I can audit the judge's declaration.

### Acceptance Criteria

#### Happy Path
- Given an admitted case for S declared distinct from R, when the operator runs the build_review findings view, then that case's line names R as its declared distinct predecessor.
- Given the findings view in JSON output mode, when a declared case is present, then its JSON carries the declared predecessor case ids, matching the human rendering.

#### Negative Paths
- Given a case with no declaration, when the findings view renders it, then no lineage text appears and its line is unchanged from today.
- Given a case with no declaration in JSON output mode, when the findings view renders it, then its JSON carries no lineage field and is otherwise unchanged from today.

### Done When
- [ ] Findings CLI tests in human and JSON modes assert the lineage for a declared case and the unchanged output for an undeclared case.

## Non-applicable negative categories

Auth, network, timeout, upload, and external dependency categories do not apply. The change is local
to feature-scoped case state and one provider judgement that is already dispatched. Concurrent access
is covered by the existing store lease, which this change keeps. Partial failure is covered by the
all-or-nothing assertions in Story 1 and Story 4. Data integrity and compatibility are covered by
Stories 4 and 6.
