# Bound Serena/MCP process fan-out across concurrent harness sessions

Status: Accepted

Track: technical
Feature: serena-mcp-fanout
Intake: jstoup111/ai-conductor#682
Complexity: M
ADR: adr-serena-mcp-build-session-exclusion (APPROVED)

## Context

Serena is registered user-scope (`skills/bootstrap/SKILL.md` §9a), so every `claude` session
loads it. `ClaudeProvider.buildArgs()` spawns every harness build session with no MCP-scoping
flag, so each inherits user-scope Serena and launches its own `serena start-mcp-server` + LSP
children. Under the daemon's concurrent sessions (parallel branches, subagents) this produces
~N Serena/LSP process trees, spiking CPU and disk. Decision (Approach A): the conductor launches
its **build** sessions with a **strict** MCP config that contains every configured server
**except Serena**, while the operator's **interactive** sessions keep Serena unchanged.

Acceptance criteria live in these stories (technical track — no PRD).

## Story 1 — Build sessions launch without Serena

As the conductor build loop, when it spawns a non-interactive `claude` build session, that
session must launch with Serena excluded so it starts no Serena MCP server and no Serena-driven
language servers.

### Happy Path

- **Given** Serena is registered user-scope and the conductor spawns a build session via the
  `invoke` print path or the non-interactive `invokeInteractive` print path,
- **When** `ClaudeProvider.buildArgs()` constructs the argv,
- **Then** the argv includes `--strict-mcp-config` together with a `--mcp-config` whose
  `mcpServers` object does **not** contain a `serena` entry,
- **And** the spawned session starts **no** `serena start-mcp-server` process and no Serena
  language-server children.

### Negative Paths

- **Given** the conductor is spawning a build session,
- **When** buildArgs runs,
- **Then** it MUST NOT rely on prompt/skill instructions to avoid Serena — exclusion is enforced
  in the spawned argv itself (deterministic, per the repo Design Principle), so a session that
  ignored such instructions still cannot start Serena.

## Story 2 — Interactive operator sessions keep full Serena

As the operator, when I run an interactive Serena-capable session, semantic Serena tools must
work exactly as before — the fix bounds duplication, it does not disable Serena.

### Happy Path

- **Given** Serena is registered user-scope,
- **When** an interactive session runs — the operator's own top-level `claude` session, or
  `invokeInteractive({ interactive: true })` (the REPL debug path),
- **Then** the session loads user-scope Serena unchanged (no `--strict-mcp-config` Serena
  exclusion is injected), and Serena's semantic tools are available and functional.

### Negative Paths

- **Given** the exclusion logic is applied to build spawns,
- **When** classifying a spawn,
- **Then** an interactive REPL session MUST NOT be classified as a build session — it must never
  have Serena stripped; misclassifying it is a regression the implementation must prevent.

## Story 3 — Non-Serena MCP servers are preserved in build sessions

As a build session that relies on a non-Serena MCP server (e.g. `context7`, a GitHub or browser
MCP), when it launches under the strict config, that server must remain available — only Serena
is removed.

### Happy Path

- **Given** the effective MCP configuration contains `serena` plus one or more other servers
  (e.g. `context7`),
- **When** the conductor generates the build-session strict MCP config,
- **Then** the generated config contains **all** non-Serena servers verbatim and omits **only**
  `serena`,
- **And** those non-Serena servers are usable inside the build session.

### Negative Paths

- **Given** the only configured MCP server is Serena,
- **When** the build-session config is generated,
- **Then** it is a valid config with an empty (or Serena-free) `mcpServers`, and the build
  session launches successfully with no MCP servers — it MUST NOT error or fall back to loading
  Serena.

## Story 4 — Fail open when the MCP configuration cannot be read

As the conductor, when I cannot read or parse the MCP configuration to build the strict config,
I must fail **open** (spawn as today) rather than crash the build.

### Happy Path

- **Given** the MCP config store (`~/.claude.json` `mcpServers`, and project `.mcp.json` if
  applicable) is readable,
- **When** buildArgs generates the strict config,
- **Then** it produces the Serena-free config and injects the flags normally.

### Negative Paths

- **Given** the MCP config store is missing, unreadable, or malformed,
- **When** buildArgs attempts to generate the strict config,
- **Then** the conductor spawns the build session **without** the strict-config flags (status
  quo — Serena may load) instead of throwing, so build liveness is preserved,
- **And** the fail-open path is logged so the missed exclusion is observable.

## Story 5 — Process count stays bounded under concurrency

As the operator running a concurrent/daemon build, the count of Serena/MCP + language-server
processes must stay bounded, not grow linearly with the number of concurrent build sessions, and
must return to baseline after builds complete and worktrees are torn down.

### Happy Path

- **Given** N concurrent harness build sessions (parallel worktree branches / subagents) run
  under the daemon,
- **When** the sessions are active,
- **Then** the number of `serena` / language-server processes attributable to those build
  sessions is bounded (not ~N) — observable by counting `serena`/LSP processes during the run,
- **And** after the sessions finish and their worktrees are removed, the `serena`/LSP process
  count and the `.serena/` disk footprint attributable to the build sessions return to baseline
  (no orphaned build-session Serena/LSP processes).

### Negative Paths

- **Given** a build session exits or its worktree is removed,
- **When** teardown completes,
- **Then** no orphaned Serena/LSP process spawned by that build session remains — because build
  sessions never started Serena, there is nothing to orphan (the exclusion removes the orphan
  source at its root).
