# Implementation Plan: Contract-aware same-file wiring

**Date:** 2026-07-30
**Design:** `.docs/decisions/adr-2026-07-30-contract-aware-same-file-wiring.md`
**Stories:** `.docs/stories/wiring-gate-flags-production-reachable-seams-compo.md`
**Conflict check:** Clean as of 2026-07-30

## Summary

Add a narrow same-file composition proof to the existing wiring probe. Seventeen small tasks preserve module reachability chains, share one TypeScript program/checker, prove exact caller-to-export identity, join the three required facts into typed evidence, retain existing fail-closed behavior, and align the SHIP-time as-built review.

## Technical Approach

- Extend each task's wiring evidence with an optional closed `proofs` collection. A `same-file-composition` proof names the export, declared caller, defining file, and non-empty production-root chain; existing evidence without proofs stays valid.
- Refactor the existing lazy TypeScript analysis into one internal per-run context containing the program, checker, module graph, and roots. `computeWiringEvidence` creates it only when Layer 2 is applicable and shares it across all exports.
- Preserve Layer 1's current cross-file success and test-only failure paths. Same-file-only results become candidates, not passes; a pure evaluator removes the orphan gap only when task ownership, same-file caller contract, exact symbol identity, and root reachability all agree.
- Keep Layer 2 unavailable states fail-closed for the exception. No non-TypeScript heuristic, name-only match, waiver, or new `Wired-into:` grammar is introduced.
- Update the provider-neutral as-built skill contract so SHIP independently traces the same root-to-caller-to-export path. Persisted BUILD proof is corroborating context, never authority over current shipped source.

## Prerequisites

- `adr-2026-07-30-contract-aware-same-file-wiring` is APPROVED.
- Stories carry `Status: Accepted`; conflict-check has zero blocking conflicts.
- Tests follow `.agents/skills/write-tests/SKILL.md`: narrowest seam, injected boundaries, isolated temporary roots, awaited cleanup, and no real LLM, GitHub, registry, or network calls.

## Tasks

### Task 1: Define typed same-file composition proof

**Story:** Story 1 — Qualifying same-file composition, happy path 2
**Type:** infrastructure

**Steps:**
1. Write a failing validator test for a task carrying a complete `same-file-composition` proof.
2. Verify the focused evidence test fails (RED).
3. Add the closed proof type and optional per-task `proofs` collection to `WiringEvidence`; validate the complete shape.
4. Verify the focused evidence test passes (GREEN).
5. Commit with message: "feat: type same-file wiring proof"

**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/wiring-evidence.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** none

### Task 2: Reject malformed same-file proof evidence

**Story:** Story 1 — Qualifying same-file composition, negative path 2
**Type:** negative-path

**Steps:**
1. Add failing table tests for an unknown proof kind, missing export/caller/file, empty root chain, and non-string chain entry.
2. Verify the focused evidence cases fail (RED).
3. Make `validateWiringEvidence` reject each malformed field with the task id and field named.
4. Verify every table row passes (GREEN).
5. Commit with message: "fix: validate same-file wiring proofs fail closed"

**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/wiring-evidence.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 1

### Task 3: Preserve Layer 2 root chains per export

**Story:** Story 1 — Qualifying same-file composition, happy path 2
**Story:** Story 2 — False-positive relief, happy path 2
**Type:** happy-path

**Steps:**
1. Add a failing Layer 2 test asserting `checkExportReachability` returns the shortest repo-relative root chain for a reachable export.
2. Verify the focused Layer 2 test fails (RED).
3. Carry `reachableFromRoots` chain evidence through `ExportReachabilityResult` without changing unreachable messages.
4. Verify reachable, orphan-island, test-edge, and dynamic-import tests pass (GREEN).
5. Commit with message: "feat: retain wiring root chains"

**Files:** `src/conductor/src/engine/wiring-probe.ts`, `src/conductor/test/wiring-layer2.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** none

### Task 4: Classify same-file-only exports without passing them

**Story:** Story 1 — Qualifying same-file composition, happy path 1; negative path 1
**Type:** refactor

**Steps:**
1. Add a failing `orphanBackstop` test that distinguishes same-file-only from absent and test-only references while keeping all three as gaps.
2. Verify the focused probe test fails (RED).
3. Add a closed reference classification/evidence field to the existing result; do not remove any gap in this task.
4. Verify legacy messages and the new classification pass (GREEN).
5. Commit with message: "refactor: classify same-file wiring candidates"

**Files:** `src/conductor/src/engine/wiring-probe.ts`, `src/conductor/test/wiring-probe.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** none

### Task 5: Share one TypeScript analysis context per probe

**Story:** Story 3 — Existing behavior remains stable, happy path 2 and negative path 2
**Type:** refactor

**Steps:**
1. Add a failing Layer 2 test with an injected compiler-program factory and multiple exports, asserting one construction.
2. Verify the count assertion fails (RED).
3. Extract an internal lazy analysis context holding program, checker, graph, and roots; pass it through reachability functions instead of constructing per use.
4. Verify the construction count is one and existing graph tests pass (GREEN).
5. Commit with message: "refactor: share wiring TypeScript analysis"

**Files:** `src/conductor/src/engine/wiring-probe.ts`, `src/conductor/test/wiring-layer2.test.ts`

**Wired-into:** `src/conductor/src/engine/wiring-probe.ts#computeWiringEvidence`

**Dependencies:** Task 3

### Task 6: Resolve an exact caller-to-export symbol reference

**Story:** Story 2 — False-positive relief, happy path 1
**Type:** happy-path

**Steps:**
1. Add a failing fixture where a declared top-level caller references the exact new export declaration in the same source file.
2. Verify the focused symbol-analysis test fails (RED).
3. Implement a pure exported symbol-reference query over the shared program/checker, returning caller and export identity evidence.
4. Verify the exact reference produces evidence (GREEN).
5. Commit with message: "feat: resolve same-file export references"

**Files:** `src/conductor/src/engine/wiring-probe.ts`, `src/conductor/test/wiring-layer2.test.ts`

**Wired-into:** `src/conductor/src/engine/wiring-probe.ts#computeWiringEvidence`

**Dependencies:** Task 5

### Task 7: Exclude lexical lookalikes from symbol proof

**Story:** Story 2 — False-positive relief, happy path 1 and negative path 1
**Type:** negative-path

**Steps:**
1. Add failing table fixtures where the export name occurs only in a comment, string, declaration, or import.
2. Verify at least one lookalike incorrectly produces evidence (RED).
3. Restrict the query to resolved identifier references inside the declared caller implementation.
4. Verify every lookalike returns no proof while Task 6 stays green (GREEN).
5. Commit with message: "fix: ignore lexical wiring lookalikes"

**Files:** `src/conductor/src/engine/wiring-probe.ts`, `src/conductor/test/wiring-layer2.test.ts`

**Wired-into:** same as Task 6

**Dependencies:** Task 6

### Task 8: Reject shadowed same-name bindings

**Story:** Story 2 — False-positive relief, negative path 1
**Type:** negative-path

**Steps:**
1. Add a failing fixture where the declared caller references a local binding that shadows the new export.
2. Verify the name-only implementation would pass (RED).
3. Compare TypeScript symbol/declaration identity so only the feature export qualifies.
4. Verify shadowing returns no proof and exact identity still passes (GREEN).
5. Commit with message: "fix: reject shadowed wiring symbols"

**Files:** `src/conductor/src/engine/wiring-probe.ts`, `src/conductor/test/wiring-layer2.test.ts`

**Wired-into:** same as Task 6

**Dependencies:** Task 7

### Task 9: Join the three proofs for a qualifying export

**Story:** Story 1 — Qualifying same-file composition, happy paths 1 and 2
**Type:** happy-path

**Steps:**
1. Add a failing pure-evaluator test with matching task ownership, same-file caller contract, exact symbol evidence, and non-empty root chain.
2. Verify the evaluator test fails (RED).
3. Implement the smallest same-file composition evaluator returning typed proof or a named missing-proof result.
4. Verify the qualifying input returns proof and no gap removal occurs outside the evaluator's explicit result (GREEN).
5. Commit with message: "feat: evaluate same-file wiring composition"

**Files:** `src/conductor/src/engine/wiring-probe.ts`, `src/conductor/test/wiring-probe.test.ts`

**Wired-into:** `src/conductor/src/engine/wiring-probe.ts#computeWiringEvidence`

**Dependencies:** Tasks 1, 4, 8

### Task 10: Deny missing and mismatched caller contracts

**Story:** Story 1 — Qualifying same-file composition, negative paths 1 and 3
**Type:** negative-path

**Steps:**
1. Add failing evaluator rows for no contract, other-file site, unresolved caller, wrong task owner, and caller referencing a different export.
2. Verify the focused rows fail (RED).
3. Return a named missing/mismatched proof result for each row without manufacturing a proof.
4. Verify every row retains the original orphan gap reason plus the actionable missing proof (GREEN).
5. Commit with message: "fix: require matching same-file caller contract"

**Files:** `src/conductor/src/engine/wiring-probe.ts`, `src/conductor/test/wiring-probe.test.ts`

**Wired-into:** same as Task 9

**Dependencies:** Task 9

### Task 11: Deny every unavailable Layer 2 state

**Story:** Story 3 — Existing behavior remains stable, happy path 3 and negative path 3
**Type:** negative-path

**Steps:**
1. Add failing evaluator/integration rows for `not-applicable`, `skipped`, and `bad-root` same-file candidates.
2. Verify at least one state incorrectly authorizes or obscures the gap (RED).
3. Make the exception require `applicable:true` with a non-empty chain; preserve the existing bad-root scope gap.
4. Verify all three states deny the exception with their existing degradation/gap semantics (GREEN).
5. Commit with message: "fix: keep same-file exception Layer 2 gated"

**Files:** `src/conductor/src/engine/wiring-probe.ts`, `src/conductor/test/wiring-layer2.test.ts`, `src/conductor/test/wiring-probe.test.ts`

**Wired-into:** same as Task 9

**Dependencies:** Task 10

### Task 12: Keep reachable dead helpers and test-only paths blocked

**Story:** Story 2 — False-positive relief, happy paths 3 and 4; negative paths 2–4
**Type:** negative-path

**Steps:**
1. Add failing integration fixtures for a reachable module with a dead helper, a module reached only through tests, tests as sole consumers, and a qualifying production caller plus incidental test import.
2. Verify the current join cannot distinguish all four outcomes (RED).
3. Apply test-path exclusion and exact caller proof before replacing only the qualifying same-file gap.
4. Verify the first three remain named gaps and the incidental test import neither creates nor invalidates a valid proof (GREEN).
5. Commit with message: "fix: preserve dead and test-only wiring gaps"

**Files:** `src/conductor/src/engine/wiring-probe.ts`, `src/conductor/test/wiring-probe.test.ts`, `src/conductor/test/wiring-layer2.test.ts`

**Wired-into:** same as Task 9

**Dependencies:** Task 11

### Task 13: Integrate typed proof into computed evidence

**Story:** Story 1 — Qualifying same-file composition, all happy paths
**Story:** Story 3 — Existing behavior, happy path 4
**Type:** happy-path

**Steps:**
1. Add a failing `computeWiringEvidence` fixture matching #880: helper and declared caller share a reachable module.
2. Verify computation returns the current orphan gap (RED).
3. Create one analysis context in the applicable Layer 2 branch, join per-export facts, replace only the qualifying gap, and append typed proof to the owning task.
4. Verify the #880 fixture has zero gaps and the complete proof validates (GREEN).
5. Commit with message: "feat: accept proven same-file wiring"

**Files:** `src/conductor/src/engine/wiring-probe.ts`, `src/conductor/test/wiring-probe.test.ts`

**Wired-into:** `src/conductor/src/engine/artifacts.ts#deriveAndPersistWiringEvidence`

**Dependencies:** Tasks 2, 12

### Task 14: Verify unchanged cross-file and legacy evidence paths

**Story:** Story 3 — Existing behavior remains stable, happy paths 1 and 4; negative paths 1 and 4
**Type:** refactor

**Steps:**
1. Run the focused cross-file, test-only, waiver, contradiction, legacy evidence, and kickback tests at the new implementation state.
2. Confirm they pass without implementation edits; if any fail, stop and route the regression to its owning prior task.
3. Record an empty verification commit with adjacent `Task:` and `Evidence: skipped` trailers.

**Files:** `src/conductor/test/wiring-probe.test.ts`, `src/conductor/test/wiring-evidence.test.ts`, `src/conductor/test/wiring-gate-loop.test.ts`, `src/conductor/test/wiring-waiver.test.ts`

**Wired-into:** none (no new production surface)

**Verify-only:** yes

**Dependencies:** Task 13

### Task 15: Align the as-built reachability contract

**Story:** Story 4 — BUILD and SHIP agree, all happy and negative paths
**Type:** happy-path

**Steps:**
1. Add a failing contract test asserting the as-built skill requires an independently verified root-to-caller-to-export chain and still rejects own-module-only or stale-proof cases.
2. Verify the contract test fails against the unconditional own-module exclusion (RED).
3. Amend the provider-neutral `architecture-review --as-built` instructions with the narrow exception and current-source authority rule.
4. Verify the contract test and provider skill contract audit pass (GREEN).
5. Commit with message: "fix: align as-built same-file reachability"

**Files:** `skills/architecture-review/SKILL.md`, `test/test_provider_skill_contracts.sh`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 13

### Task 16: Prove the #880 flow through the completion boundary

**Story:** Story 1 — Qualifying same-file composition, happy paths 1 and 2
**Story:** Story 4 — BUILD and SHIP agree, happy path 2
**Type:** happy-path

**Steps:**
1. Add a failing acceptance fixture with a real temporary TS project, accepted plan contract, configured root, same-file helper/caller, and injected Git/GitHub boundaries.
2. Verify the completion predicate reports the current orphan gap (RED).
3. Drive the real compute-persist-validate path and make only fixture/wiring adjustments needed to expose Task 13's implementation.
4. Verify `wiring_check` is satisfied and persisted proof names the full chain (GREEN).
5. Commit with message: "test: accept production-reachable same-file wiring"

**Files:** `src/conductor/test/acceptance/wiring-evidence-end-to-end.acceptance.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Tasks 14, 15

### Task 17: Prove false-pass cases through the completion boundary

**Story:** Story 2 — False-positive relief, all negative paths
**Story:** Story 3 — Existing behavior, happy path 3 and negative path 3
**Story:** Story 4 — BUILD and SHIP agree, negative paths 1 and 2
**Type:** negative-path

**Steps:**
1. Add failing acceptance rows for reachable dead helper, shadowed caller reference, test-only root chain, missing entry points, and stale/malformed claimed proof.
2. Verify at least one row falsely satisfies or lacks an actionable reason (RED).
3. Correct only boundary composition/diagnostics needed to preserve the pure decisions from Tasks 2 and 10–12.
4. Verify every row is unsatisfied with the expected named gap or evidence-validation reason (GREEN).
5. Commit with message: "test: reject unproven same-file wiring"

**Files:** `src/conductor/test/acceptance/wiring-evidence-end-to-end.acceptance.test.ts`, `src/conductor/test/wiring-evidence.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 16

## Task Dependency Graph

```text
Task 1 ──▶ Task 2 ───────────────────────────────┐
                                                │
Task 3 ──▶ Task 5 ──▶ Task 6 ──▶ Task 7 ──▶ Task 8
                                                │
Task 4 ─────────────────────────────────────────┤
                                                ▼
                                             Task 9 ──▶ Task 10 ──▶ Task 11 ──▶ Task 12
                                                                                  │
Task 2 ───────────────────────────────────────────────────────────────────────────┤
                                                                                  ▼
                                                                               Task 13
                                                                                  │
                                                   ┌──────────────────────────────┴──────────────┐
                                                   ▼                                             ▼
                                                Task 14                                      Task 15
                                                   └──────────────────────────────┬──────────────┘
                                                                                  ▼
                                                                               Task 16 ──▶ Task 17
```

## Integration Points

- After Task 9: the pure three-proof evaluator is complete and independently testable.
- After Task 13: real `computeWiringEvidence` emits validated proof for the #880 shape.
- After Task 15: BUILD and SHIP share one semantic contract with independent evidence authority.
- After Task 17: the full completion boundary proves both the qualifying path and all false-pass protections.

## Acceptance Coverage Mapping

- **Qualifying same-file composition:** happy 1 → Tasks 9, 13, 16; happy 2 → Tasks 1, 3, 9, 13, 16; happy 3 → Tasks 10, 14. Negative 1 → Tasks 10–12, 17; negative 2 → Tasks 2, 17; negative 3 → Task 10.
- **False-positive relief:** happy 1 → Tasks 6–8; happy 2 → Tasks 3, 5; happy 3 → Tasks 10, 12; happy 4 → Task 12. Negative 1 → Tasks 7–8, 17; negative 2 → Tasks 3, 11–12, 17; negative 3 → Tasks 10, 12, 17; negative 4 → Tasks 4, 12, 14, 17.
- **Existing behavior stable:** happy 1 → Task 14; happy 2 → Task 5; happy 3 → Tasks 11, 17; happy 4 → Tasks 1–2, 14. Negative 1 → Tasks 4, 12, 14; negative 2 → Task 5; negative 3 → Tasks 11, 17; negative 4 → Tasks 1–2, 14.
- **BUILD and SHIP agree:** happy 1–2 → Task 15; negative 1–2 → Tasks 15, 17.

## Verification

- [x] All happy-path criteria map to at least one task.
- [x] Every negative criterion has an explicit negative-path or contract task.
- [x] Tasks are scoped to one 2–5 minute RED/GREEN change or one verify-only proof.
- [x] Dependencies are explicit and acyclic.
- [x] Every task carries a machine-readable `Wired-into:` line.
- [x] Default tests fake GitHub and every third-party boundary; no cyclic conductor or aggregate-suite invocation is introduced.
