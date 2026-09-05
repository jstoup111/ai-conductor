# Implementation Plan: Rebase diff hunk header isolation

**Date:** 2026-09-05
**Source-Ref:** jstoup111/ai-conductor#2180
**Stories:** .docs/stories/rebase-diff-hunk-header-isolation-2180.md
**Conflict check:** S exemption; no blocking conflicts identified.

## Technical Approach

Keep the private parseDroppedCommitDiff parser and existing supersededByBase/featureCommitsPreserved policy. Introduce explicit per-file header-versus-hunk state: a `diff --git` boundary creates the next record and resets the state; an `@@` hunk header enters content state; later hunk headers keep content state. Only the pre-hunk header region may recognize `--- ` and `+++ ` as paths. Inside a hunk, classify `+` and `-` source lines first, stripping exactly the diff prefix before applying the existing trimming/counting behavior. Thus `--- comment` contributes removed source `-- comment`, and `+++ value` contributes added source `++ value`; neither mutates a path. Ignore existing metadata and no-newline markers as before.

Preserve the existing `git show --format= --unified=0 --no-renames` request, binary rejection, empty-diff refusal, file-deletion handling and line-multiplicity comparison against HEAD and the commit's parent. This fixes the reported fail-open corner by preventing a hunk addition from clobbering newPath and disappearing from added lines; it does not redefine arbitrary Git-failure policy or generalize diff syntax.

Use the local test pattern in `test/engine/rebase-resolution.test.ts`: test the exported featureCommitsPreserved function through injected GitRunner transcripts for precise path assertions, plus a real temporary Git repository where Git's generated hunk shape is the subject. Keep the parser private. The neighboring deriveChangedFileReferences parser is not a direct reusable abstraction: it produces hunk projections, not added/removed line multisets, so sharing it would widen the change without simplifying this repair. This is semantic pattern reuse, not an exact-copy contract.

## Prerequisites

No unresolved issue dependencies, external services or new packages. Existing approved rebase-conflict resolution policy requires feature commit preservation; this repair restores the current guard's intended input and changes no architectural decision. Operator authorized genuine S work despite the intake's initial M label.

## Tasks

### Task 1: Separate diff file headers from hunk source content

**Story:** Story 1 and Story 2, all acceptance criteria
**Type:** negative-path
**Dependencies:** none
**Files:** src/conductor/src/engine/rebase.ts, src/conductor/test/engine/rebase-resolution.test.ts
**Files likely touched:** same as Files.

**Steps:**
1. Extend public featureCommitsPreserved tests with faithful GitRunner transcripts for a vanished commit. Cover removed `-- comment` plus an ordinary removal (absorbed ⇒ true), added `++ value` (present ⇒ true, absent ⇒ false), and a comment-only deletion (absorbed ⇒ true, skipped ⇒ false). Assert HEAD/parent lookups use the real file paths and never `comment` or `value`. Run `ai-conductor scoped-run test/engine/rebase-resolution.test.ts` from src/conductor and establish meaningful RED; current source returns true for the skipped header-shaped addition and loses comment removal accounting.
2. Implement the per-file header/hunk state in parseDroppedCommitDiff. Reset on each `diff --git` header, enter on each hunk header, and keep path-header interpretation out of content state. Preserve line trimming and multiplicity, binary refusal and the existing public interfaces.
3. Add multi-file/multi-hunk coverage: include header-shaped source in an earlier file and an unsatisfied edit in a later file, proving independent path handling and all-file verification. Cover Git's no-newline marker. Run the same scoped tests for GREEN.
4. Extend the existing isolated local-Git fixture pattern with a `.sql` comment-only removal. Preserve the feature tip in ORIG_HEAD using the established fixture setup; construct both absorbed and skipped end states in the temporary repository and call the real public guard. Assert true only for the absorbed removal. Use locally configured identity, no remote, and clean up exactly the allocated temporary repository after awaiting Git calls; never run this fixture against the workspace repository.
5. Retain or add focused coverage for genuine whole-file deletion, empty/binary diffs and required parent-read failure. Run the scoped file and repository test-covering typecheck for GREEN, then commit the parser fix and its regression tests together. These checks remain inside the task that owns the behavior, not a later catch-all.

**Done when:**
- Public preservation checks use the original paths for both header-shaped source prefixes and accept only changes whose line counts survive in HEAD.
- A skipped `++ value` addition and a skipped comment-only deletion each return false; genuinely absorbed counterparts return true.
- Multiple files/hunks remain independently checked, and one unsatisfied file makes the guard false.
- A real Git-generated comment-deletion diff reproduces the true/false distinction through featureCommitsPreserved.
- Whole-file deletion, binary/empty diff rejection, required-parent failure and no-newline marker behavior retain their existing outcomes.

## Coverage Dispositions

| Criteria | Lowest sufficient proof | Owner |
| --- | --- | --- |
| Removed/added header-shaped source lines; original file paths | Public guard with injected GitRunner and exact query assertions | Task 1 |
| Lost addition and skipped comment-only deletion rejected | Public guard negative transcripts | Task 1 |
| Multiple hunks/files and unsatisfied sibling | Public guard multi-file transcript | Task 1 |
| Actual Git comment-removal encoding and absorbed/skipped reachability | Existing real-local-Git integration fixture pattern | Task 1 |
| Whole-file deletion, binary/empty diff, parent failure, no-newline marker | Existing sufficient cases or focused added public-guard cases | Task 1 |

All story criteria are diff-local. Task 1 owns the changed Git-diff-to-preservation-verdict boundary and its integration proof. No additional acceptance/system spec is needed: the public guard with real local Git already proves the affected boundary, without running a provider or full conductor workflow.

## Verify-Claims

Verified directly: the current parser checks path-looking prefixes before content, and a read-only execution of featureCommitsPreserved returned true for a skipped replacement while querying HEAD:missing from an added `++ missing` source line. The removal of a `-- comment` source line is absent from its removal multiset. Existing real-Git guard fixtures cover vanished commits and ORIG_HEAD. No unresolved load-bearing assumptions; verdict CLEAR.
