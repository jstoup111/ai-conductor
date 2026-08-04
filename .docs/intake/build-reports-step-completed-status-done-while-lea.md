# Intake origin: build-reports-step-completed-status-done-while-lea

Source-Ref: jstoup111/ai-conductor#1270
Owner: jstoup111

## Desired outcome

- A BUILD step cannot report `status:done` while its worktree has uncommitted changes to
- When a step ends with a dirty worktree, the recorded reason names the uncommitted paths,
- Verification evidence records the SHA it actually ran against, and a gate blocked by a
- A BUILD session that legitimately produces no changes still completes normally — an
