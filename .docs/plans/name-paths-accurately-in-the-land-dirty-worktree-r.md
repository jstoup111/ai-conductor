# Implementation Plan: Accurate paths in the land cleanliness refusal

**Date:** 2026-09-06
**Stories:** .docs/stories/name-paths-accurately-in-the-land-dirty-worktree-r.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing landing contract — the guard's accept/reject decision, its position ahead of the identity and artifact gates, and the stale-leftover protection all stay exactly as they are, and only the text of the error it already raises changes.

## Summary

Three bounded tasks deliver the diagnostic half of #1300. The spec-landing primitive's worktree-cleanliness guard already computes the set of entries that block a land; it then describes all of them with one sentence that is false for half of them. The tasks classify that set into the two conditions the guard actually enforces, render one labelled line per condition with a remedy limited to the applicable actions, prove the guard's decision is unchanged, and correct the guide bullet that repeats the same false claim. The issue's request for a supported route to revise an already-landed spec is an open design decision and is excluded by the track's scope boundary; #1300 stays open for it.

## Technical Approach

The guard runs `git status --porcelain` in the per-idea worktree and filters the lines to those that block a land. Two different conditions produce a blocking line and the code already distinguishes them at the point of filtering: a `??` prefix whose path is not under the spec-artifact directory is an untracked file the landing commit would not pick up, and any other prefix is an uncommitted change to a tracked file, wherever that file lives. Partition the retained lines on that same prefix test rather than recomputing it, so the message can never disagree with the decision that produced it.

Render the refusal from the partition. Emit one labelled clause per non-empty condition: uncommitted changes to tracked files, stating explicitly that a tracked file under the spec-artifact directory counts, and untracked files outside the spec-artifact directory. Omit a condition entirely when its partition is empty, so a refusal never advertises a problem the worktree does not have. Keep the porcelain line, prefix included, as each path's rendering, because the prefix is the evidence for the condition it was filed under. Follow with a remedy sentence assembled from the same non-empty conditions: commit or discard for the tracked half, remove or relocate for the untracked half. Retain the words "dirty" and the worktree path in the leading clause; existing callers and their assertions match on that vocabulary, and the leading clause is also where the reason the guard exists belongs — the landing commit stages only untracked artifacts under the spec-artifact directory.

Nothing about the filter's accept/reject result changes, and no code before or after the guard moves. This is a diagnostic correction inside an existing failure path: no new event, metric, span, log line, or report is produced, so the event spine is untouched and no new channel is introduced.

Tests are unit tests against the landing primitive itself, which is the enforcement point and already the subject of that file. They drive real local Git repositories through the existing worktree helper, because Git status semantics are the boundary under test, and they inject the existing owner-resolution runner rather than reaching any third-party service. No conductor run, no network, and no provider call is involved. The file already carries a refusal-text example that asserts remediation wording, and the new cases follow it. Existing loose assertions elsewhere in the suite match on "dirty" or "uncommitted" and continue to hold.

The guide correction is the documentation-upkeep obligation for this change: the reference list of landing refusals carries the same inaccurate sentence, and a reader who is sent to look outside the spec-artifact directory by the guide is misled exactly as the error misleads them. The composer skill's own one-line summary says only "a dirty worktree", which is already accurate and is deliberately left alone.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, the two stories, and the exclusion of the revise-route half on 2026-09-06 (delegated).
- Verified: `src/conductor/src/engine/engineer/land-spec.ts` runs the cleanliness guard as step 2, filters porcelain lines with a `??`-and-prefix test, and throws a single message describing every retained line as a change outside the spec-artifact directory.
- Verified: that same file's later guards — identity resolution, artifact presence, status, and protected targets — run after the cleanliness guard, so nothing in this change alters their order or inputs.
- Verified: `src/conductor/test/engine/engineer/land-spec.test.ts` already seeds valid worktrees through a local helper, already asserts a refusal for a tracked modified artifact, and already contains a describe block that asserts remediation wording in a landing error message.
- Verified: `src/conductor/test/acceptance/engineer-agent-hosted.test.ts` asserts the refusal only through a case-insensitive match on "dirty" or "uncommitted", so the retained leading clause keeps it green.
- Verified: `docs/guides/engineer-loop.md` lists the reasons landing is refused and includes a bullet claiming the cleanliness refusal covers uncommitted changes outside the spec-artifact directory.
- Verified: `skills/composer/SKILL.md` describes the same refusal as "a dirty worktree" and needs no change.
- Verified: no `reland`, `revise`, or second landing entry point exists in the engine, which is why the revise-route half is excluded rather than partially delivered.
- Scope check: consumer-facing engine diagnostic; no skill addition; provider-agnostic. Event spine: no new channel — an existing failure path's text only.
- Verify-claims verdict: CLEAR. Every path, symbol, and behavior above was read in the worktree; no pending product or scope assumption remains.

## Tasks

### Task 1: Classify the blocking entries and label them in the refusal
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/engineer/land-spec.ts, src/conductor/test/engine/engineer/land-spec.test.ts
**Dependencies:** none

**Steps:**
1. Add unit cases driving the landing primitive against a seeded worktree in three shapes: a committed artifact modified but not committed; an untracked file outside the spec-artifact directory; and both at once. Assert the refusal names each path under its own condition, and assert that no case describes a tracked modification under the spec-artifact directory as being outside it.
2. Establish RED, then partition the retained porcelain lines on the same prefix test the filter already applies, and render one labelled clause per non-empty condition, each carrying its own paths with their porcelain prefixes intact.
3. Keep the worktree path and the word "dirty" in the leading clause, and state there that the landing commit stages only untracked artifacts under the spec-artifact directory.
4. Run the focused test file through the repository's scoped test invocation, run the typecheck target that includes tests, and commit the focused change.

**Done when:**
1. A refusal for a modified tracked artifact lists it under uncommitted changes to tracked files and never calls it a change outside the spec-artifact directory.
2. A refusal for an untracked file outside the spec-artifact directory lists it under that condition and names no tracked-change condition.
3. A refusal for a worktree carrying both conditions lists each path under its own condition, with its porcelain prefix retained.
4. The leading clause still contains the worktree path and the word "dirty", so existing case-insensitive assertions elsewhere in the suite continue to pass.

### Task 2: Scope the remedy and prove the guard still fails closed
**Story:** Story 1 (negative path)
**Type:** negative-path
**Files:** src/conductor/src/engine/engineer/land-spec.ts, src/conductor/test/engine/engineer/land-spec.test.ts
**Dependencies:** 1

**Steps:**
1. Add unit cases asserting that a refusal for one condition names only that condition's remedy, and that a mixed refusal names both remedies in one sentence.
2. Add a case asserting the branch head is unchanged and no landing commit exists after a refusal caused solely by a modified tracked artifact.
3. Add a case asserting a worktree whose only uncommitted entries are untracked artifacts under the spec-artifact directory is admitted by the cleanliness guard and reaches a later gate.
4. Establish RED, then assemble the remedy sentence from the same non-empty conditions the labelled clauses were built from, so an inapplicable action can never be printed.
5. Run the focused test file through the repository's scoped test invocation, run the typecheck target that includes tests, and commit the focused change.

**Done when:**
1. A tracked-only refusal names committing or discarding and does not mention removing or relocating untracked files.
2. An untracked-outside-only refusal names removing or relocating and does not mention committing or discarding tracked changes.
3. A mixed refusal names both remedies.
4. After a refusal caused by a modified tracked artifact, the branch head equals its value before the call and no landing commit was created.
5. A worktree whose only uncommitted entries are untracked artifacts under the spec-artifact directory passes the cleanliness guard and fails, if at all, only at a later gate.

### Task 3: Correct the refusal list in the engineer-loop guide
**Story:** Story 2
**Type:** happy-path
**Files:** docs/guides/engineer-loop.md
**Dependencies:** 1

**Steps:**
1. Locate the bullet in the landing step's refusal list that describes uncommitted changes outside the spec-artifact directory.
2. Replace it with two bullets matching the shipped conditions: uncommitted changes to tracked files at any path, including a tracked artifact under the spec-artifact directory, and untracked files outside the spec-artifact directory.
3. Leave every other refusal bullet, and the surrounding step text, unchanged.
4. Commit the documentation change with the same feature branch as the code change.

**Done when:**
1. The landing refusal list names uncommitted changes to tracked files at any path as its own condition.
2. The landing refusal list names untracked files outside the spec-artifact directory as a separate condition.
3. No bullet in that list claims the cleanliness refusal covers only changes outside the spec-artifact directory.
4. Every other refusal bullet in that list is byte-for-byte unchanged.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a per-idea worktree whose only uncommitted entry is a modified tracked artifact under the spec-artifact directory, when landing is refused for worktree cleanliness, then the refusal lists that path under uncommitted changes to tracked files and no sentence of the refusal describes it as a change outside the spec-artifact directory. | 1 | "A refusal for a modified tracked artifact lists it under uncommitted changes to tracked files and never calls it a change outside the spec-artifact directory." | diff-local |
| Story 1 happy: Given a per-idea worktree whose only uncommitted entry is an untracked file outside the spec-artifact directory, when landing is refused for worktree cleanliness, then the refusal lists that path under untracked files outside the spec-artifact directory and names no tracked-change condition. | 1 | "A refusal for an untracked file outside the spec-artifact directory lists it under that condition and names no tracked-change condition." | diff-local |
| Story 1 happy: Given a per-idea worktree carrying both a modified tracked file and an untracked file outside the spec-artifact directory, when landing is refused for worktree cleanliness, then each path appears under its own condition and the remedy names both committing-or-discarding the tracked changes and removing-or-relocating the untracked files. | 1, 2 | "A mixed refusal names both remedies." | diff-local |
| Story 1 negative: Given a per-idea worktree whose only uncommitted entry is a modified tracked artifact under the spec-artifact directory, when landing is refused for worktree cleanliness, then the branch head is unchanged and no landing commit was created. | 2 | "After a refusal caused by a modified tracked artifact, the branch head equals its value before the call and no landing commit was created." | diff-local |
| Story 1 negative: Given a per-idea worktree whose only uncommitted entries are untracked files under the spec-artifact directory, when landing runs, then the cleanliness guard admits the worktree and landing proceeds past that guard. | 2 | "A worktree whose only uncommitted entries are untracked artifacts under the spec-artifact directory passes the cleanliness guard and fails, if at all, only at a later gate." | diff-local |
| Story 2 happy: Given the engineer-loop guide's list of reasons landing is refused, when a reader consults the worktree-cleanliness entry, then it names uncommitted changes to tracked files at any path and untracked files outside the spec-artifact directory as two distinct conditions. | 3 | "The landing refusal list names untracked files outside the spec-artifact directory as a separate condition." | diff-local |
| Story 2 negative: Given the same list, when a reader looks for the worktree-cleanliness entry, then no bullet states that the refusal covers only changes outside the spec-artifact directory. | 3 | "No bullet in that list claims the cleanliness refusal covers only changes outside the spec-artifact directory." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled fixtures. Task 1 owns the classification and labelling unit cases; Task 2 owns the remedy-scoping cases and the two fail-closed regressions. Both drive the landing primitive directly with a real local Git repository, because Git status semantics are the boundary under test, and inject the existing owner-resolution runner so no third-party service is reached. No conductor run is used: the assertions are available at the primitive's own boundary, and the failure path terminates the call before any later step. Task 3 delivers a documentation correction and is verified by reading the changed list; it adds no test, because the guide is not a machine-consumed contract in this repository. Existing acceptance coverage for the refusal keeps its case-insensitive assertions and needs no change. No terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3

Small tier: architecture and coherence artifacts are skipped. No ADR or amendment is required, because the guard's decision, its ordering among the landing gates, and the stale-leftover protection are all preserved unchanged.
