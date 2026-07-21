# Implementation Plan: bound Serena/MCP fan-out (serena-mcp-fanout)

Status: Accepted

Feature: serena-mcp-fanout
Intake: jstoup111/ai-conductor#682
Track: technical · Complexity: M
Stories: `.docs/stories/serena-mcp-fanout.md` (Story 1–5)
ADR: `adr-serena-mcp-build-session-exclusion` (APPROVED)
Conflicts: `.docs/conflicts/serena-mcp-fanout.md` (PASS; honor CLAUDE_CONFIG_DIR source)

## Summary

The conductor spawns every build session through `ClaudeProvider` (`src/conductor/src/execution/
claude-provider.ts`). `invoke` and the non-interactive `invokeInteractive` print path are **build**
sessions; `invokeInteractive({ interactive: true })` is the operator REPL. Add a helper that builds
a **Serena-free strict MCP config** from the effective MCP config store and inject
`--strict-mcp-config --mcp-config <file>` into `buildArgs(options)` **only when `!options.interactive`**.
Fail open (spawn as today) if the config can't be read. TDD: RED tests first at each step.

## New module

`src/conductor/src/execution/build-mcp-config.ts` — pure/IO helper:
- `resolveMcpConfigPath(env)` → the effective config file (honor `CLAUDE_CONFIG_DIR`, else
  `~/.claude.json`).
- `buildSerenaFreeConfig(env)` → reads `mcpServers`, drops the `serena` key, returns
  `{ mcpServers }` (Serena-free, possibly empty); throws/returns null on unreadable/malformed.
- `writeBuildMcpConfig(...)` → writes the JSON to a stable temp path, returns the path (or null
  on failure). Reused across spawns; regenerated when the source mtime/content changes.

## Tasks

### Task 1 — RED: config helper unit tests
**Story:** 3, 4 · **Dependencies:** none
Write failing tests for `build-mcp-config.ts`: (a) config with `serena`+`context7` → output has
`context7`, no `serena`; (b) config with only `serena` → valid empty `mcpServers`; (c) missing/
malformed file → returns null (no throw); (d) `CLAUDE_CONFIG_DIR` set → reads that dir's file.

### Task 2 — GREEN: implement `build-mcp-config.ts`
**Story:** 3, 4 · **Dependencies:** Task 1
Implement `resolveMcpConfigPath` / `buildSerenaFreeConfig` / `writeBuildMcpConfig` to pass Task 1.
Serena key match is exact (`serena`). Fail-open returns null.

### Task 3 — RED: buildArgs injection tests
**Story:** 1, 2 · **Dependencies:** Task 2
Add failing tests on `ClaudeProvider.buildArgs`: (a) build spawn (`options.interactive` falsy) →
argv contains `--strict-mcp-config` and `--mcp-config <path>` whose file omits `serena`;
(b) interactive spawn (`options.interactive === true`) → argv contains **no** Serena-exclusion
flags; (c) config unreadable → argv unchanged from today (fail open).

### Task 4 — GREEN: inject exclusion in buildArgs
**Story:** 1, 2, 4 · **Dependencies:** Task 3
In `buildArgs(options)`: when `!options.interactive`, call `writeBuildMcpConfig(effectiveEnv)`;
if it returns a path, push `--strict-mcp-config --mcp-config <path>`; if null, push nothing and
`log`/warn once (Story 4 observability). Resolve the effective env consistently with `buildEnv`
so the config source honors any `CLAUDE_CONFIG_DIR` (conflict-check Interaction 1). Do not alter
`invokeInteractive`'s `interactive` semantics.

### Task 5 — RED→GREEN: interactive/build classification guard
**Story:** 2 · **Dependencies:** Task 4
Test that `invoke(...)` (one-shot build) is treated as build (exclusion applied) and
`invokeInteractive({ interactive: true })` is treated as interactive (no exclusion). Add a guard/
assertion so a future caller can't silently misclassify. Fix any classification gap.

### Task 6 — Update Serena registration guidance
**Story:** 1, 2 · **Dependencies:** Task 4
Edit `skills/bootstrap/SKILL.md` §9a: note that user-scope Serena is intentionally
**interactive-only** and the conductor launches build sessions Serena-free automatically (no
operator action). Keep the `claude mcp add --scope user` registration unchanged.

### Task 7 — Docs + changelog + version
**Story:** all · **Dependencies:** Task 6
- `README.md` / `src/conductor/README.md`: document build-session MCP scoping behavior.
- `CHANGELOG.md` `[Unreleased]` → **Fixed**: "Bound Serena/MCP + language-server process fan-out
  by excluding Serena from harness-spawned build sessions (#682)."
- Bump `VERSION` (MINOR — new behavior; operator to confirm exact bump at PR time).
- Migration gate: internal spawn-wiring change, no consumer-visible CLI/hook/schema surface — if
  the self-host classifier flags it, add a `.docs/release-waivers/serena-mcp-fanout.md`
  (Waives: … / Rationale: internal-only) per CLAUDE.md waiver rule.

### Task 8 — Validation + concurrency observation
**Story:** 5 · **Dependencies:** Task 5, Task 7
Run `test/test_harness_integrity.sh` (must pass). Add/extend a test asserting build spawns carry
the exclusion flags. Record a bounded-process-count observation for Story 5 (manual or scripted:
count `serena`/LSP processes during a multi-branch daemon run; confirm bounded, not ~N, and
baseline after teardown) in `.docs/observation/` or the PR body — the linear-in-N spike is gone.

## Task Dependency Graph

```
Task 1 (RED helper)
   └─> Task 2 (GREEN helper)
          └─> Task 3 (RED buildArgs)
                 └─> Task 4 (GREEN buildArgs inject)
                        ├─> Task 5 (classification guard)
                        └─> Task 6 (bootstrap SKILL.md guidance)
                               └─> Task 7 (docs + changelog + VERSION + waiver)
                                      └─> Task 8 (validation + concurrency observation)  [needs Task 5 too]
```

## Acceptance mapping
- Story 1 → Task 3,4 · Story 2 → Task 3,4,5 · Story 3 → Task 1,2 · Story 4 → Task 1,2,4 ·
  Story 5 → Task 8.

## Out of scope
- Shared singleton Serena server (Approach B, rejected).
- Teardown/orphan reaping (Approach C) — unnecessary once build sessions never start Serena;
  revisit only if orphans are observed from interactive sessions.
- Changes to Serena internals, `.serena/` index placement (#141 handles that seam).
