# Implementation Plan: DECIDE Artifact Coherence Check

**Date:** 2026-07-22
**Design:** `.docs/specs/2026-07-22-decide-artifact-coherence-check.md` (FR-1..14)
**Stories:** `.docs/stories/decide-artifact-coherence-check.md` (14 stories, Accepted)
**Conflict check:** Clean as of 2026-07-22 (`.docs/conflicts/decide-artifact-coherence-check.md`)
**ADRs:** `adr-2026-07-22-coherence-gate-placement-and-validation-split`, `adr-2026-07-22-coherence-waiver-and-duplicate-claim` (APPROVED)

## Summary

Builds the DECIDE coherence gate: outcome staging at claim, a `/coherence-check` skill
authoring a committed mapping artifact, and a deterministic validator (+ waiver +
duplicate-claim) rung in `landSpec`. 20 tasks.

## Technical Approach

- **New modules, single-line hot-file insertions.** All validator logic lives in new
  files under `src/conductor/src/engine/engineer/` (`outcome-staging.ts`,
  `coherence-validator.ts`, `coherence-waiver.ts`); `land-spec.ts` (29 unmerged
  branches touch it) gains only one call-site block. Parsers are reused, not
  duplicated: `splitStoryBlocks`/`collectPlanCoverage`/FR regexes from
  `artifacts.ts`, task grammar from `plan-task-parse.ts`, waiver idiom mirrored from
  `self-host/release-gate.ts` (`parseWaiver`/`findWaiverInDiff` shapes).
- **Data flow.** claim/worktree → `.pipeline/intake-outcomes.md` (gitignored staging:
  `Source-Ref:` line + verbatim `## Desired outcome` bullets) → DECIDE skills → new
  `/coherence-check` step authors `.docs/coherence/<plan-stem>.md` (row classes:
  `outcome`, `fr`, `story`, `task`; columns: id · cited counterpart ids · verdict ·
  quote) → `landSpec` validates (tier ≠ S): parse fail-closed → id cross-check →
  set-difference per layer → one aggregated deterministic gap report → waiver eval →
  duplicate scan → commit staged outcomes inside plan-stem-keyed
  `.docs/intake/<plan-stem>.md`.
- **Layer requirements are marker-derived:** product track marker ⇒ FR layer; staged
  outcomes present ⇒ outcome layer; tier S (from `.docs/complexity/`) ⇒ validator
  skipped entirely; no-retroactivity ⇒ gate engages only when the land's own
  idea-attributable change set contains a `.docs/coherence/` artifact requirement
  signal (a plan + tier ≠ S authored under the new flow, detected by the presence of
  the staged/committed new-flow artifacts — legacy re-lands see the gate disengaged).
- **Sequencing:** staging first (1–4), validator core bottom-up (5–12), enforcement
  extras (13–15), land wiring (16), skill + registration + order/doc updates (17–20).
- Confidence: file paths verified by direct grep this session (~95%); the exact
  s-tier pinned test lives at
  `src/conductor/test/acceptance/s-tier-pipeline-knobs.acceptance.test.ts` (verified).

## Prerequisites

- None — no migrations, no new dependencies. `mmdc` present for diagram gate.

## Tasks

### Task 1: Outcome staging writer at worktree creation
**Story:** Story 1 (happy path — staged file exists before any DECIDE artifact)
**Type:** happy-path
**Steps:**
1. Write failing test: creating the engineer worktree for an intake-sourced idea writes `.pipeline/intake-outcomes.md` in the worktree containing `Source-Ref: <ref>` and the verbatim `## Desired outcome` bullet block
2. Verify test fails (RED)
3. Implement `stageIntakeOutcomes(worktreePath, sourceRef, intakeBody)` in new `outcome-staging.ts`; call it from the engineer worktree flow when claim context carries a sourceRef + body
4. Verify test passes (GREEN)
5. Commit: "feat(engineer): stage intake outcomes in worktree .pipeline at creation"
**Files likely touched:**
- src/conductor/src/engine/engineer/outcome-staging.ts — new module (stage + read + parse bullets)
- src/conductor/src/engine/engineer/worktree-authoring.ts — invoke staging after worktree creation
- src/conductor/src/engine/engineer-cli.ts — thread claim body/sourceRef into the worktree handler
- src/conductor/test/engine/engineer/outcome-staging.test.ts — new tests
**Wired-into:** src/conductor/src/engine/engineer/worktree-authoring.ts#createEngineerWorktree, src/conductor/src/engine/engineer-cli.ts#worktree
**Dependencies:** none

### Task 2: Staging negative paths (chat origin, empty outcomes)
**Story:** Story 1 (negative paths)
**Type:** negative-path
**Steps:**
1. Write failing tests: (a) no sourceRef/body ⇒ no staging file, no throw; (b) body with empty `## Desired outcome` ⇒ staged file records zero bullets and reader reports outcome-layer-not-required; (c) staged file survives a failed land (no deletion on failure path)
2. Verify tests fail (RED)
3. Implement guards in `outcome-staging.ts` (no-op on absent inputs; empty-section tolerance; reader returns `{required: false}` when zero bullets)
4. Verify tests pass (GREEN)
5. Commit: "test(engineer): outcome staging degrades cleanly for chat-origin/empty intake"
**Files likely touched:**
- src/conductor/src/engine/engineer/outcome-staging.ts — guards
- src/conductor/test/engine/engineer/outcome-staging.test.ts — negative cases
**Wired-into:** same as Task 1
**Dependencies:** 1

### Task 3: Intake marker carries outcome bullets (plan-stem key unchanged)
**Story:** Story 1 (happy path — land commits outcomes inside `.docs/intake/<plan-stem>.md`)
**Type:** happy-path
**Steps:**
1. Write failing test: `writeIntakeMarker` given staged outcomes emits the marker with `Source-Ref:`/`Owner:` lines plus the verbatim outcome bullet block; filename remains the plan stem
2. Verify test fails (RED)
3. Extend `writeIntakeMarker` signature with optional staged-outcomes content; render bullets after the header lines
4. Verify test passes (GREEN)
5. Commit: "feat(engineer): intake marker carries Desired-outcome bullets"
**Files likely touched:**
- src/conductor/src/engine/engineer/intake-marker.ts — optional outcomes param + rendering
- src/conductor/src/engine/engineer/land-spec.ts — read staging, pass to writeIntakeMarker (within existing call)
- src/conductor/test/engine/engineer/intake-marker.test.ts — new cases
**Wired-into:** src/conductor/src/engine/engineer/land-spec.ts#landSpec (existing writeIntakeMarker call site)
**Dependencies:** 1

### Task 4: Marker rewrite preservation + no idea-slug file
**Story:** Story 1 (negative/preservation paths)
**Type:** negative-path
**Steps:**
1. Write failing tests: (a) rewriting an existing marker (owner re-stamp) preserves the committed outcome bullet block and `Source-Ref:` byte-for-byte; (b) no `.docs/intake/<idea-slug>.md` is ever created (pinned contract from `intake-marker-plan-stem-keying` stays green); (c) chat-origin (no staging) marker unchanged from today's format
2. Verify tests fail (RED)
3. Implement preservation: on rewrite, extract and retain the existing bullet block (mirror the existing `Source-Ref` preservation regex approach)
4. Verify tests pass (GREEN)
5. Commit: "fix(engineer): byte-preserve outcome bullets across intake-marker rewrites"
**Files likely touched:**
- src/conductor/src/engine/engineer/intake-marker.ts — preservation logic
- src/conductor/test/engine/engineer/intake-marker.test.ts — preservation + contract cases
**Wired-into:** same as Task 3
**Dependencies:** 3

### Task 5: Coherence artifact parser (fail-closed shapes)
**Story:** Story 2 (artifact exists/parses), Story 14 (missing/empty/unparseable distinct rejections)
**Type:** infrastructure
**Steps:**
1. Write failing tests: parse a well-formed `.docs/coherence/<plan-stem>.md` into typed rows (four classes, verdicts, cited ids, quotes); missing file ⇒ `missing-coherence-artifact`; zero-byte/whitespace ⇒ `empty-coherence-artifact`; corrupted table ⇒ `unparseable-coherence-artifact` — three distinct error kinds
2. Verify tests fail (RED)
3. Implement `parseCoherenceArtifact(text | null)` in new `coherence-validator.ts` (parse-don't-validate: null result carries the distinct reason)
4. Verify tests pass (GREEN)
5. Commit: "feat(engineer): coherence artifact parser with fail-closed error kinds"
**Files likely touched:**
- src/conductor/src/engine/engineer/coherence-validator.ts — new module (parser + types)
- src/conductor/test/engine/engineer/coherence-validator.test.ts — new tests
**Wired-into:** src/conductor/src/engine/engineer/coherence-validator.ts#runCoherenceGate (parseCoherenceArtifact call, line ~1243), invoked from src/conductor/src/engine/engineer/land-spec.ts#landSpec (Task 16)
**Dependencies:** none

### Task 6: Id cross-check against real artifacts
**Story:** Story 2 (fabricated citation rejected; stem mismatch rejected)
**Type:** happy-path
**Steps:**
1. Write failing tests: every row's cited ids resolve against real inputs — story ids via `splitStoryBlocks`, task ids via the plan task tree, FR ids via the PRD text, outcome indices via staged/committed outcomes; a row citing a nonexistent id yields a fabrication gap naming the row
2. Verify tests fail (RED)
3. Implement `crossCheckIds(parsedArtifact, inputs)` reusing `artifacts.ts` parsers and `plan-task-parse.ts` grammar (no duplicated parsing)
4. Verify tests pass (GREEN)
5. Commit: "feat(engineer): coherence rows cross-checked against real story/plan/FR/outcome ids"
**Files likely touched:**
- src/conductor/src/engine/engineer/coherence-validator.ts — cross-check
- src/conductor/test/engine/engineer/coherence-validator.test.ts — fixtures with real-shaped stories/plan
**Wired-into:** src/conductor/src/engine/engineer/coherence-validator.ts#runCoherenceGate (crossCheckIds call, line ~1253), invoked from src/conductor/src/engine/engineer/land-spec.ts#landSpec (Task 16)
**Dependencies:** 5

### Task 7: Outcome-coverage layer (`outcome-<n>`)
**Story:** Story 3
**Type:** happy-path
**Steps:**
1. Write failing tests: all bullets mapped ⇒ layer passes silently; one bullet with no row or negative verdict ⇒ gap `outcome-<n>` quoting the bullet; coverage asserted via nonexistent story id ⇒ gap (from Task 6 fabrication path)
2. Verify tests fail (RED)
3. Implement outcome set-difference over staged outcome bullets vs affirmative rows
4. Verify tests pass (GREEN)
5. Commit: "feat(engineer): outcome→story coverage layer"
**Files likely touched:**
- src/conductor/src/engine/engineer/coherence-validator.ts — outcome layer
- src/conductor/test/engine/engineer/coherence-validator.test.ts
**Wired-into:** src/conductor/src/engine/engineer/coherence-validator.ts#validateCoherence (checkOutcomeCoverage call), invoked from runCoherenceGate -> src/conductor/src/engine/engineer/land-spec.ts#landSpec (Task 16)
**Dependencies:** 6

### Task 8: FR-coverage layer (`fr-<N>`, transitive)
**Story:** Story 4
**Type:** happy-path
**Steps:**
1. Write failing tests: every PRD FR cited by ≥1 story `**Requirement:**` line and transitively by ≥1 task ⇒ pass; uncovered FR ⇒ `fr-<N>`; FR whose only story has no task ⇒ report names both the FR and the story (transitive gap not masked)
2. Verify tests fail (RED)
3. Implement FR extraction from the PRD (`FR-\d+` over `## Functional Requirements`) + two-hop set-difference
4. Verify tests pass (GREEN)
5. Commit: "feat(engineer): FR→story→task coverage layer"
**Files likely touched:**
- src/conductor/src/engine/engineer/coherence-validator.ts — FR layer
- src/conductor/test/engine/engineer/coherence-validator.test.ts
**Wired-into:** src/conductor/src/engine/engineer/coherence-validator.ts#validateCoherence (checkFrCoverage call), invoked from runCoherenceGate -> src/conductor/src/engine/engineer/land-spec.ts#landSpec (Task 16)
**Dependencies:** 6

### Task 9: Story-coverage layer (`story-<id>`, zero-stories fail-closed)
**Story:** Story 5
**Type:** happy-path
**Steps:**
1. Write failing tests: every story id cited by ≥1 task `**Story:**` line ⇒ pass; uncovered story ⇒ `story-<id>` with title; stories file with zero parseable blocks ⇒ `unparseable-stories` rejection (never trivially covered)
2. Verify tests fail (RED)
3. Implement story set-difference over `splitStoryBlocks` ids vs task `**Story:**` citations (via `collectPlanCoverage`)
4. Verify tests pass (GREEN)
5. Commit: "feat(engineer): story→task coverage layer, fail-closed on unparseable stories"
**Files likely touched:**
- src/conductor/src/engine/engineer/coherence-validator.ts — story layer
- src/conductor/test/engine/engineer/coherence-validator.test.ts
**Wired-into:** src/conductor/src/engine/engineer/coherence-validator.ts#validateCoherence (checkStoryCoverage call), invoked from runCoherenceGate -> src/conductor/src/engine/engineer/land-spec.ts#landSpec (Task 16)
**Dependencies:** 6

### Task 10: Orphan-task rule (`task-<id>`)
**Story:** Story 6
**Type:** negative-path
**Steps:**
1. Write failing tests per the ADR's mechanical rule: (a) task citing existing story id ⇒ covered; (b) `**Type:** infrastructure|refactor` + non-empty declared purpose ⇒ covered; (c) task citing only nonexistent ids ⇒ `task-<id>`; (d) infrastructure task with empty/missing `**Story:**` ⇒ `task-<id>`; (e) no `**Story:**` line + non-supporting type ⇒ `task-<id>`
2. Verify tests fail (RED)
3. Implement orphan detection over the parsed task tree
4. Verify tests pass (GREEN)
5. Commit: "feat(engineer): orphan-task detection per coherence ADR rule"
**Files likely touched:**
- src/conductor/src/engine/engineer/coherence-validator.ts — orphan rule
- src/conductor/test/engine/engineer/coherence-validator.test.ts
**Wired-into:** src/conductor/src/engine/engineer/coherence-validator.ts#validateCoherence (checkOrphanTasks call), invoked from runCoherenceGate -> src/conductor/src/engine/engineer/land-spec.ts#landSpec (Task 16)
**Dependencies:** 6

### Task 11: Coverage-table consistency (`claim-<row>`)
**Story:** Story 7
**Type:** negative-path
**Steps:**
1. Write failing tests: coverage-table row citing a task id absent from the task tree ⇒ `claim-<row>` naming the phantom id; table pair contradicting the task tree's actual `**Story:**` citations ⇒ `claim-<row>`; consistent table ⇒ pass
2. Verify tests fail (RED)
3. Implement table-vs-tree reconciliation reusing `collectPlanCoverage`'s table parse
4. Verify tests pass (GREEN)
5. Commit: "feat(engineer): plan coverage-table vs task-tree consistency check"
**Files likely touched:**
- src/conductor/src/engine/engineer/coherence-validator.ts — consistency check
- src/conductor/test/engine/engineer/coherence-validator.test.ts
**Wired-into:** src/conductor/src/engine/engineer/coherence-validator.ts#validateCoherence (checkCoverageTableConsistency call), invoked from runCoherenceGate -> src/conductor/src/engine/engineer/land-spec.ts#landSpec (Task 16)
**Dependencies:** 6

### Task 12: Aggregated deterministic gap report
**Story:** Story 10
**Type:** happy-path
**Steps:**
1. Write failing tests: three gaps of different classes ⇒ one report listing all three, each with gap id + source artifact + quoted item; single gap ⇒ report contains the specific id (assert no generic-only wording); identical input twice ⇒ byte-identical report (stable ordering, stable ids)
2. Verify tests fail (RED)
3. Implement `renderGapReport(gaps[])` with deterministic sort (layer order, then artifact position)
4. Verify tests pass (GREEN)
5. Commit: "feat(engineer): aggregated deterministic coherence gap report"
**Files likely touched:**
- src/conductor/src/engine/engineer/coherence-validator.ts — report renderer + `validateCoherence` orchestrator
- src/conductor/test/engine/engineer/coherence-validator.test.ts
**Wired-into:** src/conductor/src/engine/engineer/coherence-validator.ts#runCoherenceGate (validateCoherence + renderGapReport calls, line ~1271/1310), invoked from src/conductor/src/engine/engineer/land-spec.ts#landSpec (Task 16)
**Dependencies:** 7, 8, 9, 10, 11

### Task 13: Coherence waiver parser/evaluator
**Story:** Story 9
**Type:** negative-path
**Steps:**
1. Write failing tests mirroring release-gate semantics: valid `Waives:` + `Rationale:` covering all gap ids in the spec's own change set ⇒ pass-with-waiver; partial coverage ⇒ block naming unwaived remainder; unknown gap id ⇒ malformed ⇒ block; empty rationale ⇒ malformed; waiver present on base branch but not in this change set ⇒ not applied (fresh-in-diff)
2. Verify tests fail (RED)
3. Implement `parseCoherenceWaiver`/`evaluateCoherenceWaiver` in new `coherence-waiver.ts` (structure mirrors `release-gate.ts` `parseWaiver`/`findWaiverInDiff`; gap-id set from the validator is the canonical vocabulary)
4. Verify tests pass (GREEN)
5. Commit: "feat(engineer): coherence waiver — fresh-in-diff, parse-don't-validate, partial blocks"
**Files likely touched:**
- src/conductor/src/engine/engineer/coherence-waiver.ts — new module
- src/conductor/test/engine/engineer/coherence-waiver.test.ts — new tests
**Wired-into:** src/conductor/src/engine/engineer/coherence-validator.ts#runCoherenceGate (evaluateCoherenceWaiver call, line ~1302), invoked from src/conductor/src/engine/engineer/land-spec.ts#landSpec (Task 16)
**Dependencies:** 12

### Task 14: Duplicate-claim scan (offline, intake markers only)
**Story:** Story 8
**Type:** negative-path
**Steps:**
1. Write failing tests: default-branch `.docs/intake/*.md` with same `Source-Ref` ⇒ gap `duplicate:<ref>` naming the conflicting slug; no match ⇒ pass with zero network calls (assert no gh/fetch invocation); waiver covering `duplicate:<ref>` ⇒ lands; advisory open-PR warn path is fail-open (network error ⇒ warn skipped, land unaffected)
2. Verify tests fail (RED)
3. Implement `scanDuplicateClaim(repoPath, defaultBranch, sourceRef)` via `git ls-tree`/`git show` of default-branch intake markers; advisory warn delegates to existing `overlap-scan.ts` machinery with `--source-ref` (reuse, no second scanner)
4. Verify tests pass (GREEN)
5. Commit: "feat(engineer): offline duplicate-intake-claim scan at land"
**Files likely touched:**
- src/conductor/src/engine/engineer/coherence-validator.ts — duplicate scan + gap emission
- src/conductor/src/engine/overlap-scan.ts — reuse hook for advisory warn (no behavior change to existing callers)
- src/conductor/test/engine/engineer/coherence-validator.test.ts
**Wired-into:** src/conductor/src/engine/engineer/coherence-validator.ts#runCoherenceGate (scanDuplicateClaim call, line ~1283), invoked from src/conductor/src/engine/engineer/land-spec.ts#landSpec (Task 16)
**Dependencies:** 13

### Task 15: Tier gating, layer degradation, no-retroactivity trigger
**Story:** Story 11, Story 12, Story 13 (validator side), Story 14 (S-exemption ordering)
**Type:** negative-path
**Steps:**
1. Write failing tests: tier S (from `.docs/complexity/`) ⇒ validator disengages before the missing-artifact check (Story 14 ordering); technical track marker ⇒ FR layer skipped, other layers enforced; no staged/committed outcomes ⇒ outcome layer skipped, orphan task still rejects; no track marker ⇒ defaults per existing land `parseTrack`; legacy change set (no new-flow coherence signal in the idea-attributable diff) ⇒ gate disengaged entirely; M-tier missing artifact ⇒ still rejects (exemption never leaks)
2. Verify tests fail (RED)
3. Implement `resolveRequiredLayers(worktree, tier, track, outcomes, changeSet)` as the validator's entry guard
4. Verify tests pass (GREEN)
5. Commit: "feat(engineer): tier/track/origin layer derivation + no-retroactivity trigger"
**Files likely touched:**
- src/conductor/src/engine/engineer/coherence-validator.ts — entry guard
- src/conductor/test/engine/engineer/coherence-validator.test.ts
**Wired-into:** src/conductor/src/engine/engineer/coherence-validator.ts#runCoherenceGate (resolveRequiredLayers call, line ~1229), invoked from src/conductor/src/engine/engineer/land-spec.ts#landSpec (Task 16)
**Dependencies:** 12

### Task 16: landSpec wiring (single call-site block)
**Story:** Story 2 (validator runs at land), Story 13 (silent coherent pass)
**Type:** happy-path
**Steps:**
1. Write failing acceptance tests over `landSpec`: coherent M-tier worktree lands with unchanged output except silent pass; gapped worktree throws with the aggregated report (keep-on-failure preserved); S-tier lands without artifact; staged outcomes committed into the marker (integrates Task 3)
2. Verify tests fail (RED)
3. Insert one block in `land-spec.ts` after the existing DRAFT-ADR gate: `await runCoherenceGate({worktreePath, tier, track, guard, sourceRef})` (all logic inside the new modules)
4. Verify tests pass (GREEN)
5. Commit: "feat(engineer): wire coherence gate into landSpec ladder"
**Files likely touched:**
- src/conductor/src/engine/engineer/land-spec.ts — single insertion block
- src/conductor/src/engine/engineer/coherence-validator.ts — `runCoherenceGate` facade
- src/conductor/test/engine/engineer/land-spec.test.ts — acceptance cases
**Wired-into:** src/conductor/src/engine/engineer/land-spec.ts#landSpec
**Dependencies:** 3, 14, 15

### Task 17: `/coherence-check` skill authoring
**Story:** Story 2 (mapping authored end-of-DECIDE), Story 13 (tier/model rules)
**Type:** infrastructure
**Steps:**
1. Author `skills/coherence-check/SKILL.md`: frontmatter (`name`, `description`, `enforcement: gating`, `phase: decide`), mapping-artifact format (four row classes, verdict vocabulary, gap-id scheme documented as the waiver vocabulary), semantic-judging instructions (verify-claims protocol), tier rule (M/L only), model rule (M = session default; L pins opus for the dispatch)
2. Run `test/test_harness_integrity.sh` — expect failures only for the not-yet-updated model table (fixed in Task 19)
3. Commit: "feat(skills): /coherence-check DECIDE step"
**Files likely touched:**
- skills/coherence-check/SKILL.md — new skill
**Wired-into:** none (inert until skills/engineer/SKILL.md)
**Dependencies:** none

### Task 18: Step registration + S-tier pinned test update
**Story:** Story 13 (skippable for S; pinned-set test updated in same diff)
**Type:** infrastructure
**Steps:**
1. Write failing test updates: `getSkippableSteps('S')` pinned set gains `coherence_check`; existing step definitions' `skippableForTiers` unchanged (diff guard holds); SKILL_MAP gains `coherence_check: '/coherence-check'` as a one-shot DECIDE step ordered after `plan`
2. Verify tests fail (RED)
3. Register the step in `steps.ts` (`skippableForTiers: ['S']`), SKILL_MAP in `step-runners.ts`, ordering after `plan`; L-tier model pin via the step's model resolution (`model-table-metadata.ts`)
4. Verify tests pass (GREEN)
5. Commit: "feat(engine): register coherence_check step (S-skippable, post-plan)"
**Files likely touched:**
- src/conductor/src/engine/steps.ts — step definition
- src/conductor/src/engine/step-runners.ts — SKILL_MAP entry
- src/conductor/src/engine/model-table-metadata.ts — model metadata (L opus step-up)
- src/conductor/test/acceptance/s-tier-pipeline-knobs.acceptance.test.ts — pinned-set update
- src/conductor/test/engine/steps.test.ts — registry assertions
**Wired-into:** src/conductor/src/engine/steps.ts#steps (step registry consumed by the conduct loop dispatcher)
**Dependencies:** 17

### Task 19: Canonical DECIDE order + model table regeneration
**Story:** Story 13 (order amendment obligation from conflict resolution 3)
**Type:** infrastructure
**Steps:**
1. Update `skills/engineer/SKILL.md` step list (insert coherence-check after `/plan`, tier-aware), HARNESS.md DECIDE phase table, and regenerate the model table (`bin/generate-model-table`) so integrity tests 5/5a/5b pass with the new skill entry
2. Run `test/test_harness_integrity.sh` — must pass clean
3. Commit: "docs(harness): canonical DECIDE order gains coherence-check; model table regenerated"
**Files likely touched:**
- skills/engineer/SKILL.md — DECIDE order
- HARNESS.md — phase table + model-selection table (generated section)
- .docs/architecture/generated-model-table.md — regenerated if the generator emits it
**Wired-into:** none (no new production surface)
**Dependencies:** 17, 18

### Task 20: Docs upkeep + CHANGELOG + full validation
**Story:** Story 2 (operator-facing documentation of the artifact/gate); repo release gates
**Type:** infrastructure
**Steps:**
1. Update `README.md` + `src/conductor/README.md` (coherence gate, waiver flow, duplicate check, staging); add CHANGELOG `## [Unreleased]` → Added entry; no VERSION bump (pre-v1 policy)
2. Run `test/test_harness_integrity.sh` + `src/conductor` test suite — all green
3. Commit: "docs: coherence gate documentation + changelog"
**Files likely touched:**
- README.md — feature docs
- src/conductor/README.md — engine docs
- CHANGELOG.md — [Unreleased] Added
**Wired-into:** none (no new production surface)
**Dependencies:** 16, 19

## Task Dependency Graph

```
1 ──> 2
1 ──> 3 ──> 4
5 ──> 6 ──> 7 ─┐
        ├─> 8 ─┤
        ├─> 9 ─┼─> 12 ──> 13 ──> 14 ─┐
        ├─> 10 ┤      └─> 15 ────────┼─> 16 ─┐
        └─> 11 ┘                     │       ├─> 20
3 ───────────────────────────────────┘       │
17 ──> 18 ──> 19 ────────────────────────────┘
```

Acyclic; independent roots: 1, 5, 17.

## Integration Points

- After Task 4: staging + marker round-trip testable end-to-end (claim → stage → land-commit → rewrite-preserve).
- After Task 12: full validator runnable against fixture artifact sets (all five layers + report).
- After Task 16: real `landSpec` end-to-end — coherent land, gapped reject, waived land, S-tier exemption.
- After Task 19: whole DECIDE flow order visible to the engineer session; integrity suite green.

## Coverage Check (story → task)

| Story | Tasks |
|---|---|
| 1 outcomes travel | 1, 2, 3, 4 |
| 2 mapping artifact | 5, 6, 16, 17, 20 |
| 3 outcome coverage | 7 |
| 4 FR coverage | 8 |
| 5 story coverage | 9 |
| 6 orphan tasks | 10 |
| 7 table consistency | 11 |
| 8 duplicate claim | 14 |
| 9 waiver | 13 |
| 10 gap reporting | 12 |
| 11 technical track | 15 |
| 12 no-intake | 15 |
| 13 S exemption / silent pass | 15, 16, 18, 19 |
| 14 fail-closed | 5, 15, 16 |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task (Stories 1,6,7,8,9,10,13,14 have explicit negative tasks 2,4,10,11,13,14,15)
- [ ] No task exceeds ~5 minutes of focused work per step-cycle
- [ ] Dependencies explicit and acyclic (graph above)
- [ ] Every task carries Story/Type/Files/Wired-into/Dependencies lines
