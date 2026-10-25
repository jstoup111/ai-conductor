# Implementation Plan: per-feature artifact manifest and one lookup (#3405, spec 1 of 3)

**Date:** 2026-10-25
**Source:** jstoup111/ai-conductor#3405
**Design:** technical track, no PRD. `.docs/track/decide-artifacts-are-too-repetitive-for-people-to-.md`, `.docs/architecture/decide-artifacts-are-too-repetitive-for-people-to-.md`, `.docs/decisions/adr-2026-10-24-per-feature-artifact-manifest.md`
**Stories:** .docs/stories/decide-artifacts-are-too-repetitive-for-people-to-.md
**Conflict check:** Clean as of 2026-10-25 (`.docs/conflicts/decide-artifacts-are-too-repetitive-for-people-to-.md`)

## Summary

Adds a committed per-feature artifact manifest, written by composer land. Every reader of a landed
feature's DECIDE artifacts resolves through it first, and runs today's code unchanged when there is
none. Daemon discovery finds specs by manifest. 17 tasks in three slices. No artifact file moves.

## Technical Approach

- **One module, `src/conductor/src/engine/feature-manifest.ts`.**
  - Closed `ArtifactKind` union, `FeatureScopedKind` (all kinds except `decision` and `architecture`), and branded `FeatureSlug` and `DocsPath` types.
  - `parseFeatureManifest(raw, manifestPath, folderSlug)` returns `{ kind: 'parsed', manifest }` or `{ kind: 'malformed', manifestPath, reason }`.
  - `renderFeatureManifest(manifest)` sorts entries by kind, then path, and emits two-space JSON with a trailing newline.
  - `featureManifestPath(slug)` returns `.docs/<slug>/manifest.json`.
  - `MANIFEST_KIND_LOCATIONS` (`satisfies Record<ArtifactKind, …>`) maps each kind to its legacy directory and identity strategy. `STEP_ARTIFACT_CONTRACTS` is not changed (ADR decision 5).
- **One lookup.** `resolveFeatureArtifact(source, slug, kind, legacy)`:
  - `source` is a `ManifestSource` (`readFile`, `exists`) with three adapters: working tree, git ref, and the backlog `BacklogTreeSource`.
  - Manifest present: returns `{ origin: 'manifest', paths, missing }`. It never calls `legacy`.
  - No manifest: returns `{ origin: 'legacy', paths: await legacy() }`.
  - Malformed manifest: throws `MalformedFeatureManifestError`, naming the manifest path and the reason.
  - Each routed reader passes its existing resolution expression as `legacy`, unchanged, and keeps its existing identity key as `slug` (plan stem, `feature_desc` or spec-branch slug; ADR decision 4, assumption A3).
- **Seams first, then hard-coded readers.** `resolveArtifactFiles` gains the rung only for contract patterns that map to a feature-scoped kind (prd, stories, conflict_check, plan, coherence_check). The architecture-review, plan-review, ADR, architecture and run patterns keep today's ladder. Then `resolveFeaturePlanPath`, `resolveFeatureStoriesPath`, `resolveFeaturePrdPaths` and a new async `resolveFeatureStoriesRef` replace the plan-line-only `resolvePlanStoriesPath` at its non-land callers. After that, the hard-coded readers are routed in four groups.
- **Not routed, by decision.**
  - Land and the pre-land DECIDE gates: `land-spec.ts`, `coherence-validator.ts`, `coherence-waiver.ts`, `plan-review-gate.ts`, `plan-review-runner.ts` and `outcome-staging.ts`. They read the change set the manifest is rebuilt from (ADR decision 5).
  - Shipped, halted and release-waiver evidence readers (ADR decision 3), path classifiers, and whole-directory enumerators.
- **Writer.** Land builds the manifest from `featureFiles` plus the change set's non-deleted `.docs/decisions/adr-*.md`, through the pure classifier `buildFeatureManifest`, after every gate and the intake marker, and immediately before its `git add -- .docs`.
  - It replaces any existing manifest.
  - It returns the added entries.
  - `dispatchEngineer` `'land'` emits `feature_artifacts_registered` through the same `ConductorEventEmitter` and `EventPersister` pattern it uses for `land_dependency_decided`.
- **Discovery.** `discoverBacklog` enumerates manifest slugs from a new `BacklogTreeSource.listFeatureManifests()` over the existing `prefetchDocs` listing, alongside `listPlanFiles()`, de-duplicated by slug. For a manifest-backed candidate:
  - The processed, shipped and parked checks run first.
  - It then parses the manifest and reads the listed plan.
  - It then reads stories, complexity, track, applicability, coherence and intake through `resolveFeatureArtifact`.
  - Blocked reasons gain `malformed-manifest`.
- **Test pattern.** Daemon discovery tests build an in-memory `BacklogTreeSource` (search hint: `daemon-backlog.test.ts` fake tree helpers). Land tests use a real temporary git worktree fixture (search hint: `land-gate-rejection.test.ts`, `land-spec-adr-assumption-ledger.test.ts`).
  - Every routing task asserts, for its reader group, that each reader returns the manifest path when the manifest lists a non-legacy path, and the same path or paths with no manifest and with a manifest listing legacy paths.

## Prerequisites

- None. No migration, config key or service.

## Slices

| Slice | Title | Tasks |
| --- | --- | --- |
| 1 | Manifest format and land writer | 1, 2, 3, 4, 5, 6 |
| 2 | One lookup and routed readers | 7, 8, 9, 10, 11, 12, 13, 14 |
| 3 | Manifest-backed discovery | 15, 16, 17 |

## Tasks

### Task 1: Parse a valid manifest into typed entries

**Story:** Story 1
**Type:** happy-path
**Dependencies:** none
**Files:** `src/conductor/src/engine/feature-manifest.ts`, `src/conductor/test/engine/feature-manifest.test.ts`

**Steps:**
1. Write failing tests in `feature-manifest.test.ts` for every Done-when check below; verify RED.
2. Implement `ArtifactKind`, `FeatureScopedKind`, `FeatureSlug`, `DocsPath`, `FeatureManifest`, `featureManifestPath`, and the accepting branch of `parseFeatureManifest(raw, manifestPath, folderSlug)` returning `{ kind: 'parsed', manifest }`.
3. Verify GREEN and commit.

**Done when:**
- [test] `parseFeatureManifest` on `.docs/f/manifest.json` with `schemaVersion` 1, `slug` `f`, one `plan` entry and one entry of each other kind under `.docs/` returns `kind: 'parsed'` with every entry's kind and path.
- [test] A manifest with two `decision` entries in the ADR folder parses with both entries returned.
- [test] `featureManifestPath('f')` returns `.docs/f/manifest.json`.

### Task 2: Render a manifest deterministically

**Story:** Story 1
**Type:** happy-path
**Dependencies:** Task 1
**Files:** `src/conductor/src/engine/feature-manifest.ts`, `src/conductor/test/engine/feature-manifest.test.ts`

**Steps:**
1. Write failing tests for every Done-when check below; verify RED.
2. Implement `renderFeatureManifest(manifest)`: sort entries by kind, then path; emit `JSON.stringify(…, null, 2)` plus a trailing newline; no other fields.
3. Verify GREEN and commit.

**Done when:**
- [test] `renderFeatureManifest` given the same entries in two different orders returns byte-identical strings whose entries are sorted by kind, then by path.
- [test] The rendered text parses back through `parseFeatureManifest` to the same entries and contains only the `schemaVersion`, `slug` and `artifacts` keys.

### Task 3: Reject every malformed manifest with a named reason

**Story:** Story 1
**Type:** negative-path
**Dependencies:** Task 1
**Files:** `src/conductor/src/engine/feature-manifest.ts`, `src/conductor/test/engine/feature-manifest.test.ts`

**Steps:**
1. Write failing tests for every Done-when check below; verify RED.
2. Implement the rejecting branches of `parseFeatureManifest`, each returning `{ kind: 'malformed', manifestPath, reason }`. Use exhaustive `switch` over `ArtifactKind`, with no default case.
3. Verify GREEN and commit.

**Done when:**
- [test] `parseFeatureManifest` returns `malformed` with a reason naming the unsupported schema version for `schemaVersion` 2, and naming the unknown kind `notes` for an entry of kind `notes`.
- [test] It returns `malformed` naming the unknown field for a top-level `updatedAt` and for an entry field other than `kind` and `path`.
- [test] It returns `malformed` naming the path as outside `.docs/` for `src/x.md` and for `.docs/../x.md`, and naming the path as outside the ADR folder for a `decision` entry pointing at the legacy plan file of `x`.
- [test] It returns `malformed` naming both `f` and `g` for `.docs/f/manifest.json` whose `slug` is `g`, and naming the plan entry count for zero and for two `plan` entries.
- [test] It returns `malformed` whose reason names the manifest path for text that is not valid JSON.

### Task 4: Build a manifest from a land change set

**Story:** Story 3
**Type:** happy-path
**Dependencies:** Tasks 1, 2
**Files:** `src/conductor/src/engine/feature-manifest.ts`, `src/conductor/test/engine/feature-manifest-build.test.ts`

**Steps:**
1. Write failing tests for every Done-when check below; verify RED.
2. Implement `buildFeatureManifest(slug, featureFiles, changedAdrPaths)`. It classifies each path through `MANIFEST_KIND_LOCATIONS` and lists each ADR path in the ADR folder as `decision`. It skips `.docs/plan-review/`, `.docs/shipped/`, `.docs/halted/`, `.docs/release-waivers/`, the manifest itself, and any path no kind matches.
3. Verify GREEN and commit.

**Done when:**
- [test] `buildFeatureManifest('f', …)` over the plan, stories, track, complexity, conflicts, coherence, the architecture document of `f` and `.docs/intake/f.md` lists each under its kind (`architecture` and `intake` included) and lists the ADR `adr-x` as `decision`.
- [test] Paths under `.docs/plan-review/`, `.docs/shipped/`, `.docs/halted/`, `.docs/release-waivers/`, and `.docs/f/manifest.json` itself are absent from the built manifest.
- [test] `MANIFEST_KIND_LOCATIONS` has exactly one entry per `ArtifactKind`, enforced by `satisfies Record<ArtifactKind, …>`.

### Task 5: Land writes and commits the rebuilt manifest

**Story:** Story 3
**Type:** happy-path
**Dependencies:** Task 4
**Files:** `src/conductor/src/engine/engineer/land-spec.ts`, `src/conductor/test/engine/engineer/land-spec-manifest.test.ts`

**Steps:**
1. Write failing tests in a temporary git worktree fixture for every Done-when check below; verify RED.
2. In `landSpec`, after `writeIntakeMarker` and before `git add -- .docs`, build the manifest from `featureFiles`, the intake marker path when written, and the change set's present ADR paths. Write `renderFeatureManifest` output to `.docs/<planStem>/manifest.json`, replacing any existing file. Return the added entries on the land result.
3. Verify GREEN and commit.

**Done when:**
- [test] `landSpec` on a worktree authoring plan, stories, track, complexity, conflicts, coherence, the feature architecture document and one amended ADR makes a commit containing `.docs/<slug>/manifest.json` listing each file under its kind and the ADR as `decision`.
- [test] When `landSpec` writes the intake marker, the committed manifest lists that marker as `intake`; a plan-review record present in the worktree is not listed.
- [test] A second `landSpec` on the unchanged worktree leaves the manifest bytes unchanged, and its result reports no added entries.
- [test] Re-running `landSpec` after an ADR deletion and after deleting the complexity file commits a manifest with no `decision` entry for that ADR and no complexity entry.
- [test] A pre-existing worktree manifest that lists a missing path, fails to parse, or names a different slug is replaced by `landSpec` with the manifest built from the current change set, and land does not refuse.

### Task 6: Land emits `feature_artifacts_registered`

**Story:** Story 3
**Type:** happy-path
**Dependencies:** Task 5
**Files:** `src/conductor/src/types/events.ts`, `src/conductor/src/engine/event-sinks.ts`, `src/conductor/src/engine/engineer-cli.ts`, `src/conductor/test/engine/engineer/engineer-cli-land-manifest-event.test.ts`

**Steps:**
1. Write failing tests through `dispatchEngineer` `'land'` for every Done-when check below; verify RED.
2. Add `{ type: 'feature_artifacts_registered'; slug: string; added: { kind: ArtifactKind; path: string }[] }` to the `ConductorEvent` union, and add an `EVENT_SINKS` entry with `persist: true` and every other sink false.
3. After a successful land with a non-empty `added`, emit through a `ConductorEventEmitter` and an `EventPersister` on `<canonical>/.pipeline/composer-events.jsonl`, as `land_dependency_decided` does.
4. Verify GREEN and commit.

**Done when:**
- [test] A `dispatchEngineer` `'land'` run that adds manifest entries appends exactly one `feature_artifacts_registered` line to `.pipeline/composer-events.jsonl`, naming the slug and each added kind and path.
- [test] A second `'land'` run on the unchanged worktree appends no `feature_artifacts_registered` line.
- The event type is part of `ConductorEvent` and has an `EVENT_SINKS` entry, so `tsc --noEmit` passes.

### Task 7: One lookup through the manifest

**Story:** Story 2
**Type:** happy-path
**Dependencies:** Task 1
**Files:** `src/conductor/src/engine/feature-manifest.ts`, `src/conductor/src/engine/feature-manifest-source.ts`, `src/conductor/test/engine/feature-manifest-lookup.test.ts`

**Steps:**
1. Write failing tests for every Done-when check below; verify RED.
2. Implement `ManifestSource` with three adapters: `worktreeManifestSource(root)`, `gitRefManifestSource(root, ref)` and `backlogTreeManifestSource(tree)`. Then implement `resolveFeatureArtifact(source, slug, kind, legacy)` and `MalformedFeatureManifestError`, as in Technical Approach.
3. Verify GREEN and commit.

**Done when:**
- [test] With a manifest listing `stories` at the legacy stories file of `f`, `resolveFeatureArtifact` returns `origin: 'manifest'` with exactly that path; with `stories` at `.docs/f/2-stories.md` and the legacy stories file also present, it returns `[.docs/f/2-stories.md]` and the `legacy` callback is never invoked.
- [test] With no manifest it returns `origin: 'legacy'` with exactly the paths the `legacy` callback returned.
- [test] With a manifest listing no `prd` entry and the legacy PRD file of `f` present, resolving `prd` returns no paths and never invokes `legacy`.
- [test] With an unparseable manifest and legacy files present, it throws `MalformedFeatureManifestError` whose message names `.docs/f/manifest.json` and the parse failure, and `legacy` is never invoked.
- [test] With manifests for `a` and `b`, resolving `a`'s plan returns only `a`'s listed plan; a listed `coherence` path absent from the tree yields `missing` naming that path, with no `legacy` call, for each of the three source adapters.

### Task 8: Kind table for every manifest kind

**Story:** Story 2
**Type:** infrastructure
**Dependencies:** Task 7
**Files:** `src/conductor/src/engine/feature-manifest.ts`, `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/engine/feature-manifest-lookup.test.ts`

**Steps:**
1. Write failing tests for every Done-when check below; verify RED.
2. Implement `contractPatternKind(step, pattern)`, mapping the prd, stories, conflict_check, plan and coherence_check contract patterns to their feature-scoped kind and every other pattern to `null`. Leave `STEP_ARTIFACT_CONTRACTS` unchanged.
3. Verify GREEN and commit.

**Done when:**
- [test] `contractPatternKind` returns `prd`, `stories`, `conflicts`, `plan` and `coherence` for those steps' patterns, and `null` for the architecture_review, architecture_diagram, plan_review, assess and every run-scoped pattern.
- [test] `MANIFEST_KIND_LOCATIONS` gives legacy locations for track, complexity, intake, applicability and coherence-waiver, and `STEP_ARTIFACT_CONTRACTS` deep-equals its pre-change value (snapshot of the step-to-pattern map).

### Task 9: `resolveArtifactFiles` consults the manifest for feature-scoped kinds

**Story:** Story 2
**Type:** happy-path
**Dependencies:** Task 8
**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/engine/artifacts-manifest.test.ts`

**Steps:**
1. Write failing tests through `checkStepCompletion` and `getArtifactStatus` for every Done-when check below; verify RED.
2. In `resolveArtifactFiles`, for each contract pattern whose `contractPatternKind` is non-null, resolve through `resolveFeatureArtifact`. The slug is the plan stem of `activePlanPath`, else of `planPath`, else `featureDesc`, and the existing ladder is the `legacy` callback. Every other pattern runs the existing ladder unchanged.
3. Verify GREEN and commit.

**Done when:**
- [test] With a manifest for `f` listing its plan at `.docs/f/2-machine/tasks.md`, `checkStepCompletion` for `plan` reports that file and `getArtifactStatus` shows it for `f`.
- [test] With a manifest listing one `decision` and one `architecture` entry, `checkStepCompletion` for `architecture_review` and `architecture_diagram` resolves the same files it resolves with no manifest, including the architecture-review record and the whole ADR and architecture corpora, and the no-manifest result equals the pre-change file list fixed as the test's expected value.
- [test] With a manifest and a plan-review record in the worktree, `checkStepCompletion` for `plan_review` resolves the same record it resolves with no manifest, and the no-manifest result equals the pre-change result fixed as the test's expected value.
- [test] With no manifest, and with a manifest listing the legacy paths, `checkStepCompletion` and `getArtifactStatus` for prd, stories, conflict_check, plan and coherence_check each resolve the same files as before this change (fixed as the test's expected values), and feature A's file never satisfies feature B (two-feature fixture).

### Task 10: Feature resolvers and the Stories reference read the manifest

**Story:** Story 2
**Type:** happy-path
**Dependencies:** Task 9
**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/src/engine/plan-stories-reference.ts`, `src/conductor/src/engine/rebase.ts`, `src/conductor/src/engine/prd-audit-projection.ts`, `src/conductor/src/engine/task-progress.ts`, `src/conductor/src/engine/coverage-binding-decide-set.ts`, `src/conductor/src/engine/build-review-inputs.ts`, `src/conductor/src/engine/as-built-projection.ts`, `src/conductor/test/engine/feature-resolvers-manifest.test.ts`

**Steps:**
1. Write failing tests for every Done-when check below; verify RED.
2. Give `resolveFeaturePlanPath`, `resolveFeatureStoriesPath` and `resolveFeaturePrdPaths` a manifest rung through `resolveFeatureArtifact`, with their current bodies as `legacy`.
3. Add async `resolveFeatureStoriesRef(source, planRepoPath, planContent)`: the manifest `stories` entry when present, otherwise `resolvePlanStoriesPath`. Switch the callers in `rebase`, `prd-audit-projection`, `task-progress`, `coverage-binding-decide-set`, `build-review-inputs` and `as-built-projection` to it.
4. Verify GREEN and commit.

**Done when:**
- [test] With a manifest listing `stories` at the legacy stories file of `f` and a plan whose `**Stories:**` line names the stories file of `other`, `resolveFeatureStoriesRef` and `resolveFeatureStoriesPath` return the stories file of `f`.
- [test] With a manifest listing non-legacy paths, `resolveFeaturePlanPath`, `resolveFeatureStoriesPath` and `resolveFeaturePrdPaths` return the listed paths; with a manifest listing no `prd`, `resolveFeaturePrdPaths` returns `[]` although the legacy PRD file of `f` exists.
- [test] With no manifest, and with a manifest listing legacy paths, each of the three resolvers, and `resolveFeatureStoriesRef` as called by the six switched modules, returns the same path or paths as before this change.
- [test] With a malformed manifest, `resolveFeaturePlanPath` rejects with `MalformedFeatureManifestError` naming the manifest path and returns no legacy plan.

### Task 11: Route conduct and BUILD readers

**Story:** Story 2
**Type:** refactor
**Dependencies:** Task 10
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/rebase.ts`, `src/conductor/src/engine/step-runners.ts`, `src/conductor/src/engine/coverage-binding-decide-set.ts`, `src/conductor/src/engine/artifacts.ts`, `src/conductor/src/engine/routing/owner-derivation.ts`, `src/conductor/test/engine/manifest-routing-conduct.test.ts`

**Steps:**
1. Write failing parity tests for every Done-when check below; verify RED.
2. Wrap each hard-coded read in `resolveFeatureArtifact(worktreeManifestSource(root), slug, kind, () => <existing expression>)`, keeping each reader's identity key:
   - `Conductor.resolveIntakeSourceRef` and `Conductor.resolveTrack`, plus the intake, applicability, track and stories reads in `conductor.ts`
   - `rebase.resolveReviewInputs` coherence and per-identity reads
   - `runCoverageBinding` complexity
   - `resolveCoverageBindingDecideSet` prd
   - `coherenceArtifactHasCriterionRows`
   - `owner-derivation` `readCommittedPlanText`
3. Verify GREEN and commit.

**Done when:**
- [test] For each listed reader, a fixture with no manifest yields the path, content and parsed result the reader produced before this change (fixed as the test's expected values), and a fixture whose manifest lists the legacy paths yields the same (track, intake Source-Ref, applicability, tier, coherence rows, plan text).
- [test] For each listed reader, a manifest listing the kind at `.docs/f/<name>.md` makes the reader read that file, and a manifest omitting the kind makes the reader behave as if the artifact were absent.
- [test] A malformed manifest makes `Conductor.resolveTrack` and `runCoverageBinding` fail naming the manifest path rather than reading the legacy file.

### Task 12: Route SHIP, finish and prd_audit readers

**Story:** Story 2
**Type:** refactor
**Dependencies:** Task 10
**Files:** `src/conductor/src/engine/prd-audit-projection.ts`, `src/conductor/src/engine/finish-publication-production.ts`, `src/conductor/src/engine/finish-presentation-repair.ts`, `src/conductor/src/engine/run-provenance.ts`, `src/conductor/src/engine/ship-draft-pr.ts`, `src/conductor/src/engine/remote-git-operations.ts`, `src/conductor/test/engine/manifest-routing-ship.test.ts`

**Steps:**
1. Write failing parity tests for every Done-when check below; verify RED.
2. Wrap each read in `resolveFeatureArtifact`, using `gitRefManifestSource` where the reader reads at a ref:
   - `buildPrdAuditProjection` coherence
   - `sealedChildPresentation` stories
   - `createFinishPresentationRepair` intake
   - `resolveRunSourceRef` intake
   - `createShipDraftPublicationDependencies` intake
   - `resolveFeatureRemoteMutation` intake
3. Verify GREEN and commit.

**Done when:**
- [test] For each listed reader, no manifest yields the path and parsed result the reader produced before this change (fixed as the test's expected values), and a manifest listing the legacy paths yields the same (coherence rows, stories bytes, Source-Ref).
- [test] For each listed reader, a manifest listing the kind at `.docs/f/<name>.md`, at the ref the reader reads, makes it read that file, and a manifest omitting the kind makes it behave as if the artifact were absent.
- [test] For the ref-reading readers, the manifest is read at the same ref as the artifact, not from the working tree.

### Task 13: Route daemon dispatch and operator readers

**Story:** Story 2
**Type:** refactor
**Dependencies:** Task 7
**Files:** `src/conductor/src/daemon-cli.ts`, `src/conductor/src/engine/owner-gate/provenance.ts`, `src/conductor/src/engine/daemon-park-cli.ts`, `src/conductor/src/engine/park-reconciliation.ts`, `src/conductor/src/engine/monitor/halt-inventory.ts`, `src/conductor/src/engine/daemon-halt-pr-operations.ts`, `src/conductor/test/engine/manifest-routing-daemon.test.ts`

**Steps:**
1. Write failing parity tests for every Done-when check below; verify RED.
2. Wrap each read in `resolveFeatureArtifact`, keyed by the slug each already uses:
   - `daemon-cli` `createWorkOrder` and `readMergeTime` plan and stories
   - `readSpecOwnerStamp` intake
   - `daemon-park-cli` `validateSlug` plan existence
   - `reconcileParkedFeatures` intake
   - `halt-inventory` `readSourceRef`
   - `createDaemonHaltPrOperations` intake
3. Verify GREEN and commit.

**Done when:**
- [test] For each listed reader, no manifest yields the result the reader produced before this change (fixed as the test's expected values), and a manifest listing the legacy paths yields the same (work-order plan and stories paths, merge time, owner stamp, park slug validity, Source-Ref).
- [test] For each listed reader, a manifest listing the kind at `.docs/f/<name>.md` makes the reader use that file, and `validateSlug` accepts a slug whose manifest lists a plan at a non-legacy path.
- [test] A malformed manifest makes `createWorkOrder` fail naming the manifest path instead of building a work order from legacy paths.

### Task 14: Route engineer CLI spec-branch readers

**Story:** Story 2
**Type:** refactor
**Dependencies:** Task 7
**Files:** `src/conductor/src/engine/engineer-cli.ts`, `src/conductor/src/engine/engineer/intake/overlap-sources.ts`, `src/conductor/test/engine/engineer/manifest-routing-engineer.test.ts`

**Steps:**
1. Write failing parity tests for every Done-when check below; verify RED.
2. Wrap `featureMarkerForSpecBranch` (intake, plan) and `traceBranchIssue` (intake at `spec/<slug>`) in `resolveFeatureArtifact`, with `gitRefManifestSource` at the branch they already read.
3. Verify GREEN and commit.

**Done when:**
- [test] `featureMarkerForSpecBranch` and `traceBranchIssue` return, with no manifest, the intake Source-Ref and plan they returned before this change (fixed as the test's expected values), and the same with a manifest listing the legacy paths on `spec/<slug>`.
- [test] With a manifest on `spec/<slug>` listing the intake marker at `.docs/f/intake.md`, both read that file, and with a manifest omitting `intake` both report no Source-Ref.

### Task 15: Discovery finds specs by manifest

**Story:** Story 4
**Type:** happy-path
**Dependencies:** Task 7
**Files:** `src/conductor/src/engine/backlog-tree-source.ts`, `src/conductor/src/engine/daemon-backlog.ts`, `src/conductor/test/engine/daemon-backlog-manifest.test.ts`

**Steps:**
1. Write failing `discoverBacklog` tests over an in-memory tree for every Done-when check below; verify RED.
2. Add `listFeatureManifests()` to `BacklogTreeSource`, with `gitTreeSource` answering from the existing `prefetchDocs` listing of `.docs/*/manifest.json`. Build the candidate set as manifest slugs plus `listPlanFiles()` stems, de-duplicated by slug.
3. For a manifest-backed candidate, read the plan, stories, complexity, track, applicability, coherence and intake through `resolveFeatureArtifact(backlogTreeManifestSource(tree), …)`.
4. Verify GREEN and commit.

**Done when:**
- [test] With `.docs/f/manifest.json` listing plan, stories, coherence, complexity, track and intake at today's paths, `discoverBacklog` returns `f` as an eligible item whose `planPath` and `storiesPath` are the listed paths, and each of those artifacts is read from its listed path (fake tree read log).
- [test] With both `.docs/f/manifest.json` and the legacy plan file of `f` on the default branch, `f` appears exactly once across eligible, blocked and gated items.
- [test] With no manifest on the default branch, the eligible, blocked and gated items and the logged warnings equal those of the same tree run through `discoverBacklog` before this change (fixture corpus snapshot).

### Task 16: Discovery blocks malformed manifests after dedup

**Story:** Story 4
**Type:** negative-path
**Dependencies:** Task 15
**Files:** `src/conductor/src/engine/daemon-backlog.ts`, `src/conductor/test/engine/daemon-backlog-manifest.test.ts`

**Steps:**
1. Write failing tests for every Done-when check below; verify RED.
2. Add `'malformed-manifest'` to `BlockedSpecItem['reason']`. For manifest candidates, run `isProcessed`, the shipped-record match and `isOperatorParked` before parsing the manifest; catch `MalformedFeatureManifestError` and `block` with a remedy naming the manifest path.
3. Verify GREEN and commit.

**Done when:**
- [test] An unparseable `.docs/f/manifest.json` makes `discoverBacklog` return a blocked item for `f` with reason `malformed-manifest` and a remedy naming `.docs/f/manifest.json`, while another valid candidate in the same tree is returned eligible.
- [test] A shipped, a processed and a parked slug, each with an unparseable manifest, are skipped with no blocked item, and the manifest parse is never attempted for them (fake tree read log shows no manifest read).

### Task 17: Discovery coherence and abandoned plans read through the manifest

**Story:** Story 4
**Type:** negative-path
**Dependencies:** Task 15
**Files:** `src/conductor/src/engine/daemon-backlog.ts`, `src/conductor/test/engine/daemon-backlog-manifest.test.ts`

**Steps:**
1. Write failing tests for every Done-when check below; verify RED.
2. Make the non-S coherence check read the manifest `coherence` entry for manifest-backed candidates and keep `.docs/coherence/<slug>.md` otherwise. A manifest candidate whose listed plan is absent from the tree is skipped with no `block` and no `warnOnce`.
3. Verify GREEN and commit.

**Done when:**
- [test] A manifest-backed tier M candidate whose manifest lists no `coherence` entry is blocked with reason `missing-coherence`, and a legacy tier M candidate without `.docs/coherence/<slug>.md` is still blocked `missing-coherence`.
- [test] A manifest whose listed plan is absent from the tree yields no eligible, blocked or gated item for that slug and no warning line.

## Task Dependency Graph

```
1 ─┬─ 2 ─┐
   ├─ 3  ├─ 4 ── 5 ── 6
   └─────┘
1 ── 7 ─┬─ 8 ── 9 ── 10 ─┬─ 11
        │                └─ 12
        ├─ 13
        ├─ 14
        └─ 15 ─┬─ 16
               └─ 17
```

## Integration Points

- After Task 6: `ai-conductor compose land` commits a manifest and records the registration event.
- After Task 9: step completion and the dashboard honor a manifest.
- After Task 17: a merged manifest-backed spec is discovered and dispatched by the daemon.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-24-per-feature-artifact-manifest#D1 | task | task-2 | `renderFeatureManifest` given the same entries in two different orders returns byte-identical strings whose entries are sorted by kind, then by path. |
| adr-2026-10-24-per-feature-artifact-manifest#D2 | task | task-3 | It returns `malformed` naming both `f` and `g` for `.docs/f/manifest.json` whose `slug` is `g`, and naming the plan entry count for zero and for two `plan` entries. |
| adr-2026-10-24-per-feature-artifact-manifest#D3 | task | task-4 | Paths under `.docs/plan-review/`, `.docs/shipped/`, `.docs/halted/`, `.docs/release-waivers/`, and `.docs/f/manifest.json` itself are absent from the built manifest. |
| adr-2026-10-24-per-feature-artifact-manifest#D4 | task | task-5 | makes a commit containing `.docs/<slug>/manifest.json` listing each file under its kind and the ADR as `decision` |
| adr-2026-10-24-per-feature-artifact-manifest#D5 | task | task-7, task-9 | With a manifest listing one `decision` and one `architecture` entry, `checkStepCompletion` for `architecture_review` and `architecture_diagram` resolves the same files it resolves with no manifest, including the architecture-review record and the whole ADR and architecture corpora, and the no-manifest result equals the pre-change file list fixed as the test's expected value. |
| adr-2026-10-24-per-feature-artifact-manifest#D6 | task | task-5, task-6 | A `dispatchEngineer` `'land'` run that adds manifest entries appends exactly one `feature_artifacts_registered` line to `.pipeline/composer-events.jsonl`, naming the slug and each added kind and path. |
| adr-2026-10-24-per-feature-artifact-manifest#D7 | no-change | none | Defers drift checks and manifest protection to spec 2; this spec adds no drift refusal. |
| adr-2026-10-24-per-feature-artifact-manifest#D8 | task | task-15, task-16 | With both `.docs/f/manifest.json` and the legacy plan file of `f` on the default branch, `f` appears exactly once across eligible, blocked and gated items. |
| adr-2026-10-24-per-feature-artifact-manifest#D9 | task | task-11 | a fixture whose manifest lists the legacy paths yields the same (track, intake Source-Ref, applicability, tier, coherence rows, plan text). |
| adr-2026-10-24-per-feature-artifact-manifest#D10 | no-change | none | Records the three-spec split; spec 2 and spec 3 are filed as intakes after this spec lands. |
| adr-2026-07-28-feature-aware-artifact-resolution#D1 | task | task-8 | `STEP_ARTIFACT_CONTRACTS` deep-equals its pre-change value (snapshot of the step-to-pattern map) |
| adr-2026-07-28-feature-aware-artifact-resolution#D2 | task | task-9 | With a manifest listing one `decision` and one `architecture` entry, `checkStepCompletion` for `architecture_review` and `architecture_diagram` resolves the same files it resolves with no manifest, including the architecture-review record and the whole ADR and architecture corpora, and the no-manifest result equals the pre-change file list fixed as the test's expected value. |
| adr-2026-07-28-feature-aware-artifact-resolution#D3 | task | task-9 | With a manifest for `f` listing its plan at `.docs/f/2-machine/tasks.md`, `checkStepCompletion` for `plan` reports that file and `getArtifactStatus` shows it for `f`. |
| adr-2026-07-28-feature-aware-artifact-resolution#D4 | task | task-9 | With a manifest for `f` listing its plan at `.docs/f/2-machine/tasks.md`, `checkStepCompletion` for `plan` reports that file and `getArtifactStatus` shows it for `f`. |
| adr-2026-07-28-feature-aware-artifact-resolution#D5 | task | task-9 | feature A's file never satisfies feature B (two-feature fixture) |
| adr-2026-07-26-daemon-decide-preseed-ownership#D1 | existing | none | `PRESEEDED_DONE` is already derived from `ALL_STEPS` DECIDE phase membership; this spec does not touch preseeding. |
| adr-2026-07-26-daemon-decide-preseed-ownership#D2 | existing | none | Preseeded steps are already stamped `skipped` or `done` by tier; unchanged here. |
| adr-2026-07-26-daemon-decide-preseed-ownership#D3 | task | task-17 | A manifest-backed tier M candidate whose manifest lists no `coherence` entry is blocked with reason `missing-coherence`, and a legacy tier M candidate without `.docs/coherence/<slug>.md` is still blocked `missing-coherence`. |
| adr-2026-07-26-daemon-decide-preseed-ownership#D4 | no-change | none | Task 17 changes only where the discovery coherence check reads from; the check stays shallow and full validation stays at land. |
| adr-2026-07-26-daemon-decide-preseed-ownership#D5 | existing | none | Engineer authoring already runs `coherence_check` for M and L tiers; unchanged here. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic

### Task rem-as-built-6: Have land-spec.ts report whether the manifest bytes changed (separately from added entries) and make engineer-cli.ts emit feature_artifacts_registered for any changed manifest, staying silent on unchanged re-land; add a deletion-only re-land test in engineer-cli-land-manifest-event.test.ts
**Gate:** as-built
**Rationale:** Verified at land-spec.ts:915-917 and engineer-cli.ts:1656: land rewrites the manifest but reports only additions, and the CLI emits only when additions are non-empty. A deletion-only re-land therefore changes the manifest with no feature_artifacts_registered event, which ADR D6 requires. Task 6 owns the land event emission and its unchanged-re-land silence criterion.
**Governing clause:** adr-2026-10-24-per-feature-artifact-manifest decision 6
**Done when:**
- adr-2026-10-24-per-feature-artifact-manifest decision 6 is satisfied by this task.
- The repair for task rem-as-built-6 is committed and its targeted tests pass.
**Child:** 1
**Round:** r1

### Task rem-prd-audit-10: Restore the activePlanPath→featureDesc→featureIdentities fall-through in resolveFeaturePrdPaths legacy branch (artifacts.ts) and add a no-manifest test where the PRD stem differs from the plan stem (test/engine/feature-resolvers-manifest.test.ts)
**Gate:** prd-audit
**Rationale:** Verified at artifacts.ts:1091-1097: the legacy branch of resolveFeaturePrdPaths picks one rung with a nested ternary. It no longer falls through from activePlanPath to featureDesc to featureIdentities when a rung finds no match. That breaks Task 10's no-manifest parity criterion. Separately, the legacy git-show catch in remote-git-operations.ts/ship-draft-pr.ts readCommittedRecords returns [], which changes provenance-unreadable/timeout into missing-provenance. That breaks Task 12's parity for those ref readers. Both are implementation drift against approved architecture, so the existing tasks admit the fixes.
**Criterion:** S2.3
**Parent task:** 10
**Done when:**
- [test] S2.3 is satisfied by this task.
- The repair for task rem-prd-audit-10 is committed and its targeted tests pass.
**Child:** 2
**Round:** r1
### Task rem-prd-audit-12: Stop readCommittedRecords in remote-git-operations.ts and ship-draft-pr.ts from swallowing legacy git-show failures, so readMutationProvenance again reports provenance-unreadable/provenance-timeout; add parity tests in manifest-routing-ship.test.ts
**Gate:** prd-audit
**Rationale:** Verified at artifacts.ts:1091-1097: the legacy branch of resolveFeaturePrdPaths picks one rung with a nested ternary. It no longer falls through from activePlanPath to featureDesc to featureIdentities when a rung finds no match. That breaks Task 10's no-manifest parity criterion. Separately, the legacy git-show catch in remote-git-operations.ts/ship-draft-pr.ts readCommittedRecords returns [], which changes provenance-unreadable/timeout into missing-provenance. That breaks Task 12's parity for those ref readers. Both are implementation drift against approved architecture, so the existing tasks admit the fixes.
**Criterion:** S2.3
**Parent task:** 10
**Done when:**
- [test] S2.3 is satisfied by this task.
- The repair for task rem-prd-audit-12 is committed and its targeted tests pass.
**Child:** 2
**Round:** r1
### Task rem-prd-audit-11: Rethrow MalformedFeatureManifestError (naming the manifest path) instead of reporting absence in artifacts.ts coherenceArtifactHasCriterionRows, conductor.ts:1397 reader, and routing/owner-derivation.ts readCommittedPlanText; add malformed-manifest tests in manifest-routing-conduct.test.ts
**Gate:** prd-audit
**Rationale:** ADR D5 requires an explicit malformed-manifest failure. The seven routed readers catch-all and report absence. Confirmed at artifacts.ts:2108 (coherenceArtifactHasCriterionRows has a bare catch returning false). Each site belongs to the routing task that owns it: artifacts.ts, conductor.ts and owner-derivation.ts are Task 11; finish-presentation-repair.ts and run-provenance.ts are Task 12; halt-inventory.ts is Task 13; overlap-sources.ts is Task 14. This is conforming implementation work with no architectural decision open.
**Governing clause:** adr-2026-10-24-per-feature-artifact-manifest decision 5
**Done when:**
- adr-2026-10-24-per-feature-artifact-manifest decision 5 is satisfied by this task.
- The repair for task rem-prd-audit-11 is committed and its targeted tests pass.
**Child:** 2
**Round:** r1
### Task rem-prd-audit-13: Rethrow MalformedFeatureManifestError in monitor/halt-inventory.ts readSourceRef; add malformed-manifest test in manifest-routing-daemon.test.ts
**Gate:** prd-audit
**Rationale:** ADR D5 requires an explicit malformed-manifest failure. The seven routed readers catch-all and report absence. Confirmed at artifacts.ts:2108 (coherenceArtifactHasCriterionRows has a bare catch returning false). Each site belongs to the routing task that owns it: artifacts.ts, conductor.ts and owner-derivation.ts are Task 11; finish-presentation-repair.ts and run-provenance.ts are Task 12; halt-inventory.ts is Task 13; overlap-sources.ts is Task 14. This is conforming implementation work with no architectural decision open.
**Governing clause:** adr-2026-10-24-per-feature-artifact-manifest decision 5
**Done when:**
- adr-2026-10-24-per-feature-artifact-manifest decision 5 is satisfied by this task.
- The repair for task rem-prd-audit-13 is committed and its targeted tests pass.
**Child:** 2
**Round:** r1
### Task rem-prd-audit-14: Rethrow MalformedFeatureManifestError in engineer/intake/overlap-sources.ts reader; add malformed-manifest test in manifest-routing-engineer.test.ts
**Gate:** prd-audit
**Rationale:** ADR D5 requires an explicit malformed-manifest failure. The seven routed readers catch-all and report absence. Confirmed at artifacts.ts:2108 (coherenceArtifactHasCriterionRows has a bare catch returning false). Each site belongs to the routing task that owns it: artifacts.ts, conductor.ts and owner-derivation.ts are Task 11; finish-presentation-repair.ts and run-provenance.ts are Task 12; halt-inventory.ts is Task 13; overlap-sources.ts is Task 14. This is conforming implementation work with no architectural decision open.
**Governing clause:** adr-2026-10-24-per-feature-artifact-manifest decision 5
**Done when:**
- adr-2026-10-24-per-feature-artifact-manifest decision 5 is satisfied by this task.
- The repair for task rem-prd-audit-14 is committed and its targeted tests pass.
**Child:** 2
**Round:** r1
