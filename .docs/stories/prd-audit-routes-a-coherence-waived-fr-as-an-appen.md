**Status:** Accepted

# Stories: prd_audit honors a committed coherence waiver for an uncovered FR

Source: jstoup111/ai-conductor#2888. Track: technical (no PRD). Tier: S.

Fixture used throughout: the audited feature's plan stem is `feature`. Its PRD, written `<prd-path>` below, is
the `feature.md` file in the specs directory. It declares `FR-1` and `FR-17` under `## Functional Requirements`.
Stories cite only `FR-1`, so no story criterion covers `FR-17`. A waiver file, when present, is
`.docs/coherence-waivers/feature.md` and contains `Waives: FR-17` and a non-empty `Rationale:` line.

## Story 1: A committed coherence waiver discharges its FR from the prd_audit coverage obligation

**Requirement:** #2888 Done when — a prd_audit run over a waived FR produces no gap for that FR and does not halt on it

As an operator, I want prd_audit to honor the coherence waiver that DECIDE approved for an FR with
no story, so that a feature with a waived documentation FR ships without a manual halt clear.

### Acceptance Criteria

#### Happy Path
- Given the fixture with the waiver present, when prd_audit dispatches, then the dispatched PRD-audit evidence is projection version 6 and lists `FR-17` among the PRD's waived requirements with path `<prd-path>` and the waiver's rationale text, and does not list `FR-1` as waived.
- Given the fixture with the waiver present and a provider judgment that grades every story criterion PASS with no association to `FR-17`, when prd_audit validates and persists the judgment, then the run succeeds and the persisted verdict is complete with no diagnostics and no PLAN_GAP judgment.
- Given the waiver reads `Waives: outcome-3, FR-17` with a non-empty rationale, when prd_audit dispatches, then `FR-17` is still listed as waived and no non-FR id appears among the waived requirements.

#### Negative Paths
- Given the fixture with no waiver file for the plan stem, but `.docs/coherence-waivers/other-feature.md` lists `Waives: FR-17`, when the same all-PASS judgment is validated, then the run fails as `structured-result-rejected` with the diagnostic `requirement <prd-path>:FR-17 lacks a criterion association or valid PLAN_GAP evidence`, and the persisted verdict is incomplete.
- Given the waiver file has `Waives: FR-17` but an empty or missing `Rationale:` line, or has no `Waives:` line, when prd_audit dispatches and validates the same judgment, then no requirement is listed as waived and the `FR-17` coverage diagnostic is still reported.
- Given the waiver lists `FR-17` and the PRD also declares an uncovered, unwaived `FR-18`, when the all-PASS judgment is validated, then the only coverage diagnostic names `FR-18`, and none names `FR-17`.
- Given the waiver lists `FR-99`, which no projected PRD source declares, when prd_audit dispatches, then `FR-99` is not listed as waived and no requirement is invented for it.
- Given two projected PRD sources both declare `FR-17` and the waiver lists `FR-17`, when prd_audit dispatches, then `FR-17` is not listed as waived for either source and each source's uncovered `FR-17` is still diagnosed.
- Given `.docs/coherence-waivers/feature.md` exists but cannot be read as a file (it is a directory), when prd_audit runs, then it stops before any provider invocation with a prd-audit input projection fault naming dimension `coherence-waiver`, and persists no verdict.

### Done When
- [ ] `step-runners-prd-audit.test.ts` shows a waived `FR-17` projected as waived and an all-PASS judgment persisted complete with no diagnostics.
- [ ] `prd-audit-contract.test.ts` shows waived requirements excluded from the coverage diagnostic while an unwaived uncovered requirement is still diagnosed.
- [ ] `prd-audit-projection.test.ts` shows absent, foreign-stem, malformed, undeclared, ambiguous, and unreadable waivers each producing no discharge or a named fault.
