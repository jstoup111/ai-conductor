# Implementation Plan: Fail land when a non-Small architecture artifact has no mermaid diagram

**Date:** 2026-09-06
**Stories:** .docs/stories/fail-land-when-a-non-small-architecture-artifact-h.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the change adds one refusal inside an existing tier-conditional branch and alters no shared contract — the render gate keeps ownership of fences that exist but do not parse, and the tier-agreement gate keeps ownership of the artifact's presence.

## Summary

Three bounded tasks deliver #729. A non-Small spec whose own architecture artifact carries zero fenced mermaid blocks is refused at the engineer land seam, with the refusal naming the offending artifact. The check is deliberately narrow: it reads only the architecture artifact the surrounding tier check already resolved for this idea, so a Small-tier spec, a spec with no readable tier, and any architecture document inherited from the base branch are all untouched. Auditing merged architecture documents, new flags or configuration, and any change to how diagrams are parsed or rendered are outside this slice.

## Technical Approach

The gate lands in the existing tier-conditional completeness branch of `landSpec`, immediately after the branch has confirmed that a non-Small spec produced its conflicts, architecture, and decisions artifacts. That location supplies everything the check needs and nothing it does not: the tier is already parsed, so Small tier and an unreadable tier are exempt by construction rather than by an added condition; the architecture artifact is already resolved through the idea-attribution pick, so a document inherited from the target's default branch can never be the file examined; and a missing artifact has already been refused, so the read cannot fail for absence.

Fence detection reuses the exported extractor from the mermaid renderer module rather than a fresh regular expression. That extractor already anchors both the opening and the closing fence to the start of a line, so a prose mention of a fence mid-sentence is correctly not a block — reproducing that rule by hand is exactly how the check would drift from the render gate that runs a few statements later over the same file.

The refusal is a thrown error in the same style as its neighbours: it names the architecture artifact path, states that a non-Small architecture artifact must contain at least one fenced mermaid block, and directs the author to regenerate the diagram through the architecture-diagram step. It does not mention the renderer tool, because the failure is an authoring omission rather than an environment limitation — the two are kept distinguishable in the message so an operator reading a build log can tell them apart.

Existing non-Small land fixtures across four test files seed an architecture artifact whose body is a bare heading, which the new gate correctly rejects. Those fixtures are repaired by giving each seeded artifact a minimal fenced block; none of them is about diagram content, so the repair is a fixture correction, not a weakening of their assertions. Repairing them in the same task that introduces the gate keeps the suite green at every commit.

Tests follow the repository's test-authoring rules. The land seam is exercised directly through its exported entry point against real local Git with injected GitHub and renderer dependencies, which is the pattern the existing render-gate tests in the same file already use; no conductor run is started, and no third party is contacted. Cases that only need to distinguish a fenced block from prose are asserted at the land boundary rather than duplicated as extractor unit tests, because the extractor already carries its own coverage.

Documentation upkeep adds a row to the land-time gate table and extends the architecture artifact row in the artifact reference, and one sentence in the architecture-diagram skill states the obligation so the authoring step names the rule it is held to. The skill already tells authors the render check is machinery-enforced; this sentence extends that paragraph rather than opening a new one.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, fail-closed over warn, and both stories on 2026-09-06 (delegated).
- Verified: `landSpec` step 4d parses the tier from the complexity artifact and, for a non-Small tier, resolves the architecture artifact through `pickIdeaFile` and throws when it is missing — the tier discrimination, the pick, and the refusal shape all already exist.
- Verified: `resolveIdeaFiles` builds its attribution set from the branch diff against the derived default branch plus untracked worktree files, so `pickIdeaFile` cannot return a document that only exists on the base branch.
- Verified: `checkDiagramsForFile` in the mermaid renderer module returns a no-diagrams status for a file with zero blocks, and `landSpec` step 4f treats that status as a pass — this is the defect reported in #729.
- Verified: `extractMermaidBlocks` is exported from the mermaid renderer module and anchors its fences to line starts, so a mid-sentence mention is not a block.
- Verified: the four test files named in the task file lists each seed a non-Small architecture artifact whose body carries no fenced block, so each needs a fixture repair.
- Verified: a sweep of the committed architecture documents on the base branch found exactly one file with no fenced block; because the gate reads only this idea's own artifact, no grandfathering clause is required.
- Verified: the land-time gate table in the gates explanation page and the architecture row in the artifact reference page are the canonical pages this change makes stale.
- Scope check: consumer-facing; no new skill; provider-agnostic. Event-spine: no new event, metric, span, log line, or report — the outcome is an existing gate refusal on the existing path.
- Verify-claims verdict: CLEAR. Every path, symbol, and behavior above was read in the worktree; no pending product or scope assumption remains.

## Tasks

### Task 1: Refuse a non-Small architecture artifact with no fenced diagram
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/engineer/land-spec.ts, src/conductor/test/engine/engineer/land-spec.test.ts, src/conductor/test/acceptance/engineer-agent-hosted.test.ts, src/conductor/test/acceptance/decide-artifact-coherence-check.acceptance.test.ts, src/conductor/test/acceptance/build-tasks-can-amend-protected-docs-artifacts-ame.acceptance.test.ts
**Dependencies:** none

**Steps:**
1. Add land-seam cases to the land-spec test file for a non-Small spec whose architecture artifact holds one fenced block, one whose artifact holds only a heading and prose, and one whose artifact mentions a fence only mid-sentence. Reuse the existing non-Small worktree seeding helper and the existing injected GitHub and renderer dependencies; do not start a conductor run.
2. Establish RED, then implement the check in the tier-conditional branch of the land entry point, after the missing-artifact refusal. Read the resolved architecture artifact and extract its fenced blocks with the exported extractor from the mermaid renderer module. Throw when the extraction returns nothing, naming the artifact path and pointing at the architecture-diagram step.
3. Repair the seeded architecture artifact in the three acceptance and agent-hosted test files by giving each a minimal fenced block. Change nothing else about those fixtures and leave their existing assertions intact.
4. Run the focused land, agent-hosted, and acceptance test files through the repository's scoped test invocation, then its typecheck target that covers test files, and commit the change.

**Done when:**
1. A non-Small land fixture whose architecture artifact holds one fenced mermaid block lands and returns a slug.
2. A non-Small land fixture whose architecture artifact holds only a heading and prose is rejected, and the rejection text contains that artifact's path.
3. A non-Small land fixture whose architecture artifact mentions a fence only mid-sentence is rejected for the missing-diagram reason and not for a render failure or a missing renderer tool.
4. The previously passing non-Small cases in the agent-hosted and two acceptance test files still pass with their repaired fixtures and unchanged assertions.

### Task 2: Keep the check scoped to this spec's own non-Small artifact
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/test/engine/engineer/land-spec.test.ts
**Dependencies:** 1

**Steps:**
1. Add a land case for a Small-tier spec that declares its tier and authors no architecture directory at all, asserting it lands with no diagram-presence refusal.
2. Add a land case whose base-branch commit already carries a diagram-free architecture document under a stem this idea did not author, alongside this idea's own artifact carrying a fenced block, asserting the inherited document is never judged.
3. Add a land case with no complexity artifact, asserting the existing legacy path is preserved and the new refusal never fires when the tier cannot be read.
4. Run the focused land test file through the repository's scoped test invocation and its typecheck target that covers test files, then commit.

**Done when:**
1. A Small-tier land fixture that declares its tier and authors no architecture directory lands and returns a slug.
2. A land fixture whose base-branch commit holds a diagram-free architecture document under an unrelated stem lands when this idea's own architecture artifact carries a fenced block.
3. A land fixture with no complexity artifact lands unchanged, proving the refusal never fires when no tier can be read.

### Task 3: Document the obligation where authors and operators read it
**Story:** Story 1
**Type:** happy-path
**Files:** skills/architecture-diagram/SKILL.md, docs/explanation/gates.md, docs/reference/artifacts.md
**Dependencies:** 1

**Steps:**
1. Extend the machinery-enforced paragraph in the architecture-diagram skill with one sentence stating that a non-Small architecture artifact containing no fenced mermaid block is refused at land, so an ASCII sketch is not an acceptable substitute.
2. Add a row to the land-time gate table in the gates explanation page describing what the new refusal rejects, phrased in the same voice as the neighbouring mermaid render row.
3. Extend the architecture row of the artifact reference table so its gate column names the diagram-presence requirement alongside the render check it already lists.
4. Run the repository's harness integrity suite to confirm the skill and documentation edits break no structural check, then commit.

**Done when:**
1. The architecture-diagram skill states that a non-Small architecture artifact with no fenced mermaid block is refused at land.
2. The land-time gate table carries a row for the diagram-presence refusal distinct from the existing render row.
3. The architecture row of the artifact reference names the diagram-presence requirement.
4. The repository's harness integrity suite passes with the edited skill and documentation files.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a non-Small spec whose architecture artifact contains at least one fenced mermaid block, when the spec is landed, then land proceeds past the architecture checks and completes normally. | 1 | "A non-Small land fixture whose architecture artifact holds one fenced mermaid block lands and returns a slug." | diff-local |
| Story 1 negative: Given a non-Small spec whose architecture artifact contains no fenced mermaid block, when the spec is landed, then land is refused with an error naming that architecture file and directing the author to regenerate its diagram. | 1, 3 | "A non-Small land fixture whose architecture artifact holds only a heading and prose is rejected, and the rejection text contains that artifact's path." | diff-local |
| Story 1 negative: Given a non-Small spec whose architecture artifact only mentions a mermaid fence mid-sentence in prose rather than opening a block at the start of a line, when the spec is landed, then land is refused for the same missing-diagram reason. | 1 | "A non-Small land fixture whose architecture artifact mentions a fence only mid-sentence is rejected for the missing-diagram reason and not for a render failure or a missing renderer tool." | diff-local |
| Story 2 happy: Given a Small-tier spec that authors no architecture artifact at all, when the spec is landed, then land completes without any diagram-presence refusal. | 2 | "A Small-tier land fixture that declares its tier and authors no architecture directory lands and returns a slug." | diff-local |
| Story 2 negative: Given a non-Small spec whose worktree inherits a committed, diagram-free architecture document under a stem this spec did not author, when the spec is landed, then the inherited document is never examined and land is refused only if the spec's own architecture artifact lacks a diagram. | 2 | "A land fixture whose base-branch commit holds a diagram-free architecture document under an unrelated stem lands when this idea's own architecture artifact carries a fenced block." | diff-local |
| Story 2 negative: Given a non-Small spec whose complexity artifact is absent so no tier can be read, when the spec is landed, then the existing legacy behavior is preserved and no diagram-presence refusal is raised. | 2 | "A land fixture with no complexity artifact lands unchanged, proving the refusal never fires when no tier can be read." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled fixtures. Task 1 owns the land-seam integration proving the refusal and its message, and the fixture repair that keeps the pre-existing non-Small land coverage green. Task 2 owns the scoping integration for tier exemption, base-branch attribution, and the unreadable tier. Task 3 owns the documentation and skill assertions, verified through the repository's structural integrity suite rather than through a new test. The exported fence extractor keeps its existing unit coverage, and the mermaid render gate keeps its existing tests for fences that are present but do not parse; neither is duplicated here. No new aggregate, external-service, or terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
