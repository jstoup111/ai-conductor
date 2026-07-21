# Conflict Check: serena-mcp-fanout

Feature: serena-mcp-fanout — intake jstoup111/ai-conductor#682
Verdict: **PASS (no blocking conflict)** — one load-bearing interaction to honor in the plan.

## Scope compared against

Existing specs touching the `claude` spawn point (`claude-provider.ts`) or `.serena/`:
`isolate-daemon-build-auth-from-operator-oauth`, `engineer-worktree-isolation`,
`harness-self-host-guardrails`, `sandbox-auth-expiry-park`, and intake #141 (per-worktree
`.serena/` copies).

## Interaction 1 — CLAUDE_CONFIG_DIR isolation (composes; sequencing note)

`isolate-daemon-build-auth-from-operator-oauth` points **sandbox/self-host** build sessions at a
**fresh empty `CLAUDE_CONFIG_DIR`** (mkdtemp) via `buildEnv`/`childEnv`. Consequences:

- In sandbox/self-host mode a build session already inherits **no** user `mcpServers`, so it
  never loads Serena — the exclusion is a **no-op** there, correctly. The fan-out this feature
  targets is primarily the **local (non-sandbox) daemon / parallel-branch** path, where the
  operator's real `~/.claude.json` is inherited.
- Therefore the strict-config generation MUST read `mcpServers` from the **effective config dir
  the spawn will actually use** (honor `CLAUDE_CONFIG_DIR` from `buildEnv`), NOT hardcode
  `~/.claude.json`. Reading the wrong dir would either strip nothing (miss the fix) or reference
  a Serena entry that isn't in that dir.
- No contradiction: both changes inject at the same `ClaudeProvider` spawn seam — one via argv
  (`buildArgs`, this feature), one via env (`buildEnv`, auth isolation). The plan orders the
  config-source read **after** the effective env/config-dir is resolved.

## Interaction 2 — intake #141 (per-worktree `.serena/`)

#141 concerns disk cost of per-worktree `.serena/` index copies. This feature **reduces** that
pressure as a side effect: build sessions that never start Serena never generate a `.serena/`
index in their worktree, so far fewer worktrees accrue the cache. No overlap in code seam
(#141 is `.gitignore`/index-placement; this is spawn argv). Complementary, not conflicting.

## Interaction 3 — interactive/build classification

No existing spec classifies conductor spawns as interactive vs build at the MCP level, so this
feature introduces that distinction cleanly. It must not disturb `invokeInteractive`'s existing
`interactive` flag semantics (REPL vs print) — it reads that flag, does not change it.

## No resource/state contradictions
- No two specs write the same generated-config path (this feature introduces it).
- No story here contradicts an accepted story elsewhere (verified against the compared set).
