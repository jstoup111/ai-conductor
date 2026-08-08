# Track: bin/teardown — release worktree-provisioned resources before removal

Track: product

A new consumer-authored extension point (`bin/teardown`) with a documented contract —
invocation env, bounded timeout, absent-script no-op, and best-effort-but-loud failure
semantics — is a user-facing capability whose requirements are worth enumerating in a PRD,
not internal plumbing.
