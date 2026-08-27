**Status:** Accepted

## Story 1: Remediate skill documents the criterion gap-id form

As a remediation planner working from a no-PRD `prd_audit` report, I want the id contract to name an admissible id form so that my dispositions route without operator intervention.

### Acceptance Criteria

#### Happy Path
- Given `skills/remediate/SKILL.md`, when the planner reads the `id` field rule in the disposition contract, then it states the criterion form `S<story>.<ordinal>` and that it applies when the prd_audit report's `PRD:` column is `none` (no-PRD feature)
- Given `skills/remediate/SKILL.md`, when the planner reads the id-format checklist item, then the accepted forms list includes the criterion form alongside `FR-N`, `build_review:<stem>`, `test:<stem>`, `adr-<stem>`, and `stall:<slug>`

#### Negative Paths
- Given a prd_audit report row whose `PRD:` column carries a real `FR-N` id, when the planner reads the contract, then it directs the planner to use the `FR-N` id (the criterion form is scoped to `PRD: none` rows, not offered as a general alternative)

### Done When
- [ ] `skills/remediate/SKILL.md` id field rule names the criterion form `S<story>.<ordinal>` with its `PRD: none` applicability condition
- [ ] The SKILL.md id-format checklist item lists the criterion form
- [ ] `test/test_harness_integrity.sh` passes

## Story 2: No-admitted-gap halt names rejected ids and available keys

As an operator diagnosing a kickback-cap halt, I want the halt detail to enumerate the rejected gap ids and the admission keys that were available so that the id mismatch is readable from the HALT alone.

### Acceptance Criteria

#### Happy Path
- Given a validated prd_audit admission pass where every requested remediation gap is rejected, when the engine emits the no-admitted-gap halt, then the halt detail lists each rejected gap id and the admission keys that were available for the validated gate(s)

#### Negative Paths
- Given a validated admission pass with zero available admission keys (no FIXABLE findings), when the halt is emitted, then the detail states that no admission keys were available rather than rendering an empty list ambiguously
- Given a remediation plan where at least one gap is admitted, when routing proceeds, then no enumerating halt is emitted and routing behavior is unchanged

### Done When
- [ ] The no-admitted-gap halt detail contains every rejected gap id and the available admission keys (or an explicit none-available statement)
- [ ] A unit test drives the `FR-S5.1`-vs-`S5.1` mismatch and asserts both the offending id and the available key appear in the halt detail
- [ ] Existing remediation-routing tests pass unchanged

## Story 3: Criterion admission lookup is case-insensitive

As a remediation planner, I want a criterion gap id to admit regardless of letter case so that a lowercase criterion in a report or disposition does not silently fail admission.

### Acceptance Criteria

#### Happy Path
- Given a prd_audit report with a FIXABLE finding for criterion `S5.1` and a remediation gap with id `s5.1` dispositioned `build` with tasks, when admission runs, then the gap is admitted and routed
- Given a report row whose criterion is written `s5.1`, when the admission map is built, then a gap id `S5.1` still admits (keys are normalized on insert)

#### Negative Paths
- Given a remediation gap whose id matches no criterion and no parsed FR id in any case (e.g. `FR-S5.1`), when admission runs, then the gap is rejected and the fail-closed halt fires — normalization introduces no fuzzy matching
- Given an owner-less `PLAN_GAP` or out-of-scope gap, when admission runs, then it is still rejected regardless of id casing

### Done When
- [ ] prd_audit admission-map keys are normalized on insert so `gap.id.toUpperCase()` lookup matches criterion keys case-insensitively
- [ ] Unit tests cover lowercase-gap-id and lowercase-report-criterion admission plus the still-rejected `FR-S5.1` case
- [ ] Exact-match admission semantics otherwise unchanged; full conductor test suite passes
