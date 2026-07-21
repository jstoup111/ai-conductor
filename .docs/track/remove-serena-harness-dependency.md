# Track: Remove Serena from harness dependencies and install (#753)

Track: technical

## Rationale

Internal harness-surface removal with no product feature. The operator decision (issue
#753, 2026-07-19) is that Serena — an optional LSP-backed semantic-code MCP server the
harness installs opt-in and registers at **user scope** — is out of scope for the daemon.
The user-scope registration means every Claude Code session on a daemon host (daemon,
parallel worktree branches, subagents) launches its own `serena start-mcp-server` with
per-project language-server children, and `.serena/` semantic-index caches regenerate per
worktree. Net effect: CPU/disk spikes and duplicate MCP/LSP process trees growing roughly
linearly with session count (#682).

The resolution is **removal, not management**: delete the install offer, the bootstrap
MCP registration, the HARNESS.md usage instruction, and the generated-config seeding —
plus a migration path so existing deployments cleanly stop depending on Serena. No new
capability, no UI, no PRD; acceptance criteria live in the stories.
