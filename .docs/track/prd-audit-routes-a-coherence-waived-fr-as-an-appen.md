# Track: prd_audit honors a committed coherence waiver for an uncovered FR

Track: technical

Scope boundary: Targeted engine fix (operator-delegated DECIDE, 2026-10-09). The audited feature's own committed coherence waiver (`.docs/coherence-waivers/<plan-stem>.md`) discharges each `FR-N` it lists from the prd_audit requirement-coverage obligation. The engine projects those requirements to the auditor as waived, with the waiver rationale, and the judgment contract stops demanding story or PLAN_GAP evidence for them. The `prd-audit` skill's PLAN_GAP guidance exempts them. Excluded: any change to land-time waiver validation (`coherence-waiver.ts` fresh-in-diff semantics), to remediation gap admission or the kickback-cap halt in `conductor.ts`, to PLAN_GAP or OVER_SCOPE routing, and to non-FR waiver ids (outcome, story, task, criterion, ADR). A waiver never discharges a requirement another feature's spec declared.

Engine-internal gate behavior with no product requirements; acceptance criteria live in stories (intake jstoup111/ai-conductor#2888).

## Diagnosis (verified against main e6b56fe3da)

- The incident on 2026-09-30/10-02 (`surface-evidence-path-overlap-as-suggested-depende`, waiver `Waives: FR-17`) predates the typed PRD-audit contract (#2897, merged 2026-10-05). The halt text in the issue came from the old Markdown remediation path. The root cause is still live on main, in a different form.
- `validatePrdAuditJudgment` (`src/conductor/src/engine/prd-audit-contract.ts:460-469`) requires every projected PRD requirement to be story-covered or associated with a PLAN_GAP judgment. Otherwise it adds `requirement <path>:<FR> lacks a criterion association or valid PLAN_GAP evidence`. That makes the verdict incomplete, and an exhausted `structured-result-rejected` retry halts.
- `skills/prd-audit/SKILL.md` (PLAN_GAP bullet) tells the auditor to make an untraced FR "explicit as a PLAN_GAP". That PLAN_GAP routes to a `plan-gap` halt for a happy-path criterion (`conductor.ts:3308`), or it records a false gap.
- Neither the projection (`prd-audit-projection.ts` `buildPrdAuditProjection`) nor the contract reads `.docs/coherence-waivers/`. Only land (`coherence-waiver.ts`, `land-spec.ts:668-695`) knows waivers exist. So a waived FR, which by construction has no story, can never be discharged at audit. The requirement's own DECIDE-approved disposition is invisible there.

## Approaches weighed

- **A — Filter waived FR ids at remediation gap admission (the issue's hypothesis).** Rejected. It treats the symptom only. On main the waived FR now fails the audit before remediation (an incomplete verdict or a forced PLAN_GAP halt), so filtering remediation gaps would leave the group halting.
- **B — Discharge waived FRs in the audit contract, and project them to the auditor (selected).** It fixes the obligation at its single source (`prd-audit-contract.ts`). The judgment stays with the auditor, and machinery does the bookkeeping (CLAUDE.md design principle). Effort is about half a day, in three engine files, one skill paragraph, and tests.
- **C — Forbid FR waivers at land, forcing a story for every FR.** Rejected. It overturns an operator-approved DECIDE outcome (documentation FRs legitimately have no story under the stories documentation boundary) and is a broader policy change than the issue asks.
