# Remove Serena from harness dependencies and install (#753)

Status: Accepted

## Context

The harness treats Serena (oraios/serena, an LSP-backed semantic-code MCP server) as an
opt-in dependency: `bin/install:501-558` offers to install `uv` and then
`uv tool install -p 3.13 serena-agent`; `skills/bootstrap/SKILL.md` §9a registers it as a
**user-scope** MCP server (`claude mcp add --scope user serena -- serena start-mcp-server
--context claude-code --project-from-cwd`) and runs `serena init`; `HARNESS.md:263-267`
instructs agents to use it proactively; `registry-cli.ts:106` seeds `.serena/` into every
scaffolded project's `.gitignore`.

Because registration is user-scope, every Claude Code session on a daemon host launches
its own `serena start-mcp-server` with per-project language-server children; caches
regenerate per worktree. Operator-observed effect (#682): CPU/disk spikes during
concurrent/parallel builds, process trees growing with session count.

Operator decision (#753, 2026-07-19): Serena is **out of scope for the daemon** — remove
the dependency entirely rather than managing its servers (supersedes #682 and closed spec
PR #728). Removal-path policy is fixed by
`.docs/decisions/adr-2026-07-21-serena-removal-path.md` (APPROVED): approval-gated
migration unregister (D1-C), never uninstall `serena-agent`/`uv` (D2), keep the harness
repo's own `.serena/` ignore line but drop it from `GITIGNORE_SKELETON` (D3).

## Non-goals

- No bounding, singleton-izing, or lifecycle management of Serena/MCP servers (the
  rejected #728 approach).
- No removal of other MCP integrations — context7 guidance in HARNESS.md and the
  puppeteer MCP install in `bin/install` are untouched.
- No uninstalling `serena-agent` or `uv` from operator machines, ever (ADR D2).
- No rewriting of historical CHANGELOG entries or historical `.docs/` artifacts that
  mention Serena (append-only history).
- No retroactive edit of already-seeded consumer `.gitignore`s (seeding is one-shot).

---

## Story 1 — Fresh install carries zero Serena (happy path)

As an operator running `./bin/install` on a clean machine, I am never prompted about
Serena or uv, and nothing Serena-related is installed or mentioned.

- **Given** a machine with neither `serena` nor `uv` on PATH
- **When** `./bin/install` runs (interactive or not)
- **Then** no uv prompt, no Serena prompt, no "install later with `uv tool install …
  serena-agent`" guidance is emitted, and the script's other tool installs (rtk,
  puppeteer MCP, mermaid renderer) behave exactly as before
- **And** `grep -i serena bin/install` finds nothing.

## Story 2 — Bootstrap registers nothing even when Serena IS on PATH (negative)

As an operator who independently installed Serena for other projects, running
`/bootstrap` in a harness-managed repo does not register it, initialize it, or mention it.

- **Given** `serena` IS on PATH (and possibly already registered at user scope by me)
- **When** `/bootstrap` runs to completion
- **Then** the skill contains no §9a Serena step — it never runs `claude mcp add … serena`
  or `serena init`, and never reports Serena status
- **And** my own out-of-harness registration, if any, is left exactly as I made it
  (bootstrap neither adds nor removes it).

## Story 3 — Agent guidance contains no Serena instruction (negative)

As a harness agent session, my loaded guidance never tells me to use a serena MCP server.

- **Given** HARNESS.md as loaded by bootstrap
- **When** the "MCP Servers (When Available)" section is read
- **Then** it covers context7 only — the serena bullet and the "Both installed" workflow
  bullet are gone, and no other HARNESS.md section references serena
- **And** `test/test_harness_integrity.sh` passes (model table, skill references, and
  section checks all green after the edit).

## Story 4 — Scaffolded projects no longer seed `.serena/`; harness repo stays shielded

As the registry CLI, projects I scaffold carry no Serena residue, while the harness
repo's own ignore line remains.

- **Given** `conduct create <name>` (or registry onboarding) seeds `GITIGNORE_SKELETON`
- **When** the generated `.gitignore` is inspected
- **Then** it contains `.pipeline/`, `.daemon/`, `.worktrees/` and NOT `.serena/`
- **And** the integration test asserts `.serena/` is absent from the seeded file
  (flipped from today's presence assertion at `registry-cli.test.ts:299,305`)
- **And** the harness repo's own `.gitignore` still ignores `.serena/` (ADR D3 — existing
  checkouts with historical caches must not show dirty worktrees).

## Story 5 — Upgrade path: existing deployment cleanly stops depending on Serena

As an operator updating an existing deployment where bootstrap previously registered
Serena at user scope, I get an approval-gated migration that unregisters it — and a
no-op if it was never registered.

- **Given** a consumer updating past this version, with `claude mcp get serena` exiting 0
- **When** `bin/migrate` runs the version's `## Migration` block and I approve it
- **Then** the block runs `claude mcp remove --scope user serena` (guarded by a
  `claude mcp get serena` check), reports what it did, and prints — without executing —
  the optional cleanup commands (`uv tool uninstall serena-agent`, killing stray
  `serena start-mcp-server` processes, removing `.serena/` cache dirs)
- **Given instead** Serena was never registered (fresh install or declined opt-in)
- **Then** the same block exits 0 having changed nothing (idempotent; safe to re-run)
- **And** declining the migration leaves my user config byte-identical.

## Story 6 — Daemon host runs zero Serena processes (outcome)

As a daemon host operator, after updating and approving the migration, concurrent builds
spawn no Serena processes.

- **Given** an updated deployment that has applied the Story-5 migration
- **When** the daemon runs concurrent/parallel builds (multiple sessions, worktrees,
  subagents)
- **Then** `pgrep -f 'serena start-mcp-server'` finds no harness-spawned processes at any
  point during or after the builds, no new `.serena/` cache directories appear in
  worktrees, and no CPU/disk spikes attributable to Serena/LSP children occur
- **And** sessions start without attempting to connect to a serena MCP server (no
  connection errors referencing serena in session logs).
