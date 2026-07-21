# Architecture: bounding Serena/MCP fan-out (serena-mcp-fanout)

Scope: internal change to how the conductor spawns `claude` build sessions. One component
view + one sequence view — the only architecturally interesting seam is the MCP-config
injection at the single spawn point.

## Problem (as-is)

Serena is registered **user scope** in `bootstrap/SKILL.md` §9a. `ClaudeProvider.buildArgs()`
(`src/conductor/src/execution/claude-provider.ts`) builds the `claude` argv for every
harness-spawned session and passes **no** MCP-scoping flag. Every spawned session therefore
inherits the user-scoped Serena and launches its own stdio `serena start-mcp-server` +
per-project language servers. The daemon, parallel worktree branches, and subagents run many
such sessions concurrently, so process count grows ~linearly with session count.

```mermaid
flowchart TD
  subgraph asis[As-is: user-scope inherited by every spawn]
    D[daemon / pipeline / subagents] -->|claude -p, no MCP flag| S1[claude session 1]
    D -->|claude -p, no MCP flag| S2[claude session 2]
    D -->|claude -p, no MCP flag| SN[claude session N]
    S1 --> Se1[serena start-mcp-server + LSPs]
    S2 --> Se2[serena start-mcp-server + LSPs]
    SN --> SeN[serena start-mcp-server + LSPs]
  end
```

## Target (to-be, Approach A)

`buildArgs()` injects an MCP-scoping flag for **build** sessions (the `invoke` print path and
the non-interactive `invokeInteractive` print path) that excludes Serena, while leaving the
operator's **interactive** REPL sessions (`invokeInteractive` with `interactive: true`) and
the operator's own top-level `claude` sessions untouched. Build sessions launch with no Serena
server; interactive operator sessions keep the full user-scoped Serena.

```mermaid
flowchart TD
  subgraph tobe[To-be: build sessions launch Serena-free]
    D[daemon / pipeline / subagents] -->|claude -p + build MCP config| S1[claude session 1..N]
    S1 -.no serena.-> X((no serena/LSP spawn))
    OP[operator interactive REPL] -->|user-scope inherited| Se[serena start-mcp-server + LSPs]
  end
```

## Component view

- **`ClaudeProvider.buildArgs`** — sole spawn point; gains conditional MCP-scoping argv for
  build sessions. This is the single deterministic enforcement site (repo Design Principle).
- **Build-session MCP config source** — how the Serena-less config is produced. The
  config-scoping decision (strip only Serena vs. minimal/empty MCP set for build sessions, and
  whether other user MCP servers such as GitHub are preserved) is fixed by the ADR from
  `/architecture-review`. buildArgs consumes whatever that decision selects.
- **`bootstrap/SKILL.md` §9a** — registration guidance; updated to reflect that user-scope
  Serena is intentionally interactive-only and that build sessions are launched Serena-free by
  the conductor (no operator action required).
- **`removeWorktree` (optional, if C folded in)** — teardown reaping of any orphaned
  serena/LSP processes; out of scope unless the plan adopts the light C complement.

## Sequence: a build session spawn

```mermaid
sequenceDiagram
  participant Eng as conductor engine
  participant CP as ClaudeProvider
  participant CLI as claude CLI
  Eng->>CP: invoke({prompt, cwd, ...})  // build session
  CP->>CP: buildArgs() -> argv + build MCP scoping (no serena)
  CP->>CLI: execa('claude', argv)  // strict MCP config excludes serena
  Note over CLI: no serena start-mcp-server launched
  CLI-->>CP: result (no serena/LSP child processes)
```

## Non-goals
- Not changing Serena's own internals or LSP backend.
- Not introducing a long-lived shared Serena server (Approach B, rejected).
- Not disabling Serena for the operator's interactive sessions.
