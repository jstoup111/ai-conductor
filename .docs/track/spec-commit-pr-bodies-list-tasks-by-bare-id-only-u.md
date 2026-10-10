# Track: Spec commit/PR bodies list tasks with their titles

Track: technical

Scope boundary: Narrow, as the issue's desired outcomes state it. The Tasks section of the spec land commit message, which `handoff` reuses as the spec PR body, lists each task as `- Task <id>: <title>`, matching the Stories section's `- Story <id>: <title>` shape. A task heading with no title falls back to `- Task <id>`. Derivation uses the existing `### Task <id>: <title>` heading grammar with no new plan-authoring convention. Excluded: any change to `parsePlanTaskBodies`'s return shape or its other consumers, the Summary/Track/Stories sections, the commit subject, PR title, release-metadata injection, and plan-format rules.

Internal engine tooling (`composeSpecCommitMessage`, used by every spec land in every managed project), so no product requirements and no PRD; acceptance criteria live in stories (intake jstoup111/ai-conductor#2579). Scope-check: consumer-facing engine behavior, but no `HARNESS.md`, skill, or docs change; provider-agnostic.

Approach: render titles from the existing exported `parsePlanTaskTitles` (`src/conductor/src/engine/plan-task-parse.ts:374`). It already shares `TASK_HEADER_PATTERN`, fence handling, and `expandTaskIds` with `parsePlanTaskBodies`, so ids and order stay identical. The issue's root-cause note predates this sibling parser, which already ships with two consumers. Rejected alternatives: (a) the filer's first hypothesis, changing `parsePlanTaskBodies` to return `{title, body}`, which risks every existing body consumer for no gain; (b) echoing the raw heading line the way stories do, which collapses multi-id headings (`### Task 1, 2: …`) into one line and breaks the per-id `Tasks: N` count.
