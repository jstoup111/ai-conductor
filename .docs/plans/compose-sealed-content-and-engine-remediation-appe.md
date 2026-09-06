# Implementation Plan: Compose sealed content and engine remediation appends in seal rotation

**Date:** 2026-09-06
**Stories:** .docs/stories/compose-sealed-content-and-engine-remediation-appe.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the approved seal-rebaseline and provenance-inheritance decisions, which require workspace-equals-HEAD, provable non-feature authorship, and fail-closed treatment of indeterminate provenance. None of those tests is relaxed here.

## Summary

Four bounded tasks deliver #2120 by widening the engine-append exception's anchor from the base-branch tip alone to the base tip plus the seal's own verified baseline content, keeping every feature-authored amendment refused, and splitting the refusal wording and telemetry so an operator can see which authorship exit declined. The reseal command, its terminal gate, the remediation append renderer, and halt retention across base advances are outside this slice.

## Technical Approach

The rotation evaluator already carries a single exception for the engine's own remediation append: `isEngineAppendedRemediationAmendment` accepts an authored path when the base-branch-tip buffer is a byte prefix of the committed HEAD buffer and every heading in the remaining suffix names a task id the engine recorded. After an operator reseal, the sealed bytes are no longer the base-tip bytes, so that single anchor cannot describe the legitimate state and the verdict falls through to a feature-authored refusal.

Add a second admissible anchor rather than a second predicate: the seal's own baseline content for the path. The evaluator gains an optional `sealedArtifacts` map and tries the unchanged prefix predicate against the base-tip buffer first and the sealed buffer second. The sealed buffer is trusted only when its own fingerprint equals the seal's recorded fingerprint for that path, so a derived anchor that disagrees with the seal can never widen the gate; it is discarded and the base-tip decision stands. Both anchors compose because acceptance still requires the entire divergence to be recorded appended blocks, so a feature edit either lands in the prefix and breaks byte equality or lands in the suffix and breaks the recorded-heading rule.

The in-repository resolver supplies that map from `protectedArtifactsAtCommit(projectRoot, seal.baselineCommit)`. That is exactly where the seal's fingerprints came from: the seal builder fingerprints `contentAtCommit(baselineCommit, path)`, the defensive rotation replaces the whole seal at the post-rotation commit, and the operator reseal persists its scoped result with `baselineCommit` set to the reseal target. An unreadable baseline commit degrades to no map, which is today's base-tip-only behavior — fail closed, never fail open. This adds one read-only Git read on a path that already performs several, and only when the ancestry check has already failed.

For the refusal, add one condition alongside the existing `head-differs-from-base`, returned when the engine recorded appended task ids and the committed content for the refused path carries a heading for at least one of them. That condition selects a distinct verdict reason describing an unvouched engine append instead of instructing a revert, and the refusal carries two short exit-outcome values — one for the operator-reseal exit, one for the engine-append exit — that are rendered into the reason and added as optional fields on the existing `protected_artifact_rebaseline_refused` variant. This extends the existing event spine: an additive field on an existing variant, no new variant, no sidecar, no second reader. The existing refusal-preserving set is not touched, so the new condition escalates exactly as the refusal it replaces.

Local test pattern for this work: the module's existing suite exercises the pure evaluator directly with hand-built buffer maps and seal objects, and exercises the in-repository entry point against a real temporary Git repository created with `mkdtemp`, a pinned initial branch, and local identity. Those traits fit because the behavior under test is a pure decision plus a read-only Git read, and Git semantics are the boundary. Allowed variation: fixture builders and assertion grouping. Find comparable cases by searching the seal test file for the existing rotation-verdict and engine-append cases and for its temporary-repository helpers. No third-party service, provider, or network call is involved, and no full conductor run is warranted.

## Preconditions and claim ledger

- Operator approved the Small tier, the technical track, the sealed-baseline anchor over prefix reconstruction, and all three stories on 2026-09-06 (delegated).
- Verified: `isEngineAppendedRemediationAmendment` refuses unless the supplied base buffer is a byte prefix of the head buffer, and `evaluateProtectedArtifactSealRotation` supplies it the base-tip buffer for the path.
- Verified: the operator-reseal exit in the same authored branch requires the seal's recorded fingerprint to equal the workspace fingerprint, so it cannot cover content that a later append changed.
- Verified: the seal builder fingerprints `contentAtCommit(options.baselineCommit, path)`, so sealed bytes for a path are that path's blob at the seal's baseline commit.
- Verified: the scoped operator reseal persists its recomputed seal with `baselineCommit` overridden to the reseal target commit, and the defensive rotation replaces the whole seal at the post-rotation commit.
- Verified: `protectedArtifactsAtCommit` already returns protected blobs at an arbitrary commit and is already used for the head and base-tip maps.
- Verified: `appendRemediationTasks` returns `planText + separator + blocks.join('\n')`, a pure suffix append whose rendered ids are always `rem-` prefixed, so a recorded id can never collide with an approved numeric task id.
- Verified: the refusal reason text and the refusal event emission both live in this same engine module, and the daemon renderer prints the condition strings without an exhaustive switch, so one added condition value needs no consumer change.
- Scope check: harness-repo-only, no new skill, provider-agnostic. Event spine: an additive optional field on an existing refusal variant; no new channel.
- Verify-claims verdict: CLEAR. Every path, symbol, and behavior cited above was read in this worktree. No pending assumption changes the approach.

## Tasks

### Task 1: Admit the seal's own baseline content as a second append anchor
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/protected-artifact-seal.ts, src/conductor/test/engine/protected-artifact-seal.test.ts
**Dependencies:** none

**Steps:**
1. Add table-driven evaluator cases over the pure rotation function with hand-built buffer maps: an authored artifact whose sealed buffer is a byte prefix of head and whose suffix is exactly recorded task blocks; the same case with the base tip as prefix instead; and a case whose supplied sealed buffer hashes to something other than the seal's recorded fingerprint for that path. Build seals and maps inline as the existing rotation cases in this file do; do not stub the predicate under test.
2. Establish RED on the resealed-then-appended case, which today falls through to a feature-authored refusal.
3. Add an optional sealed-content map to the evaluator input and, in the authored branch, try the unchanged append predicate against the base-tip buffer and then against the sealed buffer. Use the sealed buffer only when hashing it with the module's existing fingerprint helper reproduces the seal's recorded fingerprint for that path; otherwise ignore it entirely. Keep the accepted path in the existing engine-appended inclusion list and leave the operator-reseal exclusion branch untouched.
4. Run the module's scoped test file and the test-inclusive typecheck to GREEN and commit the focused change.

**Done when:**
1. An evaluator case whose sealed buffer is a byte prefix of head and whose suffix is exactly recorded task blocks returns a permitted verdict listing that path as an engine-appended inclusion.
2. An evaluator case anchored only by the base tip returns the same permitted verdict it returns today when no sealed map is supplied.
3. An evaluator case whose supplied sealed buffer disagrees with the seal's recorded fingerprint returns the identical refusal the same case returns with no sealed map at all.

### Task 2: Supply the verified sealed baseline from the repository
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/protected-artifact-seal.ts, src/conductor/test/engine/protected-artifact-seal.test.ts
**Dependencies:** 1

**Steps:**
1. Extend the file's real-temporary-repository fixtures to build a feature history that seals a protected artifact, records an operator reseal of it at a later commit, and then commits an engine append of recorded task blocks on top. Create the repository with the existing temporary-directory helper, pin the initial branch, set local identity, and add no remote. Read recorded appended ids from the same engine-state file the production reader consults.
2. Establish RED through the in-repository evaluator entry point, which today refuses that history as feature-authored.
3. In that entry point, read protected blobs at the seal's baseline commit with the existing commit-content helper, degrade a failed read to no map, and pass the result to the evaluator. Add no new Git subcommand and no seal write on this path.
4. Add the companion case whose seal baseline commit is unresolvable and assert the evaluation still completes with the base-tip-only verdict. Run the scoped test file and the test-inclusive typecheck, then commit.

**Done when:**
1. Through the in-repository evaluator on a real local Git history of seal, operator reseal, then engine append, the verdict is permitted and names that artifact as an engine-appended inclusion.
2. Through the same entry point with an unresolvable seal baseline commit, the evaluation completes without throwing and returns the verdict the base-tip anchor alone produces.
3. The evaluation path adds no Git invocation outside the existing read-only commit-content helpers and writes no seal file.

### Task 3: Keep feature-authored amendments refused under both anchors
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/src/engine/protected-artifact-seal.ts, src/conductor/test/engine/protected-artifact-seal.test.ts
**Dependencies:** 1

**Steps:**
1. Add evaluator cases that supply a valid sealed anchor and still must refuse: head carrying recorded task blocks plus an in-place edit to content preceding them in the same committed content; head whose suffix carries a task heading with an id the engine never recorded; head whose suffix carries a non-task markdown heading; and head with recorded blocks but an empty recorded-id list.
2. Establish RED for any case the Task 1 change would otherwise let through, then adjust only the acceptance conditions needed so all four refuse. Do not add an escape for a path whose divergence is not wholly recorded blocks.
3. Assert the refusal names the offending path in every case, and assert that no case with an empty recorded-id list reaches a permitted verdict under either anchor.
4. Run the scoped test file and the test-inclusive typecheck, then commit.

**Done when:**
1. An evaluator case mixing recorded task blocks with an in-place edit to preceding content returns a refusal naming that path.
2. An evaluator case whose suffix carries an unrecorded task heading, and one whose suffix carries a non-task markdown heading, each return a refusal naming that path.
3. With an empty recorded-appended-id list, no authored path reaches a permitted verdict under either the base-tip or the sealed anchor.

### Task 4: Name the consulted authorship exit in the refusal and its telemetry
**Story:** Story 3
**Type:** happy-path
**Files:** src/conductor/src/engine/protected-artifact-seal.ts, src/conductor/src/types/events.ts, src/conductor/test/engine/protected-artifact-seal.test.ts
**Dependencies:** 2

**Steps:**
1. Add cases asserting the produced verdict text and the emitted refusal event for two refusals: one whose committed content for the refused path carries a heading for at least one recorded appended id, and one whose committed content carries none. Capture the emitted event through the module's existing observer parameter rather than a new channel.
2. Establish RED: both refusals produce the same feature-authored revert instruction today, and neither carries an exit outcome.
3. Add one refusal condition beside the existing head-differs-from-base value, returned only when the engine recorded appended ids and the refused path's committed content carries a heading for one of them. Carry two short exit-outcome values on the refusal — one for the operator-reseal exit, one for the engine-append exit — and render them into a distinct reason that reports an unvouched engine append and gives no revert instruction. Add the condition value and the two optional fields to the existing refusal variant in the shared event type; add no new variant.
4. Leave the set of refusal conditions that preserve a passing inspection untouched, assert the new condition escalates, and confirm the existing condition and verdict-condition strings are unchanged for a refusal with no recorded append. Run the scoped test files and the test-inclusive typecheck, then commit.

**Done when:**
1. A refusal on a path whose committed content carries a recorded appended-task heading produces verdict text that reports an unvouched engine append and contains no instruction to revert committed content.
2. A refusal on a path whose committed content carries no recorded appended-task heading produces verdict text byte-identical to the feature-authored reason in force today.
3. Every emitted rotation-refusal event naming a path carries both the operator-reseal exit outcome and the engine-append exit outcome, and the existing condition and verdict-condition strings are unchanged for a path with no recorded append.
4. The new condition is absent from the refusal-preserving set, so a passing inspection is escalated for it exactly as it is for the refusal it replaces.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a sealed artifact whose content at the seal's baseline commit matches the seal's recorded fingerprint for that path, and a committed HEAD that extends exactly that content with only the engine's recorded remediation-task blocks, when seal rotation is evaluated, then the path is accepted as an engine append and rotation is permitted. | 1, 2 | "An evaluator case whose sealed buffer is a byte prefix of head and whose suffix is exactly recorded task blocks returns a permitted verdict listing that path as an engine-appended inclusion." | diff-local |
| Story 1 happy: Given a sealed artifact whose base-branch-tip content is still a byte prefix of the committed HEAD content, when seal rotation is evaluated, then the engine append is accepted exactly as it is accepted today. | 1 | "An evaluator case anchored only by the base tip returns the same permitted verdict it returns today when no sealed map is supplied." | diff-local |
| Story 1 negative: Given the content at the seal's baseline commit does not match the seal's recorded fingerprint for that path, when seal rotation is evaluated, then that anchor is discarded and the verdict is the one the base-tip anchor alone produces. | 1 | "An evaluator case whose supplied sealed buffer disagrees with the seal's recorded fingerprint returns the identical refusal the same case returns with no sealed map at all." | diff-local |
| Story 1 negative: Given the seal's baseline commit cannot be read in the repository, when seal rotation is evaluated there, then no sealed-baseline anchor is supplied and the verdict is the one the base-tip anchor alone produces. | 2 | "Through the same entry point with an unresolvable seal baseline commit, the evaluation completes without throwing and returns the verdict the base-tip anchor alone produces." | diff-local |
| Story 2 happy: Given a committed HEAD whose divergence from every admissible anchor includes content the engine never recorded, when seal rotation is evaluated, then rotation refuses and the feature halts as it does today. | 3 | "With an empty recorded-appended-id list, no authored path reaches a permitted verdict under either the base-tip or the sealed anchor." | diff-local |
| Story 2 negative: Given one commit that carries both recorded remediation-task blocks and an in-place edit to content preceding them, when seal rotation is evaluated, then rotation refuses. | 3 | "An evaluator case mixing recorded task blocks with an in-place edit to preceding content returns a refusal naming that path." | diff-local |
| Story 2 negative: Given an appended suffix carrying a task heading whose id the engine never recorded, or any other markdown heading, when seal rotation is evaluated, then rotation refuses. | 3 | "An evaluator case whose suffix carries an unrecorded task heading, and one whose suffix carries a non-task markdown heading, each return a refusal naming that path." | diff-local |
| Story 3 happy: Given a rotation refusal on a path whose committed content carries a heading for at least one recorded appended remediation-task id, when the seal verdict text is produced, then it reports an unvouched engine append and does not instruct the operator to revert the committed DECIDE content. | 4 | "A refusal on a path whose committed content carries a recorded appended-task heading produces verdict text that reports an unvouched engine append and contains no instruction to revert committed content." | diff-local |
| Story 3 happy: Given any rotation refusal naming a path, when the refusal event is emitted, then it carries the outcome of the operator-reseal exit and the outcome of the engine-append exit for that path. | 4 | "Every emitted rotation-refusal event naming a path carries both the operator-reseal exit outcome and the engine-append exit outcome, and the existing condition and verdict-condition strings are unchanged for a path with no recorded append." | diff-local |
| Story 3 negative: Given a rotation refusal on a path whose committed content carries no recorded appended remediation-task heading, when the seal verdict text is produced, then it is the feature-authored wording in force today, unchanged. | 4 | "A refusal on a path whose committed content carries no recorded appended-task heading produces verdict text byte-identical to the feature-authored reason in force today." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled fixtures. Task 1 and Task 3 own unit-level cases over the pure rotation evaluator with hand-built buffer maps and seal objects. Task 2 owns the single cross-boundary integration proof: the in-repository evaluator entry point driven against a real temporary Git repository, which is the only boundary this change reaches; that boundary is Git semantics, exercised locally with no remote, no network, no provider, and no third-party service. Task 4 owns the verdict-text and refusal-event cases, observed through the module's existing observer parameter. The module's existing rotation, inspection, and reseal cases remain authoritative for every behavior this slice does not change; no aggregate, smoke, or external-service test is added, and no terminal validation task exists.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 4
Task 1 -> Task 3
