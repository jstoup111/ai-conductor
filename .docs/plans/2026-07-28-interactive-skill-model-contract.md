# Implementation Plan: Interactive Skill Model Contract

**Date:** 2026-07-28
**Design:** Technical track; architecture review skipped for Small tier
**Stories:** `.docs/stories/interactive-skill-model-contract.md`
**Conflict check:** Skipped for Small tier

## Summary

Replace the Claude-only extra-row contract with an explicit supported-host interactive contract, reject incomplete or cross-provider Codex metadata, and regenerate the canonical model table. The work is split into three focused TDD tasks.

## Technical Approach

Keep `EXTRA_MODEL_TABLE_ROWS` as the single metadata source. Rename its execution path to a provider-neutral interactive label, retain each row's existing Claude semantics, and populate Codex model and effort cells with explicit inheritance from the applicable Codex session or spawned-agent configuration. Add a pure validation boundary in the table generator so blank Codex fields and Claude-native aliases in Codex cells fail before rendering. Update the focused unit and acceptance assertions, then regenerate only the marked `HARNESS.md` table region.

## Prerequisites

- The accepted technical story at `.docs/stories/interactive-skill-model-contract.md`.
- No new provider integration or per-skill Codex execution boundary is in scope.

## Tasks

### Task 1: Establish the supported-host interactive row contract
**Story:** Generated interactive model rows describe both supported hosts — happy paths 1 and 2
**Type:** happy-path

**Steps:**
1. Write failing focused tests asserting every extra row uses the provider-neutral interactive execution label, preserves non-empty Claude model semantics, and carries explicit non-empty Codex model and effort inheritance semantics.
2. Verify the focused metadata and generator tests fail because the current rows are Claude-only and leave Codex cells blank (RED).
3. Update the extra-row type and canonical metadata, using shared Codex inheritance constants where repetition would otherwise permit drift.
4. Verify the focused tests pass and the rendered rows describe Codex inheritance without naming a Claude model (GREEN).
5. Commit with message: `feat(models): describe both interactive hosts` and trailer `Task: 1`.

**Files:**
- `src/conductor/src/engine/model-table-metadata.ts` — define the supported-host interactive metadata contract and Codex inheritance values.
- `src/conductor/test/model-table-metadata.test.ts` — assert every canonical extra row has the complete dual-host shape.
- `src/conductor/test/generate-model-table.test.ts` — assert rendered extra rows expose both host contracts.

**Wired-into:** `src/conductor/src/tools/generate-model-table.ts#buildExtraRows`

**Dependencies:** none

### Task 2: Reject incomplete and cross-provider interactive metadata
**Story:** Generated interactive model rows describe both supported hosts — negative paths 1 and 2
**Type:** negative-path

**Steps:**
1. Write failing unit cases that pass fixture rows with an empty Codex model, an empty Codex effort, and a Claude-native alias in a Codex field to the pure extra-row validator.
2. Verify each fixture currently reaches rendering without a targeted contract error (RED).
3. Implement a pure interactive-row contract validator and invoke it before extra rows are returned or rendered; error messages must name the row and invalid provider field/value.
4. Verify all invalid fixtures fail deterministically while the canonical rows still pass (GREEN).
5. Commit with message: `test(models): fail closed on invalid interactive contracts` and trailer `Task: 2`.

**Files:**
- `src/conductor/src/tools/generate-model-table.ts` — validate interactive execution labels, required Codex fields, and provider-native alias boundaries.
- `src/conductor/test/generate-model-table.test.ts` — cover missing-field and cross-provider rejection with pure fixtures.

**Wired-into:** `src/conductor/src/tools/generate-model-table.ts#buildExtraRows`

**Dependencies:** Task 1

### Task 3: Regenerate and verify the canonical table contract
**Story:** Generated interactive model rows describe both supported hosts — all happy and negative paths; Done When 1–3
**Type:** infrastructure

**Steps:**
1. Update the focused acceptance assertions to expect the supported-host interactive label and non-empty Codex inheritance cells, including drift mutation coverage for an interactive Codex cell.
2. Verify the acceptance tests fail against the stale generated `HARNESS.md` table (RED).
3. Run `bin/generate-model-table` to rewrite only the marked generated region and align the provider-aware resolution assertions with the new contract.
4. Verify the focused unit and acceptance tests pass, then run `npm run typecheck:test`, `npm run lint`, and `bash test/test_harness_integrity.sh` as required by this repository (GREEN).
5. Commit with message: `docs(models): publish the dual-host interactive contract` and trailer `Task: 3`.

**Files:**
- `HARNESS.md` — regenerated model-selection table region.
- `src/conductor/test/acceptance/generate-model-table.acceptance.test.ts` — verify interactive Codex cell drift and generated output.
- `src/conductor/test/acceptance/provider-aware-model-resolution.acceptance.test.ts` — verify autonomous and supported-host interactive paths coexist.

**Wired-into:** none (no new production surface)

**Dependencies:** Task 2

## Task Dependency Graph

`Task 1 → Task 2 → Task 3`

## Integration Points

- After Task 1: canonical metadata and pure rendering expose both interactive host contracts.
- After Task 2: invalid Codex interactive metadata fails before table generation.
- After Task 3: generated `HARNESS.md`, drift checking, static checks, and repository integrity agree on the contract.

## Acceptance-Criteria Coverage

- Happy path 1 → Tasks 1 and 3.
- Happy path 2 → Tasks 1 and 3.
- Negative path 1 → Tasks 2 and 3.
- Negative path 2 → Tasks 2 and 3.
- Done When 1–3 → Task 3.

## Verification

- [ ] All happy-path criteria are covered by Tasks 1 and 3.
- [ ] Each negative path has an explicit failing-test task in Task 2.
- [ ] Every task is scoped to a focused TDD cycle with explicit dependencies.
- [ ] The dependency graph is acyclic.
- [ ] Every production surface has a valid `Wired-into:` declaration.
