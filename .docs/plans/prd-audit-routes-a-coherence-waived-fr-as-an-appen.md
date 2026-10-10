# Implementation Plan: prd_audit honors a committed coherence waiver for an uncovered FR

**Date:** 2026-10-09
**Design:** none (technical track, Tier S — see `.docs/track/prd-audit-routes-a-coherence-waived-fr-as-an-appen.md`)
**Stories:** .docs/stories/prd-audit-routes-a-coherence-waived-fr-as-an-appen.md
**Conflict check:** Not required (Tier S)

## Summary

Make prd_audit treat an `FR-N` listed in the audited feature's own committed coherence waiver as
discharged. The fix has four parts. A shared waiver-declaration parser. A projected
`waivedRequirements` list, with the projection version going from 5 to 6. A coverage-loop exemption
in the judgment contract. The runner pass-through, plus the matching `prd-audit` skill guidance.
Seven tasks.

## Technical Approach

- **Root cause (verified).** `validatePrdAuditJudgment` (`src/conductor/src/engine/prd-audit-contract.ts`, coverage loop after `associatedRequirements`) diagnoses every projected PRD requirement that has neither story coverage nor a PLAN_GAP association. The projection (`buildPrdAuditProjection` in `src/conductor/src/engine/prd-audit-projection.ts`) never reads `.docs/coherence-waivers/`. So a DECIDE-waived FR, which by construction has no story, either makes the verdict incomplete (`structured-result-rejected`) or forces the auditor to raise a PLAN_GAP (`skills/prd-audit/SKILL.md`), which halts `plan-gap`. Filtering remediation gaps (the issue's hypothesis) would not reach either failure. That path is rejected in the track artifact.
- **One parser, shared.** `src/conductor/src/engine/engineer/coherence-waiver.ts` gains an exported `parseCoherenceWaiverDeclaration(text): { gapIds: string[]; rationale: string } | null`. It holds the existing `Waives:` / `Rationale:` grammar, without the vocabulary check. `parseCoherenceWaiver` keeps its signature and behavior by calling it and then applying the `knownGapIds` check. Land semantics are unchanged.
- **Projection.** The present-PRD variant of `PrdAuditProjection['prd']` gains `waivedRequirements: readonly { path: string; requirementId: string; rationale: string }[]`. `buildPrdAuditProjection` reads `.docs/coherence-waivers/<basename(planPath, '.md')>.md`, which is only the audited feature's own stem. It handles the read as follows:
  - ENOENT means `[]`.
  - Any other read error (for example EISDIR) returns the fault `{ dimension: 'coherence-waiver', detail: 'active coherence waiver is unreadable' }`.
  - If `parseCoherenceWaiverDeclaration` returns `null`, the result is `[]`.
  - Each waived id that matches `/^FR-\d+[A-Za-z]?$/i` is uppercased. It is bound only when exactly one projected PRD source declares that id. An undeclared id or an id declared in more than one source is not bound.
  - Non-FR ids are ignored.
  - `PRD_AUDIT_PROJECTION_VERSION` becomes `6`. The rationale counts toward the existing total envelope limit, with no new limit dimension. Projection follows the existing `coherencePath` read idiom in the same function: ENOENT is absent, and any other error is a named fault.
- **Contract.** `PrdAuditJudgmentContext` gains an optional `waivedRequirements?: readonly PrdAuditRequirementAssociation[]`. In the coverage loop, a requirement whose `path\u0000requirementId` key is waived is skipped, with no diagnostic. Waived requirements stay in `requirements`, so a stray association to one still resolves. Grading remains the auditor's judgement, and this change adds no grade rewriting.
- **Runner.** The `prd_audit` branch of `DefaultStepRunner.run` (`src/conductor/src/engine/step-runners.ts`) passes `projection.projection.prd.waivedRequirements` (or `[]` for an absent PRD) into `validatePrdAuditJudgment`. That runner branch is the production entry point. `test/engine/step-runners-prd-audit.test.ts` owns the boundary proof.
- **Skill.** The PLAN_GAP bullet in `skills/prd-audit/SKILL.md` gains an exemption. A requirement listed in the projection's waived requirements is discharged by its committed coherence waiver, so it is not graded and not made a PLAN_GAP.
- **Out of scope** (track scope boundary): land waiver validation, remediation admission and the kickback-cap halt in `conductor.ts`, and PLAN_GAP or OVER_SCOPE routing.

Notation: `<prd-path>` is the fixture PRD's repo-relative path, which is the `feature.md` file in the specs directory, exactly as the projection reports it. Tests use that literal path.

Test pattern context: `test/engine/prd-audit-projection.test.ts` builds a temp git repo through its `fixture()` helper. Its multi-source case writes `.docs/specs/audit-fixture.md` and `.docs/specs/2026-09-30-audit-fixture.md`. `test/engine/step-runners-prd-audit.test.ts` uses `fixture()`, `runner(root, result)` and `dispatchedProjection(invoke)`, with plan stem `feature`. Search hints: `rg "lacks a criterion association" src/conductor/test/engine`, and `rg "version: 5" src/conductor/test/engine/step-runners-prd-audit.test.ts`.

## Prerequisites

- None.

## Tasks

### Task 1: Export the coherence waiver declaration parser
**Story:** Story 1 (happy path 3; negative path 2 — waiver grammar)
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/coherence-waiver.test.ts` for `parseCoherenceWaiverDeclaration`. `'Waives: outcome-3, FR-17\n\nRationale: FR-17 is documentation.'` yields `{ gapIds: ['outcome-3', 'FR-17'], rationale: 'FR-17 is documentation.' }`. Text with an empty `Rationale:`, text with no `Rationale:` line, and text with no `Waives:` line each yield `null`.
2. Verify RED.
3. In `coherence-waiver.ts`, extract the existing grammar (the `WAIVES_LINE_RE` and `RATIONALE_RE` matches, the comma split, and the empty checks) into the exported `parseCoherenceWaiverDeclaration`. Rewrite `parseCoherenceWaiver` to call it and then apply the `knownGapIds` check.
4. Verify GREEN; commit "refactor(coherence-waiver): export the waiver declaration parser".

**Done when:**
- [test] `coherence-waiver.test.ts` asserts `parseCoherenceWaiverDeclaration` returns `gapIds` `['outcome-3', 'FR-17']` and the trimmed rationale for a mixed-id waiver.
- [test] The same test asserts `parseCoherenceWaiverDeclaration` returns `null` for an empty rationale, a missing `Rationale:` line, and a missing `Waives:` line.
- [test] The existing `parseCoherenceWaiver` and `evaluateCoherenceWaiver` cases in `coherence-waiver.test.ts` pass unchanged, so land-time waiver behavior is preserved.

**Files likely touched:**
- `src/conductor/src/engine/engineer/coherence-waiver.ts` — exported declaration parser; `parseCoherenceWaiver` delegates
- `src/conductor/test/engine/engineer/coherence-waiver.test.ts` — declaration parser cases

**Dependencies:** none

### Task 2: Project the audited feature's waived FRs (version 6)
**Story:** Story 1 (happy paths 1 and 3)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/prd-audit-projection.test.ts`. The PRD declares `FR-1` and `FR-17`, and `.docs/coherence-waivers/<plan-stem>.md` contains `Waives: FR-17` and `Rationale: FR-17 is documentation.`. Assert that `buildPrdAuditProjection` returns `projection.version === 6` and `projection.prd.waivedRequirements` equal to `[{ path: <prd path>, requirementId: 'FR-17', rationale: 'FR-17 is documentation.' }]`, with no `FR-1` entry. A second case uses `Waives: outcome-3, FR-17` and asserts the same single `FR-17` entry, with no `outcome-3` entry.
2. Verify RED.
3. In `prd-audit-projection.ts`, add `waivedRequirements` to the present-PRD variant type. After `sources` are built, read `.docs/coherence-waivers/<basename(planPath, '.md')>.md`, parse it with `parseCoherenceWaiverDeclaration`, and keep uppercased ids that match `/^FR-\d+[A-Za-z]?$/i` and are declared by exactly one source. Map each kept id to `{ path, requirementId, rationale }`. Set `PRD_AUDIT_PROJECTION_VERSION = 6`. ENOENT yields `[]` (the full negative handling is Task 3).
4. Update the pinned `version: 5` expectation in `src/conductor/test/engine/step-runners-prd-audit.test.ts` to `6`.
5. Verify GREEN; commit "feat(prd-audit): project the feature's coherence-waived requirements".

**Done when:**
- [test] `prd-audit-projection.test.ts` asserts `buildPrdAuditProjection` yields version 6 and `prd.waivedRequirements` exactly `[{ path, requirementId: 'FR-17', rationale: 'FR-17 is documentation.' }]` with no `FR-1` entry.
- [test] The same test asserts a `Waives: outcome-3, FR-17` waiver still yields exactly the single `FR-17` entry and no entry for `outcome-3`.
- [test] `prd-audit-projection.test.ts` asserts a projection with no waiver file yields `prd.waivedRequirements` equal to `[]`, and the existing projection cases pass with only the version expectation moved to 6.

**Files likely touched:**
- `src/conductor/src/engine/prd-audit-projection.ts` — waiver read, `waivedRequirements`, version 6
- `src/conductor/test/engine/prd-audit-projection.test.ts` — waived-requirement projection cases
- `src/conductor/test/engine/step-runners-prd-audit.test.ts` — version pin 5 → 6

**Dependencies:** Task 1

### Task 3: Waivers that cannot discharge a requirement project nothing, or fault when unreadable
**Story:** Story 1 (negative paths 1, 2, 4, 5, 6 — projection layer)
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/prd-audit-projection.test.ts`, one per case:
   (a) no waiver for the plan stem, while `.docs/coherence-waivers/other-feature.md` lists `Waives: FR-17`;
   (b) three malformed waivers, each tested separately: `Waives: FR-17` with an empty `Rationale:`, `Waives: FR-17` with no `Rationale:` line, and a waiver with no `Waives:` line;
   (c) the waiver lists `FR-99`, which no source declares;
   (d) `audit-fixture.md` and `2026-09-30-audit-fixture.md` both declare `FR-17`, and the waiver lists `FR-17`;
   (e) `.docs/coherence-waivers/<plan-stem>.md` is a directory.
2. Verify RED (at least case (e) fails before the fault exists).
3. In `buildPrdAuditProjection`, return `{ ok: false, fault: { dimension: 'coherence-waiver', detail: 'active coherence waiver is unreadable' } }` for any non-ENOENT read error. Keep `[]` for ENOENT, for a `null` parse, and for ids that are unmatched, undeclared or declared by more than one source.
4. Verify GREEN; commit "feat(prd-audit): fail closed on waivers that cannot discharge a requirement".

**Done when:**
- [test] `prd-audit-projection.test.ts` asserts cases (a) foreign-stem waiver only, (b) empty rationale, (b) missing `Rationale:` line, and (b) missing `Waives:` each yield `prd.waivedRequirements` equal to `[]`.
- [test] The same test asserts case (c) yields `[]` and the projected `requirements` contain no `FR-99` entry, so no requirement is invented.
- [test] The same test asserts case (d) yields `[]` while both sources still list `FR-17` in their `requirements`.
- [test] The same test asserts case (e) returns `ok: false` with fault dimension `coherence-waiver` and detail `active coherence waiver is unreadable`.

**Files likely touched:**
- `src/conductor/src/engine/prd-audit-projection.ts` — unreadable-waiver fault and non-discharge branches
- `src/conductor/test/engine/prd-audit-projection.test.ts` — negative waiver cases

**Dependencies:** Task 2

### Task 4: The judgment contract exempts waived requirements from the coverage obligation
**Story:** Story 1 (happy path 2; negative paths 3 and 5 — contract layer)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/prd-audit-contract.test.ts`, using a context whose single source `<prd-path>` declares `FR-1`, `FR-17` and `FR-18`, with criteria story-covering only `FR-1`. With `waivedRequirements: [{ path: '<prd-path>', requirementId: 'FR-17' }]`, an all-PASS judgment with no associations returns `ok: false`, and its only diagnostic is `requirement <prd-path>:FR-18 lacks a criterion association or valid PLAN_GAP evidence`. With `FR-18` also waived, it returns `ok: true` with no diagnostics. With two sources both declaring `FR-17` and `waivedRequirements: []` (what Task 3 case (d) projects), both sources' `FR-17` are diagnosed.
2. Verify RED.
3. Add `readonly waivedRequirements?: readonly PrdAuditRequirementAssociation[]` to `PrdAuditJudgmentContext`. Build a key set `path\u0000requirementId` from it. In the coverage loop, `continue` before the diagnostic for a waived key. Leave `requirementKeys`, the association resolution, and the PLAN_GAP handling unchanged.
4. Verify GREEN; commit "feat(prd-audit): exempt coherence-waived requirements from coverage".

**Done when:**
- [test] `prd-audit-contract.test.ts` asserts `validatePrdAuditJudgment` with `FR-17` waived returns exactly one coverage diagnostic, naming `FR-18`, and no diagnostic naming `FR-17`.
- [test] The same test asserts that with `FR-17` and `FR-18` both waived, an all-PASS judgment returns `ok: true` with no PLAN_GAP judgment and no diagnostics.
- [test] The same test asserts that with two sources declaring `FR-17` and an empty `waivedRequirements`, each source's `FR-17` is reported by its own coverage diagnostic.
- [test] The existing `prd-audit-contract.test.ts` cases, which omit `waivedRequirements`, pass unchanged.

**Files likely touched:**
- `src/conductor/src/engine/prd-audit-contract.ts` — `waivedRequirements` context field and coverage-loop exemption
- `src/conductor/test/engine/prd-audit-contract.test.ts` — waived-coverage cases

**Dependencies:** none

### Task 5: The prd_audit runner dispatches waived FRs and settles a complete verdict over them
**Story:** Story 1 (happy paths 1 and 2 — runner boundary)
**Type:** happy-path

**Steps:**
1. Extend `fixture()` usage in `src/conductor/test/engine/step-runners-prd-audit.test.ts` with a case that adds `- FR-17: Filers receive overlap guidance.` to `<prd-path>`. Commit `.docs/coherence-waivers/feature.md` containing `Waives: FR-17` and `Rationale: FR-17 is documentation.` before the `feature/audit` branch. Run `subject.run('prd_audit', { complexity_tier: 'S' })` with `passingJudgment`.
2. Assert that `dispatchedProjection(invoke)` has `version: 6`, and that `prd.sources[0].path` is `<prd-path>`. Assert that `prd.waivedRequirements` equals `[{ path: '<prd-path>', requirementId: 'FR-17', rationale: 'FR-17 is documentation.' }]`. Assert the run resolves `success: true`, and that the persisted `PRD_AUDIT_VERDICT_PATH` has `complete: true`, `diagnostics: []`, and no judgment graded `PLAN_GAP`.
3. Verify RED.
4. In the `prd_audit` branch of `DefaultStepRunner.run` in `step-runners.ts`, pass `waivedRequirements: 'waivedRequirements' in projection.projection.prd ? projection.projection.prd.waivedRequirements : []` to `validatePrdAuditJudgment`.
5. Verify GREEN; commit "feat(prd-audit): honor coherence-waived FRs at the prd_audit runner".

**Done when:**
- [test] `step-runners-prd-audit.test.ts` asserts the prompt dispatched by `DefaultStepRunner.run('prd_audit')` carries projection version 6 whose `prd.waivedRequirements` is exactly the `FR-17` entry with path `<prd-path>` and rationale `FR-17 is documentation.`, and has no `FR-1` entry.
- [test] The same test asserts the run resolves `success: true` and the persisted verdict at `PRD_AUDIT_VERDICT_PATH` has `complete: true`, empty `diagnostics`, and no `PLAN_GAP` judgment.
- `step-runners.ts` passes the projection's `waivedRequirements` (or `[]` when the PRD is absent) into `validatePrdAuditJudgment` for the `prd_audit` step.

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts` — pass `waivedRequirements` into validation
- `src/conductor/test/engine/step-runners-prd-audit.test.ts` — waived-FR dispatch and settle case

**Dependencies:** Tasks 2, 4

### Task 6: The prd_audit runner still rejects or faults when no valid waiver applies
**Story:** Story 1 (negative paths 1, 2 and 6 — runner boundary)
**Type:** negative-path

**Steps:**
1. Add three cases to `src/conductor/test/engine/step-runners-prd-audit.test.ts`, each using the Task 5 PRD with `FR-17` and `passingJudgment`:
   (a) only `.docs/coherence-waivers/other-feature.md` lists `Waives: FR-17`;
   (b) `.docs/coherence-waivers/feature.md` is malformed, in three separate sub-cases: `Waives: FR-17` with an empty `Rationale:`, `Waives: FR-17` with no `Rationale:` line, and no `Waives:` line;
   (c) `.docs/coherence-waivers/feature.md` is a directory.
2. For (a) and (b), assert that the run resolves `success: false`, that the output starts with `structured-result-rejected:` and contains `requirement <prd-path>:FR-17 lacks a criterion association or valid PLAN_GAP evidence`, that the persisted verdict has `complete: false`, and that the dispatched projection's `prd.waivedRequirements` is `[]`. For (c), assert that `invoke` is never called, that the output contains `prd-audit input projection fault: coherence-waiver`, and that `expectNoVerdict(root)` holds.
3. Verify RED or GREEN. If Tasks 3 and 5 already produce these outcomes, commit only the tests.
4. Commit "test(prd-audit): runner rejects uncovered FRs without a valid feature waiver".

**Done when:**
- [test] `step-runners-prd-audit.test.ts` asserts a foreign-stem-only waiver yields `success: false`, `structured-result-rejected:` output naming the `FR-17` coverage diagnostic, and a persisted verdict with `complete: false`.
- [test] The same test asserts each malformed waiver (empty `Rationale:`, missing `Rationale:` line, missing `Waives:` line) yields an empty dispatched `prd.waivedRequirements`, the same `FR-17` coverage diagnostic, and `complete: false`.
- [test] The same test asserts a directory at `.docs/coherence-waivers/feature.md` stops `prd_audit` before any provider invocation with output containing `prd-audit input projection fault: coherence-waiver` and writes no verdict.

**Files likely touched:**
- `src/conductor/test/engine/step-runners-prd-audit.test.ts` — negative runner cases

**Dependencies:** Tasks 3, 5

### Task 7: prd-audit skill exempts waived requirements from PLAN_GAP guidance
**Story:** Story 1 (happy path 2 — auditor guidance consistent with the contract)
**Type:** infrastructure

**Steps:**
1. In `skills/prd-audit/SKILL.md`, extend the `**PLAN_GAP**` bullet after "rather than assessing the FR as though it were a criterion." with this sentence: "A requirement listed under the PRD's waived requirements in the projection is discharged by the feature's committed coherence waiver: do not grade it, associate it with a criterion, or make it a PLAN_GAP."
2. Natural-language guidance is not tested by wording (HARNESS.md). Confirm consistency by running `test/test_harness_integrity.sh` once.
3. Commit "docs(prd-audit): waived requirements are not PLAN_GAPs".

**Done when:**
- The `**PLAN_GAP**` bullet in `skills/prd-audit/SKILL.md` states that a requirement in the projection's waived requirements is not graded, associated, or made a PLAN_GAP, and the skill's untraced-FR PLAN_GAP instruction no longer applies to waived requirements.
- `test/test_harness_integrity.sh` exits 0 with the edited skill.

**Files likely touched:**
- `skills/prd-audit/SKILL.md` — PLAN_GAP waived-requirement exemption

**Dependencies:** Task 5

## Task Dependency Graph

```
Task 1 ──▶ Task 2 ──▶ Task 3 ──┐
                └─────────────▶ Task 5 ──▶ Task 6
Task 4 ────────────────────────▶ Task 5 ──▶ Task 7
```

## Integration Points

- After Task 5: `DefaultStepRunner.run('prd_audit')`, the production entry point, dispatches waived FRs and settles a complete verdict over them.
- After Task 6: the same entry point keeps today's rejection when no valid feature waiver applies, and faults on an unreadable waiver.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the fixture with the waiver present, when prd_audit dispatches, then the dispatched PRD-audit evidence is projection version 6 and lists `FR-17` among the PRD's waived requirements with path `<prd-path>` and the waiver's rationale text, and does not list `FR-1` as waived. | 5 | "carries projection version 6 whose `prd.waivedRequirements` is exactly the `FR-17` entry with path `<prd-path>` and rationale `FR-17 is documentation.`, and has no `FR-1` entry" | diff-local |
| Story 1 happy: Given the fixture with the waiver present and a provider judgment that grades every story criterion PASS with no association to `FR-17`, when prd_audit validates and persists the judgment, then the run succeeds and the persisted verdict is complete with no diagnostics and no PLAN_GAP judgment. | 5 | "the run resolves `success: true` and the persisted verdict at `PRD_AUDIT_VERDICT_PATH` has `complete: true`, empty `diagnostics`, and no `PLAN_GAP` judgment" | diff-local |
| Story 1 happy: Given the waiver reads `Waives: outcome-3, FR-17` with a non-empty rationale, when prd_audit dispatches, then `FR-17` is still listed as waived and no non-FR id appears among the waived requirements. | 2 | "a `Waives: outcome-3, FR-17` waiver still yields exactly the single `FR-17` entry and no entry for `outcome-3`" | diff-local |
| Story 1 negative: Given the fixture with no waiver file for the plan stem, but `.docs/coherence-waivers/other-feature.md` lists `Waives: FR-17`, when the same all-PASS judgment is validated, then the run fails as `structured-result-rejected` with the diagnostic `requirement <prd-path>:FR-17 lacks a criterion association or valid PLAN_GAP evidence`, and the persisted verdict is incomplete. | 6 | "a foreign-stem-only waiver yields `success: false`, `structured-result-rejected:` output naming the `FR-17` coverage diagnostic, and a persisted verdict with `complete: false`" | diff-local |
| Story 1 negative: Given the waiver file has `Waives: FR-17` but an empty or missing `Rationale:` line, or has no `Waives:` line, when prd_audit dispatches and validates the same judgment, then no requirement is listed as waived and the `FR-17` coverage diagnostic is still reported. | 3, 6 | "each malformed waiver (empty `Rationale:`, missing `Rationale:` line, missing `Waives:` line) yields an empty dispatched `prd.waivedRequirements`, the same `FR-17` coverage diagnostic, and `complete: false`" | diff-local |
| Story 1 negative: Given the waiver lists `FR-17` and the PRD also declares an uncovered, unwaived `FR-18`, when the all-PASS judgment is validated, then the only coverage diagnostic names `FR-18`, and none names `FR-17`. | 4 | "returns exactly one coverage diagnostic, naming `FR-18`, and no diagnostic naming `FR-17`" | diff-local |
| Story 1 negative: Given the waiver lists `FR-99`, which no projected PRD source declares, when prd_audit dispatches, then `FR-99` is not listed as waived and no requirement is invented for it. | 3 | "case (c) yields `[]` and the projected `requirements` contain no `FR-99` entry, so no requirement is invented" | diff-local |
| Story 1 negative: Given two projected PRD sources both declare `FR-17` and the waiver lists `FR-17`, when prd_audit dispatches, then `FR-17` is not listed as waived for either source and each source's uncovered `FR-17` is still diagnosed. | 3, 4 | "with two sources declaring `FR-17` and an empty `waivedRequirements`, each source's `FR-17` is reported by its own coverage diagnostic" | diff-local |
| Story 1 negative: Given `.docs/coherence-waivers/feature.md` exists but cannot be read as a file (it is a directory), when prd_audit runs, then it stops before any provider invocation with a prd-audit input projection fault naming dimension `coherence-waiver`, and persists no verdict. | 6 | "stops `prd_audit` before any provider invocation with output containing `prd-audit input projection fault: coherence-waiver` and writes no verdict" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
