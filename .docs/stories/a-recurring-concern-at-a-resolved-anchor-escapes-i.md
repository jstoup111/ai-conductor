**Status:** Accepted

# Stories: A recurring concern at a resolved anchor escapes its prior case's retry limits

Technical track, intake jstoup111/ai-conductor#3124. The governing decisions are
adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication D5.8–D5.11.

Fixture shorthand: S is a rubric-namespaced source id the current lap reports. R is a resolved
build_review `act` case whose authoritative link on S has outcome `acted` and whose action effect is
`applied`. An "unbound act row" is a remediate case row with disposition `act` and no
`existingCaseId`. N, N2 and N3 are cases that later laps mint. "Byte-identical" means a row's
serialized form in `.pipeline/remediation-cases.json` is unchanged.

## Story 1: The judge can declare a re-raise distinct, and only a valid declaration counts

**Requirement:** intake outcomes 1, 4 and 5; ADR D5.8

As the adjudication engine, I want a re-raise to count as distinct only when the judgement
explicitly declares it with a reason against a qualifying case, so that distinctness is never
inferred and a bad declaration costs no halt.

### Acceptance Criteria

#### Happy Path
- Given R owns S, when a judgement's unbound act row on S carries `distinctFrom` naming R with a non-empty reason, then the artifact is admitted and the declaration counts for R.
- Given resolved act cases R1 owning S1 and R2 owning S2, when an unbound act row on S1 and S2 declares `distinctFrom` naming only R1, then the declaration counts for R1 and not for R2.
- Given the remediate skill contract, when a Claude dispatch and a Codex dispatch render the remediate step, then both read the same `skills/remediate/SKILL.md`, which describes the `distinctFrom` entry shape, its non-empty reason, the three-attempt lineage limit, and the rule that entries naming neither a resolved act owner of a row source nor a provenance candidate of the row are ignored.

#### Negative Paths
- Given R owns S, when an unbound act row on S declares `distinctFrom` naming a case id absent from the supplied prior cases, then that entry is dropped, the judgement is admitted, and the row is treated as a recurrence of R.
- Given an open act case O and R both appear in prior cases, when an unbound act row on S declares `distinctFrom` naming O, then that entry is dropped because O is neither a resolved act owner of a row source nor a provenance candidate of the row.
- Given a resolved `defer` case D that owns no source of the row, when an unbound act row on S declares `distinctFrom` naming D, then that entry is dropped and the row is treated as a recurrence of R.
- Given a `distinctFrom` on a row bound by `existingCaseId`, or on a row whose disposition is not `act`, when the artifact is validated, then the declaration is ignored and that row is reconciled exactly as it would be without it.
- Given an unbound act row whose `distinctFrom` is an empty list, an entry with an empty or over-bound reason, or an entry with extra keys, when the artifact is parsed, then the whole artifact is rejected as malformed exactly like any other malformed remediate artifact, and no case or effect is written.
- Given two unbound act rows with identical source sets and rationale prose that differs only in wording, when neither declares `distinctFrom`, then neither is treated as distinct on the basis of its prose.

### Done When
- [ ] Artifact parser tests assert acceptance of a well-formed `distinctFrom` and rejection of each malformed shape listed above.
- [ ] Coordinator or reconciler tests assert that unknown, open, non-act and non-owner referents are dropped and the row becomes a recurrence.
- [ ] `skills/remediate/SKILL.md` documents the declaration, and no provider-specific remediate contract exists.

## Story 2: An undeclared re-raise of a resolved action is recorded as its recurrence

**Requirement:** intake outcomes 1 and 2; ADR D5.9

As the operator, I want a returning defect at a resolved anchor to stay linked to the attempts that
already failed, so that its history follows it instead of starting over.

### Acceptance Criteria

#### Happy Path
- Given R owns S, when a judgement proposes an undeclared unbound act row on S and the lineage has fewer than three applied attempts, then a new open case N is persisted with `recurrenceOf` exactly [R], a freshly reserved action effect, and R byte-identical.
- Given N was minted as a recurrence, when the effect stage applies N's action, then the kickback budget is charged exactly once for N's effect id and the lap routes BUILD with N, without halting.
- Given resolved act cases R1 owning S1 and R2 owning S2, when an undeclared unbound act row covers S1 and S2, then N's `recurrenceOf` names both R1 and R2.
- Given N is persisted, when the same judgement is reconciled again, then it converges on N with no second case, no second effect, no change to `recurrenceOf`, and no second kickback charge.
- Given N is persisted, when the next lap's judge context is assembled, then N's frozen prior-case entry carries `recurrenceOf` [R].
- Given the #2423 shape (resolved R with an applied effect, and an undeclared unbound act re-raise of R's source with a changed concern), when the lap runs through the real store, reconciler and coordinator, then N is persisted with `recurrenceOf` [R], R is byte-identical, and no `remediation_adjudication_failed` or halt event is emitted.

#### Negative Paths
- Given an unbound act row whose sources' authoritative owners are all open cases or have no owner, when it is reconciled, then the new case carries no `recurrenceOf` and no `distinctFrom`, unless the row has a provenance candidate, in which case `recurrenceOf` names that candidate.
- Given R owns S, when the judgement proposes an unbound `defer`, `reject`, `advisory` or `escalate` row on S, then the case it produces carries no `recurrenceOf` and behaves exactly as before this change.
- Given R holds no operator acceptance, when the judgement binds S to R by `existingCaseId` with disposition `act`, then the lap still halts `semantic remediation case regression R` and no new case is persisted.
- Given an open case O owns S, when an undeclared unbound act row on S with a different source set is proposed, then the lap still halts with a rejected transition naming `source-linked-by-multiple-cases`, and no `recurrenceOf` is written.
- Given a store that an engine without this change wrote, holding no `recurrenceOf` or `distinctFrom` keys, when it is read, reconciled and written, then it parses and every pre-existing row is byte-identical.
- Given a persisted case whose `recurrenceOf` is an empty list or names its own id, when the store is read, then the read fails with the existing `malformed-state` reason.

### Done When
- [ ] A coordinator test replays the #2423 shape and asserts N's `recurrenceOf`, R's unchanged bytes, one kickback charge and no failure event.
- [ ] Reconciler tests cover the multi-owner, replay-convergence and no-owner shapes.
- [ ] Store tests assert that a pre-change store round-trips byte-identically and that malformed lineage fields fail `malformed-state`.
- [ ] Existing tests for the explicit-rebind regression halt and the open-owner refusal pass unchanged.

## Story 3: A recurrence lineage stops after three applied attempts

**Requirement:** intake outcome 2; ADR D5.10

As the operator, I want a defect that keeps returning to stop after a bounded number of repairs, so
that it cannot loop through fresh repair cycles while ordinary recurrences still repair themselves.

### Acceptance Criteria

#### Happy Path
- Given R and its recurrence N are both resolved with applied action effects, when an undeclared unbound act re-raise of N's source arrives, then N2 is admitted with `recurrenceOf` [N] and routes BUILD, because the lineage counts two attempts.
- Given R, N and N2 are resolved with applied action effects in one lineage, when an undeclared unbound act re-raise of N2's source arrives, then the lap halts with reason text `semantic remediation case recurrence limit N2`, the halt names R, N and N2 and the attempt count 3, and no new case or effect is persisted.
- Given that recurrence-limit halt, when the lap ends, then `remediation_semantic_repeat_halt` is emitted with reason `recurrence-limit`, case id N2, and `lineageCaseIds` naming R, N and N2.
- Given that recurrence-limit halt, when the store is read afterwards, then the halting proposal's live sources are linked to N2 and every lineage row other than that source link is byte-identical.
- Given the halting proposal's sources are operator-accepted before the halt decision, when the coordinator re-reads authority, then the lap does not halt, exactly as the existing regression halt behaves under acceptance.

#### Negative Paths
- Given a lineage whose resolved act case R has a `failed` action effect that was never applied, when its attempt count is computed, then R contributes zero attempts.
- Given an at-limit lineage and a sibling unbound act row in the same judgement on an unrelated source, when the lap halts on the recurrence limit, then no action effect is reserved for the sibling.
- Given an at-limit lineage, when the judgement declares the re-raise `distinctFrom` the lineage's authoritative owner with a reason, then the case is admitted as a new case with no `recurrenceOf`, and its own lineage starts at zero attempts.
- Given an at-limit lineage and an exhausted cumulative kickback cap, when an under-limit recurrence on another lineage is proposed, then the lap halts with the existing kickback-cap halt naming that recurrence's effect.
- Given two lineages merge through one recurrence whose `recurrenceOf` names owners in both, when the attempt count is computed, then each applied case is counted once even if reachable by two paths.

### Done When
- [ ] A coordinator test drives one lineage through three applied attempts and asserts the fourth undeclared re-raise halts with the reason text, event fields and lineage ids, before any reservation.
- [ ] Lineage helper tests cover failed-effect exclusion, merged lineages and deduplicated counting.
- [ ] A test asserts the recurrence-limit halt is skipped when the halting sources are operator-accepted.

## Story 4: A declared distinct case is persisted and shown beside the case it differs from

**Requirement:** intake outcome 3; ADR D5.9 and D5.11

As the operator, I want every distinct declaration recorded and visible next to the case it is
distinct from, so that I can audit why a re-raise received a fresh repair budget.

### Acceptance Criteria

#### Happy Path
- Given R owns S, when an unbound act row on S declares `distinctFrom` R with reason "asserts daemon-liveness staleness, not in-flight age", then the new case N persists `distinctFrom` with R's id and that reason, carries no `recurrenceOf` for R, and R is byte-identical.
- Given N was persisted with that declaration, when `remediation_case_reconciled` is emitted for N opening, then it carries `distinctFrom` with R's id and the reason.
- Given N was persisted as a recurrence of R, when `remediation_case_reconciled` is emitted for N opening, then it carries `recurrenceOf` [R].
- Given a store holding N with `distinctFrom` R, when the operator runs `build-review findings` for the feature, then the output for N names R and the reason, and the output for R names N as declared distinct from it.
- Given a store holding N with `recurrenceOf` [R], when the operator runs `build-review findings`, then the output names R as the case N recurs from, with the lineage's applied attempt count.

#### Negative Paths
- Given a declaration entry that was dropped as non-qualifying, when N is persisted and its event emitted, then neither N's row nor the event mentions the dropped case id.
- Given a case with neither field, when `remediation_case_reconciled` is emitted for it, then the event carries neither `recurrenceOf` nor `distinctFrom`.
- Given a store holding no lineage fields, when `build-review findings` runs, then its output is identical to the output before this change.

### Done When
- [ ] Reconciler tests assert the persisted `distinctFrom` with id and reason, and the absence of dropped entries.
- [ ] Coordinator tests assert the optional event fields for distinct, recurrence and plain cases.
- [ ] `build-review findings` tests assert lineage and declaration lines and unchanged output for a store without them.
