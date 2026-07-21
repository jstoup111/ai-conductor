# Gotcha: Nested sub-agent dispatches lose the mutation-gate `Task:` stamp

**Category:** Pipeline / autonomy friction
**Discovered:** 2026-07-21, during build of #757
(`build-progress-marker-stays-0-n-for-the-whole-buil`)

## Symptom
A TDD task dispatch stalls mid-run with no commit landed on the first attempt.
Re-running the same task (or dispatching directly rather than nesting) succeeds.

## Root Cause
`.pipeline/session-hooks/mutation-gate.sh` requires a line-1 `Task: <id>` (or
`Task: none`) stamp on the dispatch that performs a mutation (Edit/Write/
NotebookEdit, or `git commit` over Bash). When a TDD subagent itself spawns a
*nested* sub-agent to perform the RED/GREEN edit steps, the nested dispatch
does not inherit/carry the stamp from its parent. The mutation-gate hook then
sees no stamp and blocks the write with:

```
implementation happens inside a stamped Agent dispatch — dispatch with
"Task: <id>" line 1, or use "Task: none" for non-implementation work
```

This happened on Task 3 and Task 11 of the #757 build; both required a manual
retry to land.

## Fix / Avoidance
Instruct TDD subagents explicitly NOT to spawn their own nested sub-agents for
RED/GREEN steps — have them make the edits directly. If a nested dispatch is
unavoidable, the nested dispatch must re-stamp its own line 1 with the same
`Task: <id>` before performing any mutation.
