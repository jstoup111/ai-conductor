# Implementation Plan: Verify resume halt clear and post one resolved comment

**Date:** 2026-09-30
**Stories:** .docs/stories/verify-resume-halt-clear-and-post-one-resolved-com.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the change is confined to the operations path of clearHaltStateForResume and keeps the halt-pr-rehabilitation ADR's stateless four-signal detection.

## Summary

Two tasks deliver #2883's remaining outcomes on top of #2865: verify the PR after the guarded clear before claiming success, and supersede the marked remediation comment instead of stacking new ones. FINISH's publication guard and the halt-open path are unchanged, so an unresolved PR keeps its signals and FINISH still refuses it.

## Technical Approach

In clearHaltStateForResume's operations branch, after every mutation reports executed, re-read the PR through the same runTrackerUrlRead view used for the initial read and evaluate hasHaltSignal on it. A read failure or a remaining signal returns partial without any comment write, which conductor.ts already treats as retryable. Only a clean re-read proceeds to the note.

The note then looks up PR comments through runTrackerUrlRead with the comments JSON field and selects the first whose body contains NEEDS_REMEDIATION_MARKER, mirroring pr-labels.ts upsertComment. When found and its URL parses to a comment id, write pull-request.comment.update with that id and the tagged resolution body; otherwise, or when the lookup fails, write one pull-request.comment.create. Both writes go through rehabilitateMutation so refusal and failure keep their existing outcomes. Superseding the halt narrative comment matches the legacy path's existing behaviour. A second resume already returns not-halted before any write because the re-read-confirmed PR has no signal.

Tests use the file's existing fakeGh and fakeOperations helpers, extended so the fake GitHub view reflects applied writes and serves a comments list. No real network or LLM.

## Preconditions and claim ledger

- Operator approved Small scope, technical track, and both stories on 2026-09-30 (delegated).
- Verified: clearHaltStateForResume issues pull-request.comment.create unconditionally after executed mutations and never re-reads the PR.
- Verified: hasHaltSignal, NEEDS_REMEDIATION_MARKER, and runTrackerUrlRead are already imported or defined in halt-pr-rehabilitation.ts.
- Verified: github-operations.ts registers pull-request.comment.update with a commentId and body payload; pr-labels.ts upsertComment uses it with parseCommentUrl.
- Verified: conductor.ts retries the resume clear only when the outcome is partial.
- Verified: #2865 already added the title and banner repair; this plan does not redo it.
- Scope check: repository-only engine behaviour; no skill addition; provider-agnostic. Event-spine: no new channel.
- Verify-claims verdict: CLEAR.

## Tasks

### Task 1: Confirm the cleared PR state before reporting success
**Story:** 1
**Type:** happy-path
**Files:** src/conductor/src/engine/halt-pr-rehabilitation.ts, src/conductor/test/engine/halt-pr-rehabilitation.test.ts
**Dependencies:** none

**Steps:**
1. Extend the clearHaltStateForResume tests with a stateful fake GitHub view that applies label removal, title edit, and body edit writes, plus fixtures where writes are no-ops and where the second read rejects. Establish RED.
2. After all mutations execute, re-read the PR view and return partial on read failure or when hasHaltSignal still holds, before any comment write.
3. Update existing tests that assumed a single read so their fakes serve the post-clear view.
4. Run the focused test file through scoped-run and commit.

**Done when:**
1. A stateful fixture starting with label, title prefix, body marker, and banner returns cleared, and hasHaltSignal on its final fake view is false.
2. A fixture whose writes execute but leave the marker returns partial with zero comment writes, and a fixture whose re-read rejects returns partial with zero comment writes.

### Task 2: Supersede the marked comment with the resolution note
**Story:** 2
**Type:** negative-path
**Files:** src/conductor/src/engine/halt-pr-rehabilitation.ts, src/conductor/test/engine/halt-pr-rehabilitation.test.ts
**Dependencies:** 1

**Steps:**
1. Add RED fixtures: an existing marked comment, no marked comment, a failing comments lookup, and a second resume call against the confirmed-clean view.
2. Replace the unconditional comment.create with a marker lookup that writes pull-request.comment.update to the matched comment id, falling back to one pull-request.comment.create when no match or the lookup fails.
3. Run the focused test file through scoped-run and commit.

**Done when:**
1. With an existing marked comment the writes contain one pull-request.comment.update carrying the resolution note and zero pull-request.comment.create writes.
2. A second resume against the confirmed-clean view returns not-halted with zero writes, and a failed comments lookup yields exactly one pull-request.comment.create with cleared only when it executed.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a resumed feature's PR carries the remediation label, title prefix, body marker, and halt banner, when the resume clear's guarded writes succeed and the follow-up read shows none of them, then the outcome is cleared and the PR passes the FINISH halt-signal check. | 1 | "A stateful fixture starting with label, title prefix, body marker, and banner returns cleared, and hasHaltSignal on its final fake view is false." | diff-local |
| Story 1 negative: Given every guarded write reports executed but the follow-up read still shows a halt signal, when the resume clear finishes, then the outcome is partial and no resolution comment is written. | 1 | "A fixture whose writes execute but leave the marker returns partial with zero comment writes, and a fixture whose re-read rejects returns partial with zero comment writes." | diff-local |
| Story 1 negative: Given the follow-up read fails, when the resume clear finishes, then the outcome is partial and no resolution comment is written. | 1 | "A fixture whose writes execute but leave the marker returns partial with zero comment writes, and a fixture whose re-read rejects returns partial with zero comment writes." | diff-local |
| Story 2 happy: Given the PR already has a comment carrying the remediation marker, when a resume clear is confirmed, then that comment is updated in place to the resolution note and no new comment is created. | 2 | "With an existing marked comment the writes contain one pull-request.comment.update carrying the resolution note and zero pull-request.comment.create writes." | diff-local |
| Story 2 negative: Given a resume clear was confirmed earlier and the PR now shows no halt signal, when a later resume runs the clear again, then it returns not-halted and writes no comment. | 2 | "A second resume against the confirmed-clean view returns not-halted with zero writes, and a failed comments lookup yields exactly one pull-request.comment.create with cleared only when it executed." | diff-local |
| Story 2 negative: Given the comment lookup fails after a confirmed clear, when the resume clear posts its note, then it creates exactly one new comment and still returns cleared only if that write executed. | 2 | "A second resume against the confirmed-clean view returns not-halted with zero writes, and a failed comments lookup yields exactly one pull-request.comment.create with cleared only when it executed." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local unit tests of clearHaltStateForResume with fakes at the GitHub read and typed-operation boundaries. The existing conductor resume-clear call site and FINISH guard are unchanged and keep their current coverage. No terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2

Small tier: architecture and coherence artifacts are skipped. No ADR or amendment is required.
