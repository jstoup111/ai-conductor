**Status:** Accepted

## Story 1: Criterion gap ids come from the engine projection

As a remediation planner working from a no-PRD `prd_audit` report, I want each criterion I must answer named by its engine criterion id in my input so that my dispositions route without operator intervention.

### Acceptance Criteria

#### Happy Path
- Given a no-PRD `prd_audit` verdict whose FIXABLE rows carry `PRD: none`, when gap planning is prepared, then the engine projection names each FIXABLE criterion by its engine criterion id in the form `S<story>.<ordinal>`, and a result that references those ids is accepted by the engine validator
- Given `skills/remediate/SKILL.md`, when the planner reads its gap-planning guidance, then it carries no `id` field rule and no id-format checklist; the admissible reference for each finding is the one the projection supplies

#### Negative Paths
- Given a `prd_audit` row whose `PRD:` column carries a real `FR-N` id, when gap planning is prepared, then the projection still names that criterion by its `S<story>.<ordinal>` engine criterion id, and a result citing the criterion by its `FR-N` form instead is rejected as a foreign reference

### Done When
- [ ] A no-PRD projection fixture carries each FIXABLE criterion as an `S<story>.<ordinal>` engine criterion id
- [ ] The provider skill contract audit passes with no id field rule or id-format checklist in the remediate gap-planning guidance
- [ ] `test/test_harness_integrity.sh` passes

## Story 2: A mismatched gap reference is diagnosed naming the rejected id and the available references

As an operator diagnosing a remediation failure, I want the diagnostic to enumerate the rejected references and the references that were required so that the id mismatch is readable without forensics.

### Acceptance Criteria

#### Happy Path
- Given a `prd_audit` gap-planning result that cites `FR-S5.1` where the required reference is `S5.1`, when the engine validator checks it, then the whole plan is rejected with a diagnostic listing the foreign reference `FR-S5.1` and the required reference `S5.1` it left unanswered
- Given a validated `prd_audit` admission pass where admission still admits no requested gap, when the engine emits the no-admitted-gap halt, then the halt detail lists each rejected gap id and the admission keys that were available for the validated gate(s)

#### Negative Paths
- Given a validated admission pass with zero available admission keys (no FIXABLE findings), when the no-admitted-gap halt is emitted, then the detail states that no admission keys were available rather than rendering an empty list ambiguously
- Given a validated remediation plan where at least one gap is admitted, when routing proceeds, then no enumerating halt is emitted and routing behavior is unchanged

### Done When
- [ ] A validator fixture drives the `FR-S5.1`-vs-`S5.1` mismatch and asserts both the foreign reference and the missing required reference appear in the rejection diagnostic
- [ ] The no-admitted-gap halt detail contains every rejected gap id and the available admission keys (or an explicit none-available statement)
- [ ] Existing remediation-routing tests pass unchanged for validated plans

## Story 3: Criterion admission lookup is case-insensitive

As a remediation planner, I want a criterion reference to match regardless of letter case so that a lowercase criterion in a report or disposition does not fail validation or admission.

### Acceptance Criteria

#### Happy Path
- Given a prd_audit verdict with a FIXABLE finding for criterion `S5.1` and a remediation result referencing `s5.1` dispositioned `build` with tasks, when the engine validator matches it against the required set using the shared case-normalization rules, then the reference is accepted, admitted, and routed
- Given a report row whose criterion is written `s5.1`, when the required reference set and admission map are built, then a result reference `S5.1` still matches (keys are normalized on insert)

#### Negative Paths
- Given a remediation result whose reference matches no required criterion in any case (e.g. `FR-S5.1`), when the engine validator checks it, then the whole plan is rejected naming the foreign reference — normalization introduces no fuzzy matching
- Given an owner-less `PLAN_GAP` or out-of-scope finding, which is not in the required reference set, when a result references it, then the whole plan is rejected naming it as a foreign reference, regardless of id casing

### Done When
- [ ] Required-reference and admission keys are case-normalized per the shared rules so a lowercase or uppercase criterion reference matches its criterion
- [ ] Unit tests cover lowercase-result-reference and lowercase-report-criterion acceptance plus the still-rejected `FR-S5.1` case
- [ ] Exact-match semantics otherwise unchanged; full conductor test suite passes
