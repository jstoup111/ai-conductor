# Implementation Plan: base-inherited protected-artifact deletion no longer deadlocks the seal

**Date:** 2026-10-07
**Design:** `.docs/architecture/base-inherited-artifact-deletion-deadlocks-both-se.md`
**Decision:** `adr-2026-10-07-prune-base-inherited-deletions-from-the-seal`
**Stories:** `.docs/stories/base-inherited-artifact-deletion-deadlocks-both-se.md` (accepted stories)
**Conflict check:** `.docs/conflicts/base-inherited-artifact-deletion-deadlocks-both-se.md`, clean as of 2026-10-07
**Issue:** jstoup111/ai-conductor#1752 (absorbs #1676)

## Summary

Seal verification and `conduct reseal` stop refusing a sealed protected artifact that the base
branch deleted and the feature never touched. Such paths are pruned from the seal with an audited
`inherited-base-deletion` lineage entry. Feature-authored deletions keep halting, and every
path-bearing seal refusal states one attribution from a closed set. The work is 11 tasks.

## Technical Approach

All production changes live in `src/conductor/src/engine/protected-artifact-seal.ts`. The only
other changes are additive type and rendering edits in `src/conductor/src/types/events.ts`,
`src/conductor/src/daemon-cli.ts`, and the conductor's rebaseline log line in
`src/conductor/src/engine/conductor.ts`.

- **One provenance answer, now with attribution.** `inspectSeal`'s local `inheritedFromBase`
  closure currently returns only an inheritance label. It is widened to also return the provenance
  evidence `branchUntouchedInheritance` already computes: the merge-base sha, and whether HEAD
  touched the path. A single attribution formatter turns that into exactly one line from the closed
  set:
  - `Attribution: feature-authored (committed on this branch since merge-base <sha>)`
  - `Attribution: uncommitted workspace change`
  - `Attribution: base-inherited`
  - `Attribution: provenance undeterminable`

  Every path-bearing refusal (added, changed, deleted, provenance undeterminable, and the rotation
  refusals in `rotationRefusalVerdict`) appends exactly one such line after its existing first line.
  Existing first lines are kept verbatim, so consumers that match on them (for example
  `reseal-cli.ts`'s `refusalPath`) keep working.
- **Deletion classification.** The sealed-path deletion loop runs the same probe.
  - `inherited`: the path is a base-inherited deletion. Its deleting commit is resolved with
    `git log -1 --diff-filter=D --format=%H <baseRef> -- <path>`. Empty output or a failure refuses
    with `Protected artifact provenance undeterminable: <path>`, the line
    `Deleting base commit not found.`, and the provenance-undeterminable attribution (ADR D5).
  - `not-inherited`: the existing `Protected artifact deleted: <path>` reason, followed by the
    feature-authored attribution (HEAD touched the path) or the uncommitted attribution (HEAD still
    has the path).
  - `no-merge-base`, `diff-probe-failed`, or a missing base ref: the existing provenance-undeterminable
    reasons, with the undeterminable attribution.

  The `ok` verdict variant gains `inheritedDeletions: { path: string; deletedBy: string }[]`.
  `inspectSeal` itself never writes.
- **Prune persistence lives with the existing writer.** `persistProtectedArtifactSealRotation`
  stays the single seal writer (see the shared-writer story of
  `no-operator-command-to-reseal-a-protected-decide-a`). It gains an optional `prune` input
  (`{ paths, deletedBy, baselineCommit }`). When present, it appends the `inherited-base-deletion`
  entry (`fromCommit === toCommit === prior baseline`, plus `deletedBy`) immediately before the
  caller's own entry, or as the only entry for a prune-only write. It emits one
  `protected_artifact_rebaseline` notification per appended entry, and the prune notification
  carries `deletedBy`. The temp-file → rename → `rm` sequence is unchanged, so a failed rename
  leaves the original seal and no temp file, and emits nothing.
- **Composed-verdict gate (ADR D4).** In `verifyExistingProtectedArtifactSeal`, a prune is written
  only after the composed verdict is known to be `ok`. Three cases:
  - Rotation is permitted: the prune is folded into the rotation write.
  - Rotation refusal preserves a passing inspection (`rotationRefusalPreservesInspection`): a
    prune-only write.
  - Any escalating refusal: nothing is written.

  `VerifyProtectedArtifactSealOptions` gains an optional `fileOperations` (the same type `rotate`
  already accepts) so tests can inject a rename failure. The first-BUILD path with no existing seal
  (`verifyProtectedArtifactSeal` with only `baselineCommit`) tolerates inherited deletions and
  persists nothing, because there is no seal yet.
- **Reseal.** `resealProtectedArtifactSeal` runs `inspectSeal` with the named paths excluded, as
  today, and the inspection result now carries `inheritedDeletions` for unnamed paths. Each named
  path missing from the workspace is classified by the same deletion classifier, exported for
  in-module reuse as `classifyDeletedProtectedArtifact`:
  - Base-inherited targets join the prune set.
  - Feature-authored or undeterminable targets throw their attributed refusal. `reseal-cli.ts`
    already turns that into `protected_artifact_reseal_refused` with `condition` set to the message.

  `createScopedProtectedArtifactSeal` receives only the surviving named paths. If none survive, the
  reseal is a prune-only write. A single `persistProtectedArtifactSealRotation` call persists the
  prune entry, then the `operator-reseal` entry. The scoped seal's `protectedArtifacts` omits the
  pruned paths.
- **Schema.** `ProtectedArtifactRebaseline` and both event declarations gain optional
  `deletedBy?: Record<string, string>`. The seal reader accepts it only when it is a plain object
  whose values are all strings, and rejects anything else with `Protected artifact seal is invalid`.
  Seal `version` stays 2.
- **Out of scope (ADR D9).** `evaluateProtectedArtifactSealRotation`'s own-plan
  exactly-append-only acceptance is not changed.

**Local test pattern.**
- Engine tests live in `src/conductor/test/engine/protected-artifact-seal.test.ts`. They build real
  git repositories with the file's `makeRepo` helper and the `makeRewrittenRepo` /
  `makeDivergingBaseRepository` helpers (search for `describe('base-branch inheritance tolerance'`
  and `describe('stale-seal rebaselining on a rewritten history (#976)'`).
  - Traits to keep: a real bare-or-local base branch, a feature branch with an explicit merge-base,
    and assertions on the persisted `.pipeline/protected-artifact-seal.json` bytes.
  - Allowed variation: new helpers may build the base-side deletion commit.
- Conductor-level guard tests follow
  `src/conductor/test/acceptance/manual-rebase-strands-protected-artifact-seal.acceptance.test.ts`:
  a real `Conductor` with a stub `StepRunner`, `HALT_MARKER` absence, and events captured from
  `ConductorEventEmitter`.
- Reseal CLI tests follow `src/conductor/test/engine/reseal-cli.test.ts`, which injects `deps`
  (`isInteractive: true`, `events`).

## Prerequisites
- None. Seal `version: 2`, `rebaselines[]`, the rebaseline observer, and `conduct reseal` exist on
  `main`.

## Tasks

### Task 1: Seal and event schema accept an audited `deletedBy` map
**Story:** Story 2 happy 4, Story 2 negative 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `protected-artifact-seal.test.ts` under `describe('createProtectedArtifactSeal'`:
   - A seal file containing an `inherited-base-deletion` entry with `deletedBy` is returned
     unchanged by the reader (exercised through `verifyProtectedArtifactSeal` reading an existing
     seal).
   - A seal with no `deletedBy` still reads.
   - A seal whose `deletedBy` is an array, a string, or an object with a non-string value is
     rejected with `Protected artifact seal is invalid`.
2. Verify RED.
3. Implement:
   - Add `deletedBy?: Record<string, string>` to `ProtectedArtifactRebaseline`.
   - Add the same field to the `protected_artifact_rebaseline` member of
     `ProtectedArtifactSealRebaselineEvent` and of `ConductorEvent` in `src/types/events.ts`.
   - Extend the `validRebaselines` predicate in the seal reader to accept `deletedBy` only as a
     non-array object with all-string values.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] The seal reader returns a version-2 seal whose `inherited-base-deletion` entry keeps its `deletedBy` map key-for-key, and also reads a seal file with no `deletedBy`.
- [test] The seal reader rejects each malformed `deletedBy` fixture (array, string, object with a numeric value) with the error `Protected artifact seal is invalid`.
- `ConductorEvent`'s `protected_artifact_rebaseline` member and `ProtectedArtifactSealRebaselineEvent` both declare `deletedBy?: Record<string, string>` and `tsc --noEmit` passes for `src/conductor`.

**Files likely touched:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — rebaseline type, event type, and reader validation
- `src/conductor/src/types/events.ts` — additive `deletedBy` on `protected_artifact_rebaseline`
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — reader round-trip and rejection tests

**Dependencies:** none

### Task 2: Attributed provenance for added, changed, and undeterminable refusals
**Story:** Story 6 happy 1, Story 6 happy 2, Story 6 negative 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `describe('base-branch inheritance tolerance'`:
   - A committed feature edit to another feature's sealed artifact refuses with
     `Protected artifact changed: <path>`, then
     `Attribution: feature-authored (committed on this branch since merge-base <sha>)`, where
     `<sha>` equals `git merge-base <base> HEAD`.
   - An uncommitted edit to a sealed artifact refuses naming the path, with
     `Attribution: uncommitted workspace change`.
   - Missing base ref, no merge-base, and a failed `git diff` probe (the existing execa-mock pattern
     in this file) each refuse with `Protected artifact provenance undeterminable: <path>` and
     `Attribution: provenance undeterminable`. None of their reasons contain `feature-authored` or
     `base-inherited`.
2. Verify RED.
3. Implement:
   - Widen the `inheritedFromBase` closure in `inspectSeal` to return
     `{ inheritance, mergeBase?, headTouchedPath }` from `branchUntouchedInheritance`'s existing
     `provenance`.
   - Add one module-private `attributionLine(...)` formatter over the closed set
     {feature-authored (committed on this branch since merge-base <sha>), uncommitted workspace
     change, base-inherited, provenance undeterminable}.
   - Append its output to the `added`, `changed`, `undeterminableProvenance`, `noMergeBase`, and
     `failedInheritanceProbe` reasons. Keep each existing first line byte-identical.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] `inspectSeal` via `verifyProtectedArtifactSeal` refuses a committed feature edit with reason lines `Protected artifact changed: <path>` then `Attribution: feature-authored (committed on this branch since merge-base <sha>)`, and `<sha>` equals the fixture's `git merge-base` output.
- [test] `inspectSeal` refuses an uncommitted sealed-artifact edit with a reason containing the path and `Attribution: uncommitted workspace change`.
- [test] The missing-base-ref, no-merge-base, and failed-diff-probe fixtures each refuse with `Protected artifact provenance undeterminable: <path>` plus `Attribution: provenance undeterminable`, and none of those reasons contains `feature-authored` or `base-inherited`.
- Every existing first line of an `inspectSeal` refusal reason is unchanged, as asserted by the pre-existing tests in `protected-artifact-seal.test.ts` passing without edits to their expected first lines.

**Files likely touched:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — provenance-bearing probe, attribution formatter, refusal reasons
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — attribution tests

**Dependencies:** none

### Task 3: The deletion loop classifies sealed-path deletions by authorship
**Story:** Story 1 negative 2, Story 1 negative 3, Story 2 negative 1, Story 3 happy 1, Story 3 happy 2, Story 3 negative 1, Story 3 negative 2, Story 6 negative 2
**Type:** happy-path

**Steps:**
1. Write failing tests in a new `describe('inherited base deletion (#1752/#1676)'` block in
   `protected-artifact-seal.test.ts`, each recording the seal file bytes before and after:
   - The base deletes a sealed path the feature never touched, and the feature rebases. The
     inspection-level verdict is `ok`, with `inheritedDeletions` equal to
     `[{ path, deletedBy: <D> }]`, where `<D>` is the deleting commit sha.
   - A feature commit deletes `.docs/stories/<own>.md`. Refuses with `Protected artifact deleted:
     .docs/stories/<own>.md` and the feature-authored attribution with the merge-base sha.
   - `.docs/plans/<x>.md` is removed from disk but still in HEAD. Refuses with `Protected artifact
     deleted: .docs/plans/<x>.md` and `Attribution: uncommitted workspace change`.
   - The feature committed a deletion, and the base deleted the same path after the feature's
     merge-base without a rebase. Refuses as feature-authored, with no inherited deletions.
   - The base tip still has `.docs/plans/<kept>.md` and the feature commit deleted it. Refuses as
     feature-authored, and an execa spy records no `git log --diff-filter=D` call for that path.
   - Missing base ref and no merge-base, with a sealed path missing. Refuse with the provenance
     undeterminable reasons naming the missing ref and the absent merge-base respectively.
   - A base-inherited deletion whose `git log --diff-filter=D` lookup returns empty output (execa
     mock). Refuses with `Protected artifact provenance undeterminable: <path>`, the line
     `Deleting base commit not found.`, and the undeterminable attribution.
   - A base-inherited change alone, and a base-inherited change plus a base-inherited deletion, with
     no other drift. No refusal at all. Adding an uncommitted edit to another sealed path refuses
     naming only the edited path; neither base-inherited path appears in the reason.
2. Verify RED.
3. Implement:
   - Add a module-private `classifyDeletedProtectedArtifact(path, probe)`. It runs the widened
     `inheritedFromBase`, and resolves the deleting commit only for `inherited`, with `git log -1
     --diff-filter=D --format=%H <baseRef> -- <path>`.
   - Replace the unconditional `Protected artifact deleted` return in `inspectSeal`'s
     `expected.keys()` loop with that classifier. Collect inherited deletions into a new
     `inheritedDeletions` field on the `ok` verdict variant, defaulting to `[]`.
   - `inspectSeal` performs no file writes.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] For the rebased base-deletion fixture, `inspectSeal` (through `verifyProtectedArtifactSeal` with no existing seal and a `baselineCommit`) returns `ok: true` with `inheritedDeletions` equal to `[{ path: '.docs/plans/<retired>.md', deletedBy: <D> }]`, where `<D>` is the fixture's deleting commit.
- [test] The committed-deletion fixture refuses with exactly `Protected artifact deleted: .docs/stories/<own>.md` followed by `Attribution: feature-authored (committed on this branch since merge-base <sha>)`, and the uncommitted-deletion fixture refuses with `Protected artifact deleted: .docs/plans/<x>.md` followed by `Attribution: uncommitted workspace change`.
- [test] The deleted-then-base-also-deleted-without-rebase fixture and the base-still-has-<kept>.md fixture both refuse as feature-authored with no `inheritedDeletions`, and the execa spy records zero `git log --diff-filter=D` invocations for `.docs/plans/<kept>.md`.
- [test] The missing-base-ref, no-merge-base, and deleting-commit-not-found fixtures each refuse with `Protected artifact provenance undeterminable: <path>` (naming the missing ref, the absent merge-base, and `Deleting base commit not found.` respectively), and every refusal fixture's seal file bytes are identical before and after.
- [test] A base-inherited-change-only fixture and a base-inherited change-plus-deletion fixture each return `ok: true` with no refusal reason, and the same change-plus-deletion fixture with an added uncommitted edit to another sealed path refuses with a reason that names the edited path and contains neither base-inherited path.

**Files likely touched:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — deletion classifier, `inheritedDeletions` verdict field
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — deletion classification tests

**Dependencies:** Task 2

### Task 4: The seal writer appends an audited prune entry
**Story:** Story 2 happy 1, Story 2 happy 3, Story 4 negative 4
**Type:** infrastructure

**Steps:**
1. Write failing tests under `describe('rotateProtectedArtifactSeal'`, driving the shared writer
   through `rotateProtectedArtifactSeal` with its new optional `prune` input and `toCommit` equal to
   the seal's current baseline (a prune-only write).
   - A prune of one path appends `{ fromCommit: B, toCommit: B, trigger: 'inherited-base-deletion',
     paths: [p], deletedBy: { p: D } }` as the last entry and removes `p` from
     `protectedArtifacts`.
   - A prune of two paths with different deleting commits produces one entry that lists both
     paths, each mapped to its own commit.
   - A rename failure injected through `fileOperations` leaves the original seal bytes, leaves no
     `.protected-artifact-seal.json.*.tmp`, emits no `protected_artifact_rebaseline` notification,
     and rejects with the injected error.
2. Verify RED.
3. Implement:
   - Add optional `prune?: { paths: string[]; deletedBy: Record<string, string> }` to
     `PersistProtectedArtifactSealRotationOptions`.
   - When present with at least one path (an empty `prune` is ignored), filter those paths out of
     `recomputed.protectedArtifacts`, and append the
     `inherited-base-deletion` entry (prior baseline as both commits) before the caller's own entry.
   - Support a prune-only write in which `recomputed.baselineCommit` equals the prior baseline and
     only the prune entry is appended.
   - After the rename, notify the observer once per appended entry; the prune notification carries
     `deletedBy`. Keep the temp/rename/rm sequence unchanged.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] After a one-path prune the persisted seal's last `rebaselines` entry deep-equals `{ fromCommit: B, toCommit: B, trigger: 'inherited-base-deletion', paths: ['.docs/plans/<retired>.md'], deletedBy: { '.docs/plans/<retired>.md': D } }`, `baselineCommit` is still `B`, and the path is absent from `protectedArtifacts`.
- [test] After a two-path prune with different deleting commits, exactly one appended `inherited-base-deletion` entry lists both paths and its `deletedBy` maps each path to its own fixture commit.
- [test] With an injected `rename` that throws, the seal file bytes are identical to before, no `.protected-artifact-seal.json.*.tmp` file exists in `.pipeline/`, the observer received zero `protected_artifact_rebaseline` notifications, and the call rejects with the injected error.

**Files likely touched:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — `persistProtectedArtifactSealRotation` prune input and notifications
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — writer tests

**Dependencies:** Task 1

### Task 5: Verification persists the prune only on an `ok` composed verdict
**Story:** Story 1 happy 2, Story 1 happy 3, Story 1 negative 1, Story 2 happy 2, Story 2 negative 3, Story 4 happy 1, Story 4 happy 2, Story 4 negative 1, Story 4 negative 2, Story 4 negative 3
**Type:** happy-path

**Steps:**
1. Write failing tests in the `inherited base deletion (#1752/#1676)` block, using real git and an
   existing seal:
   - #1676 shape: the base deletion is merged in and the seal baseline is still an ancestor of HEAD.
     `verifyProtectedArtifactSeal` returns `ok`, persists the prune entry, and the observer receives
     exactly one `protected_artifact_rebaseline` with `trigger: 'inherited-base-deletion'`, the
     pruned paths, and `deletedBy`.
   - Verify a second time. Still `ok`, the path is not in `protectedArtifacts`, and no new entry is
     appended.
   - An `onRebaseline` observer that throws. The prune is still persisted and the verdict is `ok`.
   - The base deleted the path but the feature has not merged or rebased. `ok`, and the seal bytes
     are unchanged.
   - Rewritten-history fixture (`makeRewrittenRepo` pattern) where rotation is permitted. One write
     whose last two entries are the `inherited-base-deletion` entry, then the rotation entry.
   - An inherited deletion plus an uncommitted edit to another sealed artifact. Refuses for the
     edited path, and the seal bytes are unchanged with `<retired>.md` still sealed.
   - An inherited deletion plus a feature-authored deletion. Refuses naming the feature-authored
     path, and the bytes are unchanged.
   - #1752 shape: an inherited deletion, the inspection otherwise passes, and rotation is refused as
     `head-differs-from-base` for an authored path. The verdict fails naming that path, and the bytes
     are unchanged.
2. Verify RED.
3. Implement in `verifyExistingProtectedArtifactSeal`:
   - Read `inspection.inheritedDeletions`. When it is empty, behave exactly as today and pass no
     `prune`.
   - When rotation is permitted, pass the prune to `rotateProtectedArtifactSeal` (new optional
     `prune` forwarded to the writer).
   - When `rotationRefusalVerdict` returns a passing verdict (an `ok` inspection preserved,
     including `same-history-ancestor`, which is the #1676 shape where the baseline is still an
     ancestor of HEAD),
     perform a prune-only write through `persistProtectedArtifactSealRotation`, with the prior seal
     as `recomputed` minus the pruned paths. (Without `baseBranch`, inspection already refuses any
     missing sealed path, so no prune can arise there.)
   - Never write when the composed verdict is a refusal.
   - Add optional `fileOperations` to `VerifyProtectedArtifactSealOptions`, forwarded to the writer.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] In the #1676 merge-shape fixture `verifyProtectedArtifactSeal` returns `ok: true`, the persisted seal no longer lists `.docs/plans/<retired>.md` in `protectedArtifacts`, and the observer captured exactly one `protected_artifact_rebaseline` event whose `trigger` is `inherited-base-deletion` and whose `paths` and `deletedBy` equal the persisted entry's; a second `verifyProtectedArtifactSeal` on that pruned seal returns `ok: true`, appends no `rebaselines` entry, and `.docs/plans/<retired>.md` is still absent from `protectedArtifacts`.
- [test] With an `onRebaseline` observer that throws, `verifyProtectedArtifactSeal` in the #1676 merge-shape fixture still persists the prune (the `inherited-base-deletion` entry is in the seal file) and returns a verdict with `ok: true`.
- [test] In the not-yet-rebased fixture (HEAD and disk still hold the file) `verifyProtectedArtifactSeal` returns `ok: true` and the seal file bytes are identical before and after.
- [test] In the rewritten-history fixture the seal's last two `rebaselines` entries are the `inherited-base-deletion` entry then the rotation entry, both produced by a single writer call (one rename observed by an injected `fileOperations` spy).
- [test] The uncommitted-edit-plus-inherited-deletion, feature-authored-plus-inherited-deletion, and #1752 rotation-refused fixtures each return `ok: false` naming the offending path, leave the seal file byte-identical, and in the first fixture `.docs/plans/<retired>.md` remains in `protectedArtifacts`.

**Files likely touched:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — composed-verdict prune gate, `fileOperations` option, rotate prune forwarding
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — verification prune tests

**Dependencies:** Tasks 3, 4

### Task 6: Rotation refusals carry attribution
**Story:** Story 6 happy 3, Story 5 negative 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `describe('stale-seal rebaselining on a rewritten history (#976)'`:
   - A rewritten-history fixture with a feature-authored own-plan non-append amendment and no
     reseal. `verifyProtectedArtifactSeal` fails with the existing `Protected artifact changed:
     <path>` / `Feature-authored committed change: …` lines, plus `Attribution: feature-authored
     (committed on this branch since merge-base <sha>)` using the rotation verdict's `mergeBase`.
   - A `workspace-differs-from-head` refusal appends `Attribution: uncommitted workspace change`.
   - An `engine-append-unvouched` refusal appends the feature-authored attribution.
2. Verify RED.
3. Implement: in `rotationRefusalVerdict`, append `attributionLine(...)` to each path-bearing
   refusal reason. Keep the existing lines byte-identical and the refusal/escalation set unchanged.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] The own-plan non-append rotated-baseline fixture still returns `ok: false` with first line `Protected artifact changed: <plan path>` and second line `Feature-authored committed change: revert to the committed DECIDE content and route any actual amendment to DECIDE.` unchanged, plus a line `Attribution: feature-authored (committed on this branch since merge-base <sha>)` whose sha equals the fixture merge-base.
- [test] A `workspace-differs-from-head` rotation refusal's reason contains the path and `Attribution: uncommitted workspace change`, and an `engine-append-unvouched` refusal's reason contains the path and `Attribution: feature-authored`.
- `rotationRefusalPreservesInspection` and the set of escalating conditions are unchanged, as shown by the pre-existing non-escalation tests passing without edits.

**Files likely touched:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — `rotationRefusalVerdict` attribution
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — rotation attribution tests

**Dependencies:** Task 2

### Task 7: Reseal prunes base-inherited deletions and refuses authored ones with attribution
**Story:** Story 5 happy 1, Story 5 happy 2, Story 5 negative 1, Story 5 negative 2
**Type:** happy-path

**Steps:**
1. Write failing tests under `describe('resealProtectedArtifactSeal'`:
   - #1752 shape: an inherited deletion of `<retired>.md` plus the feature's own plan with a
     committed non-append amendment. Resealing the own plan succeeds. The last two entries are
     `inherited-base-deletion` (with `deletedBy`), then `operator-reseal`. A following
     `verifyProtectedArtifactSeal` returns `ok`.
   - Resealing `<retired>.md` itself, whose deletion is inherited, succeeds. The entry is
     `inherited-base-deletion` with its deleting commit, and the reseal does not throw
     `reseal target is deleted`.
   - Resealing a path the feature deleted in a branch commit throws a message containing the path
     and `Attribution: feature-authored`, and the seal bytes are unchanged.
   - An inherited deletion elsewhere plus an uncommitted edit outside the reseal scope throws for
     the edited path with `Attribution: uncommitted workspace change`, and the bytes are unchanged
     with `<retired>.md` still sealed.
2. Verify RED.
3. Implement in `resealProtectedArtifactSeal`:
   - Run the existing excluded-path `inspectSeal`. Then, for each named path missing from the
     workspace, call `classifyDeletedProtectedArtifact`: inherited targets join the prune set, and
     anything else throws its attributed reason.
   - Pass only the surviving named paths to `createScopedProtectedArtifactSeal`, or skip it when
     none survive.
   - Persist once through `persistProtectedArtifactSealRotation`, passing `prune` (inspection
     `inheritedDeletions` plus pruned targets) only when that set is non-empty, followed by the `operator-reseal` entry listing the
     surviving named paths. When none survive, persist a prune-only write.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] In the #1752 fixture, `resealProtectedArtifactSeal` naming the own plan resolves, the persisted seal's last two `rebaselines` entries have triggers `inherited-base-deletion` (with `deletedBy` mapping `<retired>.md` to the fixture deleting commit) then `operator-reseal`, and a following `verifyProtectedArtifactSeal` returns `ok: true`.
- [test] `resealProtectedArtifactSeal` naming base-inherited-deleted `.docs/plans/<retired>.md` resolves without throwing `reseal target is deleted`, and the persisted seal records `<retired>.md` under an `inherited-base-deletion` entry whose `deletedBy` is the fixture deleting commit.
- [test] `resealProtectedArtifactSeal` naming a feature-committed deleted path rejects with a message containing that path and `Attribution: feature-authored`, and the seal file bytes are unchanged.
- [test] With an inherited deletion elsewhere and an uncommitted edit outside the named paths, `resealProtectedArtifactSeal` rejects with a message naming the edited path and `Attribution: uncommitted workspace change`, the seal bytes are unchanged, and `<retired>.md` remains in `protectedArtifacts`.

**Files likely touched:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — reseal prune and attributed target refusal
- `src/conductor/test/engine/protected-artifact-seal.test.ts` — reseal tests

**Dependencies:** Tasks 3, 4

### Task 8: `conduct reseal` recovers the #1752 shape end to end
**Story:** Story 5 happy 1, Story 5 happy 2, Story 5 negative 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/reseal-cli.test.ts`, driving the CLI entry
   (`runReseal`, the function `reseal-cli.ts` exports for `conduct reseal`) with real git worktree
   fixtures and the real `resealProtectedArtifactSeal`. Inject only `isInteractive: true` and an
   `events` emitter.
   - The #1752 worktree, resealing the own plan with a reason. Exits 0, and a following
     `verifyProtectedArtifactSeal` on the worktree returns `ok`.
   - Resealing an inherited-deleted target. Exits 0, and the seal records its
     `inherited-base-deletion` entry.
   - Resealing a feature-deleted target. Exits non-zero, and the captured
     `protected_artifact_reseal_refused` event's `condition` contains the path and
     `Attribution: feature-authored`.
2. Verify RED, then GREEN (no production change is expected beyond Task 7; if one is needed, it
   stays in `reseal-cli.ts`).
3. Commit.

**Done when:**
- [test] Through the `conduct reseal` CLI handler in `reseal-cli.ts`, the real-git #1752 worktree resealed on its own plan exits 0 and a subsequent `verifyProtectedArtifactSeal` on that worktree returns `ok: true`.
- [test] Through the same CLI handler, resealing the base-inherited-deleted target exits 0 and the worktree seal's last entries include `inherited-base-deletion` with that path's deleting commit in `deletedBy`.
- [test] Through the same CLI handler, resealing a feature-deleted target exits non-zero and the emitted `protected_artifact_reseal_refused` event's `condition` contains the target path and `Attribution: feature-authored`.

**Files likely touched:**
- `src/conductor/test/engine/reseal-cli.test.ts` — CLI integration tests
- `src/conductor/src/engine/reseal-cli.ts` — only if wiring needs adjustment

**Dependencies:** Task 7

### Task 9: Prune events render their paths and deleting commits
**Story:** Story 2 happy 2
**Type:** happy-path

**Steps:**
1. Write failing tests:
   - `renderDaemonEvent` for a `protected_artifact_rebaseline` with
     `trigger: 'inherited-base-deletion'` and a `deletedBy` map renders each pruned path with its
     short deleting commit (`daemon-cli` test file that already covers
     `protected_artifact_rebaseline` rendering; search `seal rebaselined`).
   - The conductor log line (`Protected artifact rebaseline: trigger=…`) includes each
     `path@commit`.
2. Verify RED.
3. Implement:
   - In `daemon-cli.ts` `case 'protected_artifact_rebaseline'`, append
     `; pruned base-deleted paths: <path>@<sha12>, …` when `deletedBy` is present.
   - In `conductor.ts` `surfaceProtectedArtifactRebaseline`, append ` deletedBy=<path>@<sha>,…` when
     present.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] `renderDaemonEvent` on a `protected_artifact_rebaseline` event with `trigger: 'inherited-base-deletion'` and `deletedBy: { '.docs/plans/<a>.md': '<shaA>', '.docs/plans/<b>.md': '<shaB>' }` returns a line containing `.docs/plans/<a>.md@` + the first 12 chars of shaA and `.docs/plans/<b>.md@` + the first 12 chars of shaB.
- [test] The conductor's `Protected artifact rebaseline:` log line for the same event contains `deletedBy=` followed by each path joined to its full deleting sha with `@`.
- [test] Rendering a `protected_artifact_rebaseline` event without `deletedBy` produces the same string as before this change.

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts` — prune rendering
- `src/conductor/src/engine/conductor.ts` — rebaseline log line
- `src/conductor/test/daemon-cli.test.ts` — rendering test (or the existing test file that covers `renderDaemonEvent` for rebaseline events)
- `src/conductor/test/engine/conductor.test.ts` — log line test (or the existing file covering `surfaceProtectedArtifactRebaseline`)

**Dependencies:** Task 1

### Task 10: The BUILD/SHIP dispatch guard builds through a base-inherited deletion
**Story:** Story 1 happy 1, Story 1 happy 2, Story 2 happy 2
**Type:** happy-path

**Steps:**
1. Write a failing integration test in a new
   `src/conductor/test/engine/protected-artifact-seal-inherited-deletion.test.ts`. Follow the
   `manual-rebase-strands-protected-artifact-seal.acceptance.test.ts` pattern: a real `Conductor`
   over a real git feature worktree with an existing seal, a stub `StepRunner`, and events captured
   from `ConductorEventEmitter`.
   - #1752 rebase shape: the base deleted a sealed path in commit `D`, and the feature rebased onto
     it with no other drift.
   - #1676 merge/re-kick shape.

   In both, the next BUILD step dispatches (the stub runner is invoked), no `HALT_MARKER` file
   exists, and exactly one `protected_artifact_rebaseline` event with
   `trigger: 'inherited-base-deletion'` and `deletedBy[path] === D` is emitted.
2. Verify RED, then GREEN (production behavior comes from Task 5).
3. Commit.

**Done when:**
- [test] In the real-git #1752 rebase-shape fixture, the `Conductor` BUILD dispatch guard invokes the stub step runner for the next BUILD step and no `.pipeline/HALT` file exists afterward.
- [test] In the real-git #1676 merge-shape fixture, the `Conductor` BUILD dispatch guard invokes the stub step runner and no `.pipeline/HALT` file exists afterward.
- [test] In each fixture the captured `ConductorEventEmitter` stream contains exactly one `protected_artifact_rebaseline` event whose `trigger` is `inherited-base-deletion` and whose `deletedBy` maps the deleted path to the fixture deleting commit `D`.

**Files likely touched:**
- `src/conductor/test/engine/protected-artifact-seal-inherited-deletion.test.ts` — conductor guard integration test

**Dependencies:** Task 5

### Task 11: Undeterminable deletions never fall back to an authorship label at the guard
**Story:** Story 1 negative 2, Story 1 negative 3, Story 6 negative 1
**Type:** negative-path

**Steps:**
1. Add failing cases to `protected-artifact-seal-inherited-deletion.test.ts`:
   - The base branch configured on the `Conductor` resolves neither `origin/<base>` nor `<base>`,
     and a sealed path is missing.
   - A feature worktree with no merge-base with its base, and a sealed path missing.

   In both, the guard does not dispatch. The surfaced HALT reason begins with `Protected artifact
   provenance undeterminable: <path>`, names the missing ref or the absent merge-base, contains
   `Attribution: provenance undeterminable` and neither `feature-authored` nor `base-inherited`,
   and the seal file bytes are unchanged.
2. Verify RED, then GREEN.
3. Commit.

**Done when:**
- [test] With an unresolvable base ref, the `Conductor` BUILD guard does not invoke the stub runner, its halt reason starts with `Protected artifact provenance undeterminable: <path>` and names the missing base ref, and the seal file bytes are identical before and after.
- [test] With no merge-base, the guard does not invoke the stub runner, its halt reason starts with `Protected artifact provenance undeterminable: <path>` and names the absent merge-base, and the seal file bytes are identical before and after.
- [test] Both halt reasons contain `Attribution: provenance undeterminable` and contain neither `feature-authored` nor `base-inherited`.

**Files likely touched:**
- `src/conductor/test/engine/protected-artifact-seal-inherited-deletion.test.ts` — guard fail-closed tests

**Dependencies:** Task 10

## Task Dependency Graph

```
Task 1 ──┬─> Task 4 ──┬─> Task 5 ──> Task 10 ──> Task 11
         │            └─> Task 7 ──> Task 8
         └─> Task 9
Task 2 ──┬─> Task 3 ──┬─> Task 5
         │            └─> Task 7
         └─> Task 6
```

## Integration Points
- After Task 5, verification prunes inherited deletions through the real verify entry.
- After Task 8, `conduct reseal` recovers the #1752 shape through its CLI handler.
- After Task 10, the BUILD/SHIP dispatch guard builds through both the #1752 and #1676 shapes.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a feature whose seal includes `.docs/plans/<retired>.md`, and the base branch deleted it in commit `D` before the feature rebased onto it, when the BUILD/SHIP step guard verifies the seal, then the verdict is `ok` and the step dispatches with no HALT. | 10 | "In the real-git #1752 rebase-shape fixture, the `Conductor` BUILD dispatch guard invokes the stub step runner for the next BUILD step and no `.pipeline/HALT` file exists afterward." | diff-local |
| Story 1 happy: Given the same feature on its re-kick path, where the base was merged in and the seal baseline is still an ancestor of HEAD (the #1676 shape), when the seal is verified, then the verdict is `ok`. | 5, 10 | "In the #1676 merge-shape fixture `verifyProtectedArtifactSeal` returns `ok: true`" | diff-local |
| Story 1 happy: Given the deletion was pruned by an earlier verification, when the seal is verified again, then the verdict is `ok` and `.docs/plans/<retired>.md` is no longer among the seal's `protectedArtifacts`. | 5 | "a second `verifyProtectedArtifactSeal` on that pruned seal returns `ok: true`, appends no `rebaselines` entry, and `.docs/plans/<retired>.md` is still absent from `protectedArtifacts`." | diff-local |
| Story 1 negative: Given the base branch deleted `.docs/plans/<retired>.md` but the feature has not yet rebased or merged the base (HEAD still contains the file and it is still on disk), when the seal is verified, then the verdict is `ok` and the seal is unchanged, because nothing is missing. | 5 | "In the not-yet-rebased fixture (HEAD and disk still hold the file) `verifyProtectedArtifactSeal` returns `ok: true` and the seal file bytes are identical before and after." | diff-local |
| Story 1 negative: Given the feature's base branch cannot be resolved (`origin/<base>` and `<base>` are both missing) and a sealed path is missing from the workspace, when the seal is verified, then it refuses with `Protected artifact provenance undeterminable: <path>`, names the missing base ref, and leaves the seal file byte-for-byte unchanged. | 3, 11 | "With an unresolvable base ref, the `Conductor` BUILD guard does not invoke the stub runner, its halt reason starts with `Protected artifact provenance undeterminable: <path>` and names the missing base ref, and the seal file bytes are identical before and after." | diff-local |
| Story 1 negative: Given HEAD and the base branch have no merge-base and a sealed path is missing, when the seal is verified, then it refuses with `Protected artifact provenance undeterminable: <path>`, naming the absent merge-base, and the seal is unchanged. | 3, 11 | "With no merge-base, the guard does not invoke the stub runner, its halt reason starts with `Protected artifact provenance undeterminable: <path>` and names the absent merge-base, and the seal file bytes are identical before and after." | diff-local |
| Story 2 happy: Given a base-inherited deletion of `.docs/plans/<retired>.md` by base commit `D`, when verification prunes it, then the persisted seal has a new last `rebaselines` entry with `trigger: "inherited-base-deletion"`, `paths: [".docs/plans/<retired>.md"]`, `deletedBy: {".docs/plans/<retired>.md": "<D>"}`, and `fromCommit` and `toCommit` both equal to the unchanged `baselineCommit`. | 4 | "After a one-path prune the persisted seal's last `rebaselines` entry deep-equals `{ fromCommit: B, toCommit: B, trigger: 'inherited-base-deletion', paths: ['.docs/plans/<retired>.md'], deletedBy: { '.docs/plans/<retired>.md': D } }`, `baselineCommit` is still `B`, and the path is absent from `protectedArtifacts`." | diff-local |
| Story 2 happy: Given the same prune, when it completes, then exactly one `protected_artifact_rebaseline` event is emitted with `trigger: "inherited-base-deletion"`, the pruned paths, and the same `deletedBy` map. The daemon log line and the `daemon-cli` rendering name each pruned path with its deleting commit. | 5, 9, 10 | "In the #1676 merge-shape fixture `verifyProtectedArtifactSeal` returns `ok: true`, the persisted seal no longer lists `.docs/plans/<retired>.md` in `protectedArtifacts`, and the observer captured exactly one `protected_artifact_rebaseline` event whose `trigger` is `inherited-base-deletion` and whose `paths` and `deletedBy` equal the persisted entry's" | diff-local |
| Story 2 happy: Given two sealed paths deleted by two different base commits, when verification prunes both, then one `rebaselines` entry lists both paths and `deletedBy` maps each one to its own deleting commit. | 4 | "After a two-path prune with different deleting commits, exactly one appended `inherited-base-deletion` entry lists both paths and its `deletedBy` maps each path to its own fixture commit." | diff-local |
| Story 2 happy: Given a seal file that contains an `inherited-base-deletion` entry with `deletedBy`, when the seal is read back, then it parses as a valid `version: 2` seal. A seal written before this change, with no `deletedBy`, also still parses. | 1 | "The seal reader returns a version-2 seal whose `inherited-base-deletion` entry keeps its `deletedBy` map key-for-key, and also reads a seal file with no `deletedBy`." | diff-local |
| Story 2 negative: Given a base-inherited deletion whose deleting commit cannot be found on the base ref (for example, base history was truncated), when the seal is verified, then it refuses with `Protected artifact provenance undeterminable: <path>` and the line `Deleting base commit not found.`, and writes no prune. | 3 | "The missing-base-ref, no-merge-base, and deleting-commit-not-found fixtures each refuse with `Protected artifact provenance undeterminable: <path>` (naming the missing ref, the absent merge-base, and `Deleting base commit not found.` respectively), and every refusal fixture's seal file bytes are identical before and after." | diff-local |
| Story 2 negative: Given a seal file whose rebaseline entry has a `deletedBy` value that is not an object of string commits, when the seal is read, then reading fails with `Protected artifact seal is invalid`. | 1 | "The seal reader rejects each malformed `deletedBy` fixture (array, string, object with a numeric value) with the error `Protected artifact seal is invalid`." | diff-local |
| Story 2 negative: Given the rebaseline observer throws while the prune event is emitted, when verification prunes, then the seal write still persists and the verdict is still `ok`, because telemetry is best-effort. | 5 | "With an `onRebaseline` observer that throws, `verifyProtectedArtifactSeal` in the #1676 merge-shape fixture still persists the prune (the `inherited-base-deletion` entry is in the seal file) and returns a verdict with `ok: true`." | diff-local |
| Story 3 happy: Given a feature branch with a commit that deletes sealed `.docs/stories/<own>.md` after its merge-base, when the seal is verified, then it refuses with `Protected artifact deleted: .docs/stories/<own>.md` followed by `Attribution: feature-authored (committed on this branch since merge-base <sha>)`, and the seal is unchanged. | 3 | "The committed-deletion fixture refuses with exactly `Protected artifact deleted: .docs/stories/<own>.md` followed by `Attribution: feature-authored (committed on this branch since merge-base <sha>)`, and the uncommitted-deletion fixture refuses with `Protected artifact deleted: .docs/plans/<x>.md` followed by `Attribution: uncommitted workspace change`." | diff-local |
| Story 3 happy: Given sealed `.docs/plans/<x>.md` is removed from disk but still present in HEAD, when the seal is verified, then it refuses with `Protected artifact deleted: .docs/plans/<x>.md` followed by `Attribution: uncommitted workspace change`, and the seal is unchanged. | 3 | "The committed-deletion fixture refuses with exactly `Protected artifact deleted: .docs/stories/<own>.md` followed by `Attribution: feature-authored (committed on this branch since merge-base <sha>)`, and the uncommitted-deletion fixture refuses with `Protected artifact deleted: .docs/plans/<x>.md` followed by `Attribution: uncommitted workspace change`." | diff-local |
| Story 3 negative: Given the feature committed a deletion of sealed `.docs/plans/<retired>.md` after its merge-base and the base branch later deleted the same path too, but the feature has not yet rebased onto it, when the seal is verified, then it refuses as feature-authored for that path and prunes nothing. | 3 | "The deleted-then-base-also-deleted-without-rebase fixture and the base-still-has-<kept>.md fixture both refuse as feature-authored with no `inheritedDeletions`, and the execa spy records zero `git log --diff-filter=D` invocations for `.docs/plans/<kept>.md`." | diff-local |
| Story 3 negative: Given the base branch never contained a deletion of sealed `.docs/plans/<kept>.md` (it still exists on the base tip), and the feature's branch commit deleted it, when the seal is verified, then it refuses as feature-authored and no `git log` deleting-commit lookup is attempted for it. | 3 | "The deleted-then-base-also-deleted-without-rebase fixture and the base-still-has-<kept>.md fixture both refuse as feature-authored with no `inheritedDeletions`, and the execa spy records zero `git log --diff-filter=D` invocations for `.docs/plans/<kept>.md`." | diff-local |
| Story 4 happy: Given a base-inherited deletion and no other drift, when the seal is verified, then the prune is persisted and the verdict is `ok`. | 5 | "In the #1676 merge-shape fixture `verifyProtectedArtifactSeal` returns `ok: true`, the persisted seal no longer lists `.docs/plans/<retired>.md` in `protectedArtifacts`, and the observer captured exactly one `protected_artifact_rebaseline` event whose `trigger` is `inherited-base-deletion` and whose `paths` and `deletedBy` equal the persisted entry's" | diff-local |
| Story 4 happy: Given a base-inherited deletion on a rewritten history where rotation is permitted, when the seal is verified, then one atomic write persists the `inherited-base-deletion` entry immediately followed by the rotation's own `rebaselines` entry. | 5 | "In the rewritten-history fixture the seal's last two `rebaselines` entries are the `inherited-base-deletion` entry then the rotation entry, both produced by a single writer call (one rename observed by an injected `fileOperations` spy)." | diff-local |
| Story 4 negative: Given a base-inherited deletion of `.docs/plans/<retired>.md` together with an uncommitted edit to a different sealed artifact, when the seal is verified, then it refuses for the edited artifact, persists no prune, and `.docs/plans/<retired>.md` is still in the seal. | 5 | "The uncommitted-edit-plus-inherited-deletion, feature-authored-plus-inherited-deletion, and #1752 rotation-refused fixtures each return `ok: false` naming the offending path, leave the seal file byte-identical, and in the first fixture `.docs/plans/<retired>.md` remains in `protectedArtifacts`." | diff-local |
| Story 4 negative: Given a base-inherited deletion together with a feature-authored deletion of another path, when the seal is verified, then it refuses naming the feature-authored path, and neither path is pruned. | 5 | "The uncommitted-edit-plus-inherited-deletion, feature-authored-plus-inherited-deletion, and #1752 rotation-refused fixtures each return `ok: false` naming the offending path, leave the seal file byte-identical, and in the first fixture `.docs/plans/<retired>.md` remains in `protectedArtifacts`." | diff-local |
| Story 4 negative: Given a base-inherited deletion, an inspection that otherwise passes, and a rotation refused as `head-differs-from-base` for a feature-authored path (the #1752 shape), when the seal is verified, then it halts naming the feature-authored path, persists no prune, and the seal file is byte-identical. | 5 | "The uncommitted-edit-plus-inherited-deletion, feature-authored-plus-inherited-deletion, and #1752 rotation-refused fixtures each return `ok: false` naming the offending path, leave the seal file byte-identical, and in the first fixture `.docs/plans/<retired>.md` remains in `protectedArtifacts`." | diff-local |
| Story 4 negative: Given the atomic seal write fails (the rename throws), when verification attempts the prune, then the original seal file is unchanged, no temporary file is left in `.pipeline/`, no `protected_artifact_rebaseline` event is emitted, and the error surfaces to the caller. | 4 | "With an injected `rename` that throws, the seal file bytes are identical to before, no `.protected-artifact-seal.json.*.tmp` file exists in `.pipeline/`, the observer received zero `protected_artifact_rebaseline` notifications, and the call rejects with the injected error." | diff-local |
| Story 5 happy: Given the #1752 shape: a base-inherited deletion of `.docs/plans/<retired>.md`, plus the feature's own plan carrying a committed non-append amendment that rotation refuses as `head-differs-from-base`. When the operator runs `conduct reseal` naming the feature's own plan with a reason, then the reseal succeeds. The persisted seal carries an `inherited-base-deletion` entry followed by an `operator-reseal` entry. The next seal verification returns `ok`. | 7, 8 | "In the #1752 fixture, `resealProtectedArtifactSeal` naming the own plan resolves, the persisted seal's last two `rebaselines` entries have triggers `inherited-base-deletion` (with `deletedBy` mapping `<retired>.md` to the fixture deleting commit) then `operator-reseal`, and a following `verifyProtectedArtifactSeal` returns `ok: true`." | diff-local |
| Story 5 happy: Given a reseal that names `.docs/plans/<retired>.md` itself, where that deletion is base-inherited, when the operator runs `conduct reseal` on it, then the target is pruned (recorded under `inherited-base-deletion` with its deleting commit) and the reseal succeeds, not refusing with "reseal target is deleted". | 7, 8 | "`resealProtectedArtifactSeal` naming base-inherited-deleted `.docs/plans/<retired>.md` resolves without throwing `reseal target is deleted`, and the persisted seal records `<retired>.md` under an `inherited-base-deletion` entry whose `deletedBy` is the fixture deleting commit." | diff-local |
| Story 5 negative: Given a reseal that names a sealed path the feature itself deleted in a branch commit, when the operator runs `conduct reseal` on it, then it refuses with the target named and `Attribution: feature-authored`, emits `reseal_refused` with that reason as its `condition`, and leaves the seal unchanged. | 7, 8 | "Through the same CLI handler, resealing a feature-deleted target exits non-zero and the emitted `protected_artifact_reseal_refused` event's `condition` contains the target path and `Attribution: feature-authored`." | diff-local |
| Story 5 negative: Given a base-inherited deletion elsewhere and an uncommitted edit on a sealed path outside the reseal scope, when the operator runs `conduct reseal`, then it refuses for the out-of-scope edit, with attribution `uncommitted workspace change`, and prunes nothing. | 7 | "With an inherited deletion elsewhere and an uncommitted edit outside the named paths, `resealProtectedArtifactSeal` rejects with a message naming the edited path and `Attribution: uncommitted workspace change`, the seal bytes are unchanged, and `<retired>.md` remains in `protectedArtifacts`." | diff-local |
| Story 5 negative: Given the feature's own plan differs from base only by a non-append line, and no reseal has been run, when the BUILD step guard verifies the seal on a rotated (non-ancestor) baseline, then the existing rotation refusal for that plan still halts exactly as before this change (ADR-9 keeps it out of scope). | 6 | "The own-plan non-append rotated-baseline fixture still returns `ok: false` with first line `Protected artifact changed: <plan path>` and second line `Feature-authored committed change: revert to the committed DECIDE content and route any actual amendment to DECIDE.` unchanged, plus a line `Attribution: feature-authored (committed on this branch since merge-base <sha>)` whose sha equals the fixture merge-base." | diff-local |
| Story 6 happy: Given a committed feature amendment to another feature's sealed artifact, when the seal is verified, then the refusal reads `Protected artifact changed: <path>` followed by `Attribution: feature-authored (committed on this branch since merge-base <sha>)`. | 2 | "`inspectSeal` via `verifyProtectedArtifactSeal` refuses a committed feature edit with reason lines `Protected artifact changed: <path>` then `Attribution: feature-authored (committed on this branch since merge-base <sha>)`, and `<sha>` equals the fixture's `git merge-base` output." | diff-local |
| Story 6 happy: Given an uncommitted edit to a sealed artifact, when the seal is verified, then the refusal names the path with `Attribution: uncommitted workspace change`. | 2 | "`inspectSeal` refuses an uncommitted sealed-artifact edit with a reason containing the path and `Attribution: uncommitted workspace change`." | diff-local |
| Story 6 happy: Given a rotation refusal of `head-differs-from-base` for a feature-authored path, when it escalates, then the HALT reason names the path with `Attribution: feature-authored`. | 6 | "The own-plan non-append rotated-baseline fixture still returns `ok: false` with first line `Protected artifact changed: <plan path>` and second line `Feature-authored committed change: revert to the committed DECIDE content and route any actual amendment to DECIDE.` unchanged, plus a line `Attribution: feature-authored (committed on this branch since merge-base <sha>)` whose sha equals the fixture merge-base." | diff-local |
| Story 6 negative: Given any refusal whose provenance probe could not run (missing base ref, no merge-base, or a failed git probe), when the seal is verified, then the reason names the path with `Attribution: provenance undeterminable` and never with `feature-authored` or `base-inherited`. | 2, 11 | "The missing-base-ref, no-merge-base, and failed-diff-probe fixtures each refuse with `Protected artifact provenance undeterminable: <path>` plus `Attribution: provenance undeterminable`, and none of those reasons contains `feature-authored` or `base-inherited`." | diff-local |
| Story 6 negative: Given a base-inherited change or deletion, when the seal is verified with no other drift, then no refusal is produced at all. A base-inherited path never appears in a refusal for its own drift. | 3 | "A base-inherited-change-only fixture and a base-inherited change-plus-deletion fixture each return `ok: true` with no refusal reason, and the same change-plus-deletion fixture with an added uncommitted edit to another sealed path refuses with a reason that names the edited path and contains neither base-inherited path." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-07-prune-base-inherited-deletions-from-the-seal#D1 | task | task-3 | For the rebased base-deletion fixture, `inspectSeal` (through `verifyProtectedArtifactSeal` with no existing seal and a `baselineCommit`) returns `ok: true` with `inheritedDeletions` |
| adr-2026-10-07-prune-base-inherited-deletions-from-the-seal#D2 | task | task-3 | The missing-base-ref, no-merge-base, and deleting-commit-not-found fixtures each refuse with `Protected artifact provenance undeterminable: <path>` |
| adr-2026-10-07-prune-base-inherited-deletions-from-the-seal#D3 | task | task-4, task-5 | After a one-path prune the persisted seal's last `rebaselines` entry deep-equals |
| adr-2026-10-07-prune-base-inherited-deletions-from-the-seal#D4 | task | task-5 | each return `ok: false` naming the offending path, leave the seal file byte-identical |
| adr-2026-10-07-prune-base-inherited-deletions-from-the-seal#D5 | task | task-3 | `Deleting base commit not found.` respectively), and every refusal fixture's seal file bytes are identical before and after. |
| adr-2026-10-07-prune-base-inherited-deletions-from-the-seal#D6 | task | task-3 | The committed-deletion fixture refuses with exactly `Protected artifact deleted: .docs/stories/<own>.md` followed by `Attribution: feature-authored (committed on this branch since merge-base <sha>)` |
| adr-2026-10-07-prune-base-inherited-deletions-from-the-seal#D7 | task | task-2, task-6 | refuses a committed feature edit with reason lines `Protected artifact changed: <path>` then `Attribution: feature-authored (committed on this branch since merge-base <sha>)` |
| adr-2026-10-07-prune-base-inherited-deletions-from-the-seal#D8 | task | task-7, task-8 | naming base-inherited-deleted `.docs/plans/<retired>.md` resolves without throwing `reseal target is deleted` |
| adr-2026-10-07-prune-base-inherited-deletions-from-the-seal#D9 | task | task-6 | The own-plan non-append rotated-baseline fixture still returns `ok: false` with first line `Protected artifact changed: <plan path>` |

## Verification
- [ ] All happy-path criteria are covered by at least one task.
- [ ] All negative-path criteria are covered by at least one task.
- [ ] No task exceeds 5 minutes of work.
- [ ] Every task has a `Done when:` block of falsifiable checks.
- [ ] Dependencies are explicit and acyclic.
