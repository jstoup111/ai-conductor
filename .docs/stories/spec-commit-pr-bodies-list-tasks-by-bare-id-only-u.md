**Status:** Accepted

# Stories: Spec commit/PR bodies list tasks with their titles

Source: jstoup111/ai-conductor#2579. Track: technical (no PRD). Tier: S.

`compose land` (and engineer land) commits a spec with a composed message, and `compose handoff`
builds the spec PR body from that commit. Today the message's Stories section names each story
by its title, but its Tasks section names each task only by bare id (`- Task 1` … `- Task N`).
These stories make the Tasks section name each task by its title, using the plan headings that
already exist.

## Story 1: The spec land commit lists every task with its heading title

**Requirement:** #2579 desired outcomes 1, 2

As a reviewer reading a spec PR or its land commit, I want each task listed with its title, so
that I can see what the plan does without opening the plan file.

### Acceptance Criteria

#### Happy Path
- Given a plan whose task headings are `### Task 1: Compose the body`, `### Task 2: Guard trailer-shaped prose`, and `### Task 3: Commit the summary`, when the spec commit message is composed, then its Tasks section is exactly `Tasks: 3` followed by the lines `- Task 1: Compose the body`, `- Task 2: Guard trailer-shaped prose`, and `- Task 3: Commit the summary`, in plan order.
- Given a plan task heading delimited by an em dash, `### Task task_3 — Dash-delimited title`, when the spec commit message is composed, then its Tasks section carries the line `- Task task_3: Dash-delimited title`.
- Given a valid spec with titled task headings landed through `landSpec`, when the resulting land commit's full message is read back with `git log -1 --format=%B`, then its Tasks section lists every task as `- Task <id>: <title>` in plan order.

#### Negative Paths
- Given a plan task heading with no title text, either `### Task 4` or `### Task 4:`, when the spec commit message is composed, then that task's line is exactly `- Task 4`, with no trailing colon or whitespace, and composition does not throw.
- Given a plan that shows a `### Task 9: Example heading` line only inside a fenced code block, when the spec commit message is composed, then no `- Task 9` line appears and the `Tasks:` count excludes it.
- Given a plan task whose title is itself trailer-shaped, `### Task 1: Task: 71`, when the spec commit message is composed, then that task's line is `- Task 1: Task: 71` and no line of the message matches the `Task: <id>` commit-trailer grammar.

### Done When
- [ ] `spec-commit-message.test.ts` asserts the titled `- Task <id>: <title>` lines for colon- and em-dash-delimited headings.
- [ ] `spec-commit-message.test.ts` asserts the bare `- Task 4` fallback for both untitled heading forms, the fenced-heading exclusion, and the absence of trailer-shaped lines.
- [ ] `land-spec.test.ts` asserts the land commit message read back from git carries `Tasks: 3` followed by the three titled task lines.
