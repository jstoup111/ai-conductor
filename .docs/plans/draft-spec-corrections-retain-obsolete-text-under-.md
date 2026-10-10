# Implementation Plan: Draft spec corrections retain obsolete text under amendment policy

**Date:** 2026-10-09
**Stories:** .docs/stories/draft-spec-corrections-retain-obsolete-text-under-.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped. The intent narrows only where the additive amendment note applies; it keeps the story in-place rule, the never-rewrite safeguard for artifacts already on the base branch, the BUILD prohibition, the protected-target scan, coverage binding, and the reseal procedure unchanged, and it adds one refusal to the existing land primitive without changing any other gate's order or result.

## Summary

Three tasks deliver #2499: a `draft-amendment-note` refusal in the land primitive, the lifecycle distinction in the consumer-facing `HARNESS.md` rule, and the same distinction in the three shipped DECIDE skills that instruct an amendment note. "Base branch" means the target repository's default branch, normally `main`, compared at the spec branch's merge base.

## Technical Approach

The rule's subject is a mechanical fact — does this artifact exist on the base branch? — so it is enforced where the spec is landed rather than left to prompt discipline. `landSpec` in `src/conductor/src/engine/engineer/land-spec.ts` already computes everything the gate needs: `resolveIdeaFiles` returns every `.docs/` path committed on the branch since the merge base or untracked in the worktree, and `resolveFeatureFiles` lists the `.docs` blobs present at that merge base with `git ls-tree -r -z <merge-base> -- .docs`. Factor that listing into a small helper both callers use (or have `resolveFeatureFiles` return it) instead of running a second differently-shaped listing. A draft artifact is any `.md` path in the idea set that is absent from that listing.

Add an exported pure detector beside the land primitive that returns the lines of a text matching `/^\s*(?:>\s*)*\*\*Amended \d{4}-\d{2}-\d{2}\b/` — a bold "Amended" followed by a real date, plain or block-quoted. The date digits are deliberate: the observed note in #2499 read "Amended <date> by operator:", which the coverage-binding header pattern in `src/conductor/src/engine/coverage-binding-inputs.ts:52` (requires `by #<n>`) would miss, while the documented `YYYY-MM-DD` placeholder used to describe the format must not trip the gate. Do not skip fenced code; a draft that needs to show the format uses the placeholder. Do not reuse or change `amendmentBlocks` or its header pattern: coverage binding owns that grammar.

Run the new check in `landSpec` immediately after the feature files are resolved and before any gate that writes, reading each draft artifact from the worktree. Collect every offending path, then throw one `landGateError('draft-amendment-note', …)` naming each path and telling the author to fold the correction into the artifact's current text and remove the note. Add `'draft-amendment-note'` to the `LandGateIdentifier` union. The existing `land_gate_rejected` event already carries the identifier through `classifyLandGateRejection`, so no event variant, field, or channel is added — the event-spine procedure returns "no new channel".

Rule text follows. In `HARNESS.md` "DECIDE Artifact Amendment Ownership", keep the opening sentence (DECIDE corrects on the spec branch before first BUILD entry), then distinguish by lifecycle: an accepted DECIDE artifact absent from the base branch — including one this spec branch already committed or landed — is a draft; revise it in place, remove superseded text so it states only the current approved scope, and add no amendment note or revision log; git history and the spec PR carry provenance. Keep the story-artifact exception sentence exactly as narrow as today (it must still name only `.docs/stories/` — `hasStoryOnlyAmendmentException` in the existing acceptance file checks that sentence). Keep the additive form and its never-rewrite/never-delete safeguard, scoped to the other accepted DECIDE artifacts already on the base branch. Name the land gate in one sentence. Apply the same distinction to `skills/conflict-check/SKILL.md:209-221`, `skills/architecture-review/SKILL.md:51-62`, and `skills/coherence-check/SKILL.md:268-271`. `skills/stories/SKILL.md` already replaces in place and is not edited. Write any example of the note with the `YYYY-MM-DD` placeholder, never a real date.

`src/conductor/test/acceptance/build-tasks-can-amend-protected-docs-artifacts-ame.acceptance.test.ts:238-300` pins the current wording with distance-bounded patterns. Keep those tests passing; if the reworded text legitimately moves outside a window, widen only the window and keep every safeguard term (`never rewrite`, `delete`, `original assertion`, `Amended YYYY-MM-DD by #NNN`, the story-only exception) required. New assertions for this feature go in a new contract file, `src/conductor/test/acceptance/draft-amendment-lifecycle.acceptance.test.ts`, reading the files the same way that suite's `readContract` helper does.

Pattern context for the land tests: `src/conductor/test/engine/engineer/land-spec.test.ts` builds a real repository, commits base content in `repoPath`, and seeds a valid worktree with `seedValidWorktree`; the "canonical ADR filename gate merge-base exemptions" block (around line 570) and the "DECIDE amendments at land" block (around line 2362) are the patterns for on-base versus new-artifact cases and for asserting an unchanged HEAD. `src/conductor/test/engine/engineer/land-gate-rejection.test.ts:19` is the pattern for gate classification. Reuse those builders; variation in grouping is fine.

## Preconditions and claim ledger

- Operator decision (pre-DECIDE, delegated 2026-10-09): drafts not on the base branch are revised in place; amendment notes only for artifacts already on the base branch.
- Verified: `HARNESS.md:135-152` requires the additive note for every non-story accepted artifact with no lifecycle distinction.
- Verified: `skills/conflict-check/SKILL.md:209-221`, `skills/architecture-review/SKILL.md:51-62`, `skills/coherence-check/SKILL.md:268-271` restate the additive form without the distinction; `skills/stories/SKILL.md:171-181` already replaces in place.
- Verified: `land-spec.ts:776-800` lists `.docs` blobs at the merge base; `land-spec.ts:820-858` (`resolveIdeaFiles`) returns committed-since-merge-base and untracked `.docs` paths; `land-spec.ts:124-149` is the closed `LandGateIdentifier` union; `src/conductor/src/types/events.ts:483-490` carries it on `land_gate_rejected`.
- Verified: `coverage-binding-inputs.ts:84-96` treats every amendment block in a file new at the merge base as a plan obligation, so refusing draft notes at land also removes spurious coverage claims.
- Verified: no other copy of the HARNESS.md amendment section exists in the repository; the only test pinning its wording is the acceptance file named above.
- Scope check: consumer-facing (`HARNESS.md`, shipped skills, shipped `compose land`); no new skill; provider-agnostic. Event spine: no new channel.
- Verify-claims verdict: CLEAR. Every path, symbol, and behavior above was read in this worktree.

## Tasks

### Task 1: Refuse amendment notes in draft artifacts at land
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/src/engine/engineer/land-spec.ts, src/conductor/test/engine/engineer/land-spec.test.ts, src/conductor/test/engine/engineer/land-gate-rejection.test.ts
**Dependencies:** none

**Steps:**
1. Write unit cases for the exported detector: a plain bold "Amended" line with a real date, a block-quoted one, one written "by operator", one written "by #123", a `YYYY-MM-DD` placeholder line, and prose that mentions "amended" without the bold dated form.
2. Write real-git land cases using the suite's `repoPath`/`seedValidWorktree` fixture: a clean draft set lands; an artifact committed on the base branch that gains a dated note in the worktree lands; an untracked draft with a note is refused; a draft committed on the spec branch (absent from the base) with a note is refused; two offending drafts produce one refusal naming both paths; a draft showing only the placeholder lands. For each refusal assert HEAD is unchanged and no landing commit exists.
3. Add a `land-gate-rejection.test.ts` case asserting a draft-note refusal classifies as gate `draft-amendment-note`.
4. Establish RED, then implement as described in Technical Approach: add the identifier, the detector, the shared merge-base listing, and the check placed before any landing write.
5. Run the focused land test files through the repository's scoped test runner, confirm the typecheck target that includes test files passes, and commit.

**Done when:**
1. [test] The detector returns the plain, block-quoted, "by operator", and "by #123" dated lines and returns nothing for the `YYYY-MM-DD` placeholder line and undecorated prose.
2. [test] `landSpec` refuses with gate `draft-amendment-note` when an untracked draft `.docs/` artifact, or a draft committed on the spec branch but absent from the base branch, contains a dated amendment note in plain or block-quoted form, and the message names the artifact path and tells the author to fold the correction into the artifact text.
3. [test] A single `draft-amendment-note` refusal names every offending draft path when two drafts carry notes, and after any such refusal the worktree HEAD equals its pre-land value with no landing commit created.
4. [test] `landSpec` commits the spec when no draft carries a dated note, when an artifact already on the base branch gains a dated note on the spec branch, and when a draft shows the format only with the `YYYY-MM-DD` placeholder.
5. [test] `classifyLandGateRejection` returns gate `draft-amendment-note` for that refusal.

### Task 2: State the amendment rule by artifact lifecycle in HARNESS.md
**Story:** Story 1
**Type:** happy-path
**Files:** HARNESS.md, src/conductor/test/acceptance/draft-amendment-lifecycle.acceptance.test.ts, src/conductor/test/acceptance/build-tasks-can-amend-protected-docs-artifacts-ame.acceptance.test.ts
**Dependencies:** 1

**Steps:**
1. Create the new contract file with cases over `HARNESS.md`'s DECIDE Artifact Amendment Ownership section: a draft absent from the base branch is revised in place with superseded text removed and no amendment note; the additive note and its never-rewrite/never-delete safeguard apply to non-story artifacts already on the base branch; the in-place draft rule does not extend to non-story artifacts on the base branch; the story exception sentence still names only story artifacts; the section names the `draft-amendment-note` land gate. Include a mutation case proving the draft assertion fails when the in-place sentence is removed.
2. Establish RED, then rewrite the section as described in Technical Approach. Keep every example of the note on the `YYYY-MM-DD` placeholder.
3. Run the new file and the existing amendment acceptance file; if an existing distance window no longer matches reworded text, widen only that window and keep every safeguard term required. Commit.

**Done when:**
1. [test] A contract test asserts the `HARNESS.md` section directs in-place revision with superseded text removed and no amendment note for an accepted DECIDE artifact absent from the base branch, and fails when that sentence is removed.
2. [test] A contract test asserts the section requires the additive `Amended YYYY-MM-DD by #NNN` note beside the original assertion for non-story artifacts already on the base branch and forbids rewriting or deleting their original text, and asserts the in-place draft rule is scoped to artifacts absent from the base branch.
3. [test] `hasStoryOnlyAmendmentException` still returns true for `HARNESS.md` and the story exception sentence names only story artifacts and no other artifact family.
4. [test] The existing TS-1 `HARNESS.md` case in the protected-artifact amendment acceptance file passes with every safeguard term still required.

### Task 3: Align the DECIDE skills with the lifecycle rule
**Story:** Story 1
**Type:** happy-path
**Files:** skills/conflict-check/SKILL.md, skills/architecture-review/SKILL.md, skills/coherence-check/SKILL.md, src/conductor/test/acceptance/draft-amendment-lifecycle.acceptance.test.ts, src/conductor/test/acceptance/build-tasks-can-amend-protected-docs-artifacts-ame.acceptance.test.ts
**Dependencies:** 2

**Steps:**
1. Add contract cases to the new file for each of the three skills: the amendment note is restricted to artifacts already on the base branch, and an artifact absent from the base branch is revised in place without a note.
2. Establish RED, then edit the three passages named in Technical Approach. Keep `skills/stories/SKILL.md` unchanged. Keep provider-neutral wording.
3. Run the new file and the existing amendment acceptance file (widening only a distance window if the rewording requires it, never dropping a safeguard term), confirm the provider skill contract audit still passes for the edited skills, and commit.

**Done when:**
1. [test] Contract tests assert that `skills/conflict-check/SKILL.md`, `skills/architecture-review/SKILL.md`, and `skills/coherence-check/SKILL.md` each restrict the amendment note to artifacts already on the base branch and each direct in-place revision without a note for artifacts absent from it.
2. [test] The existing TS-1 conflict-check and architecture-review cases in the protected-artifact amendment acceptance file pass with every safeguard term still required.
3. `skills/stories/SKILL.md` is byte-identical to its merge-base content.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the `HARNESS.md` DECIDE Artifact Amendment Ownership section, when an agent reads how to correct an accepted DECIDE artifact absent from the base branch, then it is told to revise that artifact in place, removing the superseded text, and to add no amendment note. | 2 | "A contract test asserts the `HARNESS.md` section directs in-place revision with superseded text removed and no amendment note for an accepted DECIDE artifact absent from the base branch, and fails when that sentence is removed." | diff-local |
| Story 1 happy: Given the `HARNESS.md` DECIDE Artifact Amendment Ownership section, when an agent reads how to correct a non-story accepted DECIDE artifact already on the base branch, then it is told to add the additive amendment note beside the original assertion and never to rewrite or delete the original text. | 2 | "A contract test asserts the section requires the additive `Amended YYYY-MM-DD by #NNN` note beside the original assertion for non-story artifacts already on the base branch and forbids rewriting or deleting their original text, and asserts the in-place draft rule is scoped to artifacts absent from the base branch." | diff-local |
| Story 1 happy: Given the `conflict-check`, `architecture-review`, and `coherence-check` skills, when each instructs a DECIDE correction of an accepted artifact, then each restricts the amendment note to artifacts already on the base branch and directs in-place revision for artifacts absent from it. | 3 | "Contract tests assert that `skills/conflict-check/SKILL.md`, `skills/architecture-review/SKILL.md`, and `skills/coherence-check/SKILL.md` each restrict the amendment note to artifacts already on the base branch and each direct in-place revision without a note for artifacts absent from it." | diff-local |
| Story 1 negative: Given the `HARNESS.md` DECIDE Artifact Amendment Ownership section, when an agent reads the in-place revision rule for draft artifacts, then that rule does not authorize rewriting or deleting the original text of a non-story artifact already on the base branch. | 2 | "A contract test asserts the section requires the additive `Amended YYYY-MM-DD by #NNN` note beside the original assertion for non-story artifacts already on the base branch and forbids rewriting or deleting their original text, and asserts the in-place draft rule is scoped to artifacts absent from the base branch." | diff-local |
| Story 1 negative: Given the `HARNESS.md` DECIDE Artifact Amendment Ownership section, when an agent reads the story-artifact exception, then that exception sentence still names only story artifacts and no other artifact family. | 2 | "`hasStoryOnlyAmendmentException` still returns true for `HARNESS.md` and the story exception sentence names only story artifacts and no other artifact family." | diff-local |
| Story 2 happy: Given a spec worktree whose `.docs/` artifacts absent from the base branch contain no amendment note, when land runs, then it commits the spec as before. | 1 | "`landSpec` commits the spec when no draft carries a dated note, when an artifact already on the base branch gains a dated note on the spec branch, and when a draft shows the format only with the `YYYY-MM-DD` placeholder." | diff-local |
| Story 2 happy: Given an artifact already on the base branch that gains an amendment note on the spec branch, when land runs, then the amendment note does not cause a refusal and the spec is committed. | 1 | "`landSpec` commits the spec when no draft carries a dated note, when an artifact already on the base branch gains a dated note on the spec branch, and when a draft shows the format only with the `YYYY-MM-DD` placeholder." | diff-local |
| Story 2 negative: Given an untracked `.docs/` artifact absent from the base branch that contains a line beginning with a bold "Amended" followed by a date, plain or block-quoted, when land runs, then land refuses with gate `draft-amendment-note`, names that artifact's path, and directs folding the correction into the artifact text. | 1 | "`landSpec` refuses with gate `draft-amendment-note` when an untracked draft `.docs/` artifact, or a draft committed on the spec branch but absent from the base branch, contains a dated amendment note in plain or block-quoted form, and the message names the artifact path and tells the author to fold the correction into the artifact text." | diff-local |
| Story 2 negative: Given a `.docs/` artifact committed earlier on the spec branch but absent from the base branch that contains an amendment note, when land runs, then land refuses with gate `draft-amendment-note` and names that artifact's path. | 1 | "`landSpec` refuses with gate `draft-amendment-note` when an untracked draft `.docs/` artifact, or a draft committed on the spec branch but absent from the base branch, contains a dated amendment note in plain or block-quoted form, and the message names the artifact path and tells the author to fold the correction into the artifact text." | diff-local |
| Story 2 negative: Given several draft artifacts containing amendment notes, when land runs, then a single refusal names every offending path. | 1 | "A single `draft-amendment-note` refusal names every offending draft path when two drafts carry notes, and after any such refusal the worktree HEAD equals its pre-land value with no landing commit created." | diff-local |
| Story 2 negative: Given land refuses with gate `draft-amendment-note`, when the refusal is reported, then the spec branch HEAD is unchanged, no landing commit is created, and the land rejection is classified with gate `draft-amendment-note`. | 1 | "A single `draft-amendment-note` refusal names every offending draft path when two drafts carry notes, and after any such refusal the worktree HEAD equals its pre-land value with no landing commit created." | diff-local |
| Story 2 negative: Given a draft artifact that shows the amendment format only with the `YYYY-MM-DD` placeholder, when land runs, then that text does not cause a refusal. | 1 | "`landSpec` commits the spec when no draft carries a dated note, when an artifact already on the base branch gains a dated note on the spec branch, and when a draft shows the format only with the `YYYY-MM-DD` placeholder." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local: the gate reads only the spec branch, its merge base, and the worktree, and the rule tests read files this diff edits. Task 1 owns the changed production boundary — `landSpec`, the function `ai-conductor compose land` calls — and proves it with real-git repositories and real worktrees; the classification case proves the identifier reaches the existing `land_gate_rejected` field. Tasks 2 and 3 own the instruction contracts with file-reading acceptance tests that include a mutation case so a removed sentence fails. No test reaches a real LLM, GitHub, or any other third-party service. No terminal validation task is added; aggregate tests belong to `test_suite`.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 3
