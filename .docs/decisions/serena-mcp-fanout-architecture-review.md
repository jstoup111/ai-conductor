# Architecture Review (lightweight): serena-mcp-fanout

Feature: serena-mcp-fanout (Medium) — intake jstoup111/ai-conductor#682
Reviewer: engineer DECIDE phase
Verdict: **PASS** (proceed to stories) with the ADR decision fixed.

## Feasibility (verified, not assumed)

- `--mcp-config` + `--strict-mcp-config` exist and mean "use only these servers" — verified
  against `claude --help`. (confidence: verified)
- MCP servers are stored in `~/.claude.json` under `mcpServers` (name-keyed); confirmed on
  this host (`context7` present, format `{name: spec}`). A strip-only-Serena config is
  therefore mechanically producible. (confidence: verified for user scope; project `.mcp.json`
  merge is inferred, flagged for the plan)
- Harness PR/git operations use the `gh`/`git` CLIs, not MCP (39 call sites) — build sessions
  do not need an MCP server for PR flow. (confidence: verified)
- The one browser-MCP consumer (`manual-test` full-stack) runs as a **User**-driven session,
  not a conductor `claude -p` spawn — so excluding MCP from harness spawns should not touch it.
  Nonetheless the ADR strips **only Serena**, so even a build spawn that did need a non-Serena
  MCP server is unaffected. (confidence: inferred; de-risked by strip-only-Serena)

## Architectural alignment

- **Single enforcement point** (`ClaudeProvider.buildArgs`) satisfies the repo Design
  Principle: deterministic, code-enforced at the spawn moment, not prompt discipline.
- **Fail-open** on unreadable MCP config preserves build liveness (a lost non-Serena MCP or a
  crash is worse than the pre-fix spike).
- **Interactive/build split** is the one subtlety: the review confirms the split maps cleanly
  onto the existing `invoke` (build print) vs `invokeInteractive({interactive:true})` (REPL)
  seam already present in `claude-provider.ts`.

## Risks / watch-items for stories & plan

1. Correctly classify every spawn as build vs interactive so no interactive session loses
   Serena and no build session keeps it.
2. Generated-config lifecycle: write to a stable/temp path, avoid races across concurrent
   spawns (each spawn may generate its own, or share one regenerated when the MCP set changes).
3. Project-scope `.mcp.json` servers: decide whether they must be merged into the generated
   config too (secondary; user-scope Serena is the primary target).
4. Verification of the outcome: a test/observation that process count stays bounded under
   concurrency, and that a single interactive session still gets working Serena.

## ADRs
- `adr-serena-mcp-build-session-exclusion.md` — APPROVED.
