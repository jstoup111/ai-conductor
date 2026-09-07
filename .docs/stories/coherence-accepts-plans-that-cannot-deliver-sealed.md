**Status:** Accepted

# Stories: Coherence accepts plans that cannot deliver sealed outcomes — engine half (#2419)

Technical track — acceptance derives from the technical intent and the approved architecture
(`adr-2026-08-31-coverage-binding-judge-step` D10, D11;
`architecture-review-2026-09-07-coherence-accepts-plans-that-cannot-deliver-sealed`). Scope is
land-time DECIDE only: the shared coherence parser and the land validator. The skill-text
achievability judgement ships separately; no BUILD or SHIP behavior changes.

## Story 1: The shared parser accepts an optional correction cell on a failing criterion row

As the land validator, I want a `criterion` row to be able to carry a seventh correction cell so that
an authored "cannot deliver" verdict records where the correction belongs, without changing how any
existing row parses.

### Acceptance Criteria

#### Happy Path
- Given a coherence artifact with a seven-cell `criterion` row whose verdict is `fail` and whose seventh cell is `plan`, when the artifact is parsed, then the row parses with a correction of layer `plan` and every other field identical to the six-cell reading
- Given a seven-cell `criterion` row whose verdict is `fail` and whose seventh cell is `architecture:adr-2026-08-31-coverage-binding-judge-step#D10`, when the artifact is parsed, then the row parses with a correction of layer `architecture` carrying the decision reference `adr-2026-08-31-coverage-binding-judge-step#D10`
- Given every six-cell `criterion` row in the landed coherence corpus, when the artifact is parsed, then each row parses to exactly the same value as before and carries no correction

#### Negative Paths
- Given a seven-cell `criterion` row whose seventh cell is `rewrite-plan`, when the artifact is parsed, then the parse fails with reason `unparseable-criterion-row` and a detail naming the line and the unknown correction value
- Given a seven-cell `criterion` row whose seventh cell is `architecture:` with nothing after the colon, when the artifact is parsed, then the parse fails with reason `unparseable-criterion-row` and a detail stating that an architecture correction must reference a decision
- Given a seven-cell `criterion` row whose verdict is `covered`, when the artifact is parsed, then the parse fails with reason `unparseable-criterion-row` and a detail stating that only a `fail` row may carry a correction

### Done When
- [ ] `parseCoherenceArtifact` accepts `criterion` rows of six or seven cells and rejects any other count with the existing cell-count detail
- [ ] `CriterionCoherenceRow` carries an optional discriminated `correction` field: `{ layer: 'plan' }` or `{ layer: 'architecture', decisionRef }`
- [ ] The corpus fixture test asserts byte-identical parse output for every existing six-cell row

## Story 2: Land reports a cannot-deliver gap that names the criterion, task, constraint, and layer

As an operator reading a land rejection, I want a failing criterion with a correction to be reported
under a layer-specific gap id whose detail names everything needed to act, so that I know whether to
amend the plan or the architecture without re-deriving the finding.

### Acceptance Criteria

#### Happy Path
- Given a parsed `fail` criterion row with correction layer `plan` at criterion index 3, when the criterion layer runs, then it reports gap id `criterion:cannot-deliver-plan:3` whose detail contains the criterion text, the cited task id(s), the row's quoted `Done when` text, and the words `correction: plan`
- Given a parsed `fail` criterion row with correction layer `architecture` referencing `adr-x#D2` at criterion index 5, when the criterion layer runs, then it reports gap id `criterion:cannot-deliver-architecture:5` whose detail contains the criterion text, the cited task id(s), the quoted `Done when` text, and `constraint: adr-x#D2`

#### Negative Paths
- Given a parsed `fail` criterion row with no correction cell at criterion index 3, when the criterion layer runs, then it reports gap id `criterion:verdict:3` with today's detail and no cannot-deliver id
- Given a parsed `fail` criterion row with correction layer `plan` whose cited task id does not exist in the plan, when the criterion layer runs, then it reports `criterion:task-missing:<n>:<id>` and does not additionally report a cannot-deliver gap for that row

### Done When
- [ ] `checkCriterionCoverage` emits `criterion:cannot-deliver-plan:<n>` / `criterion:cannot-deliver-architecture:<n>` only for `fail` rows carrying a correction
- [ ] The rendered gap report line for a cannot-deliver gap includes the criterion, cited task id(s), quote, constraint reference (architecture only), and layer
- [ ] A `fail` row without a correction still yields `criterion:verdict:<n>` unchanged

## Story 3: An architecture correction must reference a decision the change set can cite

As the land validator, I want an `architecture` correction to resolve against the ADR decisions
actually in this spec's change set so that a fabricated or out-of-scope constraint cannot pass as a
governing one.

### Acceptance Criteria

#### Happy Path
- Given a spec change set containing a non-deleted ADR whose Decision section yields decision `D2`, and a `fail` criterion row with correction `architecture:<that-adr-stem>#D2`, when the coherence gate runs, then the only gap reported for that row is `criterion:cannot-deliver-architecture:<n>`
- Given a spec change set whose only ADR is one this feature amends additively, and a `fail` criterion row citing a decision id introduced by that amendment, when the coherence gate runs, then the reference resolves and no unknown-decision gap is reported

#### Negative Paths
- Given a spec change set with no ADR path at all, and a `fail` criterion row with correction `architecture:adr-elsewhere#D1`, when the coherence gate runs, then it reports `criterion:correction-unknown-decision:<n>` naming `adr-elsewhere#D1` and the enumerated decision set as empty
- Given a spec change set containing ADR `adr-y` with decisions `D1`..`D3`, and a `fail` criterion row with correction `architecture:adr-y#D9`, when the coherence gate runs, then it reports `criterion:correction-unknown-decision:<n>` naming `adr-y#D9` and listing the decision ids that were enumerated
- Given a spec change set whose ADR `adr-z` is deleted in the diff, and a `fail` criterion row with correction `architecture:adr-z#D1`, when the coherence gate runs, then it reports `criterion:correction-unknown-decision:<n>` because a deleted ADR contributes no decisions

### Done When
- [ ] `runCoherenceGate` enumerates decision ids through `parseAdrDecisions` and `formatArchitectureDecisionId` over non-deleted change-set ADRs whenever any row carries an `architecture` correction, independent of whether the `adr` layer is engaged
- [ ] `criterion:correction-unknown-decision:<n>` is added to the aggregated `gaps` list before waiver evaluation

## Story 4: Cannot-deliver gaps are waivable coverage gaps; malformed corrections are not

As an operator, I want a deliberate deferral of a cannot-deliver finding to be recordable through
the existing coherence waiver, while a malformed correction stays a fail-closed refusal, so that the
waiver never legitimizes a record the validator could not read.

### Acceptance Criteria

#### Happy Path
- Given a land whose only reported gaps are `criterion:cannot-deliver-plan:2` and `criterion:correction-unknown-decision:4`, and a fresh `.docs/coherence-waivers/<plan-stem>.md` in the change set whose `Waives:` line lists exactly those two ids with a non-empty rationale, when the coherence gate runs, then the land succeeds

#### Negative Paths
- Given a land whose reported gaps are `criterion:cannot-deliver-plan:2` and `criterion:cannot-deliver-architecture:7`, and a fresh waiver listing only `criterion:cannot-deliver-plan:2`, when the coherence gate runs, then the land is rejected naming `criterion:cannot-deliver-architecture:7` as unwaived
- Given a coherence artifact with a seven-cell row whose seventh cell is malformed, and a fresh waiver whose `Waives:` line names `unparseable-criterion-row`, when the coherence gate runs, then the land is rejected with the `unparseable-criterion-row` refusal before any waiver is evaluated

### Done When
- [ ] The three new gap ids flow through the existing `gaps` list and `evaluateCoherenceWaiver` without any change to `coherence-waiver.ts`
- [ ] A malformed correction cell is thrown as the existing parse-failure refusal ahead of waiver evaluation

## Story 5: The correction layer is a label — nothing routes, appends, or changes downstream

As the daemon, I want a landed artifact carrying correction cells to be treated exactly like any
other at discovery and BUILD, so that the correction layer informs the operator without becoming a
routing action.

### Acceptance Criteria

#### Happy Path
- Given a merged spec whose coherence artifact contains a seven-cell `criterion` row (landed under a waiver), when daemon discovery parses the artifact, then the spec is eligible for dispatch with no `missing-coherence` block
- Given a land rejected with a `criterion:cannot-deliver-architecture:<n>` gap, when the rejection is inspected, then the worktree's plan file is unchanged and no halt marker, decide-grant, or step re-dispatch was written

#### Negative Paths
- Given a merged spec whose coherence artifact has zero `criterion` rows, when daemon discovery parses the artifact, then the spec remains eligible exactly as before this change
- Given the `coverage_binding` input reader of the coherence artifact, when it reads a seven-cell `criterion` row, then it yields the same criterion, task ids, quote, and disposition as for a six-cell row and ignores the correction

### Done When
- [ ] A discovery test pins eligibility of a merged artifact containing a seven-cell `criterion` row
- [ ] No code path outside `coherence-parse.ts` and `coherence-validator.ts` reads `correction`; the `daemon-backlog.ts` call site is unchanged
