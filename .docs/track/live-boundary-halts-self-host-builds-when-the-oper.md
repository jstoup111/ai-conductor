# Track: live-boundary halts self-host builds when the operator edits their own checkout

Track: technical

Internal self-host guard logic (`self-host/live-boundary.ts` + its `conductor.ts` call site); no user-facing product surface. Selected approach: git-aware classification of live-checkout diffs at halt time (tracked/git-explicable change → operator edit, don't halt; untracked/inexplicable → still halts, paths named, fail-closed on any git-command error).
