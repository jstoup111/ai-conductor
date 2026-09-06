# Implementation Plan: Name the missing feature content when the rebase guard rejects

**Date:** 2026-09-06
**Stories:** .docs/stories/name-the-missing-feature-content-when-the-rebase-g.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent leaves the guard's accept/reject boundary, the halt class, the halt record schema, and the rebase outcome union's existing variants intact, so it cannot contradict an in-flight change to any of them.

## Summary

Four bounded tasks deliver the two outstanding desired outcomes of #1497. The issue's other two outcomes — a rebase that git legitimately emptied completing without a halt, and a genuinely lossy rebase still halting — were delivered by commit 865167e9e and are regression-pinned here rather than reimplemented. Widening the supersession judgement, changing the conflict resolver, changing halt classification, changing the halt record schema, and rewriting operator runbook prose are outside this slice.

## Technical Approach

The work-preservation guard already knows everything the operator needs and throws it away. `supersededByBase` walks each apparently-missing commit's own `-U0` diff file by file and returns `false` at the first check it cannot satisfy; `featureCommitsPreserved` folds every such result into a single boolean; the two rejection sites then build a fixed string. The fix is to stop discarding: widen each of those two returns to a discriminated verdict that carries, on rejection, the reason the check failed and the path it failed on, and let the rejection sites render what they are handed.

Widen `supersededByBase` to return either a superseded verdict or a rejection carrying a short machine-built cause and the path it concerns — the four existing rejection shapes are: the commit's diff could not be read or is binary or empty; the commit deleted a file that is still present; content the commit added is absent from the resulting tree; content the commit removed has reappeared relative to the commit's own parent. Every current `return false` maps to exactly one of these. Do not add, remove, or reorder a check, and do not change the order in which files are inspected: the accept/reject decision must be bit-for-bit what it is today.

Widen `featureCommitsPreserved` to return either a preserved verdict or a rejection listing one entry per missing subject, each carrying the subject, the pre-rebase commit identity when it resolved, and the cause from the supersession check — with the unresolvable-subject case carrying its own cause. Both existing production callers are updated in place: the FR-9 site inside `resolveRebaseConflicts` renders the entries into its `conflict_halt` reason, and `runAcceptanceGuards` renders the same entries instead of slicing the pre-rebase subject list it currently reports. Keep the rendered reason a single line with a bounded number of entries so it stays readable inside a halt body and a dashboard row.

For the resume procedure, add one optional resume-shape field to the `conflict_halt` variant of the rebase outcome union and one matching optional parameter on the halt-marker writer. The producer is the authority: only the two acceptance-guard rejections inside `resolveRebaseConflicts` declare the completed-rebase shape, because only they run after the loop has already established that no rebase state is active and no conflicted path remains. Every other producer omits the field and the writer's default reproduces today's paused-rebase text unchanged, so no existing caller's marker changes. The completed-rebase procedure replaces the resolve-then-continue steps with steps appropriate to a finished rebase and a clean tree; it must not instruct a rebase continuation. Deriving the shape at write time instead was rejected: the writer holds no git runner, and the repository state can move between the guard's decision and the write.

The rendered evidence must be deterministic: the approved committed-halt-record decision copies the halt body verbatim into a committed, pushed file and depends on identical inputs producing identical bytes, so the entries are ordered by their position in the pre-rebase subject list, carry repo-relative paths only, carry no timestamp and no absolute path, and are bounded in number the same way the approved build-settle outcome stamp bounds its captured text. Routing is unaffected: no consumer anywhere in the engine matches on the current fixed reason literal, so replacing it cannot break a text-routed caller, and the approved decision that mechanical faults route on result kind rather than reason text is honored by keeping the resume shape a typed field on the outcome rather than a token parsed back out of the string.

The approved rebase-evidence-stamp decision already recorded this exact hazard and left an alternative remedy open — adding an empty-commit-keeping flag to the rebase invocation so git never drops the commit. That alternative is deliberately declined here: it changes what the rebase produces and would leave empty commits on every feature branch, whereas the content-based supersession check already landed and this slice only makes its rejection legible. The guard predicate stays exactly as the approved full-replay-intent decision requires.

Test pattern context: the guard behaviors are git-semantic, so they are proven against real temporary local repositories built with the existing helpers in the rebase-resolution and autoresolve-guards test files — pin the initial branch, set local identity, use no remote, and remove the exact temporary directory. Assertions are on the returned verdict and on the rendered reason string, never on internal call counts. The halt-marker behaviors are pure string and file output and are proven at unit level against a temporary directory in the rebase test file. Find comparable code by searching those three test files for their existing local-repository builders and for the current boolean assertions on the guard. Allowed variation: fixture builders and assertion grouping may change; what may not change is the boundary — no conductor run, no provider dispatch, and no network for any case in this plan.

## Preconditions and claim ledger

- Verified: `supersededByBase` is defined at src/conductor/src/engine/rebase.ts:922 and returns `Promise<boolean>`, with every failure path a bare `return false`.
- Verified: `featureCommitsPreserved` is defined at src/conductor/src/engine/rebase.ts:985, returns `Promise<boolean>`, resolves each missing subject through `ORIG_HEAD` and fails closed when a subject cannot be resolved.
- Verified: the FR-8 and FR-9 rejections are at src/conductor/src/engine/rebase.ts:1120-1125 and :1128-1134, and are reached only after the completion check at :1108-1113 established that no rebase state is active and no conflicted path remains.
- Verified: the FR-9 reason at src/conductor/src/engine/rebase.ts:1132 is the fixed literal `rebase resolution dropped feature commit(s)`.
- Verified: the second production caller is `runAcceptanceGuards` at src/conductor/src/engine/autoresolve.ts:452-500, whose guard-3 branch at :487-497 reports a prefix of the PRE-rebase subject list rather than the missing subjects.
- Verified: `writeHalt` is defined at src/conductor/src/engine/rebase.ts:454, takes no git runner, and templates one unconditional four-step resume procedure ending in a rebase continuation.
- Verified: the `conflict_halt` variant of the rebase outcome union is declared at src/conductor/src/engine/rebase.ts:514 as `{ kind; conflicts; reason }`.
- Verified: the two halt-writing call sites for that outcome are src/conductor/src/engine/conductor.ts:12499 and src/conductor/src/engine/daemon-rekick.ts:620; the other four `writeHalt` callers raise non-rebase halts and are untouched.
- Verified: existing coverage lives in src/conductor/test/engine/rebase-resolution.test.ts (real-local-Git guard cases from :564), src/conductor/test/engine/autoresolve-guards.test.ts (:87 asserts the FR-9 rejection reason), and src/conductor/test/engine/rebase.test.ts (:647 and :656 assert halt-marker output).
- Verified: commit 865167e9e delivered the content-based supersession check, closing the issue's first and third desired outcomes; this plan pins them and does not reopen them.
- Scope check: consumer-facing engine behavior, no new skill, provider-agnostic; no catalog registration and no behavioral-rule entry required.
- Event spine: no event, metric, span, log line, or report is added or changed; the rejection text travels on the existing outcome reason and the existing halt body.
- Verified: no consumer in `src/conductor/src`, `src/conductor/test`, `bin`, or `hooks` matches on the literal reason `rebase resolution dropped feature commit(s)`; the only occurrence is the producing site itself at src/conductor/src/engine/rebase.ts:1132.
- Verified: the second sanctioned guard call path reaches `runAcceptanceGuards` from src/conductor/src/engine/ci-fix.ts:509 and src/conductor/src/engine/autoresolve.ts:980; neither writes a halt marker, so Task 2's fix at the guard's own reason covers that path and the resume-shape work in Tasks 3 and 4 does not apply to it.
- Verified by a full sweep of all 559 approved decision records: no record types or governs the rebase outcome union, and no record fixes the halt resume procedure as immutable text. The guards' originating decision leaves an open follow-up asking for the preservation check to be defined precisely, and its architecture review's condition 2 asks for the same; this slice discharges the diagnostic half of both. No amendment to any approved decision is required, and none is authored here.
- Verified: the halt writer at src/conductor/src/engine/rebase.ts:454 already delegates to the single sanctioned marker writer with the `needs-human` class; this slice keeps both, adds no second writer, and adds no halt class.
- Verify-claims verdict: CLEAR. Every path, symbol, and line number above was read in the worktree. No unconfirmed assumption changes the approach or the task breakdown.

## Tasks

### Task 1: Report why a dropped commit failed the supersession check
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/src/engine/rebase.ts, src/conductor/test/engine/rebase-resolution.test.ts
**Dependencies:** none

**Steps:**
1. Extend the existing real-local-Git cases for the supersession check with assertions on a returned verdict rather than a boolean, covering each of the four rejection shapes: unreadable, binary, or empty commit diff; a deletion whose file is still present; added content absent from the resulting tree; removed content that reappeared relative to the commit's own parent.
2. Confirm RED against the current boolean return.
3. Widen the helper's return to a discriminated verdict carrying, on rejection, a short cause and the path it concerns. Map each existing early return to exactly one cause. Add no check, remove no check, and preserve the existing file inspection order.
4. Confirm GREEN, then re-run the pre-existing accept cases unchanged to prove the accept/reject boundary did not move.
5. Build the fixtures with the file's existing temporary-repository helpers: pinned initial branch, local identity, no remote, exact directory removal. Assert on the returned verdict, never on call counts. Do not run the conductor and do not touch the network.
6. Run the repository's narrowest invocation for this test file plus the typecheck target that covers test files, then commit the focused change.

**Done when:**
1. Each of the four rejection shapes returns a verdict whose cause identifies that shape and whose path names the file inspected.
2. Every commit that the check accepted before still returns a superseded verdict, and every commit it rejected before still returns a rejection.
3. The narrowest test invocation for this file passes and the typecheck target covering test files passes.

### Task 2: Render the missing content into both guard rejections
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/rebase.ts, src/conductor/src/engine/autoresolve.ts, src/conductor/test/engine/rebase-resolution.test.ts, src/conductor/test/engine/autoresolve-guards.test.ts
**Dependencies:** 1

**Steps:**
1. Extend the real-local-Git guard cases so a single dropped-and-unrecovered commit asserts the rejection names the subject, the abbreviated pre-rebase commit identity, and the failing path; add a case with two independently dropped-and-unrecovered commits asserting both subjects appear in one rejection; add a case whose subject cannot be resolved back to a pre-rebase commit asserting rejection plus an unresolved cause.
2. Extend the existing acceptance-guard rejection case so it asserts the reason contains the genuinely missing subject and does NOT contain a surviving pre-rebase subject.
3. Confirm RED, then widen the preservation helper's return to a preserved verdict or a rejection listing one entry per missing subject, each carrying the subject, the resolved pre-rebase identity when available, and the cause from Task 1.
4. Render those entries at the guard-rejection site inside the bounded resolution loop, replacing the fixed reason literal, and render the same entries in the shared acceptance-guard branch in place of its pre-rebase subject slice. Keep the rendered reason one line, order entries by their position in the pre-rebase subject list, use repo-relative paths, emit no timestamp and no absolute path, and bound the number of enumerated entries — the halt body is committed and pushed, so identical inputs must render identical bytes.
5. Compute every entry from deterministic git inspection inside the engine. Do not dispatch a provider, and do not ask the resolver to explain what is missing: the guard stays engine-native and prompt-free.
6. Preserve the helper's existing short-circuit for an empty pre-rebase subject list and its fail-closed behavior for an unresolvable subject; both are load-bearing for other callers.
7. Run the narrowest invocation for both test files plus the typecheck target that covers test files, then commit.

**Done when:**
1. The guard rejection for one dropped-and-unrecovered commit contains that commit's subject, its abbreviated pre-rebase identity, and the failing path.
2. The guard rejection for two independently dropped-and-unrecovered commits contains both subjects in one reason, ordered by their position in the pre-rebase subject list, with repo-relative paths, no timestamp, a bounded entry count, and identical bytes on a repeat render.
3. The guard rejection for an unresolvable subject contains that subject and states it could not be resolved, and the guard still rejects.
4. The shared acceptance-guard rejection reason contains the missing subject and omits pre-rebase subjects that survived the replay.
5. A commit git eliminated because the base already carries it still yields a preserved verdict and no rejection.

### Task 3: Template a completed-rebase resume procedure in the halt marker
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/rebase.ts, src/conductor/test/engine/rebase.test.ts
**Dependencies:** none

**Steps:**
1. Extend the existing halt-marker cases with one that requests the completed-rebase shape and one that requests nothing, asserting the written body for each.
2. Confirm RED, then add one optional resume-shape parameter to the halt-marker writer with two values: the paused-rebase shape and the completed-rebase shape.
3. Keep the paused-rebase shape's text byte-identical to today's and make it the default when the parameter is omitted, so every existing caller's output is unchanged.
4. Give the completed-rebase shape a procedure appropriate to a finished rebase with a clean tree: it must not instruct conflict resolution and must not instruct a rebase continuation, and it must not present an empty conflicted-file list as a resolution instruction.
5. Leave the halt class, the reason line, the single sanctioned marker writer, and the halt record write path untouched. Add no second writer and no new halt class.
6. Correct the writer's own documentation, which today asserts unconditionally that the rebase is left paused; that invariant now holds only for the paused-rebase shape.
7. Run the narrowest invocation for this test file plus the typecheck target that covers test files, then commit.

**Done when:**
1. The completed-rebase body contains neither a conflict-resolution instruction nor a rebase-continuation instruction.
2. The paused-rebase body is byte-identical to the body produced before this task for the same inputs.
3. Omitting the parameter produces the paused-rebase body, and both shapes still write the needs-human class marker.
4. A completed-rebase halt written with no conflicted paths still writes successfully and presents no empty file list as an instruction.
5. The writer still delegates to the single sanctioned marker writer, and no second halt writer and no new halt class is introduced.

### Task 4: Declare the resume shape at the guard rejections and thread it to both writers
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/rebase.ts, src/conductor/src/engine/conductor.ts, src/conductor/src/engine/daemon-rekick.ts, src/conductor/test/engine/rebase-resolution.test.ts
**Dependencies:** 3

**Steps:**
1. Write a failing case driving the bounded resolution loop with an injected resolver whose resolution completes the rebase but drops feature content, asserting the returned halt outcome declares the completed-rebase shape.
2. Add a companion case for the branch-not-current rejection on the same loop, asserting the same declaration, and a case for a resolver that gives up mid-rebase asserting no shape is declared.
3. Confirm RED, then add one optional resume-shape field to the halt variant of the rebase outcome union and set it on exactly the two acceptance-guard rejections inside that loop. Leave every other producer of that variant untouched so it keeps the default.
4. Pass the declared shape through at the rebase step's halt-writing call and at the daemon play-forward halt-writing call. Change nothing else at either site.
5. Use the file's existing injected-resolver and temporary-repository helpers; do not run the conductor, dispatch a provider, or touch the network.
6. Run the narrowest invocation for the affected test files plus the typecheck target that covers test files, then run the repository's configured aggregate test command once, then commit.

**Done when:**
1. Both acceptance-guard rejections from the bounded resolution loop declare the completed-rebase shape.
2. A resolver that gives up while the rebase is still paused produces a halt outcome that declares no shape.
3. Both halt-writing call sites forward the declared shape to the marker writer.
4. The repository's configured aggregate test command passes.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a completed rebase in which one pre-rebase commit subject is absent and the content that commit added is absent from the resulting tree, when the work-preservation guard rejects, then the rejection names that subject, its pre-rebase commit identity, and the file whose content failed the check. | 1, 2 | "The guard rejection for one dropped-and-unrecovered commit contains that commit's subject, its abbreviated pre-rebase identity, and the failing path." | diff-local |
| Story 1 happy: Given the same condition reached through the shared acceptance-guard entry point used after an automated resolution, when that entry point rejects, then its reason names only the subject that is actually missing and its content evidence, not an unfiltered prefix of the pre-rebase subject list. | 2 | "The shared acceptance-guard rejection reason contains the missing subject and omits pre-rebase subjects that survived the replay." | diff-local |
| Story 1 happy: Given several pre-rebase subjects are absent and none of their content survives, when the guard rejects, then the rejection enumerates each missing subject with its own evidence rather than reporting a single unattributed failure. | 2 | "The guard rejection for two independently dropped-and-unrecovered commits contains both subjects in one reason, ordered by their position in the pre-rebase subject list, with repo-relative paths, no timestamp, a bounded entry count, and identical bytes on a repeat render." | diff-local |
| Story 1 negative: Given a missing subject that cannot be resolved back to a pre-rebase commit, when the guard runs, then it still rejects and the rejection states that the subject could not be resolved. | 2 | "The guard rejection for an unresolvable subject contains that subject and states it could not be resolved, and the guard still rejects." | diff-local |
| Story 1 negative: Given a completed rebase in which git eliminated a commit because the base already carries an equivalent change, when the guard runs, then it reports the feature content preserved and no halt is raised. | 1, 2 | "A commit git eliminated because the base already carries it still yields a preserved verdict and no rejection." | diff-local |
| Story 1 negative: Given a missing commit whose diff cannot be read, is empty, or is binary, when the guard runs, then it still rejects and the rejection states which commit could not be judged. | 1 | "Each of the four rejection shapes returns a verdict whose cause identifies that shape and whose path names the file inspected." | diff-local |
| Story 2 happy: Given a halt raised by an acceptance guard after the rebase completed, when the halt marker is written, then its resume procedure describes recovery from a completed rebase with a clean tree and instructs no conflict resolution and no rebase continuation. | 3 | "The completed-rebase body contains neither a conflict-resolution instruction nor a rebase-continuation instruction." | diff-local |
| Story 2 happy: Given a halt raised while a rebase is paused mid-flight on conflicted paths, when the halt marker is written, then it carries the existing conflict-resolution-then-continue procedure unchanged. | 3 | "The paused-rebase body is byte-identical to the body produced before this task for the same inputs." | diff-local |
| Story 2 happy: Given a halt raised by an acceptance guard, when the halt marker is written, then it still carries the `needs-human` class and the guard's reason line. | 3, 4 | "Omitting the parameter produces the paused-rebase body, and both shapes still write the needs-human class marker." | diff-local |
| Story 2 negative: Given a halt whose producer declares no resume shape, when the halt marker is written, then it falls back to the paused-rebase procedure, preserving today's text for every existing caller. | 3, 4 | "A resolver that gives up while the rebase is still paused produces a halt outcome that declares no shape." | diff-local |
| Story 2 negative: Given a halt raised by an acceptance guard with no conflicted paths captured, when the halt marker is written, then the marker is still written with the completed-rebase procedure and no empty file list is presented as a resolution instruction. | 3 | "A completed-rebase halt written with no conflicted paths still writes successfully and presents no empty file list as an instruction." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local: each is decided entirely by the engine helpers this diff changes and by fixtures the tests build themselves, so no commit outside this feature can change whether it holds. Task 1 owns the supersession check's rejection causes at the real-local-Git integration level, because the behavior is git-semantic and the local repository is the boundary under test. Task 2 owns the rendered rejection text for both guard entry points at the same level, reusing the two existing guard test files rather than adding a third. Task 3 owns the halt-marker body at unit level against a temporary directory, since the behavior is pure string and file output. Task 4 owns the outcome-to-writer threading through the bounded resolution loop with an injected resolver, stopping at the returned outcome and the two forwarding call sites; it does not run the conductor. No third-party service, provider, or network call appears in any case. Existing halt-class, halt-record, and conflict-resolution coverage remains authoritative for everything this slice does not change, and no terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 3 -> Task 4
