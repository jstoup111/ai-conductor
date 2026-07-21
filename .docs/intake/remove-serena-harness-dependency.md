# Intake: Remove Serena from harness dependencies and install — out of scope for the daemon (#753)

Source: jstoup111/ai-conductor#753
Source-Ref: jstoup111/ai-conductor#753
Owner: jstoup111
Size (filed): S
Labels: priority: critical, v1.0 gate

See the GitHub issue for the operator decision (2026-07-19 re-scope), the motivating
symptom (#682: duplicate `serena start-mcp-server` + per-project LSP trees spiking CPU/disk
on daemon hosts during concurrent builds), and the full touchpoint list. This intake
supersedes #682 and the closed spec PR #728 (which took the server-management approach the
operator rejected). Inherits #682's v1.0 gate position (#228 blocked_by).

## Scope re-statement (as specced)

Remove Serena from the harness entirely — install path, bootstrap registration, agent
guidance, and generated config — rather than bounding or lifecycle-managing its processes:

- `bin/install`: delete the Serena install block AND the uv-for-Serena install ladder
  (uv exists in the install script only as Serena's installer).
- `skills/bootstrap/SKILL.md`: delete §9a (user-scope `claude mcp add … serena` +
  `serena init`) and the `.serena/` gitignore-seed bullet in §5.
- `HARNESS.md`: remove the serena bullets from "MCP Servers (When Available)"; context7
  guidance stays.
- `src/conductor/src/engine/registry-cli.ts`: drop `.serena/` from `GITIGNORE_SKELETON`;
  update the integration test that asserts it.
- `README.md`: remove the uv requirement bullet, the "Optional: Serena" install paragraph,
  and the `.serena/` mention in the `conduct create` skeleton description.
- CHANGELOG `[Unreleased] → ### Removed` entry with a `## Migration` block giving existing
  deployments the clean removal path (guarded, idempotent `claude mcp remove --scope user
  serena`; optional manual uninstall guidance) — see the ADR.

**Kept deliberately:** the single `.serena/` line in the harness repo's own `.gitignore`
(residue shield for existing checkouts/worktrees — untracked `.serena/` caches would
otherwise dirty worktrees and trip cleanliness guards). Historical CHANGELOG entries and
`.docs/` artifacts that mention Serena are immutable history and are untouched.

ADR: `.docs/decisions/adr-2026-07-21-serena-removal-path.md`.
