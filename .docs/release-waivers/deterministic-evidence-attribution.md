Waives: hook wiring

Rationale: Hook provisioning is engine-owned, per-worktree infrastructure applied automatically
during worktree preparation. The new `conduct-ts task start|done` CLI is a new harness-provided
tool with zero consumer action required — no settings.json changes, no existing-hook semantics
changes, no consumer-facing configuration. Hook wiring happens in `worktree-prepare.ts`
(`prepareWorktree()`) as part of the normal daemon build flow; it fails gracefully (fail-open)
if anything goes wrong and never surfaces a hook error to the consumer. Zero consumer-visible
breaking changes.
