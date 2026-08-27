# Implementation Plan: Remediation gap ids admissible on no-PRD features

**Date:** 2026-08-27
**Stories:** .docs/stories/remediation-gap-ids-have-no-admissible-form-on-a-n.md

## Summary

Documents the criterion gap-id form in the remediate skill, makes the no-admitted-gap kickback-cap
halt name the rejected ids and available admission keys, and normalizes prd_audit admission-map
criterion keys so lookup is case-insensitive. 4 tasks.

## Technical Approach

Admission binds a planner gap to a prd_audit finding via `prdAuditFindings.get(gap.id.toUpperCase())`;
the map is populated with the finding's `criterion` verbatim plus already-uppercased `FR-N` ids
parsed from the report's `PRD:` column. On a no-PRD feature every `PRD:` cell is `none`, so the
criterion key is the only admissible identity — and it is undocumented in the planner's contract,
and stored case-sensitively.

Three changes, all narrow:

- **Skill contract** (`skills/remediate/SKILL.md`): the `id` field rule and the id-format checklist
  gain the criterion form `S<story>.<ordinal>`, explicitly scoped to report rows whose `PRD:`
  column is `none`.
- **Admission-map normalization** (`src/conductor/src/engine/conductor.ts`, insert site near the
  `prdAuditFindings.set(finding.criterion, …)` loop): store criterion keys uppercased so the
  existing `gap.id.toUpperCase()` lookup is case-insensitive. Fail-closed means: admission remains
  an exact string match against the normalized key set — the only relaxation is letter case; no
  prefix stripping, no fuzzy matching, and the rejected-gap `continue` path is untouched.
- **Halt detail** (`conductor.ts`, the `fixes.length > 0 && routedFixes.length === 0` halt): append
  to the existing detail the rejected gap ids and the admission keys that were available from the
  validated gate(s) (`prdAuditFindings` and/or as-built keys), or an explicit "no admission keys
  were available" statement when the validated maps are empty.

Tests extend the existing remediation-admission coverage in
`src/conductor/test/engine/conductor-remediation-authority-routing.test.ts` — follow that file's
existing fixture style (report + remediation.json fixtures driving the routing entry point); search
hint: existing cases asserting the "no admitted remediation gap" halt and criterion-bound admission.
Sequencing: normalization first (Task 2) so the halt-detail test (Task 3) asserts against final
admission semantics; the skill doc edit (Task 1) is independent.

## Prerequisites

None — all edits land in existing files with existing test harnesses.

## Tasks

### Task 1: Document the criterion gap-id form in the remediate skill
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Edit `skills/remediate/SKILL.md` `id` field rule (the "Field rules" bullet currently reading "the blocking FR id (`FR-N`)"): add the criterion form — for a prd_audit finding whose report row's `PRD:` column is `none` (no-PRD / technical-track feature), the id is the criterion key `S<story>.<ordinal>` (e.g. `S5.1`) exactly as the report's criterion column spells it.
2. Edit the id-format checklist item ("`id` format correct: …") to include the criterion form.
3. Make clear the criterion form applies only to `PRD: none` rows — rows carrying a real `FR-N` keep the `FR-N` id.
4. Run `test/test_harness_integrity.sh`.
5. Commit with message: "docs(remediate): document criterion gap-id form for no-PRD prd_audit findings"

**Done when:**
- The `id` field rule names `S<story>.<ordinal>` with the `PRD: none` applicability condition
- The id-format checklist line lists the criterion form alongside the existing five forms
- `test/test_harness_integrity.sh` exits 0

**Files likely touched:**
- skills/remediate/SKILL.md — id contract + checklist

**Dependencies:** none

### Task 2: Normalize prd_audit admission-map criterion keys to uppercase
**Story:** Story 3 (happy paths + Done When normalization check)
**Type:** happy-path

**Steps:**
1. Write failing test in `src/conductor/test/engine/conductor-remediation-authority-routing.test.ts`: a prd_audit report with FIXABLE criterion `S5.1` and a remediation gap id `s5.1` (disposition `build`, non-empty tasks) is admitted and routed; a sibling case with report criterion written `s5.1` and gap id `S5.1` also admits. Follow the file's existing report+remediation fixture pattern.
2. Verify tests fail (RED) — today the lowercase report criterion is stored verbatim and never matches.
3. Implement: at the `prdAuditFindings` population site in `src/conductor/src/engine/conductor.ts`, insert criterion keys as `finding.criterion.toUpperCase()` (FR ids are already uppercased by the parser).
4. Verify tests pass (GREEN); run the conductor test suite.
5. Commit with message: "fix(engine): case-insensitive criterion keys in prd_audit remediation admission"

**Done when:**
- Both new lowercase-mismatch cases pass; each asserts the gap routed (admitted), not merely no-halt
- The map-insert site uppercases criterion keys; the lookup expression is unchanged
- Full conductor test suite passes

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — admission-map insert
- src/conductor/test/engine/conductor-remediation-authority-routing.test.ts — new cases

**Dependencies:** none

### Task 3: Enumerate rejected ids and available keys in the no-admitted-gap halt
**Story:** Story 2 (happy path + empty-keys negative path)
**Type:** happy-path

**Steps:**
1. Write failing test in `conductor-remediation-authority-routing.test.ts`: drive the `FR-S5.1`-vs-`S5.1` mismatch (report FIXABLE criterion `S5.1`, gap id `FR-S5.1`, disposition `build` with tasks) and assert the halt detail contains both the rejected id `FR-S5.1` and the available key `S5.1`. Add a second case with a validated report containing no FIXABLE findings, asserting the detail states no admission keys were available.
2. Verify tests fail (RED) — the current detail names only the routing rule.
3. Implement: in the `fixes.length > 0 && routedFixes.length === 0` halt in `conductor.ts`, collect the rejected append-disposition gap ids and the key sets of whichever admission maps were validated (`prdAuditFindings`, as-built keys), and append them to the detail — e.g. `rejected gap ids: FR-S5.1; available admission keys: S5.1` or `…; no admission keys were available`. Reuse the maps already in scope; no new data structures beyond rendering.
4. Verify tests pass (GREEN); run the conductor test suite, confirming existing halt-message assertions still pass (extend, don't replace, the current detail text).
5. Commit with message: "fix(engine): no-admitted-gap halt names rejected ids and available admission keys"

**Done when:**
- The mismatch test asserts both `FR-S5.1` and `S5.1` appear in the halt detail
- The empty-keys test asserts an explicit no-keys-available statement (not an empty list)
- Existing "no admitted remediation gap" assertions in the suite still pass
- Full conductor test suite passes

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — halt detail rendering
- src/conductor/test/engine/conductor-remediation-authority-routing.test.ts — new cases

**Dependencies:** Task 2

### Task 4: Fail-closed rejection is unchanged for non-matching and owner-less gaps
**Story:** Story 3 (negative paths)
**Type:** negative-path

**Steps:**
1. Write failing-or-passing tests in `conductor-remediation-authority-routing.test.ts`: (a) gap id `FR-S5.1` against available key `S5.1` is rejected and the kickback-cap halt fires — normalization added no prefix or fuzzy matching; (b) an owner-less `PLAN_GAP`-style gap (no admitting finding in any case) is rejected regardless of id casing.
2. If a case already passes (expected — these guard existing behavior), keep it as regression coverage; verify by mutating the assertion once to prove it can fail, then restore.
3. Run the full conductor test suite.
4. Commit with message: "test(engine): fail-closed admission rejection unchanged under key normalization"

**Done when:**
- Both rejection cases assert the halt fires (not merely absence of routing)
- Full conductor test suite passes

**Files likely touched:**
- src/conductor/test/engine/conductor-remediation-authority-routing.test.ts — regression cases

**Verify-only:** yes

**Dependencies:** Task 2, Task 3

## Task Dependency Graph

```
Task 1 (skill doc)          — independent
Task 2 (key normalization) ──> Task 3 (halt detail) ──> Task 4 (fail-closed regression)
```

## Integration Points

- After Task 3: the full #1963 scenario is reproducible end-to-end in tests — a mismatched id
  halts with a readable detail; a case-mismatched criterion id routes.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
