**Status:** Accepted

# Stories: Operator acceptance survives a build_review re-raise (respec of #3271)

**Feature:** jstoup111/ai-conductor#3271 (including #3303), technical track, Tier L
**Authoritative design:** `adr-2026-10-20-operator-acceptance-is-durable-case-state` (APPROVED),
built on #3292's `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` D5.4–D5.7.
**Binding conditions:** `.docs/decisions/architecture-review-2026-10-20-operator-acceptance-survives-a-build-review-re-rai.md`
(APPROVED WITH CONDITIONS, conditions 1–4).

Technical track: there is no PRD. `**Requirement:**` cites the numbered outcomes in the track's
scope boundary (`.docs/track/operator-acceptance-survives-a-build-review-re-rai.md`):

1. A finding the adjudicator binds to an operator-accepted case does not block.
2. The carry is visible in `build-review findings`, in the PR accepted-risk section and on the event spine.
3. The adjudicator sees which prior cases an operator accepted.
4. An unbound finding still blocks exactly as today.
5. Acceptance stays feature-scoped.
6. At a clean PASS, an open action case whose effect failed or was never built, and whose every source is operator-accepted or no longer raised, ends resolved with its history intact.
7. A failed action case whose finding is still raised and unaccepted still blocks.
8. When settlement cannot proceed, the halt names a supported, TTY-gated operator command that resolves the blocking case.

Terms:

- An *acceptance origin* is the record, on a case, that an exact operator disposition accepted one of its sources on a given lap.
- An *operator-resolved case* is a case closed with `build-review resolve-case`. It differs from an *operator-resolved finding*, which an exact operator disposition covers.
- A *carry-eligible case* is a case an operator resolved with `build-review resolve-case`, or a resolved case holding at least one acceptance origin whose every origin disposition is still effective and none of whose origins was recorded on the current lap.
- A *carried* finding is a current finding the adjudicator binds to a carry-eligible case by `existingCaseId`.
- *Today* and *as today* mean the engine with #3292 built, which this feature builds on.

Every carry, origin, retirement and settled-read criterion holds for a built-in rubric finding and
for a custom-rubric finding whose identity changes from lap to lap (architecture-review condition 3).

---

## Story 1: An action re-raise bound to an accepted case settles as carried

**Requirement:** #3271 outcome 1

As an operator who accepted a build_review finding, I want a later lap that re-raises the same substance under a new finding id, and that the adjudicator binds to the accepted case with `act`, to settle on its own, so that I neither accept it again nor clear a needs-human halt.

### Acceptance Criteria

#### Happy Path
- Given resolved action case C with an `applied` effect whose source F1 the operator accepted on lap L1, when lap L2 raises the same substance as finding F2 and the judgement binds F2 to C by `existingCaseId` with disposition `act`, then F2 settles as carried: no `semantic remediation case regression` or `semantic remediation case repeat` halt occurs, no BUILD work order is published, no kickback is charged, and C gains exactly one new source link for F2 with outcome `carried` while its disposition, resolution, effect and earlier links are unchanged.
- Given F2 is the only unresolved content finding of mechanically healthy lap L2, when the effective verdict is derived, then it is PASS and no second `build-review accept` is needed.
- Given F2 was carried on L2, when lap L3 raises the same substance as F3 and the judgement binds F3 to C, then F3 also settles as carried from C's original L1 acceptance.
- Given the #3211 sequence replayed with a custom eventSpine rubric finding whose finding id differs on every lap, when the second lap binds the re-raised finding to the accepted case, then that lap settles with no halt.

#### Negative Paths
- Given resolved action case C with an `applied` or `failed` effect that holds no acceptance origin and no operator resolution, when lap L2 binds F2 to C by `existingCaseId` with disposition `act`, then the lap halts `semantic remediation case regression C` exactly as today and persists no carried link.
- Given C's only acceptance origin was recorded on the current lap, when the same lap's judgement binds another finding to C, then that finding is not carried and today's reuse rule applies to it.
- Given lap L2 binds F2 to carry-eligible C and also raises an unbound content finding G, when the lap settles, then only F2 is carried and G routes exactly as it would without F2.
- Given lap L2 has an infrastructure failure beside carried F2, when the effective verdict is derived, then the infrastructure result still blocks until it heals or has an exact reduced-coverage decision.

### Done When
- [ ] A coordinator test with the real store and reconciler pins the act-path carry and fails on today's engine with `semantic remediation case regression`.
- [ ] A conductor build_review test shows a lap whose only content finding is carried publishes effective PASS with zero kickback ledger increments and no work order.
- [ ] A three-lap test proves carry follows the case, not the previous lap's finding id.
- [ ] Each test has a custom-rubric twin whose finding id changes per lap.

---

## Story 2: A non-action binding to an accepted case settles as carried

**Requirement:** #3271 outcome 1

As an operator, I want an escalation, deferral, rejection or refutation that the adjudicator binds to an accepted case to settle as carried, so that a re-raise never opens a decision stop or fails with `decision stop conflicting-case-id`.

### Acceptance Criteria

#### Happy Path
- Given carry-eligible case C, when a later lap's judgement binds re-raised finding F2 to C by `existingCaseId` with disposition `escalate` and source ids that differ from C's, then F2 settles as carried, no open decision stop is persisted, and the lap does not halt with `decision stop` or `conflicting-case-id`.
- Given carry-eligible case C, when a later lap binds F2 to C with disposition `defer`, `reject` or `refute`, then F2 settles as carried, no deferral effect is reserved, no intake issue is filed, and no kickback is charged.

#### Negative Paths
- Given resolved case R with no acceptance origin and no operator resolution, when a later lap binds an escalation to R with source ids that differ from R's, then a new open decision stop is persisted and the lap halts exactly as today.
- Given open decision stop D with no operator resolution, when a later lap binds an escalation to D's id with a different source set or owner, then persistence fails `conflicting-case-id` and writes nothing, exactly as today.
- Given carry-eligible case C, when a later lap escalates the same substance as an unbound case, then a decision stop is persisted and the lap halts exactly as today.
- Given one lap in which F2 is bound to carry-eligible C as `escalate` and an unbound escalation G is raised, when the lap settles, then F2 is carried and G still produces its decision stop.

### Done When
- [ ] The 2026-10-17 `decision stop conflicting-case-id` shape is pinned as a test that settles as carried.
- [ ] A test asserts the store holds no new open decision stop after an escalation bound to a carry-eligible case.
- [ ] Tests assert the unaccepted-escalation and unbound-escalation paths are unchanged, including `conflicting-case-id`.

---

## Story 3: An acceptance is recorded on the case that holds the accepted finding

**Requirement:** #3271 outcome 1

As an operator, I want my exact acceptance of a finding to be recorded on the remediation case that holds it, including a finding whose lap halted, so that a later re-raise the adjudicator binds to that case can carry it.

### Acceptance Criteria

#### Happy Path
- Given open action case O whose only source is F1 and the operator accepts F1 during lap L1, when L1 finalizes, then O is resolved and records the acceptance origin F1 on lap L1.
- Given a lap halted `semantic remediation case regression C` because finding F2 was bound to resolved C, when the halt is recorded, then F2 is linked to C with outcome `acted` and nothing else on C changes, and after the operator accepts F2 and the next lap finalizes, C records the acceptance origin F2 on that lap.
- Given C recorded an origin for F2 after a regression halt, when a later lap binds re-raised F3 to C, then F3 settles as carried with no halt.

#### Negative Paths
- Given open case O with sources F1 and F2, when the operator accepts only F1 and F2 is still raised as L1 finalizes, then O stays open with origin F1 recorded, and a later lap binding a finding to O is not carried.
- Given finding F1 is hidden by the confidence floor rather than accepted by an exact disposition, when the lap finalizes, then no acceptance origin is written for F1.
- Given the lap finalizes again after a crash, when origins are written, then C holds the origin for F1 on L1 exactly once.
- Given a judgement or provider output that sets `operatorAcceptance`, `operatorResolution` or a `carried` source outcome, when it is validated, then it is rejected fail-closed and the case store is byte-identical.

### Done When
- [ ] A finalize test asserts the origin on open and resolved cases, for built-in and custom findings.
- [ ] A halt-accept-re-raise test proves one acceptance after a regression halt carries every later binding.
- [ ] A validation test rejects provider output carrying any of the three operator-owned fields.

---

## Story 4: Carry never widens past the adjudicator binding and the origin's authority

**Requirement:** #3271 outcome 4

As an operator, I want an acceptance to reach only findings the adjudicator binds to the case I accepted, so that a defect I did not accept, or a genuinely new defect, still blocks.

### Acceptance Criteria

#### Happy Path
- Given carry-eligible case C, when a later lap raises a finding with C's rubric, path and summary that the judgement proposes as an unbound case, then the finding is not carried and is admitted as a new case, with a new action charged against the kickback budget, as #3292's D5.6 prescribes.
- Given the origin disposition for C was withdrawn or invalidated before lap L3, when L3 binds re-raised F3 to C, then F3 is not carried and today's reuse rule applies, while F2 carried on an earlier lap stays settled.

#### Negative Paths
- Given a case holding no acceptance origin and no operator resolution, when a later lap binds a finding to it with any disposition, then the finding is not carried and today's repeat, regression, deferral and decision-stop rules apply.
- Given a current finding whose exact id matches no disposition and which the judgement does not bind, when it resembles an accepted finding by rubric, path or summary, then it is not suppressed by that resemblance and is not accepted risk.
- Given the disposition store is unreadable or malformed, when a later lap binds F2 to C, then F2 is not carried and the gate takes exactly the path it takes today for an unreadable disposition store.
- Given the case store is unreadable or malformed, when the lap runs, then nothing is carried and the gate fails closed exactly as today.

### Done When
- [ ] Unbound and unaccepted-case bindings are asserted to produce today's routes for `act`, `escalate` and `reject`.
- [ ] A withdrawn-origin test asserts no new carry and no revocation of an earlier carried link.
- [ ] Unreadable disposition-store and case-store fixtures are asserted to carry nothing.

---

## Story 5: Acceptance stays scoped to its feature and child

**Requirement:** #3271 outcome 5

As an operator, I want an acceptance to carry only within the feature and stacked child I accepted it on, so that it can never settle a finding elsewhere.

### Acceptance Criteria

#### Happy Path
- Given a carry-eligible case on feature A, when feature B's lap raises a finding with the same substance, then feature B's finding is not carried.
- Given a stacked child with its own carry-eligible case, when the child's lap binds a re-raised finding to it, then the finding is carried using the child's case store and the feature's disposition store.

#### Negative Paths
- Given a disposition record whose feature identity differs from the current feature, when origins are written or carry is decided, then it neither records an origin nor carries a finding.
- Given a stacked child whose sibling holds carry-eligible case C, when the child's judgement binds a finding to C's id, then the binding is not resolved against the sibling's store and nothing is carried.
- Given a child's build_review verdict is derived, when its settled sources are read, then only that child's case store is read.

### Done When
- [ ] A two-feature test asserts no carry crosses features.
- [ ] A stacked-child test asserts carry and the effective verdict read only that child's case store.

---

## Story 6: The adjudicator sees which prior cases an operator accepted

**Requirement:** #3271 outcome 3

As the `remediate` adjudicator, I want every carry-eligible prior case marked in my context, so that I can bind a re-raise of the same substance to it.

### Acceptance Criteria

#### Happy Path
- Given a carry-eligible prior case, when the adjudication context is assembled, then that case carries an `operatorAccepted` marker naming its origin source ids and origin lap ids.
- Given the `remediate` skill contract, when it describes prior cases, then it states that a same-substance finding may be bound to a case marked `operatorAccepted` and that the adjudicator never asserts or creates acceptance.

#### Negative Paths
- Given a prior case that is not carry-eligible, including one whose origin disposition was withdrawn, when the context is assembled, then it carries no `operatorAccepted` marker.
- Given a carry-eligible case, when the context is assembled, then no operator name and no rationale appear anywhere in the context.
- Given marked cases push the context to its byte ceiling, when it is assembled, then the existing overflow rule applies unchanged.

### Done When
- [ ] A context test asserts the marker on a carry-eligible case and its absence on an ineligible one.
- [ ] A context test asserts no operator name or rationale is projected.
- [ ] The skill contract text is asserted to permit a substance binding and forbid asserting or creating acceptance.

---

## Story 7: Carried and operator-resolved state is visible to the operator and in the PR

**Requirement:** #3271 outcome 2

As an operator, I want carried findings and operator-resolved cases listed locally with their origin, and listed in the PR's accepted-risk section, so that I can audit what my acceptance now covers.

### Acceptance Criteria

#### Happy Path
- Given a carried finding, when `ai-conductor build-review findings --feature <slug>` runs, then it lists the finding as carried with its case id, origin source ids, origin laps, and the origin dispositions' operators and rationales, and `--json` carries the same fields.
- Given an operator-resolved case, when `build-review findings` runs, then it lists the case with its operator, rationale and resolution time.
- Given a feature with carried findings and operator-resolved cases, when finish publication or the shipped record renders the accepted-risk section, then each carried finding is listed with its finding id, rubric, carried-from origin id and lap, and each operator-resolved case with its case id and source ids.
- Given a stacked child, when `build-review findings --feature <slug> --child <child>` runs, then it lists that child's carried and operator-resolved state.

#### Negative Paths
- Given carried findings and operator-resolved cases, when the PR accepted-risk section is rendered, then no operator name, rationale, summary or time appears in it.
- Given the case store is unreadable when the accepted-risk section is rendered, when publication runs, then every directly accepted finding is still rendered, no carried row is fabricated, and the unreadable state is reported.
- Given a feature with no carried finding and no operator-resolved case, when findings or the accepted-risk section renders, then no carried or operator-resolved row appears.
- Given an outbox entry not yet drained, when `build-review findings` runs, then it shows the pending entry.

### Done When
- [ ] Findings tests (text and `--json`) assert carried and operator-resolved rows and their fields.
- [ ] Renderer tests assert carried and operator-resolved rows without operator, rationale, summary or time.
- [ ] An unreadable-store renderer test asserts direct rows render and the state is reported.

---

## Story 8: Every new occurrence reaches the event spine exactly once

**Requirement:** #3271 outcome 2

As a reader of `.pipeline/events.jsonl`, I want each carry, operator resolution and settlement retirement recorded as exactly one event even across crashes, so that the spine is a complete record.

### Acceptance Criteria

#### Happy Path
- Given a finding carried on a lap, when the lap's entries are drained, then exactly one `build_review_acceptance_carried` event is persisted naming the feature, lap, source, case, origin source ids and origin laps.
- Given a case resolved by `build-review resolve-case`, when the next engine pass drains, then exactly one `remediation_case_operator_resolved` event is persisted carrying the occurrence time the command stamped.
- Given a case retired by acceptance or absence, when the entries are drained, then exactly one `remediation_case_reconciled` event with an `eventId` is persisted.
- Given the event union, when sink registration is checked, then both new event types are declared in every sink and in the persister's eventId dedup set.

#### Negative Paths
- Given a crash after the state change is written and before any emit, when the next drain runs, then the event is persisted exactly once and the final state is identical.
- Given a crash after the event is persisted and before its outbox entry is removed, when the next drain runs, then the repeat is dropped as a duplicate and exactly one line exists for that `eventId`.
- Given a pending outbox entry, when the coordinator returns through any early-exit path, then the entry is drained first.
- Given a lap with no carry, no operator resolution and no retirement, when it settles, then none of these events is emitted.
- Given the persister fails to write an event, when the drain runs, then the outbox entry stays in place and is delivered by a later drain.

### Done When
- [ ] For carry, operator resolution and settlement retirement, tests crash before the transition, after the state write, after the persist and after the full drain, and each asserts one persisted event per `eventId` and identical final state.
- [ ] A test proves every coordinator early-exit path drains a pending entry.
- [ ] The sink and dedup registrations are asserted.

---

## Story 9: A clean PASS settles accepted and absent failed action cases

**Requirement:** #3271 outcomes 6 and 7

As an operator, I want a clean build_review PASS to settle an action case whose repair failed or never ran once all its findings are accepted or gone, so that I never hand-edit `remediation-cases.json` (#3303).

### Acceptance Criteria

#### Happy Path
- Given open action case O with a `failed` effect whose source F1 the operator accepted on an earlier lap, when a clean PASS lap settles, then O is resolved with every link and earlier effect state kept, one `remediation_case_reconciled` event is persisted, and PASS publishes.
- Given open action case O with a `reserved` effect whose every source is accepted, when the lap settles, then O is resolved and its effect becomes `failed` with a diagnostic naming the retirement reason.
- Given open action case O with a `failed` effect whose source is not raised on a mechanically healthy lap, when the lap settles, then O is resolved by absence.

#### Negative Paths
- Given open action case O with a `failed` effect whose source is still raised and unaccepted, when a PASS is attempted, then settlement halts naming O and the exact command `ai-conductor build-review resolve-case --feature <slug> --case <O>`, with `--child <child>` when the case store is child-scoped.
- Given open action case O whose source is not raised on a lap where any built-in or custom rubric had an infrastructure failure or incomplete scope, even when a reduced-coverage decision covers it, when the lap settles, then O is not retired by absence.
- Given a failed deferral or an open decision stop that no operator resolved with `build-review resolve-case`, when a clean PASS is attempted, then settlement still blocks exactly as today.
- Given settlement runs again after a crash, when O is retired, then O is resolved once and exactly one `remediation_case_reconciled` event exists for it.

### Done When
- [ ] The #3303 store shape is replayed through the conductor and settles at PASS without a hand edit.
- [ ] Tests pin the still-raised block, the unhealthy-lap no-retire and the deferral or decision-stop block.
- [ ] The halt text test asserts the exact `resolve-case` command with and without `--child`.

---

## Story 10: An operator resolves a blocking case with a supported command

**Requirement:** #3271 outcome 8

As an operator, I want a TTY-gated `build-review resolve-case` command that resolves a blocking remediation case with my rationale, so that settlement can proceed without editing engine state by hand.

### Acceptance Criteria

#### Happy Path
- Given an interactive terminal, a resolved machine identity and open case O on feature F, when `ai-conductor build-review resolve-case --feature F --case O --rationale "<text>"` runs, then O is resolved with an operator resolution naming the operator, rationale and time, a `reserved` effect becomes `failed`, every link and earlier effect state is kept, one outbox entry is written, and the command prints the resolution.
- Given a stacked child, when the command runs with `--child <child>`, then only that child's case store changes.
- Given O was resolved by the command, when a later lap binds a re-raised finding to O, then it settles as carried.

#### Negative Paths
- Given an unknown case id, an already resolved case, an empty rationale, a non-interactive session, an unresolved machine identity or a feature mismatch, when the command runs, then it refuses naming that reason and the case store is byte-identical.
- Given a running lap holds the case-store lease, when the command runs, then it writes only after acquiring the lease, and on lease timeout it refuses with `lock-timeout` and leaves the store byte-identical.
- Given the command succeeded, when it exits, then it has appended nothing to `.pipeline/events.jsonl` and the event appears only after the next engine drain.

### Done When
- [ ] CLI tests cover the successful resolution, `--child`, and each of the six refusals with a byte-identical store.
- [ ] A test asserts the command reaches dispatch beside `accept` and shares its TTY and identity gate.
- [ ] A test asserts a later binding to an operator-resolved case carries.

---

## Story 11: Existing case stores keep working across the v3 upgrade

**Requirement:** #3271 outcomes 1 and 6

As an operator with features already in flight, I want their existing case stores read and upgraded without loss, so that the upgrade itself never halts a feature.

### Acceptance Criteria

#### Happy Path
- Given a valid v2 case store, when it is read, then every case, link, effect and suppression reads exactly as before.
- Given a valid v2 or v1 case store, when the next mutation writes, then the file is written as v3 with every prior case, link, effect and suppression preserved and no acceptance origin, operator resolution or outbox entry invented.

#### Negative Paths
- Given a v3 store with an unknown key, an unknown source outcome or an outbox entry that is not a valid conductor event, when it is read or mutated, then it fails `malformed-state` and nothing is written.
- Given a v2 store whose cases use only the pre-change fields, when the coordinator runs a lap that neither carries nor retires, then every case, link, effect and suppression in the written file is identical to the input.

### Done When
- [ ] Store tests round-trip v1 and v2 fixtures to v3 and assert field-for-field preservation.
- [ ] Malformed-v3 fixtures are asserted to fail closed with no write.

---

## Story 12: Every reader agrees on what is carried

**Requirement:** #3271 outcomes 4 and 5

As the engine, I want every consumer of build_review state to read carry the same way from the right case store, so that no exit path publishes a different verdict than the coordinator decided.

### Acceptance Criteria

#### Happy Path
- Given a carried finding, when the coordinator's live source set, the effective verdict at every production exit, the `build-review findings` command and clean-PASS settlement each evaluate it, then all report it as settled.
- Given adjudication is disabled for the feature, when the effective verdict is derived, then the case store is not read and no finding is treated as carried.

#### Negative Paths
- Given a production caller of the effective-verdict resolver that omits its child scope or adjudication flag, when the engine is compiled, then compilation fails.
- Given a carried link on a source that an open case also links, when settled sources are derived, then the open case's link decides and the source is not settled by carry.
- Given a child review, when its effective verdict is derived at any exit, then it never reads the flat feature store.

### Done When
- [ ] One parity test exercises the coordinator, each effective-verdict exit, the findings command and settlement against one fixture.
- [ ] A test asserts the adjudication-disabled path reads no case store.
- [ ] The plan enumerates every production caller of the effective-verdict resolver by file with its child and adjudication source.
