# Implementation Plan: Feature-aware step artifact resolution (#993)

**Date:** 2026-07-28
**Design:** `.docs/decisions/adr-2026-07-28-feature-aware-artifact-resolution.md`
**Stories:** `.docs/stories/step-completion-globs-are-feature-unscoped-so-anot.md`
**Conflict check:** Clean as of 2026-07-28

## Summary

Replace the hand-authored glob map with typed per-pattern contracts, add one deterministic
feature-aware resolver, and migrate completion, interactive review, and both dashboard renderers
to its diagnostic result. Twelve small TDD tasks preserve raw corpus discovery, custom predicates,
configured freshness, repository/run scope, and historical singleton compatibility.

## Technical Approach

- Define `STEP_ARTIFACT_CONTRACTS` as the authored registry. Each pattern carries `feature`,
  `repository`, or `run` scope; feature patterns also carry their normalization strategy.
  Derive the ordered `STEP_ARTIFACT_GLOBS` projection mechanically for compatibility.
- Add `ArtifactResolutionContext` and a once-per-operation context builder. It combines
  `featureDesc`, explicit/engine-recorded plan paths, and an engine-owned Git change set. The Git
  collector uses an injected `GitRunner`, local origin-default/merge-base discovery, committed and
  working-tree paths, and no fetch; indeterminate Git evidence degrades to an empty change set.
- Add `resolveArtifactFiles(dir, step, context, extraGlobs?)`. It expands raw patterns once, retains
  per-pattern results for dashboard display, and applies the approved ladder: explicit identity,
  changed-path attribution, contract normalization, singleton fallback, then fail-closed ambiguity.
- Keep `findArtifactFiles` policy-free. Keep custom completion predicates and configured exact-file
  freshness ahead of generic resolution. Append configured acceptance globs as repository-scoped
  patterns under their current stronger predicate.
- Thread one prepared context through each generic consumer. A renderer refresh builds it once and
  reuses it for every step so Git discovery is not repeated per pattern or step.

## Prerequisites

- The approved ADR and architecture review are authoritative.
- Use temporary directories and injected Git runners for unit tests; use a bounded local Git fixture
  only for the integration case where merge-base and working-tree semantics are the behavior.
- Run narrow Vitest files during RED/GREEN; type-check tests with `npm run typecheck:test`.

## Tasks

### Task 1: Declare explicit artifact contracts

**Story:** TS-993-1 — happy path 1; negative paths 1-2
**Type:** infrastructure

**Steps:**
1. Write failing registry tests that require every built-in step entry and every non-empty pattern to
   declare a lifecycle scope, with an identity strategy required for `feature` scope.
2. Run `npx vitest run test/engine/artifacts.test.ts --reporter=dot --silent` and verify RED.
3. Add the contract types and `STEP_ARTIFACT_CONTRACTS` in `artifacts.ts`, using `satisfies`/exhaustive
   records so omitted step entries and malformed feature contracts also fail type-checking.
4. Re-run the narrow test and `npm run typecheck:test`; verify GREEN.
5. Commit with message `feat: declare scoped artifact contracts` and trailer `Task: 1`.

**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/engine/artifacts.test.ts`

**Wired-into:** `src/conductor/src/engine/artifacts.ts#STEP_ARTIFACT_GLOBS`, `src/conductor/src/engine/artifacts.ts#resolveArtifactFiles`

**Dependencies:** none

### Task 2: Derive the legacy ordered glob projection

**Story:** TS-993-1 — happy paths 2-3; negative path 3
**Type:** refactor

**Steps:**
1. Write a failing compatibility test containing the complete pre-change ordered glob map and a
   mixed-pattern assertion proving scope remains per pattern.
2. Run the artifacts test and verify RED against the still hand-authored projection.
3. Derive `STEP_ARTIFACT_GLOBS` exclusively from `STEP_ARTIFACT_CONTRACTS`, preserving every existing
   pattern string and order; remove the duplicate authored map.
4. Re-run the artifacts test and test-inclusive type-check; verify GREEN.
5. Commit with message `refactor: derive step glob compatibility map` and trailer `Task: 2`.

**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/engine/artifacts.test.ts`

**Wired-into:** same as Task 1

**Dependencies:** Task 1

### Task 3: Normalize canonical and historical feature identities

**Story:** TS-993-2 — happy path 3; negative path 4
**Type:** happy-path

**Steps:**
1. Write table-driven failing unit tests for exact plan stems, slugified feature descriptions,
   contract-declared dated prefixes, contract-declared step prefixes, and a foreign normalized stem.
2. Run the artifacts test and verify RED.
3. Implement a pure normalization/matching helper driven by the feature contract's identity strategy;
   do not use mtime, directory order, or a global list of guessed prefixes.
4. Re-run the artifacts test and test-inclusive type-check; verify GREEN.
5. Commit with message `feat: normalize artifact feature identities` and trailer `Task: 3`.

**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/engine/artifacts.test.ts`

**Wired-into:** `src/conductor/src/engine/artifacts.ts#resolveArtifactFiles`

**Dependencies:** Task 2

### Task 4: Build feature resolution context once

**Story:** TS-993-2 — happy path 2; negative path 3
**Type:** infrastructure

**Steps:**
1. Write failing tests with an injected `GitRunner` for engine-recorded `activePlanPath`, explicit
   plan/feature precedence, committed paths since merge-base, modified/untracked paths, paths outside
   declared patterns, and indeterminate Git results.
2. Run the artifacts test and verify RED without invoking a real process or network service.
3. Implement `ArtifactResolutionContext` and its builder using local Git evidence only. Collect the
   change set once, normalize paths repository-relatively, and degrade Git failure to no change-set
   evidence while retaining explicit identity evidence.
4. Re-run the artifacts test and test-inclusive type-check; verify GREEN.
5. Commit with message `feat: assemble artifact resolution context` and trailer `Task: 4`.

**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/engine/artifacts.test.ts`

**Wired-into:** `src/conductor/src/engine/artifacts.ts#resolveArtifactFiles`, `src/conductor/src/ui/terminal-renderer.ts#TerminalRenderer.collectArtifacts`, `src/conductor/src/ui/create-renderer.ts#collectArtifacts`

**Dependencies:** Task 3

### Task 5: Resolve current-feature and intentionally broad artifacts

**Story:** TS-993-2 — happy paths 1-4
**Story:** TS-993-4 — happy path 1
**Type:** happy-path

**Steps:**
1. Write failing resolver tests for two coexisting features, changed/untracked attribution, canonical
   and historical names, singleton legacy fallback, repository scope, run scope, and raw matcher
   availability.
2. Run the artifacts test and verify RED.
3. Implement `resolveArtifactFiles` so feature entries select only associated candidates while
   repository/run entries retain all declared matches and raw `findArtifactFiles` remains unchanged.
4. Re-run the artifacts test and test-inclusive type-check; verify GREEN.
5. Commit with message `feat: resolve scoped artifact files` and trailer `Task: 5`.

**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/engine/artifacts.test.ts`

**Wired-into:** `src/conductor/src/engine/artifacts.ts#checkStepCompletion`, `src/conductor/src/engine/conductor.ts#Conductor.run`, `src/conductor/src/engine/artifacts.ts#getArtifactStatus`

**Dependencies:** Task 4

### Task 6: Fail closed on foreign and ambiguous feature corpora

**Story:** TS-993-2 — negative paths 1-4
**Type:** negative-path

**Steps:**
1. Write failing tests for A-only/B-active, multiple unmatched candidates, a changed file outside the
   declared pattern, and a normalized foreign filename; assert zero satisfying files and an actionable
   diagnostic code/reason.
2. Run the artifacts test and verify RED.
3. Complete the resolver's missing/foreign/ambiguous diagnostic result and ensure no branch sorts by
   filename, compares mtime, or accepts the first raw match.
4. Re-run the artifacts test and test-inclusive type-check; verify GREEN.
5. Commit with message `fix: reject foreign artifact candidates` and trailer `Task: 6`.

**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/engine/artifacts.test.ts`

**Wired-into:** same as Task 5

**Dependencies:** Task 5

### Task 7: Route generic completion through scoped resolution

**Story:** TS-993-3 — happy path 1
**Story:** TS-993-4 — happy paths 2-4
**Type:** happy-path

**Steps:**
1. Write failing completion tests proving A cannot complete B, B completes from its own resolved file,
   and resolver diagnostics become the completion failure reason.
2. Add regression assertions that custom predicates run first, configured completion artifacts retain
   exact-file freshness, and configured acceptance globs remain eligible.
3. Update the generic fallback in `checkStepCompletion` to consume `resolveArtifactFiles` with the
   existing completion context and extra acceptance contracts; leave earlier authority branches intact.
4. Run the artifacts test and test-inclusive type-check; verify GREEN.
5. Commit with message `fix: scope generic completion artifacts` and trailer `Task: 7`.

**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/engine/artifacts.test.ts`

**Wired-into:** `src/conductor/src/engine/artifacts.ts#checkStepCompletion`

**Dependencies:** Task 6

### Task 8: Scope interactive artifact review

**Story:** TS-993-3 — happy path 1; negative path 1
**Type:** happy-path

**Steps:**
1. Write a bounded failing conductor test whose target step has A and B artifacts, stops immediately
   after the review observation, and asserts the review callback receives only B.
2. Run `npx vitest run test/engine/conductor.test.ts --reporter=dot --silent` and verify RED.
3. Replace the success-path review's raw corpus lookup with `resolveArtifactFiles`, passing the same
   prepared feature context used by completion and preserving approval hashes/rejection behavior.
4. Re-run the conductor test and test-inclusive type-check; verify GREEN and awaited cleanup.
5. Commit with message `fix: scope interactive artifact review` and trailer `Task: 8`.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor.test.ts`

**Wired-into:** `src/conductor/src/engine/conductor.ts#Conductor.run`

**Dependencies:** Task 7

### Task 9: Make artifact status use resolver diagnostics

**Story:** TS-993-3 — happy path 1; negative path 2
**Type:** happy-path

**Steps:**
1. Write failing `getArtifactStatus` tests for B-only scoped files and an ambiguous feature corpus that
   remains unsatisfied while retaining the pattern and diagnostic.
2. Run the artifacts test and verify RED.
3. Extend status records with an optional diagnostic and derive their files/satisfied values from one
   resolver result rather than independent `matchGlob` calls.
4. Re-run the artifacts test and test-inclusive type-check; verify GREEN.
5. Commit with message `fix: scope dashboard artifact status` and trailer `Task: 9`.

**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/engine/artifacts.test.ts`

**Wired-into:** `src/conductor/src/ui/terminal-renderer.ts#TerminalRenderer.collectArtifacts`, `src/conductor/src/ui/create-renderer.ts#collectArtifacts`

**Dependencies:** Task 6

### Task 10: Thread feature context through the terminal dashboard

**Story:** TS-993-3 — happy path 2; negative path 2
**Type:** happy-path

**Steps:**
1. Write failing terminal-renderer tests with A/B plan artifacts and `featureDesc` B; assert only B is
   displayed and ambiguity cannot render a satisfied marker.
2. Run `npx vitest run test/ui/terminal-renderer.test.ts --reporter=dot --silent` and verify RED.
3. Build one artifact resolution context per `collectArtifacts` refresh and pass it to every
   `getArtifactStatus` call, reusing the renderer's existing feature description.
4. Re-run the terminal-renderer test and test-inclusive type-check; verify GREEN.
5. Commit with message `fix: scope terminal dashboard artifacts` and trailer `Task: 10`.

**Files:** `src/conductor/src/ui/terminal-renderer.ts`, `src/conductor/test/ui/terminal-renderer.test.ts`

**Wired-into:** `src/conductor/src/ui/terminal-renderer.ts#TerminalRenderer.collectArtifacts`

**Dependencies:** Task 4, Task 9

### Task 11: Thread feature context through the create dashboard

**Story:** TS-993-3 — happy path 2; negative path 2
**Type:** happy-path

**Steps:**
1. Write failing create-renderer tests mirroring the terminal A/B and ambiguity cases.
2. Run `npx vitest run test/ui/create-renderer.test.ts --reporter=dot --silent` and verify RED.
3. Build one artifact resolution context per `collectArtifacts` refresh and reuse it across the create
   renderer's status calls without changing snapshot or live-region behavior.
4. Re-run the create-renderer test and test-inclusive type-check; verify GREEN.
5. Commit with message `fix: scope create dashboard artifacts` and trailer `Task: 11`.

**Files:** `src/conductor/src/ui/create-renderer.ts`, `src/conductor/test/ui/create-renderer.test.ts`

**Wired-into:** `src/conductor/src/ui/create-renderer.ts#collectArtifacts`

**Dependencies:** Task 4, Task 9

### Task 12: Lock consumer reachability and preservation boundaries

**Story:** TS-993-3 — happy path 3; negative path 3
**Story:** TS-993-4 — all happy and negative paths
**Type:** negative-path

**Steps:**
1. Write a failing structural test that inventories `CUSTOM_COMPLETION_PREDICATES`, asserts the three
   generic production consumers call `resolveArtifactFiles`, and asserts raw discovery remains exported
   for explicit corpus callers.
2. Add corpus regressions for repository scope, stale/malformed run verdicts, configured artifact
   freshness, acceptance RED/configured globs, and absence of a universal plan-stem requirement.
3. Fix any remaining registry classification or call-site bypass exposed by the inventory; do not
   weaken the existing predicate bodies.
4. Run the new structural test, artifacts/conductor/renderer neighbors, `npm run typecheck:test`, and
   `npm run lint`; verify GREEN together rather than only in isolation.
5. Commit with message `test: enforce artifact resolver reachability` and trailer `Task: 12`.

**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/src/ui/terminal-renderer.ts`, `src/conductor/src/ui/create-renderer.ts`, `src/conductor/test/engine/artifact-resolution-wiring.test.ts`, `src/conductor/test/engine/artifacts.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 7, Task 8, Task 10, Task 11

## Task Dependency Graph

```text
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 ─┐
                    └→ 9 → 10 ───┼→ 12
                         └→ 11 ───┘
```

## Integration Points

- After Task 6: the shared resolver can be exercised independently against all three scopes and the
  complete identity ladder.
- After Task 8: completion and interactive review agree on one current-feature file set.
- After Task 11: both renderer implementations agree with engine completion and review.
- After Task 12: production reachability and every preservation boundary are mechanically guarded.

## Coverage Check

| Story | Tasks | Acceptance criteria | Verdict |
|---|---|---|---|
| TS-993-1 | 1 | H1, N1, N2 | covered |
| TS-993-1 | 2 | H2, H3, N3 | covered |
| TS-993-2 | 3, 6 | H3, N4 | covered |
| TS-993-2 | 4, 5, 6 | H2, N3 | covered |
| TS-993-2 | 5 | H1, H4 | covered |
| TS-993-2 | 6 | N1, N2 | covered |
| TS-993-3 | 7, 8, 9 | H1 | covered |
| TS-993-3 | 10, 11 | H2, N2 | covered |
| TS-993-3 | 12 | H3, N3 | covered |
| TS-993-3 | 8 | N1 | covered |
| TS-993-4 | 5, 12 | H1, N2 | covered |
| TS-993-4 | 7, 12 | H2-H4, N1, N3, N4 | covered |

## Verification

- [ ] Each narrow RED/GREEN command passes after its task.
- [ ] `cd src/conductor && npm run typecheck` passes.
- [ ] `cd src/conductor && npm run typecheck:test` passes.
- [ ] `cd src/conductor && npm run lint` passes.
- [ ] `cd src/conductor && npm test` completes with `AGGREGATE_TEST_SUITE_PASS`.
- [ ] `bash test/test_harness_integrity.sh` passes before every repository commit.
- [ ] All twelve tasks remain independently attributable and the dependency graph is acyclic.
