# Complexity: serena-mcp-fanout

Tier: M

## Rationale

**Medium**, not Small or Large.

**Why not Small:** the change alters the conductor's `claude` spawn contract
(`claude-provider.ts` `buildArgs`, used by both the `invoke` print path and the
`invokeInteractive` REPL/print paths) and the Serena registration guidance in
`bootstrap/SKILL.md`. It carries a genuine correctness fork that must be resolved before
stories: build sessions must exclude **only** Serena while preserving any other user-scoped
MCP servers (e.g. GitHub), and must NOT strip Serena from the operator's interactive REPL
sessions. Getting `--mcp-config` / `--strict-mcp-config` semantics wrong could silently
disable all MCP in build sessions — a regression worth a lightweight ADR.

**Why not Large:** single subsystem (spawn wiring), no new data models, no auth, no state
machine, no external service integration, small story count (~4-5). Language-server fan-out
reduction falls out of the same seam rather than adding independent scope.

## Signals
- Models: none
- Integrations: MCP-config generation only (no new external service)
- Auth: none
- State machines: none
- Estimated stories: ~4-5 (build sessions exclude Serena; interactive keeps Serena; other user
  MCP servers preserved in build sessions; bounded process count under concurrency; negative path)

## Tier-driven step plan
- /architecture-diagram: run, tightly scoped (one component/sequence view of MCP-config injection)
- /architecture-review: lightweight, with an ADR fixing the config-scoping decision
- /conflict-check: run
