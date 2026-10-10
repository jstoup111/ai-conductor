# Intake origin: spec-commit-pr-bodies-list-tasks-by-bare-id-only-u

Source-Ref: jstoup111/ai-conductor#2579
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2579 digest=fee8ecaa10f0ff7af861c4825adf1f5f5be443ffad160c3409c590d027f96de1 >>>
## Desired outcome

- A spec PR body / `land` commit message's Tasks section lists each task's title text, in the same `- Task N: <title>` shape the Stories section already uses for `- Story N: <title>`.
- This holds with no plan-file edits beyond what already exists today — i.e. it works against the same `### Task N: <title>` headings the plan format already requires, with no new authoring convention.
- A plan with a task heading containing no title (bare `### Task N`, if that ever occurs) still renders without crashing — falls back to the bare id rather than an empty string or an error.
<<< END INBOUND >>>
