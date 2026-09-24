# Implementation Plan: Project-owned pull request body regions survive finish (#2616)

**Date:** 2026-09-24
**Stories:** .docs/stories/preserve-project-owned-pr-body-sections-through-fi.md
**Conflict check:** Clean as of 2026-09-24 (1 blocking and 5 degrading resolved; see `.docs/conflicts/preserve-project-owned-pr-body-sections-through-fi.md`)

## Summary

Fifteen tasks let a project declare step-owned pull request body regions in its `.github/pull_request_template.md`, seed the SHIP draft from that template, capture each region when its owning step succeeds, restore it byte-for-byte after every FINISH body rewrite, verify it before the ready flip, and retire the self-host `Release-*` snapshot in favor of an ordinary `release-disposition` region.

## Technical Approach

- **Declaration (ADR D1–D2).** A new `src/conductor/src/engine/pr-body-regions.ts` parses `<!-- ai-conductor:step «key» -->` … `<!-- /ai-conductor:step -->` pairs; `loadConfig` reads only `.github/pull_request_template.md` and validates owners with the custom-step-only, fail-closed shape used for `completion_artifact` (reject built-in, undeclared, or post-`finish` keys; the error names the step). The loaded config carries the template bytes and region owners; nothing is added to `.ai-conductor/config.yml`.
- **Seed and floor (D3).** `openShipDraftPr` builds the draft from floor marker + template + closing placeholder + draft note; without a template the body is today's. `isEngineFlooredBody` nets the seeded template bytes out of `authoredProseLength`, so a seeded draft stays a floor (architecture review condition 1).
- **Ensure, capture, store (D4–D5).** A pre-dispatch hook inserts a missing region into the retained draft before its owning step runs; a completion hook captures the region's exact bytes when the owning step reports `done`, halting on a missing or empty region. Captures persist in `.pipeline/pr-body-region-captures.json` keyed by pull request URL and step key, and a re-dispatch of the owning step replaces its capture.
- **Re-insertion (D6).** `runFinishPublication` wraps the authoring and judge dispatches so regions are restored before the coordinator observes the revision — the judged revision already carries them, so no prose verdict goes stale (condition 2). The body floor and halt-PR rehabilitation paths re-insert inside `createFinishPresentationRepair`. No publication transition is added.
- **Verify before ready (D7).** `createFinishPresentationRepair` re-reads and compares every capture immediately before `ensureShipReady`, in both production compositions (`ready_pr` and the finish completion repair); the completion repair becomes fail-closed only when a capture exists, keeping its warn-only behavior otherwise (condition 3).
- **Engine sections (D8).** `upsertReducedCoverageEvidence` masks regions before searching for its heading; accepted risk, the closing reference, and the plan line keep their paths.
- **Retirement (D9).** This repository's template gains a `release-disposition` region and its skill writes inside it; only then is the self-host snapshot/restore deleted (conflict C4 ordering), keeping release-flow activation and the release gate's validation (condition 4).
- **All GitHub writes and reads** go through the guarded operation boundary of `adr-2026-09-11-github-operation-ownership`; tests mock that boundary.
- **Sequencing.** Parser (1) → config (2) → floor (3) and seed (4); primitives and store (5) → ensure (6) → capture (7) → re-insertion (8) and repair (9) → completion repair (10); engine sections (11); no-region baseline (12, condition 5); release region (13) → retirement (14); shipped skill guidance (15) is independent.

## Prerequisites

- None beyond `main` at `c50ca7651`. Task 12 records its golden bodies from that commit.

## Tasks

### Task 1: Parse step-keyed regions from a pull request template
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/pr-body-regions.test.ts` for `parsePrTemplateRegions`: one region per marker pair with key and exact bytes; zero regions for an unmarked template; typed errors for an unclosed region, a nested region (both keys), a duplicate key, and region content containing `## Reduced build-review coverage` or the accepted-risk start marker.
2. Verify tests fail (RED).
3. Implement `parsePrTemplateRegions` in new `src/conductor/src/engine/pr-body-regions.ts`. Markers are the single-line comments `<!-- ai-conductor:step «key» -->` and `<!-- /ai-conductor:step -->`; region bytes are everything between them, never interpreted. Engine-owned text is the reduced build-review coverage heading and the accepted-risk markers exported by `build-review-accepted-risk.ts` (import the constants; do not re-spell them).
4. Verify tests pass (GREEN).
5. Commit: "feat(pr-body): parse step-keyed template regions"

**Done when:**
- `parsePrTemplateRegions` in `src/conductor/src/engine/pr-body-regions.ts` returns one region per `<!-- ai-conductor:step «key» -->` … `<!-- /ai-conductor:step -->` pair with its key and exact bytes, and returns zero regions for a template with no markers, as asserted by the region-parse tests in `src/conductor/test/engine/pr-body-regions.test.ts`
- it returns a typed error naming the step key for an opening marker with no closing marker, for a region opened inside another region (naming both keys), and for two regions naming the same key, as asserted by the unclosed, nested, and duplicate-key tests
- it returns a typed error naming the region's key and the engine-owned text for region content containing `## Reduced build-review coverage` or the accepted-risk start marker, as asserted by the engine-owned-text tests

**Files:**
- `src/conductor/src/engine/pr-body-regions.ts` — new template region parser
- `src/conductor/test/engine/pr-body-regions.test.ts` — parser tests

**Dependencies:** none

### Task 2: Validate template regions at config load
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/config.test.ts` driving `loadConfig` against fixture project roots: a marked `.github/pull_request_template.md` with a declared custom step ordered before `finish`; two such regions; an unmarked template; a marked template only at the repository root; and failing templates for built-in `finish`, undeclared `release-disposiiton`, a step ordered after `finish`, and the four template-shape errors from Task 1.
2. Verify tests fail (RED).
3. Implement in `src/conductor/src/engine/config.ts`: read only `.github/pull_request_template.md` under the project root; run `parsePrTemplateRegions`; reject a key that is a built-in step, is undeclared under `steps:`, or is not ordered before `finish` (reuse the ordering computed by `selectFinishPrerequisiteSteps` in `finish-custom-step-prerequisites.ts`); record the template bytes and region owners on the loaded config (type in `src/conductor/src/types/config.ts`). Follow the custom-step-only, fail-closed validator shape used for `completion_artifact`: reject on built-in steps, error names the step. No `.ai-conductor/config.yml` key is added.
4. Verify tests pass (GREEN).
5. Commit: "feat(config): validate pull request template regions at load"

**Done when:**
- `loadConfig` in `src/conductor/src/engine/config.ts`, given `.github/pull_request_template.md` with a region naming a declared custom step ordered before `finish`, succeeds and reports that step as the region's owner in the loaded config, and given two regions naming two such steps succeeds with each step owning exactly its own region, as asserted by the region-owner config tests in `src/conductor/test/engine/config.test.ts`
- `loadConfig` succeeds with zero region owners for a template with no markers and for a repository whose only marked template is at the repository root rather than `.github/pull_request_template.md`, as asserted by the unmarked-template and root-template config tests
- `loadConfig` fails with an error naming the marker key and the broken rule for a region naming built-in step `finish` (built-in steps cannot own a region), an undeclared key `release-disposiiton` (undeclared step), and a declared step whose `after:` orders it after `finish` (a region owner must run before `finish`), as asserted by the three owner-rule config tests
- `loadConfig` fails with an error naming the offending step key for the duplicate-key, unclosed, and nested (naming both keys) templates, and naming the step key and the engine-owned text it contains for the engine-owned-text template, as asserted by the four template-shape config tests

**Files:**
- `src/conductor/src/engine/config.ts` — template read and region validation
- `src/conductor/src/types/config.ts` — loaded region owners and template bytes
- `src/conductor/test/engine/config.test.ts` — config-load tests

**Dependencies:** Task 1

### Task 3: Recognize a template-seeded draft as the engine floor
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/halt-pr-rehabilitation.test.ts`: a seeded draft built from a template longer than 400 characters with no prose classifies as floor; the same draft with 1,000 characters of added prose and the floor marker kept classifies as authored. Add a test in `src/conductor/test/engine/finish-publication-production.test.ts` that FINISH observation of the unauthored seeded draft reports floor and the coordinator selects `author_pr_prose`.
2. Verify tests fail (RED).
3. Implement in `src/conductor/src/engine/halt-pr-rehabilitation.ts`: `isEngineFlooredBody` accepts the loaded template bytes and `authoredProseLength` nets them out before comparing against `FLOOR_FREE_TEXT_MAX_CHARS`; pass the loaded template from the FINISH observation in `src/conductor/src/engine/finish-publication-production.ts`.
4. Verify tests pass (GREEN).
5. Commit: "fix(finish): classify template-seeded drafts as the floor"

**Done when:**
- `isEngineFlooredBody` in `src/conductor/src/engine/halt-pr-rehabilitation.ts`, given a template-seeded draft whose template text exceeds 400 characters and no authored prose, returns `true` because `authoredProseLength` nets out the seeded template bytes, as asserted by the seeded-floor test in `src/conductor/test/engine/halt-pr-rehabilitation.test.ts`
- the same classifier returns `false` for that draft with 1,000 characters of added prose and the floor marker left in place, classifying it as authored prose, as asserted by the seeded-authored test
- FINISH publication observation of an unauthored template-seeded draft reports the body as the engine floor and the coordinator selects `author_pr_prose`, as asserted by the seeded-draft selection test in `src/conductor/test/engine/finish-publication-production.test.ts`

**Files:**
- `src/conductor/src/engine/halt-pr-rehabilitation.ts` — template-aware floor measurement
- `src/conductor/src/engine/finish-publication-production.ts` — pass loaded template to floor observation
- `src/conductor/test/engine/halt-pr-rehabilitation.test.ts` — floor tests
- `src/conductor/test/engine/finish-publication-production.test.ts` — selection test

**Dependencies:** Task 2

### Task 4: Seed the SHIP draft body from the template
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/ship-draft-pr.test.ts` capturing the create invocation: with a template the body is floor marker + template bytes + closing-reference placeholder + draft note; without a template it is byte-identical to today's `shipDraftPrBody`; a template line identical to a floor placeholder appears once and the unauthored body still classifies as floor. Add a wiring test in `src/conductor/test/engine/conductor-finish-publication.test.ts` that both SHIP entry callers pass the loaded template.
2. Verify tests fail (RED).
3. Implement: `shipDraftPrBody` and `openShipDraftPr` in `src/conductor/src/engine/ship-draft-pr.ts` take the loaded template; pass it from the conductor SHIP draft path in `src/conductor/src/engine/conductor.ts` and the `establish_pr` effect in `src/conductor/src/engine/finish-publication.ts`.
4. Verify tests pass (GREEN).
5. Commit: "feat(ship): seed the draft pull request from the project template"

**Done when:**
- `openShipDraftPr` in `src/conductor/src/engine/ship-draft-pr.ts`, given the loaded config's template, issues a create invocation whose body contains the engine floor marker, the template's bytes unchanged, the closing-reference placeholder comment, and the SHIP draft note, as asserted by the seeded-create test in `src/conductor/test/engine/ship-draft-pr.test.ts`
- given no template, the create invocation's body is byte-identical to the pre-change `shipDraftPrBody` output for the same feature description, as asserted by the no-template create test
- given a template containing a line identical to a floor placeholder, the seeded body contains that template line exactly once and `isEngineFlooredBody` classifies the unauthored seeded body as the engine floor, as asserted by the placeholder-line seed test
- both SHIP entry callers — the conductor SHIP draft path and the finish publication `establish_pr` effect — pass the loaded template to `openShipDraftPr`, as asserted by the SHIP draft wiring test in `src/conductor/test/engine/conductor-finish-publication.test.ts`

**Files:**
- `src/conductor/src/engine/ship-draft-pr.ts` — template-seeded draft body
- `src/conductor/src/engine/conductor.ts` — pass template at SHIP entry
- `src/conductor/src/engine/finish-publication.ts` — pass template in establish_pr
- `src/conductor/test/engine/ship-draft-pr.test.ts` — seed tests
- `src/conductor/test/engine/conductor-finish-publication.test.ts` — wiring test

**Dependencies:** Task 2, Task 3

### Task 5: Region restore primitives and the capture store
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/pr-body-regions.test.ts` for `restoreRegion` (omitted, altered, duplicated, already-matching) and `isEmptyRegion`, and in `src/conductor/test/engine/pr-body-region-store.test.ts` for `writeRegionCapture` / `readRegionCaptures` keyed by pull request URL and step key.
2. Verify tests fail (RED).
3. Implement `restoreRegion` and `isEmptyRegion` in `src/conductor/src/engine/pr-body-regions.ts` (replace in place when markers exist, collapse duplicates to one, append after the last region otherwise; bytes are never interpreted) — the same replace-in-place-else-append shape as `upsertBuildReviewAcceptedRisk` in `build-review-accepted-risk.ts`, with a step-keyed marker and restored rather than regenerated bytes. Implement the store in new `src/conductor/src/engine/pr-body-region-store.ts` at `.pipeline/pr-body-region-captures.json` with the guarded mkdir-before-write discipline.
4. Verify tests pass (GREEN).
5. Commit: "feat(pr-body): region restore primitives and capture store"

**Done when:**
- `restoreRegion` in `src/conductor/src/engine/pr-body-regions.ts` returns a body containing the region exactly once with the captured bytes when the input body omits the region, holds altered text between its markers, or holds the region twice, and returns the input unchanged when the region already matches, as asserted by the restore tests in `src/conductor/test/engine/pr-body-regions.test.ts`
- `isEmptyRegion` returns `true` for a region holding only whitespace and HTML comments and `false` for `Attested-By: security-bot`, as asserted by the empty-region tests
- `writeRegionCapture` and `readRegionCaptures` in `src/conductor/src/engine/pr-body-region-store.ts` persist captures in `.pipeline/pr-body-region-captures.json` keyed by pull request URL and step key, and a capture recorded for a different pull request URL is not returned for the current pull request, as asserted by the store tests in `src/conductor/test/engine/pr-body-region-store.test.ts`

**Files:**
- `src/conductor/src/engine/pr-body-regions.ts` — restore and emptiness primitives
- `src/conductor/src/engine/pr-body-region-store.ts` — new capture store
- `src/conductor/test/engine/pr-body-regions.test.ts` — primitive tests
- `src/conductor/test/engine/pr-body-region-store.test.ts` — store tests

**Dependencies:** Task 1

### Task 6: Ensure the region exists before its owning step dispatches
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/pr-body-region-dispatch.test.ts` with a mocked GitHub operation runner: region absent → one edit inserting the template region; region present → zero edits; non-owner → zero reads and edits; refused edit, failed read, and missing draft → no dispatch and a halt naming the step.
2. Verify tests fail (RED).
3. Implement the pre-dispatch region hook in the dispatch loop of `src/conductor/src/engine/conductor.ts`, beside the existing per-step pre-dispatch hooks, for steps that own a region: resolve the retained draft, read its body, and insert the template region with `restoreRegion` through the guarded GitHub operation boundary; halt through the existing halt writer on refusal, read failure, or missing draft.
4. Verify tests pass (GREEN).
5. Commit: "feat(conductor): ensure an owning step's region before dispatch"

**Done when:**
- the pre-dispatch region hook in `src/conductor/src/engine/conductor.ts`, for an owning step whose retained draft body lacks its region, issues exactly one guarded body edit whose result contains the template's region once and every other byte of the prior body unchanged, before dispatching the step, as asserted by the ensure-region test in `src/conductor/test/engine/pr-body-region-dispatch.test.ts`
- for an owning step whose body already holds its region with content, the hook issues zero body edits and leaves the region content unchanged, and for a step that owns no region the hook issues zero body reads and zero body edits, as asserted by the region-present and non-owner dispatch tests
- when the guarded edit is refused, the body read fails, or no retained draft exists because every early publish failed, the step is not dispatched and the run halts with a reason naming the step and, respectively, the refusal, the failed read, or the missing draft, and FINISH does not create the pull request, as asserted by the three pre-dispatch halt tests

**Files:**
- `src/conductor/src/engine/conductor.ts` — pre-dispatch region hook
- `src/conductor/test/engine/pr-body-region-dispatch.test.ts` — dispatch hook tests

**Dependencies:** Task 2, Task 5

### Task 7: Capture an owning step's region when it succeeds
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/pr-body-region-capture.test.ts`: `done` with content persists the exact bytes; a restart reuses the capture with zero capture reads at FINISH; a re-dispatch replaces the capture; markers removed, empty region, or failed read halt naming the step with no FINISH dispatch; a `failed` step takes no capture; a repository with no template writes no capture file.
2. Verify tests fail (RED).
3. Implement the owning-step completion hook in `src/conductor/src/engine/conductor.ts` where a sequential step's `step_completed` with status `done` is emitted: read the retained draft body, extract the region, halt via the existing halt writer when absent or `isEmptyRegion`, else `writeRegionCapture`; discard the step's capture in the pre-dispatch hook from Task 6 when the owning step dispatches again.
4. Verify tests pass (GREEN).
5. Commit: "feat(conductor): capture an owning step's region on success"

**Done when:**
- the owning-step completion hook in `src/conductor/src/engine/conductor.ts`, when an owning step reports `done` with region content `Attested-By: security-bot`, persists a capture whose bytes equal the region bytes read from the body for that pull request URL and step key, as asserted by the capture test in `src/conductor/test/engine/pr-body-region-capture.test.ts`
- after a simulated process restart the resumed FINISH uses the persisted capture and issues zero body reads for capture, and a second dispatch of the owning step discards the first capture so the capture holds the second run's bytes and not the first run's, as asserted by the restart and re-dispatch capture tests
- when the owning step reports `done` with its region markers removed, with an empty region, or with a failed body read, no capture is persisted and the run halts with a reason naming the step and, respectively, a missing region, an empty region, or the failed read, and FINISH is not dispatched, as asserted by the three capture-halt tests
- when the owning step ends `failed` no capture is taken and no region halt is raised, as asserted by the failed-step capture test

**Files:**
- `src/conductor/src/engine/conductor.ts` — owning-step completion capture hook
- `src/conductor/test/engine/pr-body-region-capture.test.ts` — capture tests

**Dependencies:** Task 5, Task 6

### Task 8: Re-insert regions inside the authoring and judge-repair effects
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-finish-publication.test.ts` with a stubbed provider: authoring and judge repair that omit a region; two regions omitted; an altered region; a duplicated region; an unknown-format region; an intact region (zero edits, one judge dispatch); a refused re-insertion (halt, no ready call). Add an authoring-prompt assertion in `src/conductor/test/engine/step-runners.test.ts`.
2. Verify tests fail (RED).
3. Implement in `runFinishPublication` in `src/conductor/src/engine/conductor.ts`: after `dispatchAuthoring` and `dispatchJudgment` return, read the body, apply `restoreRegion` for every capture of this pull request, and write once through the guarded boundary only when the body changed — before the coordinator re-observes, so the judged revision already carries the regions. Replace the authoring instruction's release-metadata clause in `src/conductor/src/engine/step-runners.ts` with one telling the provider to leave every `ai-conductor:step` region unchanged.
4. Verify tests pass (GREEN).
5. Commit: "feat(finish): keep captured regions through prose authoring and repair"

**Done when:**
- `runFinishPublication` in `src/conductor/src/engine/conductor.ts` wraps `dispatchAuthoring` and `dispatchJudgment` so that, when the provider's body omits a captured region, the region is restored with bytes identical to its capture before the coordinator observes the revision, and the judged revision and the post-repair observed body each contain it, as asserted by the authoring and judge-repair re-insertion tests in `src/conductor/test/engine/conductor-finish-publication.test.ts`
- with captures for two steps and an authoring output omitting both, the observed body contains each region exactly once with bytes identical to its capture, and with a region whose text between markers was altered or written twice, the observed body contains it exactly once with the captured bytes and none of the altered text, as asserted by the two-region, altered-region, and duplicated-region tests
- a captured region holding `Compliance-Attestation: signed 2026-09-24` that authoring omits is restored byte-for-byte, and an authoring output that already carries every region intact causes zero re-insertion edits and exactly one judge dispatch for that revision, as asserted by the unknown-format and intact-region tests
- when the guarded GitHub operation boundary refuses the re-insertion edit, the run halts with a reason naming the region's step and the refusal and no ready-for-review call is issued, as asserted by the refused re-insertion test
- the authoring instruction in `src/conductor/src/engine/step-runners.ts` tells the provider to leave every `ai-conductor:step` region unchanged in place of preserving release metadata, as asserted by the authoring-prompt test in `src/conductor/test/engine/step-runners.test.ts`

**Files:**
- `src/conductor/src/engine/conductor.ts` — re-insertion around authoring and judge dispatch
- `src/conductor/src/engine/step-runners.ts` — authoring instruction
- `src/conductor/test/engine/conductor-finish-publication.test.ts` — re-insertion tests
- `src/conductor/test/engine/step-runners.test.ts` — prompt test

**Dependencies:** Task 5, Task 7

### Task 9: Restore and verify regions in the presentation repair before ready
**Story:** 5
**Story:** 6
**Story:** 8
**Type:** happy-path

**Steps:**
1. Write failing tests: in `src/conductor/test/engine/conductor-finish-repair.test.ts`, body-floor and halt-rehabilitation rewrites followed by region re-insertion; in `src/conductor/test/engine/finish-publication-production-wiring.test.ts`, the `ready_pr` presentation repair built by the production CLI and daemon composition roots (not a hand-built repair) verifies regions before `ensureShipReady`, restores an edited region then re-reads then readies in order, halts draft on a refused restore or a persistent mismatch, and with no captures issues exactly the pre-change operation sequence.
2. Verify tests fail (RED).
3. Implement in `createFinishPresentationRepair` in `src/conductor/src/engine/conductor.ts`: add a region restore-and-verify step after `bodyFloor` and before `ensureShipReady`, beside the existing `restoreReleaseMetadata` hook (that hook is removed only in Task 14, so this repository keeps its release block throughout the build) (restore via `restoreRegion`, one guarded write when changed, re-read and compare every capture); compose it into `createProvenanceGuardedFinishPresentationRepair` and both production roots in `src/conductor/src/index.ts` and `src/conductor/src/daemon-cli.ts`.
4. Verify tests pass (GREEN).
5. Commit: "feat(finish): verify captured regions before the ready flip"

**Done when:**
- `createFinishPresentationRepair` in `src/conductor/src/engine/conductor.ts` re-inserts every captured region after `rehabilitateHaltPr` and `bodyFloor`, so the body after a body-floor or halt-PR rehabilitation rewrite contains each region with bytes identical to its capture, as asserted by the floor and rehabilitation re-insertion tests in `src/conductor/test/engine/conductor-finish-repair.test.ts`
- the `ready_pr` presentation repair as composed by the production CLI and daemon composition roots re-reads the body and compares every region to its capture before `ensureShipReady`, marking the pull request ready when all match, and for a region edited after the last rewrite records one restore edit, then a matching re-read, then the ready-for-review call in that order, as asserted by the production-composition tests in `src/conductor/test/engine/finish-publication-production-wiring.test.ts`
- when the restore edit is refused, or the re-read after a restore still differs from the capture, the pull request stays draft, no ready-for-review call is issued, and the run halts with a reason naming the region's step and, for the second case, a verification mismatch, as asserted by the refused-restore and persistent-mismatch tests
- with no captured regions, the `ready_pr` presentation repair issues exactly the GitHub operation sequence it issued before this change and no region verification read, as asserted by the no-region operation-sequence test

**Files:**
- `src/conductor/src/engine/conductor.ts` — region restore-and-verify in presentation repair
- `src/conductor/src/index.ts` — production composition
- `src/conductor/src/daemon-cli.ts` — production composition
- `src/conductor/test/engine/conductor-finish-repair.test.ts` — re-insertion tests
- `src/conductor/test/engine/finish-publication-production-wiring.test.ts` — production-composition tests

**Dependencies:** Task 5, Task 7

### Task 10: Fail closed on region verification in the finish completion repair
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-finish-repair.test.ts`: with a capture, the completion repair verifies regions before its ready call; with a capture and a failed verification read, no ready call and a halt naming the step; with no capture, a gh outage still logs a warning and the finish step proceeds.
2. Verify tests fail (RED).
3. Implement in `src/conductor/src/engine/artifacts.ts` and `repairFinishPr` in `src/conductor/src/engine/conductor.ts`: add a flag, beside `releaseMetadataPreservationRequired` (removed in Task 14), set when this pull request has any region capture; with the flag set a verification failure is fatal, otherwise the repair stays warn-only.
4. Verify tests pass (GREEN).
5. Commit: "fix(finish): fail closed on region verification in completion repair"

**Done when:**
- the finish completion check in `src/conductor/src/engine/artifacts.ts` runs `repairFinishPr` with region verification before its ready-for-review call whenever a region capture exists, as asserted by the completion-repair verification test in `src/conductor/test/engine/conductor-finish-repair.test.ts`
- when a capture exists and the verification read fails, no ready-for-review call is issued and the run halts naming the region's step and the failed read, while with no capture a gh outage still logs a warning and lets the finish step proceed, as asserted by the failed-read halt and no-capture warn-only tests

**Files:**
- `src/conductor/src/engine/artifacts.ts` — capture-gated fail-closed completion repair
- `src/conductor/src/engine/conductor.ts` — repairFinishPr region verification
- `src/conductor/test/engine/conductor-finish-repair.test.ts` — completion repair tests

**Dependencies:** Task 9

### Task 11: Engine-owned sections write outside every region
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/finish-publication-production.test.ts`: a region containing `## Reduced build-review coverage` text stays byte-identical while the engine writes its one section outside it; a last-positioned region gets the section after its closing marker; accepted risk, the closing reference, and the plan declaration line are written beside a captured region without changing it.
2. Verify tests fail (RED).
3. Implement in `upsertReducedCoverageEvidence` in `src/conductor/src/engine/finish-publication-production.ts`: mask `ai-conductor:step` regions before searching for the heading, and append outside every region.
4. Verify tests pass (GREEN).
5. Commit: "fix(finish): keep engine sections outside step regions"

**Done when:**
- `upsertReducedCoverageEvidence` in `src/conductor/src/engine/finish-publication-production.ts` ignores any `## Reduced build-review coverage` text inside an `ai-conductor:step` region and writes its one section outside every region, after the closing marker when the region is last, leaving the region byte-identical, as asserted by the region-masked coverage tests in `src/conductor/test/engine/finish-publication-production.test.ts`
- with a captured region present, FINISH publication writes the reduced build-review coverage section, the accepted-risk section between its markers, the closing reference, and the plan declaration line, and the region stays byte-identical to its capture, as asserted by the engine-sections-beside-region test

**Files:**
- `src/conductor/src/engine/finish-publication-production.ts` — region-masked coverage upsert
- `src/conductor/test/engine/finish-publication-production.test.ts` — engine-section tests

**Dependencies:** Task 5

### Task 12: A repository with no regions keeps today's FINISH body
**Story:** 8
**Type:** negative-path

**Steps:**
1. Write failing tests in new `src/conductor/test/engine/pr-body-regions-baseline.test.ts` driving `runFinishPublication` with a stubbed authoring provider and the region inputs introduced by Tasks 4–9: an unmarked template and no template each produce the golden final body recorded from the engine at `c50ca7651` for the same inputs; no template writes no capture file and issues no verification read; unmarked step text omitted by authoring is not restored and raises no halt. The tests fail until the region inputs exist.
2. Verify tests fail (RED).
3. Implement only what the tests require to compose the region inputs as empty; no behavior change on the no-region path.
4. Verify tests pass (GREEN).
5. Commit: "test(finish): pin the no-region FINISH baseline"

**Done when:**
- with an unmarked template and with no template, FINISH publication driven through `runFinishPublication` with a stubbed authoring provider produces a final pull request body byte-identical to the golden body recorded from the engine at `c50ca7651` for the same inputs, as asserted by the two baseline tests in `src/conductor/test/engine/pr-body-regions-baseline.test.ts`
- the no-template run writes no `.pipeline/pr-body-region-captures.json` and issues zero region verification reads, as asserted by the no-template side-effect test
- with no region markers and a custom step that wrote unmarked text into the body, authoring that omits the text leaves it absent from the final body and raises no region halt, as asserted by the unmarked-contribution test

**Files:**
- `src/conductor/test/engine/pr-body-regions-baseline.test.ts` — no-region baseline tests

**Dependencies:** Task 4, Task 7, Task 8, Task 9, Task 11

### Task 13: Declare this repository's release-disposition region
**Story:** 9
**Type:** happy-path

**Steps:**
1. Write failing tests: in `src/conductor/test/engine/config.test.ts`, `loadConfig` on this repository's own config and template reports `release-disposition` as the region owner; in `src/conductor/test/engine/release-metadata.test.ts`, `parseReleaseDisposition` accepts a region-wrapped `note` disposition with a runnable migration fence followed by the closing marker; in `src/conductor/test/engine/release-candidates.test.ts`, `collectReleaseCandidates` reads the region-wrapped fields.
2. Verify tests fail (RED).
3. Implement: wrap `## Release metadata` and `## Migration` in `.github/pull_request_template.md` in one `release-disposition` region; update `.agents/skills/release-disposition/SKILL.md` step 4 to write only between its region markers and leave them in place.
4. Verify tests pass (GREEN).
5. Commit: "feat(release): declare the release-disposition pull request body region"

**Done when:**
- `.github/pull_request_template.md` wraps its `## Release metadata` and `## Migration` sections in one `release-disposition` region, and `loadConfig` on this repository's own `.ai-conductor/config.yml` and template succeeds with `release-disposition` as that region's owner, as asserted by the repository-template config test in `src/conductor/test/engine/config.test.ts`
- `parseReleaseDisposition` in `src/conductor/src/engine/release-metadata.ts` accepts a body whose `release-disposition` region holds a `note` disposition and a `## Migration` section with a runnable migration fence followed by the region's closing marker, returning that disposition and migration, as asserted by the region-wrapped parse test in `src/conductor/test/engine/release-metadata.test.ts`
- `collectReleaseCandidates` in `src/conductor/src/engine/release-candidates.ts` returns the category, semver, and note written inside the region of a merged pull request body, as asserted by the region-wrapped candidate test in `src/conductor/test/engine/release-candidates.test.ts`
- `.agents/skills/release-disposition/SKILL.md` names the `release-disposition` region markers as the write boundary for its release metadata and migration edits

**Files:**
- `.github/pull_request_template.md` — release-disposition region
- `.agents/skills/release-disposition/SKILL.md` — write inside the region
- `src/conductor/test/engine/config.test.ts` — repository template test
- `src/conductor/test/engine/release-metadata.test.ts` — region-wrapped parse test
- `src/conductor/test/engine/release-candidates.test.ts` — region-wrapped candidate test

**Dependencies:** Task 2

### Task 14: Retire the self-host Release-* snapshot
**Story:** 9
**Type:** refactor

**Steps:**
1. Write failing tests in new `src/conductor/test/engine/self-host/release-disposition-region.test.ts` for a self-host finish fixture: authoring drops every `Release-` line and the region is restored before the ready call with no release-gate halt; an empty region halts naming `release-disposition`; a stale `.pipeline/release-metadata-snapshot.json` never reaches the body.
2. Verify tests fail (RED).
3. Delete, following the code-removal skill: the snapshot, restore, persisted-snapshot, and supersede functions in `src/conductor/src/engine/self-host/release-metadata-flow.ts`; their `conductor.ts` call sites (the finish-dispatch snapshot, the supersede clear, `restoreFinishReleaseMetadata`, the `restoreReleaseMetadata` presentation-repair hook); the `releaseMetadataPreservationRequired` flag in `artifacts.ts`; `snapshotReleaseMetadataBlock` and `mergeReleaseMetadataBlock` in `src/conductor/src/engine/release-metadata.ts` once no caller remains; and `src/conductor/test/engine/self-host/release-metadata-snapshot.test.ts`. Keep release-flow activation and the self-host release gate's body validation.
4. Verify tests pass (GREEN).
5. Commit: "refactor(self-host): retire the Release-* snapshot in favor of regions"

**Done when:**
- in a self-host finish fixture whose authoring output drops every `Release-` line, the `release-disposition` region is restored to the step's written bytes before the ready-for-review call, the release metadata parser accepts the finished body, and the self-host release gate raises no halt, as asserted by the dropped-block test in `src/conductor/test/engine/self-host/release-disposition-region.test.ts`
- when `release-disposition` reports `done` with an empty region, the run halts with a reason naming `release-disposition` and an empty region, as asserted by the empty-release-region test
- with a stale `.pipeline/release-metadata-snapshot.json` holding a different block, the finished body holds the bytes captured from this run's step and contains no trace of the stale block, as asserted by the stale-snapshot test
- release-flow activation and the self-host release gate's body validation in `src/conductor/src/engine/self-host/release-metadata-flow.ts` keep passing their existing tests in `src/conductor/test/engine/self-host/release-metadata-flow.test.ts`, and FINISH preserves the release block only through the region captures

**Files:**
- `src/conductor/src/engine/self-host/release-metadata-flow.ts` — snapshot/restore removed
- `src/conductor/src/engine/conductor.ts` — snapshot call sites removed
- `src/conductor/src/engine/release-metadata.ts` — snapshot helpers removed
- `src/conductor/src/engine/artifacts.ts` — releaseMetadataPreservationRequired removed
- `src/conductor/test/engine/self-host/release-metadata-snapshot.test.ts` — removed with the snapshot
- `src/conductor/test/engine/self-host/release-metadata-flow.test.ts` — activation tests kept
- `src/conductor/test/engine/self-host/release-metadata-flow-wiring.test.ts` — call-site expectations updated
- `src/conductor/test/engine/self-host/release-disposition-region.test.ts` — region tests

**Dependencies:** Task 8, Task 9, Task 10, Task 13

### Task 15: Shipped pr and finish skills keep step regions intact
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Edit `skills/pr/SKILL.md`: where it says a floored body is replaced wholesale, state that every `ai-conductor:step` region and its markers stay unchanged.
2. Edit `skills/finish/SKILL.md`: replace the release-metadata preservation instruction with preserving every `ai-conductor:step` region.
3. Commit: "docs(skills): pr and finish keep step regions intact"

**Done when:**
- `skills/pr/SKILL.md` states that replacing a floored body leaves every `ai-conductor:step` region and its markers unchanged
- `skills/finish/SKILL.md` replaces its release-metadata preservation instruction with preserving every `ai-conductor:step` region

**Files:**
- `skills/pr/SKILL.md` — region-preserving body guidance
- `skills/finish/SKILL.md` — region-preserving finish guidance

**Dependencies:** none

## Task Dependency Graph

Task 2 ← Task 1; Task 3 ← Task 2; Task 4 ← Tasks 2, 3; Task 5 ← Task 1; Task 6 ← Tasks 2, 5; Task 7 ← Tasks 5, 6; Task 8 ← Tasks 5, 7; Task 9 ← Tasks 5, 7; Task 10 ← Task 9; Task 11 ← Task 5; Task 12 ← Tasks 4, 7, 8, 9, 11; Task 13 ← Task 2; Task 14 ← Tasks 8, 9, 10, 13; Task 15 independent.

## Integration Points

- After Task 2: `loadConfig` reports region owners or fails naming the step for any project.
- After Task 4: SHIP opens a template-seeded draft through both entry callers.
- After Task 7: an owning step's success produces a persisted capture or a halt naming it.
- After Task 9: the production `ready_pr` composition verifies regions before marking ready.
- After Task 14: this repository's release block survives FINISH through its region alone.

## Architecture Review Conditions

- Condition 1 (seeded floor) — Task 3. Condition 2 (re-insert before observation) — Task 8. Condition 3 (verify before every production ready flip) — Tasks 9 and 10. Condition 4 (no `Release-*` preservation code) — Task 14. Condition 5 (no-region byte-identical baseline) — Tasks 4 and 12.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a repository whose template wraps a section in markers naming custom step `compliance-attest`, and `compliance-attest` is declared under `steps:` and ordered before `finish`, when the project config loads, then loading succeeds and `compliance-attest` is recorded as the owner of that region. | 2 | "`loadConfig` in `src/conductor/src/engine/config.ts`, given `.github/pull_request_template.md` with a region naming a declared custom step ordered before `finish`, succeeds and reports that step as the region's owner in the loaded config, and given two regions naming two such steps succeeds with each step owning exactly its own region, as asserted by the region-owner config tests in `src/conductor/test/engine/config.test.ts`" | diff-local |
| Story 1 happy: Given a template with two regions naming two different declared custom steps ordered before `finish`, when the project config loads, then loading succeeds and each step owns exactly its own region. | 2 | "`loadConfig` in `src/conductor/src/engine/config.ts`, given `.github/pull_request_template.md` with a region naming a declared custom step ordered before `finish`, succeeds and reports that step as the region's owner in the loaded config, and given two regions naming two such steps succeeds with each step owning exactly its own region, as asserted by the region-owner config tests in `src/conductor/test/engine/config.test.ts`" | diff-local |
| Story 1 happy: Given a repository whose template contains no region markers, when the project config loads, then loading succeeds and no step owns a region. | 2 | "`loadConfig` succeeds with zero region owners for a template with no markers and for a repository whose only marked template is at the repository root rather than `.github/pull_request_template.md`, as asserted by the unmarked-template and root-template config tests" | diff-local |
| Story 1 happy: Given a repository with no file at `.github/pull_request_template.md` and a marked template at the repository root instead, when the project config loads, then loading succeeds and no step owns a region. | 2 | "`loadConfig` succeeds with zero region owners for a template with no markers and for a repository whose only marked template is at the repository root rather than `.github/pull_request_template.md`, as asserted by the unmarked-template and root-template config tests" | diff-local |
| Story 1 negative: Given a template region whose marker names built-in step `finish`, when the project config loads, then loading fails with an error naming the marker key `finish` and stating that built-in steps cannot own a region. | 2 | "`loadConfig` fails with an error naming the marker key and the broken rule for a region naming built-in step `finish` (built-in steps cannot own a region), an undeclared key `release-disposiiton` (undeclared step), and a declared step whose `after:` orders it after `finish` (a region owner must run before `finish`), as asserted by the three owner-rule config tests" | diff-local |
| Story 1 negative: Given a template region whose marker names `release-disposiiton` and no step of that name is declared, when the project config loads, then loading fails with an error naming `release-disposiiton` as an undeclared step. | 2 | "`loadConfig` fails with an error naming the marker key and the broken rule for a region naming built-in step `finish` (built-in steps cannot own a region), an undeclared key `release-disposiiton` (undeclared step), and a declared step whose `after:` orders it after `finish` (a region owner must run before `finish`), as asserted by the three owner-rule config tests" | diff-local |
| Story 1 negative: Given a template region naming a declared custom step whose `after:` places it after `finish`, when the project config loads, then loading fails with an error naming that step and stating that a region owner must run before `finish`. | 2 | "`loadConfig` fails with an error naming the marker key and the broken rule for a region naming built-in step `finish` (built-in steps cannot own a region), an undeclared key `release-disposiiton` (undeclared step), and a declared step whose `after:` orders it after `finish` (a region owner must run before `finish`), as asserted by the three owner-rule config tests" | diff-local |
| Story 1 negative: Given a template with two regions that both name `compliance-attest`, when the project config loads, then loading fails with an error naming `compliance-attest` as owning more than one region. | 2 | "`loadConfig` fails with an error naming the offending step key for the duplicate-key, unclosed, and nested (naming both keys) templates, and naming the step key and the engine-owned text it contains for the engine-owned-text template, as asserted by the four template-shape config tests" | diff-local |
| Story 1 negative: Given a template with an opening region marker and no closing marker, when the project config loads, then loading fails with an error naming the unclosed region's step key. | 2 | "`loadConfig` fails with an error naming the offending step key for the duplicate-key, unclosed, and nested (naming both keys) templates, and naming the step key and the engine-owned text it contains for the engine-owned-text template, as asserted by the four template-shape config tests" | diff-local |
| Story 1 negative: Given a template with a region opened inside another region, when the project config loads, then loading fails with an error naming both step keys as nested. | 2 | "`loadConfig` fails with an error naming the offending step key for the duplicate-key, unclosed, and nested (naming both keys) templates, and naming the step key and the engine-owned text it contains for the engine-owned-text template, as asserted by the four template-shape config tests" | diff-local |
| Story 1 negative: Given a template region whose content contains the heading `## Reduced build-review coverage` or the accepted-risk start marker, when the project config loads, then loading fails with an error naming the region's step key and the engine-owned text it contains. | 2 | "`loadConfig` fails with an error naming the offending step key for the duplicate-key, unclosed, and nested (naming both keys) templates, and naming the step key and the engine-owned text it contains for the engine-owned-text template, as asserted by the four template-shape config tests" | diff-local |
| Story 2 happy: Given a repository with a template, when SHIP opens the draft pull request, then the created body contains the engine floor marker, the template's bytes unchanged, the closing-reference placeholder comment, and the SHIP draft note. | 4 | "`openShipDraftPr` in `src/conductor/src/engine/ship-draft-pr.ts`, given the loaded config's template, issues a create invocation whose body contains the engine floor marker, the template's bytes unchanged, the closing-reference placeholder comment, and the SHIP draft note, as asserted by the seeded-create test in `src/conductor/test/engine/ship-draft-pr.test.ts`" | diff-local |
| Story 2 happy: Given a repository without a template, when SHIP opens the draft pull request, then the created body is byte-identical to the body SHIP creates today for the same feature description. | 4 | "given no template, the create invocation's body is byte-identical to the pre-change `shipDraftPrBody` output for the same feature description, as asserted by the no-template create test" | diff-local |
| Story 2 happy: Given a template-seeded draft whose body has not been authored, when FINISH observes the pull request, then the body is classified as the engine floor and prose authoring is selected. | 3 | "FINISH publication observation of an unauthored template-seeded draft reports the body as the engine floor and the coordinator selects `author_pr_prose`, as asserted by the seeded-draft selection test in `src/conductor/test/engine/finish-publication-production.test.ts`" | diff-local |
| Story 2 negative: Given a template-seeded draft whose template text exceeds 400 characters and no prose has been authored, when FINISH observes the pull request, then the body is still classified as the engine floor rather than authored prose. | 3 | "`isEngineFlooredBody` in `src/conductor/src/engine/halt-pr-rehabilitation.ts`, given a template-seeded draft whose template text exceeds 400 characters and no authored prose, returns `true` because `authoredProseLength` nets out the seeded template bytes, as asserted by the seeded-floor test in `src/conductor/test/engine/halt-pr-rehabilitation.test.ts`" | diff-local |
| Story 2 negative: Given a template-seeded draft into which authoring wrote 1,000 characters of prose while leaving the floor marker in place, when FINISH observes the pull request, then the body is classified as authored prose rather than the engine floor. | 3 | "the same classifier returns `false` for that draft with 1,000 characters of added prose and the floor marker left in place, classifying it as authored prose, as asserted by the seeded-authored test" | diff-local |
| Story 2 negative: Given a template whose own text contains a line identical to a floor placeholder, when SHIP seeds the draft and FINISH later observes it unauthored, then the body is classified as the engine floor and the template line is still present exactly once. | 4 | "given a template containing a line identical to a floor placeholder, the seeded body contains that template line exactly once and `isEngineFlooredBody` classifies the unauthored seeded body as the engine floor, as asserted by the placeholder-line seed test" | diff-local |
| Story 3 happy: Given a retained draft pull request whose body lacks the `compliance-attest` region, as a reused halt pull request does, when `compliance-attest` is about to dispatch, then the body gains the template's `compliance-attest` region exactly once and every other byte of the body is unchanged. | 6 | "the pre-dispatch region hook in `src/conductor/src/engine/conductor.ts`, for an owning step whose retained draft body lacks its region, issues exactly one guarded body edit whose result contains the template's region once and every other byte of the prior body unchanged, before dispatching the step, as asserted by the ensure-region test in `src/conductor/test/engine/pr-body-region-dispatch.test.ts`" | diff-local |
| Story 3 happy: Given a retained draft whose body already contains the `compliance-attest` region with content, when `compliance-attest` is about to dispatch, then no pull request body edit is issued and the region's content is unchanged. | 6 | "for an owning step whose body already holds its region with content, the hook issues zero body edits and leaves the region content unchanged, and for a step that owns no region the hook issues zero body reads and zero body edits, as asserted by the region-present and non-owner dispatch tests" | diff-local |
| Story 3 happy: Given a step that owns no region, when it is about to dispatch, then no pull request body read or edit is issued on its behalf. | 6 | "for an owning step whose body already holds its region with content, the hook issues zero body edits and leaves the region content unchanged, and for a step that owns no region the hook issues zero body reads and zero body edits, as asserted by the region-present and non-owner dispatch tests" | diff-local |
| Story 3 negative: Given a retained draft lacking the region and the guarded GitHub operation boundary refuses the body edit, when `compliance-attest` is about to dispatch, then the step is not dispatched and the run halts with a reason naming `compliance-attest` and the refusal. | 6 | "when the guarded edit is refused, the body read fails, or no retained draft exists because every early publish failed, the step is not dispatched and the run halts with a reason naming the step and, respectively, the refusal, the failed read, or the missing draft, and FINISH does not create the pull request, as asserted by the three pre-dispatch halt tests" | diff-local |
| Story 3 negative: Given the retained draft body cannot be read because GitHub is unavailable, when `compliance-attest` is about to dispatch, then the step is not dispatched and the run halts with a reason naming `compliance-attest` and the failed read. | 6 | "when the guarded edit is refused, the body read fails, or no retained draft exists because every early publish failed, the step is not dispatched and the run halts with a reason naming the step and, respectively, the refusal, the failed read, or the missing draft, and FINISH does not create the pull request, as asserted by the three pre-dispatch halt tests" | diff-local |
| Story 3 negative: Given no retained draft pull request exists for the branch because every early publish failed, when `compliance-attest` is about to dispatch, then the step is not dispatched and the run halts with a reason naming `compliance-attest` and the missing draft, rather than leaving FINISH to create the pull request. | 6 | "when the guarded edit is refused, the body read fails, or no retained draft exists because every early publish failed, the step is not dispatched and the run halts with a reason naming the step and, respectively, the refusal, the failed read, or the missing draft, and FINISH does not create the pull request, as asserted by the three pre-dispatch halt tests" | diff-local |
| Story 4 happy: Given `compliance-attest` reports `done` and its region holds `Attested-By: security-bot`, when the engine processes that completion, then a capture holding the region's exact bytes is persisted for that pull request and step key. | 7 | "the owning-step completion hook in `src/conductor/src/engine/conductor.ts`, when an owning step reports `done` with region content `Attested-By: security-bot`, persists a capture whose bytes equal the region bytes read from the body for that pull request URL and step key, as asserted by the capture test in `src/conductor/test/engine/pr-body-region-capture.test.ts`" | diff-local |
| Story 4 happy: Given a persisted capture and the conductor process restarts before FINISH, when the resumed run reaches FINISH, then the persisted capture is used and no new capture is taken from the current body. | 7 | "after a simulated process restart the resumed FINISH uses the persisted capture and issues zero body reads for capture, and a second dispatch of the owning step discards the first capture so the capture holds the second run's bytes and not the first run's, as asserted by the restart and re-dispatch capture tests" | diff-local |
| Story 4 happy: Given a persisted capture for `compliance-attest` and the step is dispatched again, when the second run reports `done` with different region content, then the capture holds the second run's bytes and not the first run's. | 7 | "after a simulated process restart the resumed FINISH uses the persisted capture and issues zero body reads for capture, and a second dispatch of the owning step discards the first capture so the capture holds the second run's bytes and not the first run's, as asserted by the restart and re-dispatch capture tests" | diff-local |
| Story 4 negative: Given `compliance-attest` reports `done` and its region markers have been removed from the body, when the engine processes that completion, then the run halts with a reason naming `compliance-attest` and a missing region, and FINISH is not dispatched. | 7 | "when the owning step reports `done` with its region markers removed, with an empty region, or with a failed body read, no capture is persisted and the run halts with a reason naming the step and, respectively, a missing region, an empty region, or the failed read, and FINISH is not dispatched, as asserted by the three capture-halt tests" | diff-local |
| Story 4 negative: Given `compliance-attest` reports `done` and its region is empty, when the engine processes that completion, then the run halts with a reason naming `compliance-attest` and an empty region, and FINISH is not dispatched. | 7 | "when the owning step reports `done` with its region markers removed, with an empty region, or with a failed body read, no capture is persisted and the run halts with a reason naming the step and, respectively, a missing region, an empty region, or the failed read, and FINISH is not dispatched, as asserted by the three capture-halt tests" | diff-local |
| Story 4 negative: Given `compliance-attest` reports `done` and the body read fails, when the engine processes that completion, then no capture is persisted and the run halts with a reason naming `compliance-attest` and the failed read. | 7 | "when the owning step reports `done` with its region markers removed, with an empty region, or with a failed body read, no capture is persisted and the run halts with a reason naming the step and, respectively, a missing region, an empty region, or the failed read, and FINISH is not dispatched, as asserted by the three capture-halt tests" | diff-local |
| Story 4 negative: Given `compliance-attest` ends `failed`, when the engine processes that outcome, then no capture is taken and no region halt is raised for it. | 7 | "when the owning step ends `failed` no capture is taken and no region halt is raised, as asserted by the failed-step capture test" | diff-local |
| Story 4 negative: Given a persisted capture recorded for a different pull request URL, when FINISH runs for the current pull request, then that capture is not used for the current pull request. | 5 | "`writeRegionCapture` and `readRegionCaptures` in `src/conductor/src/engine/pr-body-region-store.ts` persist captures in `.pipeline/pr-body-region-captures.json` keyed by pull request URL and step key, and a capture recorded for a different pull request URL is not returned for the current pull request, as asserted by the store tests in `src/conductor/test/engine/pr-body-region-store.test.ts`" | diff-local |
| Story 5 happy: Given a capture for `compliance-attest`, when prose authoring writes a body that omits the region, then the revision the prose judge evaluates contains the region with bytes identical to the capture. | 8 | "`runFinishPublication` in `src/conductor/src/engine/conductor.ts` wraps `dispatchAuthoring` and `dispatchJudgment` so that, when the provider's body omits a captured region, the region is restored with bytes identical to its capture before the coordinator observes the revision, and the judged revision and the post-repair observed body each contain it, as asserted by the authoring and judge-repair re-insertion tests in `src/conductor/test/engine/conductor-finish-publication.test.ts`" | diff-local |
| Story 5 happy: Given a capture, when the prose judge's repair rewrites the body without the region, then the body observed after the repair contains the region with bytes identical to the capture. | 8 | "`runFinishPublication` in `src/conductor/src/engine/conductor.ts` wraps `dispatchAuthoring` and `dispatchJudgment` so that, when the provider's body omits a captured region, the region is restored with bytes identical to its capture before the coordinator observes the revision, and the judged revision and the post-repair observed body each contain it, as asserted by the authoring and judge-repair re-insertion tests in `src/conductor/test/engine/conductor-finish-publication.test.ts`" | diff-local |
| Story 5 happy: Given a capture, when the body floor or halt pull request rehabilitation rewrites the body, then the body after that rewrite contains the region with bytes identical to the capture. | 9 | "`createFinishPresentationRepair` in `src/conductor/src/engine/conductor.ts` re-inserts every captured region after `rehabilitateHaltPr` and `bodyFloor`, so the body after a body-floor or halt-PR rehabilitation rewrite contains each region with bytes identical to its capture, as asserted by the floor and rehabilitation re-insertion tests in `src/conductor/test/engine/conductor-finish-repair.test.ts`" | diff-local |
| Story 5 happy: Given captures for two steps, when prose authoring omits both regions, then the resulting body contains each region exactly once with bytes identical to its capture. | 8 | "with captures for two steps and an authoring output omitting both, the observed body contains each region exactly once with bytes identical to its capture, and with a region whose text between markers was altered or written twice, the observed body contains it exactly once with the captured bytes and none of the altered text, as asserted by the two-region, altered-region, and duplicated-region tests" | diff-local |
| Story 5 happy: Given prose authoring already left the region intact, when the authoring effect completes, then no additional body edit is issued and the prose judge runs exactly once for that revision. | 8 | "a captured region holding `Compliance-Attestation: signed 2026-09-24` that authoring omits is restored byte-for-byte, and an authoring output that already carries every region intact causes zero re-insertion edits and exactly one judge dispatch for that revision, as asserted by the unknown-format and intact-region tests" | diff-local |
| Story 5 negative: Given a capture, when prose authoring keeps the region markers but changes the text between them, then the region is restored to the captured bytes and the altered text is gone. | 8 | "with captures for two steps and an authoring output omitting both, the observed body contains each region exactly once with bytes identical to its capture, and with a region whose text between markers was altered or written twice, the observed body contains it exactly once with the captured bytes and none of the altered text, as asserted by the two-region, altered-region, and duplicated-region tests" | diff-local |
| Story 5 negative: Given a capture, when prose authoring writes the region twice, then the resulting body contains the region exactly once with the captured bytes. | 8 | "with captures for two steps and an authoring output omitting both, the observed body contains each region exactly once with bytes identical to its capture, and with a region whose text between markers was altered or written twice, the observed body contains it exactly once with the captured bytes and none of the altered text, as asserted by the two-region, altered-region, and duplicated-region tests" | diff-local |
| Story 5 negative: Given a capture whose content is in a format the engine has never seen, such as `Compliance-Attestation: signed 2026-09-24`, when prose authoring omits it, then it is restored byte-for-byte like any other region. | 8 | "a captured region holding `Compliance-Attestation: signed 2026-09-24` that authoring omits is restored byte-for-byte, and an authoring output that already carries every region intact causes zero re-insertion edits and exactly one judge dispatch for that revision, as asserted by the unknown-format and intact-region tests" | diff-local |
| Story 5 negative: Given a capture, when the guarded GitHub operation boundary refuses the re-insertion edit, then the run halts with a reason naming the region's step and the refusal and the pull request is not marked ready. | 8 | "when the guarded GitHub operation boundary refuses the re-insertion edit, the run halts with a reason naming the region's step and the refusal and no ready-for-review call is issued, as asserted by the refused re-insertion test" | diff-local |
| Story 6 happy: Given every captured region is intact, when the production `ready_pr` publication transition runs, then the body is re-read, every region compares equal to its capture, and the pull request is marked ready. | 9 | "the `ready_pr` presentation repair as composed by the production CLI and daemon composition roots re-reads the body and compares every region to its capture before `ensureShipReady`, marking the pull request ready when all match, and for a region edited after the last rewrite records one restore edit, then a matching re-read, then the ready-for-review call in that order, as asserted by the production-composition tests in `src/conductor/test/engine/finish-publication-production-wiring.test.ts`" | diff-local |
| Story 6 happy: Given a region was edited after the last FINISH rewrite, when the production `ready_pr` publication transition runs, then the region is restored to its captured bytes, the re-read body compares equal, and only then is the pull request marked ready. | 9 | "the `ready_pr` presentation repair as composed by the production CLI and daemon composition roots re-reads the body and compares every region to its capture before `ensureShipReady`, marking the pull request ready when all match, and for a region edited after the last rewrite records one restore edit, then a matching re-read, then the ready-for-review call in that order, as asserted by the production-composition tests in `src/conductor/test/engine/finish-publication-production-wiring.test.ts`" | diff-local |
| Story 6 happy: Given every captured region is intact, when the finish completion repair runs, then regions are verified before its ready-for-review call. | 10 | "the finish completion check in `src/conductor/src/engine/artifacts.ts` runs `repairFinishPr` with region verification before its ready-for-review call whenever a region capture exists, as asserted by the completion-repair verification test in `src/conductor/test/engine/conductor-finish-repair.test.ts`" | diff-local |
| Story 6 negative: Given a region cannot be restored because the guarded edit is refused, when the production `ready_pr` publication transition runs, then the pull request stays draft and the run halts with a reason naming the region's step. | 9 | "when the restore edit is refused, or the re-read after a restore still differs from the capture, the pull request stays draft, no ready-for-review call is issued, and the run halts with a reason naming the region's step and, for the second case, a verification mismatch, as asserted by the refused-restore and persistent-mismatch tests" | diff-local |
| Story 6 negative: Given the re-read after a restore still differs from the capture, when the production `ready_pr` publication transition runs, then the pull request stays draft and the run halts with a reason naming the region's step and a verification mismatch. | 9 | "when the restore edit is refused, or the re-read after a restore still differs from the capture, the pull request stays draft, no ready-for-review call is issued, and the run halts with a reason naming the region's step and, for the second case, a verification mismatch, as asserted by the refused-restore and persistent-mismatch tests" | diff-local |
| Story 6 negative: Given the verification read fails, when the finish completion repair runs, then no ready-for-review call is issued and the run halts naming the region's step and the failed read. | 10 | "when a capture exists and the verification read fails, no ready-for-review call is issued and the run halts naming the region's step and the failed read, while with no capture a gh outage still logs a warning and lets the finish step proceed, as asserted by the failed-read halt and no-capture warn-only tests" | diff-local |
| Story 7 happy: Given a capture for `compliance-attest` and reduced build-review coverage to report, when FINISH publishes, then the body contains both the reduced build-review coverage section and the region with its captured bytes. | 11 | "with a captured region present, FINISH publication writes the reduced build-review coverage section, the accepted-risk section between its markers, the closing reference, and the plan declaration line, and the region stays byte-identical to its capture, as asserted by the engine-sections-beside-region test" | diff-local |
| Story 7 happy: Given a capture and accepted build-review risk, when FINISH publishes, then the accepted-risk section is written between its markers and the region is unchanged. | 11 | "with a captured region present, FINISH publication writes the reduced build-review coverage section, the accepted-risk section between its markers, the closing reference, and the plan declaration line, and the region stays byte-identical to its capture, as asserted by the engine-sections-beside-region test" | diff-local |
| Story 7 happy: Given a capture and a feature sourced from an intake issue, when the closing reference and plan declaration line are written, then both appear and the region is unchanged. | 11 | "with a captured region present, FINISH publication writes the reduced build-review coverage section, the accepted-risk section between its markers, the closing reference, and the plan declaration line, and the region stays byte-identical to its capture, as asserted by the engine-sections-beside-region test" | diff-local |
| Story 7 negative: Given a step wrote the text `## Reduced build-review coverage` inside its region at run time, when the engine upserts its reduced build-review coverage section, then the region's bytes are unchanged and the engine's section is written outside every region. | 11 | "`upsertReducedCoverageEvidence` in `src/conductor/src/engine/finish-publication-production.ts` ignores any `## Reduced build-review coverage` text inside an `ai-conductor:step` region and writes its one section outside every region, after the closing marker when the region is last, leaving the region byte-identical, as asserted by the region-masked coverage tests in `src/conductor/test/engine/finish-publication-production.test.ts`" | diff-local |
| Story 7 negative: Given a region is positioned last in the body, when the engine appends its reduced build-review coverage section, then the section is written after the region's closing marker and the region's bytes are unchanged. | 11 | "`upsertReducedCoverageEvidence` in `src/conductor/src/engine/finish-publication-production.ts` ignores any `## Reduced build-review coverage` text inside an `ai-conductor:step` region and writes its one section outside every region, after the closing marker when the region is last, leaving the region byte-identical, as asserted by the region-masked coverage tests in `src/conductor/test/engine/finish-publication-production.test.ts`" | diff-local |
| Story 8 happy: Given a repository whose template has no region markers, when a feature runs from SHIP through FINISH, then the final pull request body is byte-identical to the body today's engine produces for the same inputs. | 12 | "with an unmarked template and with no template, FINISH publication driven through `runFinishPublication` with a stubbed authoring provider produces a final pull request body byte-identical to the golden body recorded from the engine at `c50ca7651` for the same inputs, as asserted by the two baseline tests in `src/conductor/test/engine/pr-body-regions-baseline.test.ts`" | diff-local |
| Story 8 happy: Given a repository with no template, when a feature runs from SHIP through FINISH, then no region capture file is written and no region verification read is issued. | 12 | "the no-template run writes no `.pipeline/pr-body-region-captures.json` and issues zero region verification reads, as asserted by the no-template side-effect test" | diff-local |
| Story 8 negative: Given a repository with no region markers and a custom step that writes its own text into the body without markers, when FINISH prose authoring omits that text, then the text is not restored and no region halt is raised. | 12 | "with no region markers and a custom step that wrote unmarked text into the body, authoring that omits the text leaves it absent from the final body and raises no region halt, as asserted by the unmarked-contribution test" | diff-local |
| Story 8 negative: Given a repository with no region markers, when the production `ready_pr` publication transition runs, then it issues exactly the GitHub operations it issues today. | 9 | "with no captured regions, the `ready_pr` presentation repair issues exactly the GitHub operation sequence it issued before this change and no region verification read, as asserted by the no-region operation-sequence test" | diff-local |
| Story 9 happy: Given this repository's template wraps the release metadata and migration sections in a `release-disposition` region and the step writes a `note` disposition, when FINISH completes, then the body's region is byte-identical to what the step wrote. | 14 | "in a self-host finish fixture whose authoring output drops every `Release-` line, the `release-disposition` region is restored to the step's written bytes before the ready-for-review call, the release metadata parser accepts the finished body, and the self-host release gate raises no halt, as asserted by the dropped-block test in `src/conductor/test/engine/self-host/release-disposition-region.test.ts`" | diff-local |
| Story 9 happy: Given the step wrote a `note` disposition with a `## Migration` section holding a runnable migration fence, when the release metadata check parses the finished body, then it accepts the disposition and the migration. | 13 | "`parseReleaseDisposition` in `src/conductor/src/engine/release-metadata.ts` accepts a body whose `release-disposition` region holds a `note` disposition and a `## Migration` section with a runnable migration fence followed by the region's closing marker, returning that disposition and migration, as asserted by the region-wrapped parse test in `src/conductor/test/engine/release-metadata.test.ts`" | diff-local |
| Story 9 happy: Given a merged pull request whose body carries the region, when the release pull request workflow collects release candidates, then it reads the same category, semver, and note the step wrote. | 13 | "`collectReleaseCandidates` in `src/conductor/src/engine/release-candidates.ts` returns the category, semver, and note written inside the region of a merged pull request body, as asserted by the region-wrapped candidate test in `src/conductor/test/engine/release-candidates.test.ts`" | diff-local |
| Story 9 negative: Given prose authoring rewrites the body without any `Release-` lines, when FINISH reaches the ready flip, then the region is restored before the pull request is marked ready and the self-host release gate does not halt. | 14 | "in a self-host finish fixture whose authoring output drops every `Release-` line, the `release-disposition` region is restored to the step's written bytes before the ready-for-review call, the release metadata parser accepts the finished body, and the self-host release gate raises no halt, as asserted by the dropped-block test in `src/conductor/test/engine/self-host/release-disposition-region.test.ts`" | diff-local |
| Story 9 negative: Given `release-disposition` reports `done` and its region is empty, when the engine processes that completion, then the run halts with a reason naming `release-disposition` and an empty region. | 14 | "when `release-disposition` reports `done` with an empty region, the run halts with a reason naming `release-disposition` and an empty region, as asserted by the empty-release-region test" | diff-local |
| Story 9 negative: Given a `.pipeline/release-metadata-snapshot.json` left by an earlier engine version holds a different block, when FINISH restores regions, then the region holds the bytes captured from this run's step and the stale file's block does not appear in the body. | 14 | "with a stale `.pipeline/release-metadata-snapshot.json` holding a different block, the finished body holds the bytes captured from this run's step and contains no trace of the stale block, as asserted by the stale-snapshot test" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-24-project-owned-pr-body-regions#D1 | task | task-2 | succeeds with zero region owners for a template with no markers and for a repository whose only marked template is at the repository root |
| adr-2026-09-24-project-owned-pr-body-regions#D2 | task | task-2 | fails with an error naming the marker key and the broken rule |
| adr-2026-09-24-project-owned-pr-body-regions#D3 | task | task-4 | issues a create invocation whose body contains the engine floor marker, the template's bytes unchanged |
| adr-2026-09-24-project-owned-pr-body-regions#D4 | task | task-6 | issues exactly one guarded body edit whose result contains the template's region once |
| adr-2026-09-24-project-owned-pr-body-regions#D5 | task | task-7 | persists a capture whose bytes equal the region bytes read from the body |
| adr-2026-09-24-project-owned-pr-body-regions#D6 | task | task-8, task-9 | the region is restored with bytes identical to its capture before the coordinator observes the revision |
| adr-2026-09-24-project-owned-pr-body-regions#D7 | task | task-9, task-10 | re-reads the body and compares every region to its capture before `ensureShipReady` |
| adr-2026-09-24-project-owned-pr-body-regions#D8 | task | task-11 | writes its one section outside every region |
| adr-2026-09-24-project-owned-pr-body-regions#D9 | task | task-13, task-14 | FINISH preserves the release block only through the region captures |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] Every task has a `Done when:` block of falsifiable checks naming its mechanism
- [x] Dependencies are explicit and acyclic
- [x] No task directs an amendment to another feature's sealed artifact
