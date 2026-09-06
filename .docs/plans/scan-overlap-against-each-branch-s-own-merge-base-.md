# Implementation Plan: Scan overlap against each branch's own merge-base diff

**Date:** 2026-09-06
**Stories:** .docs/stories/scan-overlap-against-each-branch-s-own-merge-base-.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; scoped intent conforms to the governing approved ADR for this scan — a deterministic, stateless, advisory primitive that reuses the shared changed-paths helper, degrades through skip notes, and never blocks authoring.

## Summary

Three bounded tasks deliver #1650 by correcting the single per-branch comparison the advisory overlap scan performs. Branch enumeration policy, the path-intersection rule, the blocker sweep, the rendered line formats, the command surface, and the behaviour of a candidate path that does not exist are outside this small slice.

## Technical Approach

The scan's per-branch step asks the shared changed-paths helper for `git diff --name-only <base> <branch>`. That is a two-endpoint comparison, so its result is every difference between the two tips — which includes every path the base itself changed after the branch forked. Every long-lived sibling branch therefore appears to "touch" most of the repository, which is exactly the reported ~100% false-positive rate. The correct question is what the branch contributes: the paths changed between the branch's merge base with the base ref and the branch itself.

Add `changedPathsSinceMergeBase(git, baseRef, branchRef)` beside the existing helper in the rebase module, which is already the engine's home for git range helpers and already resolves merge bases elsewhere in the same file. It runs `merge-base <baseRef> <branchRef>`, and on success delegates to the existing two-endpoint helper with the resolved commit as the from-ref — so the parsing, trimming, and empty-line filtering stay in one place and the existing helper's other four callers are untouched. Keep the existing helper's non-throwing contract: a merge-base call that exits non-zero or prints nothing returns a distinguishable no-result value (`null`) rather than an empty path list, because an empty list and an unanswerable question mean opposite things to the caller.

In the scan loop, replace the one two-endpoint call with the new helper and push an advisory note naming the branch when the helper returns the no-result value. The loop already carries a per-branch try/catch that records a skip note, so a thrown diff failure keeps its current behaviour and the remaining branches keep theirs; the new note is the same shape for the one refusal mode that is not an exception. Unrelated histories and shallow clones are the realistic causes, and both are rare enough that the note is signal rather than noise. Nothing else in the module changes: enumeration still drops refs with zero commits ahead of the base, intersection still matches on exact normalised path equality, the blocker sweep is untouched, and the renderer emits the same line shapes, so the clean-report line still appears exactly when there are no overlaps, blockers, indeterminates, or notes.

Follow the repository's existing test patterns rather than inventing new ones. The engine unit suites for both modules use a scripted git runner that matches argv prefixes to canned results, which makes a merge-base refusal and a diff refusal expressible without a repository; use it for every pure comparison case and for the advisory-note cases. The command-level suite for this subcommand already builds a real local git repository, forks a `spec/*` sibling branch, and drives the exported command function with the real git runner and no linked issue reference, so the blocker sweep makes no network call; extend that fixture for the end-to-end proof, since the printed report is what an author actually reads. Allowed variation: fixture builders and assertion grouping may differ, provided each case keeps its real boundary — pure comparison cases stay at unit level with an injected runner, and the command-level cases keep the real git runner over a temporary repository. Search hints: the scripted-runner helper is defined at the top of each engine unit test file, and the scratch-repository builder at the top of the command-level test file. No exact-copy pattern declaration applies.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, correcting the comparison in place, and both stories on 2026-09-06 (delegated).
- Verified: the scan's per-branch step calls the shared changed-paths helper with the base ref and the branch ref; read in the engine's overlap-scan module.
- Verified: that helper runs `git diff --name-only <from> <to>`, returns an empty array on non-zero exit, and never throws on a refusal; read in the rebase module.
- Verified: the helper has four other callers across the engine and its tests, none of which is in scope here — so a new sibling helper, not a change to the existing one, is the correct shape.
- Verified: the rebase module already runs `merge-base` in several places, so the new helper introduces no new git dependency or argv shape to the runner.
- Verified: the scan loop already wraps each branch in try/catch and pushes a per-branch skip note, and the renderer suppresses the clean line whenever any note exists.
- Verified against this repository: for the branch named in the issue, the two-endpoint comparison against the default branch returns 3987 paths and contains the queried file, while the merge-base comparison returns 7 and does not — the two-endpoint comparison is the defect's mechanism, not the enumeration filter the issue's third hypothesis proposed.
- Verified: the existing command-level suite drives the exported command function against a real temporary repository with a `spec/*` sibling branch and omits the source ref so no network call occurs.
- Verified: the governing approved ADR requires an advisory, stateless, deterministic primitive reusing the changed-paths helper; a merge-base-relative comparison preserves each property, so no ADR amendment or new ADR is required.
- Scope check: A — consumer-facing engine behaviour; B — n/a, no new skill; C — provider-agnostic. Event spine: no new event, metric, span, or channel; the scan's existing printed report is unchanged in shape.
- Verify-claims verdict: CLEAR. No load-bearing assumption remains unconfirmed; the issue's own inferred cause was superseded by the verified two-endpoint reading.

## Tasks

### Task 1: Add a merge-base-relative changed-path helper
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/rebase.ts, src/conductor/test/engine/rebase.test.ts
**Dependencies:** none

**Steps:**
1. Write failing unit tests with the scripted git runner already defined at the top of that test file: a resolvable merge base returns the paths changed between that commit and the branch; a merge-base call that exits non-zero returns the no-result value; a merge-base call that succeeds with empty output returns the no-result value; the helper issues no comparison anchored at the base tip.
2. Run the file's narrow test invocation and confirm RED.
3. Implement `changedPathsSinceMergeBase(git, baseRef, branchRef)` beside the existing two-endpoint helper: run `merge-base <baseRef> <branchRef>`, return `null` on non-zero exit or empty output, otherwise delegate to the existing helper with the trimmed commit as the from-ref. Do not change the existing helper or any of its other callers.
4. Run the file's narrow test invocation and confirm GREEN, then run the typecheck target that includes the test directory.
5. Commit the focused change.

**Done when:**
1. The new unit cases prove a resolvable merge base yields exactly the paths between that commit and the branch, and never the base-tip difference.
2. The new unit cases prove a merge-base call that fails or prints nothing yields the no-result value rather than an empty path list.
3. The existing changed-paths helper and its other call sites are byte-for-byte unchanged in the diff.
4. The typecheck target that includes the test directory passes.

### Task 2: Judge overlap by each branch's own contribution
**Story:** Story 1
**Story:** Story 2 (negative path)
**Type:** happy-path
**Files:** src/conductor/src/engine/overlap-scan.ts, src/conductor/test/engine/overlap-scan.test.ts
**Dependencies:** 1

**Steps:**
1. Extend that file's scripted-git-runner fixtures with failing cases: a branch whose merge-base comparison contains a candidate path is reported; a branch whose merge-base comparison omits it is not reported even though the base-tip comparison would contain it; a branch whose merge base is uncomputable yields one advisory note naming it and no overlap entry; a branch whose diff throws still leaves another branch's genuine overlap in the report.
2. Run the file's narrow test invocation and confirm RED.
3. Replace the single per-branch two-endpoint call in the scan loop with the new helper, and push an advisory note naming the branch when the helper returns the no-result value. Leave branch enumeration, the path intersection, the blocker sweep, the report shape, and the renderer untouched.
4. Run the file's narrow test invocation and confirm GREEN, then run the typecheck target that includes the test directory.
5. Commit the focused change.

**Done when:**
1. A candidate path changed only on the base after a branch forked produces no overlap entry for that branch.
2. A candidate path changed by a branch's own commits still produces an entry naming that branch and that path, and a second candidate path it did not change is absent from that entry.
3. An uncomputable merge base for one branch produces exactly one advisory note naming that branch and no overlap entry for it.
4. A failing diff for one branch leaves the other branch's genuine overlap in the report.

### Task 3: Prove the corrected verdict through the command entry point
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/test/engine/overlap-scan-cli.test.ts
**Dependencies:** 2

**Steps:**
1. Extend the scratch-repository dispatch fixtures in that file, reusing its existing builder and its convention of omitting the source ref so the blocker sweep makes no network call.
2. Add a case that forks a `spec/*` sibling branch, returns to the base branch, commits a change to a candidate file the sibling never touched, drives the exported command function with the real git runner, and asserts the printed report is the clean no-overlap line and contains no branch name.
3. Add a case at that same advanced base in which the sibling's own commit changes a second candidate file, and assert the printed output names the sibling branch with only that file.
4. Confirm both new cases fail against the pre-change per-branch comparison and pass against the delivered one, then run the file's narrow test invocation and the typecheck target that includes the test directory.
5. Commit the focused change.

**Done when:**
1. The command-entry fixture whose base advanced on a candidate path after the sibling forked prints the single clean no-overlap line and names no branch.
2. The command-entry fixture at that same advanced base names the sibling branch with only the file its own commit changed.
3. Both new cases fail against the pre-change per-branch comparison and pass against the delivered one.
4. The existing command-level cases for surface registration, argv detection, and the advisory-skip exit code remain unchanged and passing.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an unmerged sibling branch whose own commits change a candidate path, when the scan runs, then the report names that branch together with that path. | 2, 3 | "A candidate path changed by a branch's own commits still produces an entry naming that branch and that path, and a second candidate path it did not change is absent from that entry." | diff-local |
| Story 1 happy: Given an unmerged sibling branch whose own commits change one candidate path and not another, when the scan runs, then the report names only the changed path for that branch. | 2, 3 | "The command-entry fixture at that same advanced base names the sibling branch with only the file its own commit changed." | diff-local |
| Story 1 negative: Given the base branch has advanced with commits changing a candidate path after a sibling branch forked, and that branch's own commits never touch that path, when the scan runs, then the report does not name that branch for that path. | 2, 3 | "A candidate path changed only on the base after a branch forked produces no overlap entry for that branch." | diff-local |
| Story 1 negative: Given no unmerged sibling branch's own commits change any candidate path, when the scan runs, then the scan renders the single clean no-overlap line and names no branch. | 3 | "The command-entry fixture whose base advanced on a candidate path after the sibling forked prints the single clean no-overlap line and names no branch." | diff-local |
| Story 2 happy: Given every unmerged sibling branch shares history with the base ref, when the scan runs, then it compares each branch from that branch's merge base with the base ref and adds no advisory note. | 1, 2 | "The new unit cases prove a resolvable merge base yields exactly the paths between that commit and the branch, and never the base-tip difference." | diff-local |
| Story 2 negative: Given the merge base between the base ref and one sibling branch cannot be computed, when the scan runs, then that branch produces an advisory note naming it and contributes no overlap claim. | 1, 2 | "An uncomputable merge base for one branch produces exactly one advisory note naming that branch and no overlap entry for it." | diff-local |
| Story 2 negative: Given one sibling branch's diff fails after its merge base resolved, when the scan runs, then that branch produces an advisory skip note and the remaining branches' overlaps are still reported. | 2 | "A failing diff for one branch leaves the other branch's genuine overlap in the report." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local: each is decided by the engine's own comparison over fixtures this diff creates, and no commit outside this feature can change whether it holds. Task 1 owns the helper's unit cases with an injected scripted git runner — the narrowest level that proves the merge-base anchoring and the no-result value. Task 2 owns the scan loop's unit cases at the same level, covering both Story 1 report criteria and both Story 2 degradation criteria, because a scripted runner is the only way to make a merge-base refusal and a diff refusal deterministic. Task 3 owns the cross-boundary integration proof: the exported command function is the entry point an author actually invokes, and its existing suite already drives it with the real git runner over a real temporary repository, so the observable behaviour asserted is the printed report text rather than an internal return value. No new aggregate, smoke, or external-service test is required, no real LLM, GitHub, or network call is introduced, and no terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 3

Small tier: architecture and coherence artifacts are skipped. No new ADR or amendment is required because the governing approved ADR's advisory, stateless, helper-reusing contract is preserved intact.
