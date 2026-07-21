# ADR: Serena removal path — stop shipping it, migrate existing deployments via an approval-gated unregister, keep the repo-local ignore line

**Status:** APPROVED
**Date:** 2026-07-21
**Issue:** #753 · **Stem:** `remove-serena-harness-dependency`
**Supersedes:** the server-management approach of closed spec PR #728 (branch
`spec/multiple-serena-mcp-servers-spike-cpu-and-disk-acr`, never merged — no artifacts on main)

## Context

The harness currently (a) offers to install `uv` + `serena-agent` in `bin/install`,
(b) registers Serena as a **user-scope** MCP server in `/bootstrap` §9a
(`claude mcp add --scope user serena -- serena start-mcp-server --context claude-code
--project-from-cwd`), (c) instructs agents to use it proactively in HARNESS.md, and
(d) seeds `.serena/` into generated `.gitignore`s. Operator decision (#753): Serena is
out of scope for the daemon — remove the dependency entirely (do NOT bound/singleton
its servers, the #728 approach).

Removal has three sub-decisions:

### D1 — Existing deployments: actively unregister, or stop-and-document?

The user-scope registration lives in Claude Code's **user-level** config
(`~/.claude.json`), outside any repo. Merely stopping new registrations leaves every
existing deployment still spawning `serena start-mcp-server` per session — the #682
symptom persists indefinitely on exactly the hosts that motivated the issue. But having
harness code silently mutate user-level config on update is out of bounds: the operator
may use Serena outside the harness.

- **(A) Silent active removal:** `bin/install --update` / bootstrap runs
  `claude mcp remove --scope user serena` unconditionally. Fixes hosts, but mutates
  user config without consent and breaks non-harness Serena users.
- **(B) Stop-and-document only:** README/CHANGELOG note the manual commands. Safe, but
  the daemon-host symptom persists until every operator reads the note; "clean removal
  path" becomes a hope.
- **(C) Approval-gated migration block (chosen):** the change ships a `## Migration`
  section in CHANGELOG whose ```` ```bash migration ```` block `bin/migrate` executes
  **only after operator approval** when a consumer updates past this version. The block
  is guarded and idempotent: it unregisters the user-scope Serena MCP server only if
  `claude mcp get serena` succeeds, and prints (does not run) the optional cleanup
  commands — `uv tool uninstall serena-agent`, killing stray
  `serena start-mcp-server` processes, deleting `.serena/` caches.

**Decision: (C).** The unregister is the one action that actually stops per-session
Serena spawning on existing hosts, and `bin/migrate`'s approval gate is the existing,
sanctioned consent mechanism for exactly this kind of consumer-side cleanup. The block
must be a no-op when Serena was never registered (fresh installs, declined opt-ins).

### D2 — Uninstall `serena-agent` / `uv` themselves?

**No.** Both are user-machine tools installed into the operator's toolchain
(`uv tool install`, `~/.local/bin/uv`) and may serve purposes beyond this harness. The
migration block prints the uninstall commands as guidance; it never runs them. Removing
the *registration* (D1) is sufficient to reach the issue's desired outcome — zero
harness-attributable Serena processes — because nothing launches an installed-but-
unregistered Serena.

### D3 — Keep `.serena/` gitignore entries?

Split decision:

- **Harness repo `.gitignore:31` — KEEP.** Existing checkouts and worktrees may carry
  `.serena/` caches from history, and hosts that haven't yet run the migration still
  regenerate them. Un-ignoring would surface untracked `.serena/` dirs that dirty
  worktrees — tripping the engineer's dirty-worktree land refusal and daemon
  cleanliness checks. One inert line is the cheap shield.
- **`GITIGNORE_SKELETON` (`registry-cli.ts:106`) — REMOVE.** The skeleton is
  *generative*: it propagates harness knowledge of Serena into every newly scaffolded
  project. Post-removal the harness has no Serena concept to seed. Existing consumer
  projects keep their already-seeded `.gitignore` lines (seeding is one-shot, never
  retracted), so they stay protected without any migration action.

## Consequences

- Fresh installs never see a Serena or uv prompt; `/bootstrap` performs no MCP
  registration for Serena; agents receive no Serena guidance; scaffolded projects have
  no `.serena/` ignore line.
- Existing deployments converge on "zero Serena processes" the first time they approve
  the migration block; until then behavior is unchanged (fail-safe, not fail-broken).
- Operators who use Serena independently of the harness can decline the migration
  block (or re-register afterwards) — the harness neither installs nor uninstalls it.
- The release gate's canonical breaking surfaces are untouched; the migration block is
  voluntary, so no `.docs/release-waivers/` entry is needed.
- Historical CHANGELOG entries and `.docs/` artifacts mentioning Serena remain as-is
  (append-only history).
