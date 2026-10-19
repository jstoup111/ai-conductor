**Status:** Accepted

# Stories: build_review halts when a judgement re-raises a source a resolved case owns

Technical track, intake jstoup111/ai-conductor#3292, which also delivers #2464's core outcome. The
governing decisions are adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication
D5.4–D5.7.

Fixture shorthand: S is a rubric-namespaced source id the current lap reports. R is a build_review
case with `resolution: resolved` that links S. O is a case with `resolution: open` that links S.
N, N1 and N2 are cases a proposed next state adds. "Byte-identical" means R's serialized row in
`.pipeline/remediation-cases.json` is unchanged.

## Story 1: The case store admits a source shared with resolved history and refuses two open owners

**Requirement:** intake outcomes 1, 2 and 4; ADR D5.4

As the adjudication engine, I want the case store to refuse only a source linked by two open cases,
so that resolved history never blocks a new case while open ownership stays unambiguous.

### Acceptance Criteria

#### Happy Path
- Given a valid store holding R and a mutation proposing open case N that also links S, when the store applies it, then the next state is written, R's row is byte-identical, and a read returns both R and N.
- Given the store written by that mutation, when it is read or mutated again, then it parses without failure and returns the same cases in the same order.
- Given two resolved cases that both link S, when a mutation proposes one open case N linking S, then the next state is written and both resolved rows are byte-identical.

#### Negative Paths
- Given a valid store holding O, when a mutation proposes open case N also linking S, then the store returns rejected-transition with invariant `source-linked-by-multiple-cases`, case ids O and N, and source id S, and the file is byte-identical to before.
- Given a valid store holding R, when a mutation proposes two open cases N1 and N2 that both link S, then the store returns rejected-transition naming the invariant, N1, N2 and S, and writes nothing.
- Given a mutation that repeats a case id or a durable effect id, when the store applies it, then it still returns rejected-transition naming `duplicate-case-id` or `duplicate-effect-id`, and writes nothing.
- Given a mutation in which one case links S twice, when the store applies it, then it is refused and the file is byte-identical to before.
- Given a persisted store file that itself links S from two open cases, when it is read or mutated, then the store fails with the existing malformed-state reason and never with a rejected transition.

### Done When
- [ ] Store tests assert that R plus a new open case linking S writes, and that the next read returns both rows with R's bytes unchanged.
- [ ] Store tests assert rejected-transition with invariant, case ids and source id for the O plus N and the N1 plus N2 shapes, with file bytes unchanged.
- [ ] Store tests assert that the duplicate-case-id, duplicate-effect-id and in-case repeated-source refusals are unchanged.

## Story 2: Every source resolves to one authoritative link

**Requirement:** intake outcome 1; ADR D5.5

As the adjudication engine, I want each current source to resolve to exactly one link when history
shares it, so that routing and settlement never read resolved history as a contradiction.

### Acceptance Criteria

#### Happy Path
- Given R linking S with outcome `acted` and an open escalation decision stop linking S with outcome `escalate`, when the reducer derives the route, then coverage is consistent and the route is the decision-stop halt for that owner, not "current remediation source coverage is incomplete or contradictory".
- Given R linking S with outcome `acted` and an open action case N with an applied effect linking S, when the reducer derives the route, then it routes BUILD and the BUILD route's repair case ids are exactly N.
- Given two resolved cases linking S where the later-recorded link settles S and the earlier one does not, when the settled-source predicate is computed, then S is settled; with the settling link recorded earlier instead, S is not settled.
- Given a store in which no source is linked by more than one case, when coverage, the route, and the settled-source predicate are computed, then each result equals the result before this change for the same store.

#### Negative Paths
- Given two resolved cases whose links on S carry the same `recordedAt`, when the authoritative link is read twice, then both reads return the link of the case later in store order.
- Given a current source S that no case links, when the reducer derives the route, then it still halts with "current remediation source coverage is incomplete or contradictory".
- Given a resolved deferral whose applied link on S would settle it and a later open action case N linking S, when the settled-source predicate is computed, then S is not settled and stays a live source.
- Given the `build-review findings` command and the effective-verdict path read a store holding R and N on S, when each derives its settled sources, then both report the same settled set as the coordinator.

### Done When
- [ ] Reducer tests cover the escalation-over-resolved and action-over-resolved fixtures and assert the route and repair case ids.
- [ ] Settled-predicate tests cover later-settling, earlier-settling and equal-timestamp links.
- [ ] A regression test computes coverage, route and settled sources on a pre-change fixture store and asserts unchanged results.

## Story 3: An unbound re-raise over resolved history becomes a new, charged case

**Requirement:** intake outcomes 1 and 2; ADR D5.6

As the operator, I want a judgement that re-raises a resolved case's source as a new case to proceed
like any new case, so that the feature does not halt on a case-store invariant and the kickback cap
remains the bound.

### Acceptance Criteria

#### Happy Path
- Given R is an action case whose effect `failed` and the judgement proposes an unbound action case whose sources include S as `merged` plus another live source, when the lap reconciles, then a new case N with a freshly reserved action effect is persisted, R is byte-identical, and no `remediation_adjudication_failed` event is emitted.
- Given N's new action effect and kickback budget remaining, when the effect stage applies it, then the kickback budget is charged exactly once for N's effect id and the lap routes BUILD with N.
- Given R is an action case with an `applied` effect and the judgement proposes an unbound `defer` or `reject` case on S, when the lap reconciles, then a new case with that disposition is persisted and R is byte-identical.
- Given N was persisted for the re-raise, when the same judgement is reconciled again, then it converges on N with no second case, effect or kickback charge.

#### Negative Paths
- Given N's new action effect and an exhausted cumulative kickback cap, when the effect stage runs, then the lap halts with the existing kickback-cap halt naming N's effect and no case-store invariant appears in the halt or the event.
- Given R is an action case, failed or applied, that holds no operator-accepted source, and the judgement binds the current finding to R by `existingCaseId` with disposition `act`, when the lap runs, then it halts `semantic remediation case regression R` and persists no new case.
- Given O is an open action case on S and the judgement proposes an unbound action case on S with a different source set, when the lap reconciles, then it halts with a rejected transition naming `source-linked-by-multiple-cases`, O, the proposed case id and S, and the store is byte-identical.

### Done When
- [ ] A coordinator test replays the 2026-10-18 `daemon-reconciliation-delays-first-feature-dispatc` shape through the real store and reconciler and asserts N persisted, R unchanged and no failure event.
- [ ] Tests assert one kickback charge for N's effect id, and the kickback-cap halt when the cap is exhausted.
- [ ] Tests assert that the explicit-rebind regression halt and the open-owner refusal are unchanged.

## Story 4: Decision stops over resolved history persist, and a replayed stop converges

**Requirement:** intake outcomes 1, 2 and 4; ADR D5.7

As the operator, I want an escalation over a resolved case's source to stop on the decision it asks
for, and a re-raised identical stop to be recognised as the same stop, so that I answer the real
decision instead of clearing a store failure.

### Acceptance Criteria

#### Happy Path
- Given R is an action case with an `applied` effect and the judgement escalates S to architecture as an unbound case, when the lap runs, then a new open decision stop is persisted, R is byte-identical, and the feature halts with the existing decision-stop halt naming the architecture owner, the new case id and S.
- Given R holds no operator-accepted source and the judgement names R as `existingCaseId` on an escalation whose sources differ from R's, when the stop is persisted, then a new open stop with a fresh case id is written and R is byte-identical.
- Given an open decision stop D on S from an earlier lap, when a later lap's judgement escalates the same sources with the same owner, disposition and outcomes bound to D's id but with fresh link timestamps, then persistence reports already-persisted and writes nothing.
- Given an open decision stop D on S from an earlier lap, when a later lap escalates the same source set to the same owner as an unbound case, then persistence converges on D, writes nothing, and the halt names D.

#### Negative Paths
- Given an open decision stop D on S, when a later lap escalates S as an unbound case to a different owner, then the lap halts with a rejected transition naming `source-linked-by-multiple-cases`, D, the proposed stop id and S, and the store is byte-identical.
- Given an open decision stop D, when a later lap binds an escalation to D's id with a different source set or owner, then persistence still fails `conflicting-case-id` and writes nothing.
- Given O is an open action case on S, when the judgement escalates S as an unbound case, then the lap halts with a rejected transition naming the invariant, O, the proposed stop id and S, and O is byte-identical.

### Done When
- [ ] A coordinator test replays the 2026-10-18 `a-routed-fix-cannot-be-built-charged-and-reviewed-` shape and asserts a persisted architecture decision stop, R unchanged, and the decision-stop halt text.
- [ ] Effects tests assert bound-replay and unbound-replay convergence with no write, and `conflicting-case-id` on a changed owner or source set.
- [ ] Tests assert the open-owner refusals for a different-owner stop and for a stop over an open action case.

## Story 5: Every rejected case-store transition halt names what was rejected

**Requirement:** intake outcome 3; ADR D5.7

As the operator, I want every halt caused by a refused case-store transition to name its invariant,
cases and sources, so that I never read the case store by hand to diagnose it.

### Acceptance Criteria

#### Happy Path
- Given an escalation whose decision-stop persistence is refused as a rejected transition, when the lap halts, then `remediation_adjudication_failed` carries `rejectedTransition` with the invariant, case ids and source ids, and the HALT text names them and states that persisted case history is valid and unchanged.
- Given a blocked-consistency stop whose persistence is refused as a rejected transition, when the lap halts, then the event and HALT text carry the same invariant, case ids and source ids.
- Given a reconciliation refused as a rejected transition, when the lap halts, then the event and HALT text still carry the invariant, case ids and source ids exactly as before this change.

#### Negative Paths
- Given decision-stop persistence fails with `lock-timeout`, when the lap halts, then the HALT reason reads `decision stop case store lock-timeout`, the event carries no `rejectedTransition`, and the text does not state that history is valid.
- Given the persisted store is corrupt when a decision stop is persisted, when the lap halts, then the halt reports a malformed case store and carries no rejected-transition fields.
- Given a decision stop fails `conflicting-case-id`, when the lap halts, then the halt names `conflicting-case-id` and carries no `rejectedTransition` fields.

### Done When
- [ ] Coordinator tests assert the event fields and HALT text for refused explicit-escalation and blocked-consistency stops.
- [ ] Tests assert the lock-timeout, corrupt-store and conflicting-case-id halts carry no rejected-transition fields.
- [ ] The existing reconciliation rejected-transition test passes unchanged.
