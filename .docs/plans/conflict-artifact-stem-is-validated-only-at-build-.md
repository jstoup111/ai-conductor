# Implementation Plan: Land-time feature-scoped artifact stem validation

**Date:** 2026-08-25
**Stories:** .docs/stories/conflict-artifact-stem-is-validated-only-at-build-.md
**Conflict check:** Skipped (Tier S)

## Summary

Validate every feature-scoped `.docs/` artifact stem at `engineer land` time through the same
`STEP_ARTIFACT_CONTRACTS` identity matching the daemon's forward-walk uses, and enrich the
resolver's `ambiguous` diagnostic to name the naming rule and expected filename. 5 tasks.

## Technical Approach

Single source of truth: `src/conductor/src/engine/artifacts.ts` already owns
`artifactMatchesFeatureIdentity` (module-private) and the per-step contracts
(`STEP_ARTIFACT_CONTRACTS`). We export a small validation helper from that module —
`validateFeatureArtifactStems(entries, featureIdentity)` — that, given candidate artifact paths
grouped by step and the feature identity (slug), returns the list of violations, each carrying
`{ step, path, strategy, expectedStem, exampleExpectedPath }`. `landSpec`
(`src/conductor/src/engine/engineer/land-spec.ts`) locates a single artifact per family via
`pickIdeaFile` (land-spec.ts:205-312) for the gates that need one file to read, but land STAGES
every `.docs/` file the idea authored. Stem validation therefore runs over the full candidate set,
not the picks: `pickIdeaFile`'s enumeration half is split out as `listIdeaFiles(dir, ideaFiles)` —
every idea-attributable `.md` in the directory, sorted — and `landSpec` feeds each feature-scoped
family's whole list (specs → `prd`, stories → `stories`, conflicts → `conflict_check`, plans →
`plan`, coherence → `coherence_check`) through the helper, then throws a single aggregated error
enumerating every violation with its expected stem. Validating only the pick would let a stale
mismatched sibling land beside a conforming newest file and reintroduce the very forward-walk
ambiguity this feature exists to prevent. The resolver's `diagnosticFor` (artifacts.ts:474-484) is
extended so the `ambiguous` case for feature-scoped contracts appends the identity strategy, the
expected stem, and an example expected filename derived from the contract's pattern directory;
`missing` and repository-scoped diagnostics are untouched.

Local pattern: land-spec failures throw `Error` with a `landSpec:`-prefixed multi-line message
(see the existing tier-mismatch throw at land-spec.ts:319); the new aggregated stem error follows
that same shape. Tests live beside existing suites — search for `land-spec` and `artifacts`
`*.test.ts` under `src/conductor` and follow their fixture-worktree helpers.

## Prerequisites

None — all changes live in `src/conductor`.

## Tasks

### Task 1: Export `validateFeatureArtifactStems` from artifacts.ts
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing test: given the #1743 fixture — feature identity `clean-rubric-judgements-rejected-as-invalid-provid`, candidate `.docs/conflicts/2026-08-19-clean-rubric-judgements.md` under step `conflict_check` — the helper returns one violation with `expectedStem` equal to the full slug and `exampleExpectedPath` `.docs/conflicts/clean-rubric-judgements-rejected-as-invalid-provid.md`; given the correctly named path (with or without a date prefix) it returns zero violations.
2. Verify test fails (RED).
3. Implement: add `validateFeatureArtifactStems(entries: {step, paths}[], featureIdentity)` in `artifacts.ts`, reusing `artifactMatchesFeatureIdentity` and each step's contract from `STEP_ARTIFACT_CONTRACTS` (feature-scoped patterns only; repository/run-scoped contracts are ignored). Violation objects carry `step`, `path`, `strategy` name, `expectedStem`, `exampleExpectedPath`.
4. Verify test passes (GREEN).
5. Commit: "feat(artifacts): export feature-scoped stem validation helper".

**Done when:**
- The helper is exported from `artifacts.ts` and delegates identity matching to `artifactMatchesFeatureIdentity` (no duplicated normalization logic in the helper body).
- Unit tests pass for: exact-slug match, date-prefixed match, truncated mismatch (the #1743 fixture verbatim), and plan-stem (`plan`/`coherence_check`) mismatch.
- A repository-scoped path passed under a feature-scoped step set produces no violation and no throw.

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts — new exported helper
- src/conductor/src/engine/artifacts.test.ts — helper unit tests

**Dependencies:** none

### Task 2: landSpec rejects mismatched stems (aggregated, expected stem named)
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: a fixture worktree whose `.docs/conflicts/` file stem is a truncation of the slug fails `landSpec` with a `landSpec:`-prefixed error whose message contains the offending path, the strategy name, and the expected stem; a fully slug-named fixture worktree (date prefixes included) lands as before.
2. Verify test fails (RED).
3. Implement: in `land-spec.ts`, split `listIdeaFiles(dir, ideaFiles)` out of `pickIdeaFile` (it returns every idea-attributable `.md` in the directory, sorted; `pickIdeaFile` keeps its newest-mtime reduction on top of it), build the `{step, paths}` entries from each feature-scoped family's FULL candidate list — specs/stories/plans/conflicts/coherence, independent of which file the picks selected — and call `validateFeatureArtifactStems` with the feature slug; on any violation throw one aggregated `landSpec:` error listing every violation as `<path>: expected stem "<expectedStem>" (<strategy>)`. Follow the existing tier-mismatch throw pattern at land-spec.ts:319. Worktree keep-on-failure behavior is untouched (the throw propagates like existing gate failures).
4. Verify test passes (GREEN).
5. Commit: "fix(engineer): validate feature-scoped artifact stems at land (#1743)".

**Done when:**
- The #1743 truncated-conflicts fixture fails `landSpec` and the error text contains the expected stem verbatim.
- Slug-named fixtures with and without date prefixes on normalized-stem artifacts land successfully (existing land tests stay green).
- A family holding a stale mismatched file ALONGSIDE a conforming newest file fails the land, naming the stale path — validation is over every candidate, not the pick.
- The validation runs through Task 1's helper — `land-spec.ts` contains no stem-normalization logic of its own.

**Files likely touched:**
- src/conductor/src/engine/engineer/land-spec.ts — stem validation call + aggregated throw
- src/conductor/src/engine/engineer/land-spec.test.ts — fixture tests

**Dependencies:** Task 1

### Task 3: Negative paths — plan-stem mismatch and multi-artifact enumeration at land
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) a fixture worktree whose plans-directory artifact stem differs from the slug fails `landSpec` naming the expected plan stem under the `plan-stem` strategy; (b) a fixture with BOTH a mismatched conflicts stem and a mismatched stories stem fails with one error message enumerating both paths, each with its own expected stem; (c) a fixture whose conflicts family holds a stale mismatched file under a newer conforming one fails naming the stale path, and a fixture with stale mismatched siblings in two families enumerates both.
2. Verify tests fail (RED) — (b) must fail specifically because only the first violation is reported if the implementation short-circuits.
3. Implement: adjust the Task 2 aggregation if needed so all violations across all steps are collected before the single throw.
4. Verify tests pass (GREEN).
5. Commit: "test(engineer): plan-stem mismatch and multi-violation enumeration at land".

**Done when:**
- The plan-stem mismatch fixture fails with the `plan` step's expected stem in the message.
- The two-violation fixture's error message contains both offending paths and both expected stems.
- Stale mismatched siblings fail the land even when the family's newest file conforms.
- No fixture passes on the loose `pickIdeaFile` association alone.

**Files likely touched:**
- src/conductor/src/engine/engineer/land-spec.test.ts — negative-path fixtures
- src/conductor/src/engine/engineer/land-spec.ts — aggregation fix only if (b) fails

**Dependencies:** Task 2

### Task 4: Resolver `ambiguous` diagnostic names rule, expected stem, and example filename
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test: resolving `conflict_check` for the #1743 fixture (mismatched candidate present) yields a diagnostic whose `reason` contains the identity strategy (`normalized-stem`, date prefix stripped), the expected stem, and the example expected filename `.docs/conflicts/clean-rubric-judgements-rejected-as-invalid-provid.md`, in addition to the existing candidate-count sentence.
2. Verify test fails (RED).
3. Implement: extend `diagnosticFor` (artifacts.ts:474-484) — for the `ambiguous` code on feature-scoped contracts, append the naming-rule sentence built from the contract's identity strategy and pattern directory plus the feature identity. Repository-scoped and `missing` diagnostics keep their current strings.
4. Verify test passes (GREEN).
5. Commit: "feat(artifacts): ambiguous diagnostic names naming rule and expected filename (#1743)".

**Done when:**
- The #1743 replay test asserts the expected filename appears in the diagnostic `reason`.
- A forward-walk HALT evidence string built from the new diagnostic contains the full text untruncated (unit test on the emitted evidence string).

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts — `diagnosticFor` enrichment
- src/conductor/src/engine/artifacts.test.ts — diagnostic assertions

**Dependencies:** Task 1

### Task 5: Negative paths — empty-candidate and repository-scoped diagnostics unchanged
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing-or-green regression tests pinning exact current strings: (a) an empty candidate set produces the existing `missing` diagnostic (`"<step> has no artifact candidates for <identity>"`) with no stem-mismatch text; (b) a repository-scoped contract failure produces its current diagnostic byte-identical, with no naming-rule sentence.
2. Verify the assertions express the exact current strings (run once against pre-Task-4 behavior via the fixtures).
3. Implement: none expected; fix Task 4's guard if either regression fails.
4. Verify tests pass (GREEN).
5. Commit: "test(artifacts): pin missing and repository-scoped diagnostics (#1743)".

**Done when:**
- The `missing`-code diagnostic string is asserted byte-identical to its pre-change form.
- The repository-scoped failure diagnostic is asserted byte-identical to its pre-change form.
- Both tests pass with Task 4's enrichment in place.

**Files likely touched:**
- src/conductor/src/engine/artifacts.test.ts — regression pins

**Dependencies:** Task 4

## Task Dependency Graph

```
Task 1 ─┬─▶ Task 2 ─▶ Task 3
        └─▶ Task 4 ─▶ Task 5
```

## Integration Points

- After Task 2: an `engineer land` over a mismatched fixture fails end-to-end with the expected stem named.
- After Task 4: replaying the #1743 merged-mismatch fixture through the resolver yields the mechanical-fix diagnostic.

## Verification

- [ ] All happy path criteria covered by at least one task (Story 1 → Tasks 1-2; Story 2 → Task 4)
- [ ] All negative path criteria covered by explicit tasks (Story 1 → Tasks 2-3; Story 2 → Task 5)
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a falsifiable `Done when:` block
- [ ] Dependencies are explicit and acyclic
