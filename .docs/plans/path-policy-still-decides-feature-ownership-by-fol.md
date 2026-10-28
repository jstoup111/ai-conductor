# Implementation Plan: path policy decides feature ownership from the artifact manifest (#3418, spec 2 of 3)

**Date:** 2026-10-28
**Design:** `adr-2026-10-28-path-policy-reads-feature-ownership-from-manifest`
**Stories:** .docs/stories/path-policy-still-decides-feature-ownership-by-fol.md
**Conflict check:** Clean as of 2026-10-28 (`.docs/conflicts/path-policy-still-decides-feature-ownership-by-fol.md`)

## Summary

Every `.docs/` path policy decides a manifest-backed feature's ownership from one engine-computed
result instead of folder and basename matching. The result also stops runs on manifest drift,
protects the manifest against every tool, gives the operator a registration command, and retires
the manifest on prune. 23 tasks in three stacked slices.

## Technical Approach

- **One ownership module.** `src/conductor/src/engine/feature-ownership.ts` exports
  `computeFeatureOwnership(source, slug, baseRef)`. It returns a discriminated union:
  - `legacy`
  - `manifest`: owned paths, protected paths and the manifest path
  - `malformed`: the spec 1 parser reason
  - `drift`: entries `{ path, reason: 'missing' | 'unlisted' }`

  It reuses `parseFeatureManifest`, `MANIFEST_KIND_LOCATIONS` and the `feature-manifest-source.ts`
  sources. Unlisted detection runs `git diff --name-status --diff-filter=A <merge-base>..HEAD`
  plus untracked files, where `<merge-base>` is the merge base of HEAD with the feature's base
  branch. Only in-scope paths count. `renderOwnershipRefusal` renders the one refusal reason every
  caller uses. The slug comes from the same derivation `resolveArtifactFiles` uses: active plan
  stem, then plan stem, then `feature_desc`.
- **Step boundary.** The BUILD/SHIP step-entry block in `conductor.ts`, the place that already
  verifies the seal, calls the module first. A `malformed` or `drift` result reuses the existing
  `refusal: { kind: 'seal' }` path and its HALT-at-attempt-2 rule. `performRebase` and the restack
  seal checks call it before they move HEAD.
- **Seal.** `protected-artifact-seal.ts` takes the protected set from ownership:
  - the five folders, plus listed `plan`, `stories`, `prd`, `architecture` and `decision` paths,
    plus the manifest
  - this set is used for creation, inspection and every rotation

  Self-amendment becomes listed-path membership for manifest-backed features, and `namesOwnFeature`
  stays for legacy ones. A manifest change is always a violation. Reseal accepts listed
  protected-kind paths and refuses the manifest.
- **Marker and hooks.** `writePhaseMarker` adds `own:` and `protect:` lines. The generated
  pre-commit hook in `git-hook-assets.ts` uses them when present and falls back to its stem rule
  otherwise. In the hook, and in the docs write guard (`session-hook-assets.ts`, regenerated into
  `hooks/claude/docs-guard.sh` by `src/conductor/src/tools/generate-docs-guard-hook.ts`), an
  `allow:` entry without a trailing `/` matches exactly.
- **Invalidation and rebase.**
  - `resolveReviewInputs` (`rebase.ts`) and the review-document predicate in `gate-invalidation.ts`
    use listed paths and the manifest for manifest-backed features.
  - `docsKeepBothResolver` declines manifest conflicts.
  - `resolveRebaseConflicts`, the single model-driven resolver behind both the daemon rebase step
    and auto-resolve Tier 2, stops as needs-human on any manifest conflict.
- **build_review.**
  - `assembleBuildReviewInputs` excludes `.docs/*/manifest.json` from the graded diff.
  - `classifyTautologyPaths` treats listed artifacts and manifests as non-production.
- **Registration.** `src/conductor/src/engine/register-artifact-cli.ts` follows `reseal-cli.ts`:
  - it resolves `.worktrees/<slug>`, gates on a TTY, records audit events on the worktree spine,
    and offers an optional `--clear-halt`
  - it validates, renders through `renderFeatureManifest`, and commits with
    `CONDUCT_ENGINE_COMMIT=1`
  - it rotates the seal with trigger `operator-register` and emits `feature_artifacts_registered`
  - the CLI command table and the pre-pipeline dispatch register it beside `reseal`
- **Prune.** `DOCS_RETENTION_POLICY` gains a kind axis. `resolveDocsPruneSelection` reads each
  shipped stem's manifest from `origin/main`. `readPlanOrPruned` reads the plan path from the
  manifest at the deleting commit's parent.
- **Fixture notation.** Task steps and checks write fixture paths inside protected folders with an
  angle-bracketed segment, such as `.docs/stories/<extra>.md` for the fixture file
  `.docs/stories/extra.md`, so the plan's protected-target scan does not read a test fixture as a
  BUILD target. Each placeholder stands for the literal fixture name inside its brackets.
- **Legacy.** Every policy keeps its existing branch when the result is `legacy`. Each legacy
  criterion is asserted in the task that owns that policy.
- **Release.** The new CLI verb is additive. The finish step's release metadata covers it (a
  `bin/conduct CLI` surface), and no consumer migration action is needed.

## Prerequisites

- Spec 1 (`feature-manifest.ts`, `feature-manifest-source.ts`, the land manifest write) is on main.

## Slices

| Slice | Title | Tasks |
| --- | --- | --- |
| 1 | Ownership, drift stop, seal, hook and allowlist | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 |
| 2 | Invalidation, rebase and build_review scope | 13, 14, 15, 16, 17 |
| 3 | Registration and prune | 18, 19, 20, 21, 22, 23 |

## Tasks

### Task 1: Compute one ownership result with two-way drift
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/feature-ownership.realgit.test.ts` for every Done-when check below, using isolated local git repositories.
2. Verify the tests fail (RED).
3. Implement `computeFeatureOwnership` and `renderOwnershipRefusal` in `src/conductor/src/engine/feature-ownership.ts`. Reuse `parseFeatureManifest` and `MANIFEST_KIND_LOCATIONS`. Feature-added paths are `--diff-filter=A` paths between the merge base of HEAD with the base branch and HEAD, plus untracked paths. In-scope paths are those a manifest kind classifies, or any path under `.docs/<slug>/`, excluding the manifest, `.docs/plan-review/`, `.docs/shipped/`, `.docs/halted/` and `.docs/release-waivers/`.
4. Verify the tests pass (GREEN).
5. Commit.

**Done when:**
- [test] `computeFeatureOwnership` returns `drift` listing `{ path: '.docs/coherence/f.md', reason: 'missing' }` when that listed file is absent, `{ reason: 'unlisted' }` for a committed unlisted `.docs/stories/<extra>.md` and for an untracked `.docs/f/notes.md`, and all three entries in one result when the three cases are combined.
- [test] `computeFeatureOwnership` returns `manifest` with no drift when the feature added only `src/x.ts` and `.docs/release-waivers/f.md`, when a stacked child's base branch (its parent) added `.docs/stories/<p>.md`, and when the feature rebased onto a base branch that added `.docs/stories/<other>.md`.
- [test] `computeFeatureOwnership` returns `legacy` when `.docs/<slug>/manifest.json` is absent, without running any git diff, and returns `malformed` carrying the parser reason naming both `f` and `g` for a manifest whose slug differs from its folder.
- [test] `renderOwnershipRefusal` renders one reason that names every drift path with its own reason, saying "restore the file" for a missing path and naming `ai-conductor register-artifact` for an unlisted path.

**Files:** src/conductor/src/engine/feature-ownership.ts, src/conductor/test/engine/feature-ownership.realgit.test.ts

**Dependencies:** none

### Task 2: Refuse a BUILD or SHIP step on drift or a malformed manifest
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-ownership-refusal.test.ts` for every Done-when check below, driving the conductor step-entry path.
2. Verify the tests fail (RED).
3. Implement: in the BUILD/SHIP step-entry block of `conductor.ts`, call `computeFeatureOwnership` before `verifyProtectedArtifactSeal`. On `drift` or `malformed`, set `protectedArtifactIssue` to `renderOwnershipRefusal`, so the existing `refusal: { kind: 'seal' }` and attempt-2 HALT path applies.
4. Verify the tests pass (GREEN).
5. Commit.

**Done when:**
- [test] A manifest-backed BUILD step whose listed `.docs/coherence/f.md` is missing, or that committed an unlisted `.docs/stories/<extra>.md`, returns a result with `refusal.kind` `seal` whose reason contains each path, "restore the file" for the missing one and `ai-conductor register-artifact` for the unlisted one, and no provider dispatch occurs.
- [test] A manifest-backed SHIP step with an untracked unlisted `.docs/f/notes.md` is refused with a reason naming `.docs/f/notes.md` as unlisted with the `ai-conductor register-artifact` remedy; a step with one missing and two unlisted paths is refused once with all three paths in the reason, each with its own missing or unlisted reason.
- [test] A manifest whose slug differs from its folder refuses the step with the parser reason, and `verifyProtectedArtifactSeal` is not called for that attempt, so no folder or stem rule decides ownership.
- [test] On the second refused attempt, `writeHaltMarker` is called with `PROTECTED_ARTIFACT_HALT_CLASS` and text containing each disagreeing path.
- [test] These BUILD steps all dispatch with no ownership refusal: a manifest-backed step with no drift, one whose feature added only `src/x.ts` and `.docs/release-waivers/f.md`, a stacked child whose parent base branch added `.docs/stories/<p>.md`, and a legacy feature that added `.docs/stories/<extra>.md`. The legacy case computes no drift.

**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/conductor-ownership-refusal.test.ts

**Dependencies:** Task 1

### Task 3: Refuse rebase and restack before HEAD moves on drift
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/rebase.test.ts` and `src/conductor/test/engine/restack/restack-ownership-drift.test.ts` for every Done-when check below.
2. Verify the tests fail (RED).
3. Implement: call `computeFeatureOwnership` in `performRebase` before the pre-rebase seal check, and at the restack seal checks in `restack-executor.ts` and `restack-move.ts`. Refuse with the `renderOwnershipRefusal` reason.
4. Verify the tests pass (GREEN).
5. Commit.

**Done when:**
- [test] `performRebase` for a manifest-backed feature with drift refuses with a reason naming each disagreeing path, and HEAD's sha after the call equals its sha before the call.
- [test] The restack executor and restack move seal checks refuse a manifest-backed child with drift with the same reason, and move no ref.

**Files:** src/conductor/src/engine/rebase.ts, src/conductor/src/engine/restack/restack-executor.ts, src/conductor/src/engine/restack/restack-move.ts, src/conductor/test/engine/rebase.test.ts, src/conductor/test/engine/restack/restack-ownership-drift.test.ts

**Dependencies:** Task 1

### Task 4: Seal listed protected-kind paths and judge self-amendment by membership
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/protected-artifact-seal-ownership.realgit.test.ts` for every Done-when check below.
2. Verify the tests fail (RED).
3. Implement: `createProtectedArtifactSeal` and `inspectSeal` take their protected set from the ownership result. That set is the five folders, plus listed `plan`, `stories`, `prd`, `architecture` and `decision` paths, plus the manifest. For a manifest-backed feature, a changed sealed path is a self-amendment only when it is a listed protected-kind path, not the manifest. `namesOwnFeature` stays the rule for legacy features.
4. Verify the tests pass (GREEN).
5. Commit.

**Done when:**
- [test] For a manifest listing `stories` at `.docs/f/review/stories.md`, the created seal's `protectedArtifacts` contain that path with its fingerprint, and do not contain the listed `coherence` path.
- [test] `inspectSeal` reports a changed listed `.docs/plans/<f>.md` in `selfAmendments` with `ok: true`, so the step-entry check lets the step proceed.
- [test] For manifest-backed `f`, `inspectSeal` returns `ok: false` with `Protected artifact changed: .docs/stories/<f>-old.md` when that unlisted same-stem file changed, and `selfAmendments` does not contain it.
- [test] For a legacy feature `f`, a changed `.docs/plans/<f>.md` is still a self-amendment through `namesOwnFeature`, and the sealed set is exactly the five folders' files.

**Files:** src/conductor/src/engine/protected-artifact-seal.ts, src/conductor/test/engine/protected-artifact-seal-ownership.realgit.test.ts

**Dependencies:** Task 1

### Task 5: Protect the manifest in the seal against any tool
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/protected-artifact-seal-manifest.realgit.test.ts` for every Done-when check below. Make each manifest change through a plain file write and `git commit --no-verify`, with no tool hook involved.
2. Verify the tests fail (RED).
3. Implement: keep the manifest out of the self-amendment branch of `inspectSeal`. For a seal without a manifest entry, rely on the existing not-in-seal provenance branch (`inheritedFromBase`).
4. Verify the tests pass (GREEN).
5. Commit.

**Done when:**
- [test] At first BUILD entry for a manifest-backed feature, the created seal contains `.docs/<slug>/manifest.json` with its sha256 fingerprint, and a later `inspectSeal` with the manifest unchanged returns `ok: true` with no entry naming it.
- [test] A manifest changed and committed with `--no-verify`, or changed and left uncommitted, makes the step-entry seal check fail with `Protected artifact changed: .docs/<slug>/manifest.json`, and `selfAmendments` never contains the manifest.
- [test] For a seal lacking the manifest entry, `inspectSeal` returns `ok: true` when the branch has not changed the manifest since its merge base, even after the base branch changed its own copy.
- [test] For a seal lacking the manifest entry where the branch changed the manifest since its merge base, `inspectSeal` returns `Protected artifact added: .docs/<slug>/manifest.json`.

**Files:** src/conductor/src/engine/protected-artifact-seal.ts, src/conductor/test/engine/protected-artifact-seal-manifest.realgit.test.ts

**Dependencies:** Task 4

### Task 6: Keep ownership-protected paths across every seal rotation
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/protected-artifact-seal-rotation-ownership.realgit.test.ts` for every Done-when check below.
2. Verify the tests fail (RED).
3. Implement: the rotation paths (`evaluateProtectedArtifactSealRotation`, `persistProtectedArtifactSealRotation` and the rebaseline record) recompute the protected set from the ownership result rather than from `PROTECTED_ARTIFACT_DIRECTORIES` alone.
4. Verify the tests pass (GREEN).
5. Commit.

**Done when:**
- [test] After a rebase rotation of a manifest-backed feature's seal, the persisted seal fingerprints `.docs/<slug>/manifest.json` and every listed protected-kind path, including one outside the five folders.
- [test] The rotation's `rebaselines[]` audit record lists the manifest and each listed protected-kind path it covered.

**Files:** src/conductor/src/engine/protected-artifact-seal.ts, src/conductor/test/engine/protected-artifact-seal-rotation-ownership.realgit.test.ts

**Dependencies:** Task 4

### Task 7: Write ownership lines and the narrowed remediate allowlist into the phase marker
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/phase-marker.test.ts` and `src/conductor/test/engine/conductor-ownership-refusal.test.ts` for every Done-when check below.
2. Verify the tests fail (RED).
3. Implement: `writePhaseMarker` accepts `own` and `protect` lists and writes one `own: <path>` and one `protect: <path>` line per entry. At step entry, `conductor.ts` passes them from the ownership result. For a manifest-backed `remediate` step it replaces the plans-folder prefix entry with the listed plan path in `allow`.
4. Verify the tests pass (GREEN).
5. Commit.

**Done when:**
- [test] For a manifest-backed `build` step, `.pipeline/phase-active` has one `own:` line per listed path except the manifest, and one `protect:` line per listed protected-kind path plus `.docs/<slug>/manifest.json`.
- [test] For a manifest-backed `remediate` step, the marker's `allow:` lines are exactly `.docs/release-waivers/` and the listed plan path, and contain no plans-folder prefix entry.
- [test] For a legacy feature, the marker has no `own:` or `protect:` line, and its `allow:` lines equal `resolveDocsAllowlist(step)` as today.

**Files:** src/conductor/src/engine/phase-marker.ts, src/conductor/src/engine/conductor.ts, src/conductor/test/engine/phase-marker.test.ts, src/conductor/test/engine/conductor-ownership-refusal.test.ts

**Dependencies:** Task 1

### Task 8: Make the pre-commit hook decide own and protected paths from marker lines
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/git-hook-assets-ownership.realgit.test.ts` for every Done-when check below. Run the generated `PRE_COMMIT_HOOK` in an isolated repository under a BUILD marker.
2. Verify the tests fail (RED).
3. Implement: in `PRE_COMMIT_HOOK` (`git-hook-assets.ts`), when any `own:` or `protect:` line is present:
   - a staged path is own only on an exact `own:` match
   - `protect:` paths join the folder arms
   - an `allow:` entry without a trailing `/` matches exactly

   With no such line, keep the `plan_ref` stem rule.
4. Verify the tests pass (GREEN).
5. Commit.

**Done when:**
- [test] With `own: .docs/f/review/stories.md` and a matching `protect:` line, a commit staging a change to that path succeeds.
- [test] With manifest-backed marker lines for `f`, a commit staging an unlisted `.docs/stories/<f>-old.md`, or another feature's `.docs/plans/<g>.md`, is rejected, and the hook output names the staged path.
- [test] Under a `remediate` marker with `allow: .docs/plans/<f>.md`, a commit staging `.docs/plans/<f>.md.orig` is rejected naming that path, and a commit staging `.docs/plans/<f>.md` succeeds.
- [test] With a marker carrying no `own:` or `protect:` line, a commit staging the own-stem `.docs/plans/<f>.md` (with `plan_ref` naming `f`) succeeds through the stem rule.

**Files:** src/conductor/src/engine/git-hook-assets.ts, src/conductor/test/engine/git-hook-assets-ownership.realgit.test.ts

**Dependencies:** Task 7

### Task 9: Reject a staged manifest change or deletion at commit for every provider
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/git-hook-assets-ownership.realgit.test.ts` for every Done-when check below. Each test invokes `git commit` directly in a repository whose only hook wiring is `core.hooksPath`, with no Claude or Codex session hook, so the result is provider-neutral.
2. Verify the tests fail (RED).
3. Implement: the manifest is always a `protect:` path and never an `own:` path, and the hook rejects any staged add, modify or delete of it.
4. Verify the tests pass (GREEN).
5. Commit.

**Done when:**
- [test] A commit staging a shell-written change to `.docs/<slug>/manifest.json` under a BUILD marker is rejected, and the hook output contains `.docs/<slug>/manifest.json`.
- [test] A commit staging the manifest's deletion (`rm` then `git add -A`) under a BUILD marker is rejected naming the manifest.
- [test] Each rejection happens with no PreToolUse docs guard configured: the test repository has only `core.hooksPath`, as in a Codex BUILD session.

**Files:** src/conductor/src/engine/git-hook-assets.ts, src/conductor/test/engine/git-hook-assets-ownership.realgit.test.ts

**Dependencies:** Task 8

### Task 10: Match file allow entries exactly in the docs write guard
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/session-hook-behavior.test.ts` for every Done-when check below, driving the generated `DOCS_GUARD_HOOK`.
2. Verify the tests fail (RED).
3. Implement: in `DOCS_GUARD_HOOK` (`session-hook-assets.ts`), an allow entry ending in `/` matches by prefix and any other entry matches exactly. Regenerate `hooks/claude/docs-guard.sh` with `src/conductor/src/tools/generate-docs-guard-hook.ts`.
4. Verify the tests pass (GREEN).
5. Commit.

**Done when:**
- [test] Under a marker allowing `.docs/release-waivers/` and `.docs/plans/<f>.md`, a Write to `.docs/plans/<f>.md.orig` and a Write to `.docs/plans/<other>.md` are both denied, and a Write to `.docs/plans/<f>.md` is allowed.
- [test] Under a marker allowing `.docs/release-waivers/`, a Write to `.docs/release-waivers/f.md` is allowed by prefix as today.
- [test] The docs-guard generator's drift check passes: `hooks/claude/docs-guard.sh` equals the regenerated `DOCS_GUARD_HOOK` output.

**Files:** src/conductor/src/engine/session-hook-assets.ts, hooks/claude/docs-guard.sh, src/conductor/test/engine/session-hook-behavior.test.ts

**Dependencies:** Task 7

### Task 11: Let reseal approve listed protected-kind paths and never the manifest
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/reseal-cli.test.ts` for every Done-when check below.
2. Verify the tests fail (RED).
3. Implement:
   - `prepareProtectedArtifactReseal` accepts a path that is in the five folders or is a listed protected-kind path, and refuses the manifest with a message naming `ai-conductor register-artifact`.
   - `describeResealRecovery` (`reseal-cli.ts`) omits any path reseal would refuse.
4. Verify the tests pass (GREEN).
5. Commit.

**Done when:**
- [test] `ai-conductor reseal --slug f --path .docs/f/review/stories.md --reason "approved edit"`, run on a changed and committed listed stories path, exits 0, and the seal's fingerprint for that path equals its committed content's fingerprint.
- [test] `ai-conductor reseal --slug f --path .docs/f/manifest.json --reason x` exits non-zero with a message containing `ai-conductor register-artifact`, and the seal file is byte-identical before and after.
- [test] For a protected-artifact halt caused by a changed `.docs/f/manifest.json`, the printed recovery text (the refusal and HALT text built at step entry with `describeResealRecovery`) contains no `reseal` command naming the manifest.

**Files:** src/conductor/src/engine/protected-artifact-seal.ts, src/conductor/src/engine/reseal-cli.ts, src/conductor/test/engine/reseal-cli.test.ts

**Dependencies:** Task 4

### Task 12: Classify remediation-redirect targets by ownership
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/remediation-hints-ownership.test.ts` for every Done-when check below.
2. Verify the tests fail (RED).
3. Implement: in `remediation-hints.ts`, for a manifest-backed feature, a target is the feature's own only when it is an owned path from the ownership result. Legacy features keep `scanPlanProtectedTargets` with the plan stem. The land-time scanner is unchanged.
4. Verify the tests pass (GREEN).
5. Commit.

**Done when:**
- [test] For manifest-backed `f`, a remediation directed at its listed `.docs/plans/<f>.md` is classified as own and is not redirected to the `plan` step.
- [test] For manifest-backed `f`, a remediation directed at the unlisted `.docs/stories/<f>-old.md` is redirected to the `plan` step, naming that path as a foreign protected target.
- [test] For a legacy feature `f`, a remediation directed at `.docs/stories/<f>.md` is classified as own exactly as today.

**Files:** src/conductor/src/engine/remediation-hints.ts, src/conductor/test/engine/remediation-hints-ownership.test.ts

**Dependencies:** Task 1

### Task 13: Resolve review-document inputs from the owned set
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/gate-invalidation-ownership.test.ts` for every Done-when check below, driving `classifyGateInvalidation` through `resolveReviewInputs`.
2. Verify the tests fail (RED).
3. Implement:
   - For a manifest-backed feature, `resolveReviewInputs` (`rebase.ts`) returns the listed `stories`, `prd`, `plan`, `coherence` and `decision` paths, the manifest, and the cited ADRs.
   - The same-stem loop and the empty-identity fallback run only for legacy features.
   - `isReviewDocumentPath` (`gate-invalidation.ts`) also accepts listed paths and the manifest.
4. Verify the tests pass (GREEN).
5. Commit.

**Done when:**
- [test] For a manifest-backed feature, a delta changing its listed `.docs/f/review/stories.md`, or a delta changing only `.docs/f/manifest.json`, invalidates the `prd_audit` and `architecture_review_as_built` document surfaces.
- [test] For a manifest-backed feature whose listed coherence document cites `adr-2026-01-01-x`, a delta changing `.docs/decisions/<adr-2026-01-01-x>.md` invalidates the document surfaces.
- [test] For manifest-backed `f`, a delta changing only the unlisted same-stem `.docs/stories/<f>.md`, or only another feature's `.docs/plans/<g>.md`, invalidates no document surface.
- [test] For a legacy feature `f`, a delta changing `.docs/stories/<f>.md` invalidates the document surfaces through the same-stem rule exactly as today.

**Files:** src/conductor/src/engine/rebase.ts, src/conductor/src/engine/gate-invalidation.ts, src/conductor/test/engine/gate-invalidation-ownership.test.ts

**Dependencies:** Task 1

### Task 14: Report the declared document surface with listed paths
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/gate-invalidation-ownership.test.ts` for every Done-when check below.
2. Verify the tests fail (RED).
3. Implement: the `projectGateSurfaces` document declaration includes the manifest-backed feature's listed paths and the manifest, so the report's declared surface and its matched paths agree.
4. Verify the tests pass (GREEN).
5. Commit.

**Done when:**
- [test] For a manifest-backed feature whose listed `.docs/f/review/stories.md` changed, the invalidation report's declared `prd_audit` input surface contains `.docs/f/review/stories.md`, and its matched paths contain the same path.
- [test] For a legacy feature, the declared `prd_audit` surface is the stories-folder and specs-folder prefix pair exactly as today.

**Files:** src/conductor/src/engine/gate-invalidation.ts, src/conductor/test/engine/gate-invalidation-ownership.test.ts

**Dependencies:** Task 13

### Task 15: Never auto-resolve a manifest conflict
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/rebase-manifest-conflict.realgit.test.ts` for every Done-when check below, using isolated local git and a fake provider boundary for the model-driven resolver.
2. Verify the tests fail (RED).
3. Implement:
   - `docsKeepBothResolver` declines when any conflict path matches `.docs/<name>/manifest.json`.
   - `resolveRebaseConflicts` returns a needs-human outcome before any provider dispatch when any conflict path is a manifest. Its reason names the manifest and the recovery: take the base branch's manifest, then re-run `register-artifact`.
4. Verify the tests pass (GREEN).
5. Commit.

**Done when:**
- [test] For a rebase conflict on `.docs/f/manifest.json` and `.docs/stories/<x>.md`, `docsKeepBothResolver` declines, and neither `.docs/f/manifest~ours.json` nor `.docs/f/manifest~theirs.json` exists afterwards.
- [test] `resolveRebaseConflicts` for a conflict set containing `.docs/f/manifest.json` records zero provider dispatches and returns needs-human with a reason containing `.docs/f/manifest.json`, `register-artifact` and the base branch's manifest.
- [test] For an add/add conflict on `.docs/stories/<x>.md` alone, `docsKeepBothResolver` keeps both sides exactly as today.
- [test] For a manifest-backed feature whose base tip changed another feature's `.docs/stories/<g>.md`, the pre-rebase seal check in `performRebase` tolerates it as base-inherited and the rebase proceeds.

**Files:** src/conductor/src/engine/rebase.ts, src/conductor/test/engine/rebase-manifest-conflict.realgit.test.ts

**Dependencies:** Task 1

### Task 16: Exclude manifests from the graded build_review diff
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-inputs.test.ts` for every Done-when check below.
2. Verify the tests fail (RED).
3. Implement: `assembleBuildReviewInputs` adds `.docs/*/manifest.json` to its machinery-authored exclusions (beside `.docs/shipped/`) for the graded diff and inventory.
4. Verify the tests pass (GREEN).
5. Commit.

**Done when:**
- [test] For a manifest-backed feature whose branch changed `.docs/f/manifest.json` and its listed `.docs/plans/<f>.md`, the graded diff contains `.docs/plans/<f>.md` and does not contain `.docs/f/manifest.json`.
- [test] For a manifest-backed feature whose branch changed another feature's `.docs/specs/<g>.md`, the graded diff contains `.docs/specs/<g>.md`.
- [test] For a legacy feature whose branch changed `.docs/plans/<f>.md`, the graded diff, both its path set and its patch text, is identical to the graded diff produced before this change.

**Files:** src/conductor/src/engine/build-review-inputs.ts, src/conductor/test/engine/build-review-inputs.test.ts

**Dependencies:** Task 1

### Task 17: Treat listed artifacts and manifests as non-production in the testQuality preflight
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-test-quality-preflight.test.ts` for every Done-when check below.
2. Verify the tests fail (RED).
3. Implement: `classifyTautologyPaths` receives the ownership result and classifies listed artifact paths and `.docs/*/manifest.json` as neither production nor test, so `materializeTautologyPreflight` does not restore them.
4. Verify the tests pass (GREEN).
5. Commit.

**Done when:**
- [test] For a manifest-backed feature whose diff touches `src/x.ts`, `test/x.test.ts` and its listed `.docs/f/review/stories.md`, `classifyTautologyPaths` returns `src/x.ts` as production and `test/x.test.ts` as test, and returns the stories path in neither set, so the counterfactual does not restore it.
- [test] For a manifest-backed feature whose diff touches only `.docs/f/manifest.json`, the manifest is not in the production set.
- [test] For a legacy feature whose diff touches `.docs/plans/<f>.md`, the production classification is identical to the classification before this change.

**Files:** src/conductor/src/engine/build-review-test-quality-preflight.ts, src/conductor/src/engine/step-runners.ts, src/conductor/test/engine/build-review-test-quality-preflight.test.ts

**Dependencies:** Task 1

### Task 18: Validate a registration request
**Story:** Story 6
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/register-artifact-cli.test.ts` for every Done-when check below.
2. Verify the tests fail (RED).
3. Implement `validateRegistration` and `dispatchRegisterArtifactCommand` in `src/conductor/src/engine/register-artifact-cli.ts`. `validateRegistration` returns a typed refusal condition, or the new manifest rendered through `renderFeatureManifest`. On a refusal, `dispatchRegisterArtifactCommand` returns a non-zero exit code and writes `register-artifact: <condition>.` to stderr.
4. Verify the tests pass (GREEN).
5. Commit.

**Done when:**
- [test] The `register-artifact` command (`dispatchRegisterArtifactCommand`) exits non-zero, with stderr naming the condition and no file written, for a blank reason (missing rationale), for `--slug g` with no `.worktrees/g` (unknown feature worktree `g`), and for a path absent from the worktree (names the path).
- [test] The `register-artifact` command exits non-zero, with stderr naming the condition, for a path the manifest already lists (the duplicate entry), for `--kind coherence` with `.docs/stories/<extra>.md` (the kind mismatch with `stories`), and for `--kind plan` when a plan is listed (the second plan entry).
- [test] The `register-artifact` command exits non-zero for paths under `.docs/shipped/`, `.docs/halted/`, `.docs/plan-review/` and `.docs/release-waivers/`, and for a path outside `.docs/`, with stderr naming each path as not registrable.
- [test] The `register-artifact` command exits non-zero for a malformed manifest, with stderr carrying the parser's named failure, and the manifest file is byte-identical afterwards.

**Files:** src/conductor/src/engine/register-artifact-cli.ts, src/conductor/test/engine/register-artifact-cli.test.ts

**Dependencies:** none

### Task 19: Commit a registration atomically
**Story:** Story 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/register-artifact-cli.realgit.test.ts` for every Done-when check below.
2. Verify the tests fail (RED).
3. Implement: after validation, write the rendered manifest and create one commit with `CONDUCT_ENGINE_COMMIT=1` containing the artifact and the manifest. If the commit fails, restore the manifest and leave the seal untouched.
4. Verify the tests pass (GREEN).
5. Commit.

**Done when:**
- [test] Running `ai-conductor register-artifact --slug f --kind stories --path .docs/stories/<extra>.md --reason "split story file"` interactively for halted feature `f` exits 0, and the manifest lists `{ kind: 'stories', path: '.docs/stories/<extra>.md' }` in renderer order.
- [test] HEAD is one new commit, not refused by the installed pre-commit hook, whose changed paths are exactly `.docs/stories/<extra>.md` and `.docs/f/manifest.json`.
- [test] When the commit is made to fail, the command exits non-zero, and `.docs/f/manifest.json` and `.pipeline/protected-artifact-seal.json` are byte-identical to their contents before the command.

**Files:** src/conductor/src/engine/register-artifact-cli.ts, src/conductor/test/engine/register-artifact-cli.realgit.test.ts

**Dependencies:** Task 18

### Task 20: Rotate the seal and record a registration
**Story:** Story 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/register-artifact-cli.realgit.test.ts` for every Done-when check below.
2. Verify the tests fail (RED).
3. Implement:
   - After the commit, rotate the seal through `persistProtectedArtifactSealRotation` with trigger `operator-register`, for the manifest and, when its kind is protected, the path.
   - Emit `feature_artifacts_registered` with the slug and added entry on an `EventPersister` over the worktree's `.pipeline/events.jsonl`.
   - With `--clear-halt`, clear the HALT marker as `reseal` does.
4. Verify the tests pass (GREEN).
5. Commit.

**Done when:**
- [test] After a successful registration, `inspectSeal` returns `ok: true` with no entry for the manifest or `.docs/stories/<extra>.md`, and `computeFeatureOwnership` returns `manifest` with no drift.
- [test] After the registration, resolving stories for `f` through `resolveFeatureArtifact` returns `.docs/stories/<extra>.md` among its paths.
- [test] The worktree's `.pipeline/events.jsonl` contains exactly one `feature_artifacts_registered` event, with slug `f` and added `[{ kind: 'stories', path: '.docs/stories/<extra>.md' }]`.
- [test] With `--clear-halt`, `.pipeline/HALT` is absent after a successful registration.

**Files:** src/conductor/src/engine/register-artifact-cli.ts, src/conductor/src/engine/protected-artifact-seal.ts, src/conductor/test/engine/register-artifact-cli.realgit.test.ts

**Dependencies:** Task 19, Task 6

### Task 21: Wire register-artifact as an operator-only command
**Story:** Story 6
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/register-artifact-cli.test.ts` for every Done-when check below.
2. Verify the tests fail (RED).
3. Implement:
   - `detectRegisterArtifactCommand`, with `dispatchRegisterArtifactCommand` dispatched in `index.ts` before the pipeline boots, beside the reseal dispatch.
   - The command entry in `cli.ts`.
   - The `feature_artifact_registration_refused` event in `types/events.ts`, emitted on every refusal.
   - The TTY gate.
4. Verify the tests pass (GREEN).
5. Commit.

**Done when:**
- [test] Run without an interactive terminal (`isInteractive: false`), the command exits non-zero, changes no file, and the worktree's events contain `feature_artifact_registration_refused` with condition `requires an interactive terminal`.
- [test] `index.ts` dispatches `register-artifact` through `detectRegisterArtifactCommand` before the pipeline is constructed, and `STEP_DEFINITIONS` contains no step named `register-artifact` or `register_artifact`.
- [test] `ai-conductor reseal --slug f --path .docs/stories/<extra>.md` for an unlisted, unsealed path still refuses it as not sealed, and the manifest is unchanged.

**Files:** src/conductor/src/engine/register-artifact-cli.ts, src/conductor/src/index.ts, src/conductor/src/cli.ts, src/conductor/src/types/events.ts, src/conductor/test/engine/register-artifact-cli.test.ts

**Dependencies:** Task 20

### Task 22: Select a shipped feature's prunable files from its manifest
**Story:** Story 7
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/docs-prune-selection.realgit.test.ts` and `src/conductor/test/engine/docs-retention.test.ts` for every Done-when check below.
2. Verify the tests fail (RED).
3. Implement:
   - `DOCS_RETENTION_POLICY` gains the prunable kinds: `plan`, `conflicts`, `coherence`, `coherence-waiver`, `track`, `complexity` and `applicability`.
   - `resolveDocsPruneSelection` reads each shipped stem's manifest from `origin/main` through a git-ref manifest source. It selects listed prunable-kind entries plus the manifest, and the stem-ruled halted, plan-review and retro records.
   - A malformed manifest skips the stem with reason `malformed-manifest`, added to the `decide_artifacts_pruned` skipped-reason union in `types/events.ts`.
4. Verify the tests pass (GREEN).
5. Commit.

**Done when:**
- [test] For shipped `f` whose manifest lists `plan`, `coherence`, `track`, `complexity`, `stories` and `decision` entries, the selection is exactly those plan, coherence, track and complexity paths, plus `.docs/f/manifest.json`, plus `f`'s stem-matched halted, plan-review and retro records.
- [test] For shipped `f` whose manifest lists `.docs/plans/<f>.md` while an unlisted `.docs/coherence/f.md` exists on `origin/main`, the selection does not contain `.docs/coherence/f.md`.
- [test] For a shipped stem with a malformed manifest, the result's skipped list holds `{ stem, reason: 'malformed-manifest' }` naming the manifest file, the emitted `decide_artifacts_pruned` event records that skip, and the other stems' selections are unchanged.
- [test] For a shipped legacy stem with no manifest, the selection equals `prunableFilesForStem`'s stem-matched set exactly as today.

**Files:** src/conductor/src/engine/docs-retention.ts, src/conductor/src/engine/docs-prune.ts, src/conductor/src/types/events.ts, src/conductor/test/engine/docs-prune-selection.realgit.test.ts, src/conductor/test/engine/docs-retention.test.ts

**Dependencies:** none

### Task 23: Remove the manifest on prune and find a pruned plan through it
**Story:** Story 7
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/docs-prune-commit.realgit.test.ts`, `src/conductor/test/engine/docs-prune-inflight.realgit.test.ts` and `src/conductor/test/engine/pruned-plan.realgit.test.ts` for every Done-when check below.
2. Verify the tests fail (RED).
3. Implement:
   - `commitDocsPruneDeletion` and `applyOpenPullRequestDeferral` operate on the manifest-backed selection.
   - When the manifest was deleted, `readPlanOrPruned` reads the plan path from the manifest at the deleting commit's parent.
4. Verify the tests pass (GREEN).
5. Commit.

**Done when:**
- [test] After the prune commit for manifest-backed `f`, `git ls-tree origin/main` contains neither `.docs/f/manifest.json` nor its listed plan, and still contains its listed stories and decision files.
- [test] An open pull request that modifies `.docs/f/manifest.json` defers `f`'s whole selection with reason `open-pr-modifies`.
- [test] For a pruned feature whose listed plan was `.docs/f/machine/plan.md`, `readPlanOrPruned` returns that plan's content from the deleting commit's parent.
- [test] For a pruned plan whose deleting commit is unreachable from the commit read, `readPlanOrPruned` refuses with `shipment-plan-pruned`, and the shipment audit classifies that row `unresolved` as today.

**Files:** src/conductor/src/engine/docs-prune.ts, src/conductor/src/engine/pruned-plan.ts, src/conductor/test/engine/docs-prune-commit.realgit.test.ts, src/conductor/test/engine/docs-prune-inflight.realgit.test.ts, src/conductor/test/engine/pruned-plan.realgit.test.ts

**Dependencies:** Task 22

## Task Dependency Graph

```text
Slice 1: 1 ─┬─ 2
            ├─ 3
            ├─ 4 ─┬─ 5
            │     ├─ 6
            │     └─ 11
            ├─ 7 ─┬─ 8 ── 9
            │     └─ 10
            └─ 12
Slice 2: 1 ─┬─ 13 ── 14
            ├─ 15
            ├─ 16
            └─ 17
Slice 3: 18 ── 19 ── 20 (also needs 6) ── 21
         22 ── 23
```

## Integration Points

- After Task 2: a manifest-backed daemon BUILD with drift stops at step entry, naming each path.
- After Task 9: a shell-command manifest edit is refused at commit and caught by the seal.
- After Task 15: no automatic tier ever writes a manifest during rebase.
- After Task 21: an operator can clear an unlisted-drift stop through `ai-conductor register-artifact`.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-28-path-policy-reads-feature-ownership-from-manifest#D1 | task | task-1 | `computeFeatureOwnership` returns `legacy` when `.docs/<slug>/manifest.json` is absent |
| adr-2026-10-28-path-policy-reads-feature-ownership-from-manifest#D2 | task | task-1 | all three entries in one result when the three cases are combined |
| adr-2026-10-28-path-policy-reads-feature-ownership-from-manifest#D3 | task | task-2, task-3 | returns a result with `refusal.kind` `seal` whose reason contains each path |
| adr-2026-10-28-path-policy-reads-feature-ownership-from-manifest#D4 | task | task-4, task-5, task-6, task-11 | the created seal's `protectedArtifacts` contain that path with its fingerprint |
| adr-2026-10-28-path-policy-reads-feature-ownership-from-manifest#D5 | task | task-7, task-8, task-10, task-12 | one `protect:` line per listed protected-kind path plus `.docs/<slug>/manifest.json` |
| adr-2026-10-28-path-policy-reads-feature-ownership-from-manifest#D6 | task | task-13, task-14, task-15 | invalidates the `prd_audit` and `architecture_review_as_built` document surfaces |
| adr-2026-10-28-path-policy-reads-feature-ownership-from-manifest#D7 | task | task-16, task-17 | the graded diff contains `.docs/plans/<f>.md` and does not contain `.docs/f/manifest.json` |
| adr-2026-10-28-path-policy-reads-feature-ownership-from-manifest#D8 | task | task-18, task-19, task-20, task-21 | contains exactly one `feature_artifacts_registered` event |
| adr-2026-10-28-path-policy-reads-feature-ownership-from-manifest#D9 | task | task-22, task-23 | plus `.docs/f/manifest.json` |
| adr-2026-10-28-path-policy-reads-feature-ownership-from-manifest#D10 | task | task-2, task-13, task-22 | The legacy case computes no drift. |
| adr-2026-10-24-per-feature-artifact-manifest#D1 | existing | none | `featureManifestPath` in `feature-manifest.ts` renders `.docs/<slug>/manifest.json`; this spec reads it unchanged |
| adr-2026-10-24-per-feature-artifact-manifest#D2 | existing | none | `parseFeatureManifest` enforces the closed kind set; ownership reuses it without change |
| adr-2026-10-24-per-feature-artifact-manifest#D3 | existing | none | `isExcludedManifestPath` excludes plan-review, shipped, halted and release-waiver records; drift reuses the same exclusions |
| adr-2026-10-24-per-feature-artifact-manifest#D4 | existing | none | Land already requires the plan stem to equal the slug; ownership derives the slug as `resolveArtifactFiles` does |
| adr-2026-10-24-per-feature-artifact-manifest#D5 | existing | none | `resolveFeatureArtifact` in `feature-manifest-source.ts` is the lookup; registration visibility is asserted through it |
| adr-2026-10-24-per-feature-artifact-manifest#D6 | task | task-19 | the manifest lists `{ kind: 'stories', path: '.docs/stories/<extra>.md' }` in renderer order |
| adr-2026-10-24-per-feature-artifact-manifest#D7 | task | task-5, task-9, task-2, task-21, task-23 | and `selfAmendments` never contains the manifest |
| adr-2026-10-24-per-feature-artifact-manifest#D8 | existing | none | Discovery's manifest candidates and `malformed-manifest` blocking in `daemon-backlog.ts` are unchanged |
| adr-2026-10-24-per-feature-artifact-manifest#D9 | no-change | none | No feature flag: every new refusal applies only to manifest-backed features, as in this spec's D10 |
| adr-2026-10-24-per-feature-artifact-manifest#D10 | no-change | none | Delivery order is recorded; this spec is spec 2 and moves no file |
| adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts#D1 | task | task-22 | the selection does not contain `.docs/coherence/f.md` |
| adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts#D2 | existing | none | `ai-conductor docs-prune` stays the only, operator-run entry point (`docs-prune-cli.ts`) |
| adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts#D3 | task | task-23 | defers `f`'s whole selection with reason `open-pr-modifies` |
| adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts#D4 | existing | none | `commitDocsPruneDeletion` keeps its guarded temporary-worktree publication unchanged |
| adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts#D5 | task | task-22 | the emitted `decide_artifacts_pruned` event records that skip |
| adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts#D6 | task | task-23 | `readPlanOrPruned` returns that plan's content from the deleting commit's parent |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
