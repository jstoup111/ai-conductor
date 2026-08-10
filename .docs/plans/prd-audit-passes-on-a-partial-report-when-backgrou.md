# Implementation Plan: prd_audit FR-coverage gate

**Date:** 2026-08-09
**Stories:** `.docs/stories/prd-audit-passes-on-a-partial-report-when-backgrou.md`
**Complexity:** Tier S — architecture-diagram, architecture-review, conflict-check and
coherence-check are skipped per tier rules.
**Source:** jstoup111/ai-conductor#1398

## Summary

Give the `prd_audit` gate a denominator. Today it asks only "are any *present* verdict rows
blocking", so a report missing rows entirely reads as clean and is recorded — and later reused — as
a pass. Nine small tasks derive the feature's approved-PRD FR ids deterministically, add one shared
coverage helper, and apply it at all three coverage-blind sites.

## Technical Approach

- **Reuse, do not invent.** `extractPrdFrIds` already parses `FR-N` ids under a PRD's
  `## Functional Requirements` heading; it is private to `engineer/coherence-validator.ts`. Lift it
  into a shared module so the coherence validator and the gate share one FR grammar. Row ids come
  from the existing `parseFrVerdictRow`.
- **Feature-scoped denominator.** Resolve this feature's approved PRD with the existing
  feature-identity ladder (`buildArtifactResolutionContext` / the `resolveFeatureStoriesPath`
  pattern), excluding `SUPERSEDED-` files. Never scan the whole `.docs/specs/` corpus — that helper
  already documents why that fallback is forbidden.
- **Fail closed where it is safe to.** `prd_audit` carries `skippableForTracks: ['technical']`
  (`steps.ts:223`), so whenever it runs the feature is product-track and a PRD exists. An
  unresolvable or unreadable PRD therefore blocks. An enumerable-but-empty FR set (a PRD with no
  `## Functional Requirements` section) leaves behavior unchanged, mirroring the coherence
  validator's existing FR-10 precedent.
- **One helper, three call sites.** The predicate (`artifacts.ts:2303`), the `gate-code-validity`
  preserve path (`:2257`) and the sweep-spare path (`:681`) all call the same coverage function, so
  a false pass cannot be recorded, preserved, or reused.
- **No new channel.** The coverage failure travels on `CompletionResult.reason`, which the existing
  `gate_verdict` event and HALT reason already carry. Nothing is added to the `ConductorEvent`
  union and no sidecar is introduced (event-spine §2).
- **No LLM.** Every part of this change is mechanical, per the repository's deterministic-first
  Design Principle.

## Prerequisites

- Stories carry `Status: Accepted`.
- Tests follow `.agents/skills/write-tests/SKILL.md`: narrowest seam, injected boundaries, isolated
  temporary roots, awaited cleanup, no real LLM/GitHub/network calls.
- `test/test_harness_integrity.sh` passes before commit.

## Release metadata

The retained PR declares `Release-Disposition: note`, `Release-Category: Fixed`,
`Release-Semver: patch`. No `settings.json` schema, hook wiring, skill symlink, or `bin/conduct`
CLI surface changes, so no migration block is required.

## Tasks

### Task 1: Lift the FR-id parser into a shared module

**Story:** Story 3 — feature-scoped denominator, Done-When 1
**Type:** infrastructure

**Steps:**
1. Write a failing test importing `extractPrdFrIds` from the new shared module, covering the
   heading-scoped section, the `FR-\d+[A-Za-z]?` shape, case normalization, and a PRD with no
   `## Functional Requirements` heading returning an empty set.
2. Verify the focused test fails (RED).
3. Create `src/conductor/src/engine/prd-fr-ids.ts` exporting `extractPrdFrIds`, moved verbatim from
   `engineer/coherence-validator.ts`; import it there instead of the local copy.
4. Verify the focused test and the existing coherence-validator tests pass (GREEN).
5. Commit with message: "refactor: share the PRD FR-id parser"

**Files:** `src/conductor/src/engine/prd-fr-ids.ts`,
`src/conductor/src/engine/engineer/coherence-validator.ts`,
`src/conductor/test/prd-fr-ids.test.ts`

**Wired-into:** `src/conductor/src/engine/engineer/coherence-validator.ts#validateCoherence`

**Dependencies:** none

### Task 2: Report the FR ids that carry no verdict row

**Story:** Story 1 — every FR must carry a verdict row, Done-When 1
**Type:** infrastructure

**Steps:**
1. Write a failing test for `findFrIdsWithoutRows(content, expectedIds)`: a report covering every
   id returns empty; a report missing two ids returns exactly those two; an empty report returns
   every id; row ids are matched case-insensitively.
2. Verify the focused test fails (RED).
3. Implement `findFrIdsWithoutRows` in `artifacts.ts`, collecting row ids via the existing
   `parseFrVerdictRow` so the row grammar is not duplicated.
4. Verify the focused test passes (GREEN).
5. Commit with message: "feat: detect PRD FRs with no audit verdict row"

**Files:** `src/conductor/src/engine/artifacts.ts`,
`src/conductor/test/prd-audit-coverage.test.ts`

**Wired-into:** none (inert until `src/conductor/src/engine/artifacts.ts`)

**Dependencies:** Task 1

### Task 3: Resolve this feature's approved PRD paths

**Story:** Story 3 — feature-scoped denominator, happy paths 1-2
**Type:** infrastructure

**Steps:**
1. Write a failing test for `resolveFeaturePrdPaths(projectRoot, ctx)`: a corpus of many specs
   yields only the stem-matched one; a `SUPERSEDED-` file is excluded; an unmatched corpus yields
   an empty result rather than the whole corpus.
2. Verify the focused test fails (RED).
3. Implement it in `artifacts.ts` mirroring `resolveFeatureStoriesPath`'s ladder
   (`activePlanPath` → `featureDesc` stem → `featureIdentities`), scoped to `.docs/specs/*.md`.
4. Verify the focused test passes (GREEN).
5. Commit with message: "feat: resolve a feature's own approved PRD paths"

**Files:** `src/conductor/src/engine/artifacts.ts`,
`src/conductor/test/prd-audit-coverage.test.ts`

**Wired-into:** none (inert until `src/conductor/src/engine/artifacts.ts`)

**Dependencies:** none

### Task 4: Join resolution and coverage into one gate helper

**Story:** Story 1 — every FR must carry a verdict row, Done-When 1
**Type:** infrastructure

**Steps:**
1. Write a failing test for `prdAuditCoverageGap(projectRoot, ctx, reportContent)` returning
   `null` for full coverage, a gap naming the uncovered ids, and `null` when the resolved PRD
   enumerates no FR ids.
2. Verify the focused test fails (RED).
3. Implement it in `artifacts.ts` composing Tasks 2 and 3.
4. Verify the focused test passes (GREEN).
5. Commit with message: "feat: add the prd_audit coverage helper"

**Files:** `src/conductor/src/engine/artifacts.ts`,
`src/conductor/test/prd-audit-coverage.test.ts`

**Wired-into:** none (inert until `src/conductor/src/engine/artifacts.ts`)

**Dependencies:** Task 2, Task 3

### Task 5: Fail closed on an unresolvable or unreadable PRD

**Story:** Story 3 — feature-scoped denominator, negative paths 1-2
**Type:** negative-path

**Steps:**
1. Add failing table tests: no PRD resolvable → gap with an `unresolvable` reason; the resolved
   PRD read throws → gap, never an empty denominator; two resolving PRDs → the union of their ids
   is required.
2. Verify the focused cases fail (RED).
3. Extend `prdAuditCoverageGap` to distinguish "no PRD resolvable" and "read failed" from "resolved
   with zero ids", returning a gap for the first two and `null` for the third.
4. Verify every table row passes (GREEN).
5. Commit with message: "fix: fail closed when the audited PRD cannot be resolved"

**Files:** `src/conductor/src/engine/artifacts.ts`,
`src/conductor/test/prd-audit-coverage.test.ts`

**Wired-into:** none (inert until `src/conductor/src/engine/artifacts.ts`)

**Dependencies:** Task 4

### Task 6: Enforce coverage in the completion predicate

**Story:** Story 1 — every FR must carry a verdict row, happy path 1
**Type:** happy-path

**Steps:**
1. Write a failing test driving the `prd_audit` predicate with a fresh, fully covered, all-ALIGNED
   report and asserting `done: true` unchanged.
2. Verify the focused test fails or passes as appropriate, then add the blocking case (RED).
3. Call `prdAuditCoverageGap` in the predicate at `artifacts.ts:2303` after the blocking-row scan
   and before the pass path, returning `done: false` with a reason naming the uncovered ids.
4. Verify the focused tests pass (GREEN).
5. Commit with message: "fix: block prd_audit when an FR carries no verdict"

**Files:** `src/conductor/src/engine/artifacts.ts`,
`src/conductor/test/prd-audit-coverage.test.ts`

**Wired-into:** `src/conductor/src/engine/artifacts.ts#checkStepCompletion`

**Dependencies:** Task 5

### Task 7: Never stamp a pass from an incomplete run

**Story:** Story 1 — every FR must carry a verdict row, negative paths 2-4
**Type:** negative-path

**Steps:**
1. Add failing tests: a report missing FR-3 and FR-5 blocks naming both and writes no code stamp;
   an empty report blocks naming every id; a report that both omits a row and carries a blocking
   row surfaces both failures.
2. Verify the focused cases fail (RED).
3. Confirm the Task 6 ordering places the coverage return ahead of `writePrdAuditCodeStamp`, and
   compose the reason so a blocking row and an absent verdict are reported together.
4. Verify every case passes (GREEN).
5. Commit with message: "fix: never stamp a prd_audit pass on partial coverage"

**Files:** `src/conductor/src/engine/artifacts.ts`,
`src/conductor/test/prd-audit-coverage.test.ts`

**Wired-into:** `src/conductor/src/engine/artifacts.ts#checkStepCompletion`

**Dependencies:** Task 6

### Task 8: Apply coverage to the preserve and sweep-spare paths

**Story:** Story 2 — a pass from an incomplete run is never reused
**Type:** negative-path

**Steps:**
1. Add failing tests driving the `gate-code-validity` preserve path (`artifacts.ts:2257`) and the
   sweep-spare path (`:681`) with a `preserve`-valid sidecar plus a coverage-incomplete report,
   asserting neither yields a pass; plus a full-coverage case asserting preserve still works.
2. Verify the focused cases fail (RED).
3. Add the same `prdAuditCoverageGap` call to both paths.
4. Verify every case passes (GREEN).
5. Commit with message: "fix: re-check FR coverage before preserving a prd_audit pass"

**Files:** `src/conductor/src/engine/artifacts.ts`,
`src/conductor/test/prd-audit-coverage.test.ts`

**Wired-into:** `src/conductor/src/engine/artifacts.ts#checkStepCompletion`

**Dependencies:** Task 7

### Task 9: Document the coverage requirement

**Story:** Story 1 — every FR must carry a verdict row, Done-When 3
**Type:** documentation

**Steps:**
1. State in `skills/prd-audit/SKILL.md` §4 that the verdict table MUST carry exactly one row per
   enumerated `FR-N` and that a missing row blocks the gate identically to an un-ALIGNED row.
2. Update `docs/explanation/gates.md` and `docs/reference/steps.md` where the `prd_audit` gate
   predicate is described, to include the coverage requirement and the fail-closed
   unresolvable-PRD case.
3. Run `test/test_harness_integrity.sh` and fix any failures.
4. Commit with message: "docs: record the prd_audit FR-coverage requirement"

**Files:** `skills/prd-audit/SKILL.md`, `docs/explanation/gates.md`, `docs/reference/steps.md`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 8

## Task Dependency Graph

```
Task 1 ──▶ Task 2 ──┐
                    ├──▶ Task 4 ──▶ Task 5 ──▶ Task 6 ──▶ Task 7 ──▶ Task 8 ──▶ Task 9
Task 3 ─────────────┘
```

Tasks 1 and 3 are independent and may run concurrently. Everything from Task 4 onward is serial —
each wires the previous task's helper into one more call site.

## Out of Scope

Split to separate intakes by operator decision:

- Engine-owned per-FR fan-out (bounded dispatch, deterministic join, worker/aggregator tier split,
  per-dispatch spine events).
- The missing `prd_audit` execution timeout.
- The validation-group branch receiving exactly one attempt (`conductor.ts:4272`) versus three on
  the serial path.
