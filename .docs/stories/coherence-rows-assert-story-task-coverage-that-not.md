**Status:** Accepted

# Stories: Criterion-level coherence coverage

Technical track — no PRD; these criteria are the contract. Source intake jstoup111/ai-conductor#1799.
Subsumes jstoup111/ai-conductor#1744: Story 1 is the mechanism that issue asks for — accepted stories
checked against the engine's own criterion extractor — so #1744 can be closed as covered when this
ships.

Governing decisions: `adr-2026-08-23-criterion-layer-is-structural-at-land`,
`adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote`,
`adr-2026-08-23-diff-locality-is-an-authored-disposition`,
`adr-2026-08-24-evidentiary-defects-are-not-waivable`.

## Story 1: Every accepted story criterion is owned by a task before the plan lands

As an operator, I want an accepted story criterion that no plan task owns to be rejected when the
spec lands, so that the gap is fixed while the artifacts are still being authored instead of
surfacing two steps later as an `acceptance_specs` needs-human halt.

### Acceptance Criteria

#### Happy Path
- Given a Medium-tier spec whose coherence artifact carries one criterion row for every criterion the engine extracts from its stories, when the operator runs engineer land, then the land succeeds and no criterion gap is reported
- Given a Large-tier spec whose stories declare both happy and negative criteria for three stories, when the land gate enumerates criteria, then it uses the same extractor `acceptance_specs` uses and derives an identical criterion set
- Given a spec whose coherence artifact carries criterion rows in any order relative to the stories file, when the land gate compares them, then ordering does not affect the verdict

#### Negative Paths
- Given a spec whose stories declare four criteria and whose coherence artifact carries three criterion rows and no waiver names the resulting gap, when the operator runs engineer land, then the land is rejected and the message names the omitted criterion verbatim
- Given a spec whose coherence artifact carries a criterion row whose criterion text matches no criterion in the stories file and no waiver names the resulting gap, when the operator runs engineer land, then the land is rejected and the message names that row as invented
- Given a spec whose coherence artifact carries two criterion rows for the same criterion and no waiver names the resulting gap, when the operator runs engineer land, then the land is rejected and the message names the duplicated criterion
- Given a Small-tier spec, when the operator runs engineer land, then the criterion layer does not engage and the land is unaffected
- Given a change set carrying no file under `.docs/coherence/`, when the operator runs engineer land, then the criterion layer does not engage and the legacy escape is preserved
- Given a spec whose stories file has no parseable story blocks, when the land gate enumerates criteria, then the land is rejected naming the unparseable stories file rather than reporting zero criteria as full coverage

### Done When
- [ ] `resolveRequiredLayers` returns a layer set containing `criterion` for tier M and tier L, and omits it for tier S
- [ ] A land-gate test proves a spec with one unrowed story criterion is rejected with that criterion's exact text in the message
- [ ] A land-gate test proves a criterion row citing text absent from the stories file is rejected as invented
- [ ] The land gate obtains its criterion set by calling `extractAuthoritativeStoryCriteria`, asserted by a test that fails if a second extractor is introduced

## Story 2: A coverage claim is rejected when the cited task's text does not support it

As an operator, I want a criterion row that attributes coverage to a named task to be rejected when
that task's committed text does not contain the quote the row relies on, so that a mapping the plan
contradicts cannot pass as `covered`.

### Acceptance Criteria

#### Happy Path
- Given a criterion row citing task 10 and quoting a span that appears verbatim in task 10's committed text, when the operator runs engineer land, then the row is accepted
- Given a criterion row whose quote differs from the cited task's text only in surrounding whitespace and line wrapping, when the land gate compares them, then the quote is accepted
- Given a criterion row citing two tasks and quoting a span from the second of them, when the land gate checks grounding, then the row is accepted because the quote is found in one cited task

#### Negative Paths
- Given a criterion row citing task 10 and quoting text that appears nowhere in task 10 and no waiver names the resulting gap, when the operator runs engineer land, then the land is rejected and the message names both the criterion and task 10 as the task it was attributed to
- Given a criterion row whose quote appears in the plan but inside a task other than the one cited, when the operator runs engineer land, then the land is rejected because the quote must be found in a cited task
- Given a criterion row citing a task id that does not exist in the plan, when the operator runs engineer land, then the land is rejected naming the unresolvable task id
- Given a criterion row with an empty quote, when the operator runs engineer land, then the land is rejected naming the criterion with the missing quote
- Given a criterion row whose quote is a paraphrase of the cited task rather than an exact span, when the land gate compares them, then the land is rejected because paraphrase does not ground a claim
- Given a plan task whose wording is edited after its criterion row was authored so the quote no longer occurs, when the operator re-runs engineer land, then the land is rejected naming that criterion and task rather than passing on the stale quote

### Done When
- [ ] A task-body extractor in `plan-task-parse.ts` returns the full committed body text for a given task id, covered by unit tests over multi-task plans
- [ ] A land-gate test reproduces the #1799 exemplar: a row claiming task 10 carries a third variant is rejected when the plan assigns two
- [ ] The rejection message contains both the criterion text and the cited task id, asserted by a test on the message content
- [ ] Whitespace normalization is applied to the quote comparison, proven by a test with a line-wrapped quote

## Story 3: A criterion whose truth depends on state outside the diff is rejected

As an operator, I want a completion criterion that can be invalidated by commits this feature does
not contain to be rejected when the spec lands, so that a criterion cannot invalidate itself between
authoring and BUILD and strand a fully implemented feature.

### Acceptance Criteria

#### Happy Path
- Given every criterion row carrying a diff-locality disposition drawn from the closed vocabulary and none of them negative, when the operator runs engineer land, then the land succeeds
- Given a criterion row marked diff-local whose criterion is satisfiable by the feature's own diff, when the land gate checks dispositions, then the row is accepted with no further analysis

#### Negative Paths
- Given a criterion row carrying no diff-locality disposition and no waiver naming the resulting gap, when the operator runs engineer land, then the land is rejected naming that criterion
- Given a criterion row whose disposition marks the criterion as depending on state outside the diff and no waiver naming the resulting gap, when the operator runs engineer land, then the land is rejected naming that criterion
- Given a criterion row whose disposition is a string outside the closed vocabulary, when the operator runs engineer land, then the land is rejected as malformed rather than treated as affirmative
- Given the recovered census criterion requiring a corpus test over every landed plan on main to find exactly one non-empty map, when it is authored as a criterion row, then the land is rejected because its truth depends on commits outside this feature's diff
- Given a criterion row whose disposition is negative and a fresh coherence waiver naming that criterion's gap id with a written rationale, when the operator runs engineer land, then the land succeeds and the deferral is recorded rather than silently dropped

### Done When
- [ ] The diff-locality disposition vocabulary is a closed union in the engine, with a test proving an unrecognized value is rejected rather than defaulted to affirmative
- [ ] A land-gate test proves a criterion row with an absent disposition is rejected naming that criterion
- [ ] A land-gate test uses the census criterion recovered from commit `e93914b2f^` and proves it is rejected
- [ ] `skills/coherence-check/SKILL.md` and `skills/plan/SKILL.md` document the disposition and the question the author must answer

## Story 4: Specs that landed before this shipped keep building

As an operator, I want every already-merged and parked spec to keep building unchanged, so that
adding a stricter land gate does not block the existing backlog.

### Acceptance Criteria

#### Happy Path
- Given a merged spec whose coherence artifact carries zero criterion rows, when daemon discovery evaluates it, then it is not blocked and remains eligible to build
- Given a merged spec whose coherence artifact carries zero criterion rows, when `prd_audit` reads the coherence mapping at SHIP, then it proceeds using the mapping it finds
- Given a coherence artifact carrying zero criterion rows, when `hasCoherenceTableDataRow` evaluates it, then it reports the artifact as a valid table

#### Negative Paths
- Given a merged spec whose coherence artifact carries zero criterion rows, when daemon discovery runs, then no `missing-coherence` blocked item is recorded for it
- Given a merged spec whose coherence artifact predates this feature entirely, when the daemon dispatches it to BUILD, then no step fails on the absence of criterion rows
- Given the criterion layer engages at land, when the change set is inspected, then the discovery-side coherence check in `daemon-backlog.ts` is unmodified by this feature

### Done When
- [ ] A test asserts `hasCoherenceTableDataRow` accepts an artifact containing no criterion rows
- [ ] A discovery test asserts a merged spec lacking criterion rows produces no blocked item
- [ ] A test asserts this feature's diff does not modify the discovery-side coherence check

## Story 5: Every new refusal is waivable and no unknown value passes silently

As an operator, I want each rejection this gate introduces to carry a stable gap id I can waive, and
no unrecognized field value to be treated as affirmative, so that a deliberate deferral stays
possible and an invented value cannot slip past the gate.

### Acceptance Criteria

#### Happy Path
- Given a criterion coverage gap and a fresh waiver naming that gap's stable id with a rationale, when the operator runs engineer land, then the land succeeds
- Given a criterion row carrying a verdict drawn from the closed vocabulary, when the land gate reads it, then the verdict is honored as authored

#### Negative Paths
- Given a criterion row carrying a verdict string outside the closed vocabulary, when the operator runs engineer land, then the land is rejected as malformed rather than treated as affirmative
- Given a waiver naming a gap id the validator never reported, when the operator runs engineer land, then the land is rejected because a waiver must name the validator's own gap ids
- Given a waiver that names some but not all reported criterion gaps, when the operator runs engineer land, then the land is rejected naming the uncovered gaps
- Given a waiver that was merged by an earlier feature rather than being fresh in this change set, when the operator runs engineer land, then the land is rejected on freshness
- Given a criterion **coverage** rejection of any class introduced by this feature, when its report is rendered, then it carries a stable gap id that the waiver mechanism accepts (evidentiary defects — an unreadable record or an unresolvable citation — are refused fail-closed and are deliberately not waivable, per `adr-2026-08-24-evidentiary-defects-are-not-waivable`)

### Done When
- [ ] Every criterion coverage rejection class emits a stable gap id, proven by a test enumerating the classes and asserting each id is waivable, and the same test records the evidentiary classes that are deliberately non-waivable
- [ ] A test asserts an unrecognized criterion verdict is rejected, contrasted with the existing affirmative-by-default behavior for legacy row classes
- [ ] A waiver test covers the partial-coverage and stale-waiver cases for criterion gaps

## Story 6: A late-discovered gap names the check that should have caught it

As an operator, I want an `acceptance_specs` coverage halt to name the DECIDE-time criterion check
when that check was in force for the spec, so that I am told where the defect belongs without being
misdirected on specs that landed before the check existed.

### Acceptance Criteria

#### Happy Path
- Given a spec whose coherence artifact carries criterion rows and whose `acceptance_specs` step finds an uncovered criterion, when the halt is rendered, then the message names the DECIDE-time criterion check that should have caught it
- Given a spec whose criteria are all covered, when `acceptance_specs` runs, then its behavior and messages are unchanged by this feature

#### Negative Paths
- Given a spec that landed before this feature shipped and whose coherence artifact carries no criterion rows, when `acceptance_specs` finds an uncovered criterion, then the halt keeps the existing message and does not name a check that was not in force
- Given a spec whose coherence artifact carries criterion rows, when `acceptance_specs` finds an invented disposition record rather than an omitted criterion, then the message distinguishes the two cases rather than naming the DECIDE check for both
- Given the `acceptance_specs` completion predicate, when this feature's change is applied, then it performs no new subprocess or network call and remains a pure read

### Done When
- [ ] The `acceptance_specs` uncovered-criterion message is conditional on the presence of criterion rows in the spec's coherence artifact, proven by tests for both branches
- [ ] A test asserts a legacy spec's halt message is byte-identical to today's
- [ ] A test asserts the completion predicate remains free of subprocess and network calls
