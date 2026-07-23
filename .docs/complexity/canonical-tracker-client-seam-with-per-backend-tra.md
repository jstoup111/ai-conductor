# Complexity: canonical-tracker-client-seam-with-per-backend-tra

Tier: M

## Rationale

- No new external integrations are implemented (Jira transports are contract-only,
  deferred to #849); no new runtime dependency; no state machines or auth flows built.
- But the refactor surface is wide: one new `TrackerClient` interface + GitHub
  implementation, a canonical runner type + single kill-switch-guarded production
  factory, migration of 10+ verified issue-side call sites across engine modules
  (intake, owner-gate, backlog-priority, blocker-resolver, issue-dep-migration,
  wiring-probe, file-issue, halt-issues' object-shaped `GhAbstraction`), while leaving
  PR-side `gh` call sites untouched.
- A documented per-project tracker config contract (backend, transport `api`|`mcp`,
  credentials reference) must be specified for #845 to host — schema design, not code.
- Test surface: every migrated call site's fakes converge on one client fake; the
  kill-switch bypass holes (engineer-cli, halt-issues) get closed and covered.
- Matches the issue's own `size: M` label; well short of L (no multi-day integration,
  no product surface), clearly beyond S (cross-cutting interface design + broad
  migration).
