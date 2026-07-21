# ADR: Exclude Serena from harness-spawned build sessions via strict MCP config

Status: APPROVED
Date: 2026-07-20
Feature: serena-mcp-fanout
Intake: jstoup111/ai-conductor#682

## Context

Serena is registered **user scope** (`skills/bootstrap/SKILL.md` §9a:
`claude mcp add --scope user serena -- serena start-mcp-server ...`). User scope means every
`claude` session loads it. `ClaudeProvider.buildArgs()`
(`src/conductor/src/execution/claude-provider.ts`) constructs the argv for every
harness-spawned session and passes **no** MCP-scoping flag, so each spawned session inherits
user-scope Serena and launches its own stdio `serena start-mcp-server` plus per-project
language servers. The daemon, parallel worktree branches, and subagents run many such sessions
concurrently, so Serena/LSP process count grows ~linearly with concurrent session count —
the CPU/disk spike reported in #682.

Claude Code offers **no flag to exclude a single MCP server**. The only levers are:
- `--mcp-config <configs...>` — load MCP servers from JSON files/strings (verified `claude --help`).
- `--strict-mcp-config` — use **only** servers from `--mcp-config`, ignoring all other MCP
  configuration (verified `claude --help`).

MCP servers are stored in `~/.claude.json` under a top-level `mcpServers` object keyed by
server name (verified on this host: `{ "context7": {...} }`); project scope adds `.mcp.json`.

## Decision

The conductor launches its **build** sessions with a generated **strict** MCP config that
contains every configured MCP server **except Serena**. Concretely:

1. `buildArgs()` (or a helper it calls) produces a build-session MCP config by reading the
   effective `mcpServers` set and removing the `serena` entry, then appends
   `--strict-mcp-config --mcp-config <generated>` to the argv.
2. This applies to **build** spawns only: the `invoke` print path and the non-interactive
   `invokeInteractive` print path. It MUST NOT apply to:
   - `invokeInteractive({ interactive: true })` — the operator's REPL debug sessions, and
   - the operator's own top-level `claude` sessions (the conductor never spawns those).
3. **Strip only Serena** — all other MCP servers (e.g. `context7`, a GitHub or browser MCP)
   are preserved in the generated config, so no non-Serena capability regresses. (Chosen over a
   blanket empty config: operator-confirmed 2026-07-20; safe even if a build spawn relies on a
   non-Serena MCP server.)

## Consequences

- **Bounds process count:** concurrent Serena/LSP process trees become O(operator interactive
  sessions) ≈ 1, independent of N build sessions. Language-server fan-out drops proportionally
  because each excluded session also skips its LSP children (addresses filer hypothesis b).
- **Interactive Serena unaffected:** the operator's interactive sessions keep full user-scope
  Serena — the intake's negative-path requirement.
- **No new long-lived process:** no shared-server daemon, port, or health lifecycle to own
  (why Approach B was rejected).
- **Config-generation coupling:** the conductor now depends on the `~/.claude.json`
  `mcpServers` shape and `--mcp-config` format. If the store shape changes, generation must
  track it. Mitigation: fail **open** — if the MCP set cannot be read, spawn without the strict
  flag (status quo: Serena loads) rather than crash the build. A build that silently loses a
  needed non-Serena MCP is worse than the pre-fix spike.
- **Project-scope `.mcp.json`:** primary Serena registration is user-scope, so the user store
  is the load-bearing source; the plan notes project-scope `.mcp.json` merge handling as a
  secondary case.

## Alternatives rejected

- **Shared singleton Serena via SSE (filer hyp a):** one process tree but adds a long-lived
  host daemon + port + health lifecycle, and does not reduce LSP fan-out (one server indexes
  every project). More operational surface for less coverage.
- **Teardown/orphan reaping only (filer hyp c):** does not bound the concurrent peak (the
  actual spike); cleanup-after, not prevent. May fold in later as a light complement, not the
  primary fix.
- **Blanket empty strict config for build sessions:** simplest, but would silently disable any
  non-Serena MCP a build spawn relies on. Rejected by operator in favor of strip-only-Serena.
