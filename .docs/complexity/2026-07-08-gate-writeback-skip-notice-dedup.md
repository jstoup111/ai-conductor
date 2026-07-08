# Complexity: gate-writeback skip-notice warn-once dedup

Tier: S

## Rationale

- **Surface:** one module (`src/conductor/src/engine/gate-writeback.ts`) plus its single
  production call site (`daemon-cli.ts` `announceGated` closure); an existing test file
  (`test/engine/gate-writeback.test.ts`) to extend.
- **No new models, integrations, auth, or state machines.** The dedup state is an
  in-memory per-daemon-run `Set` injected through the existing `GateWritebackDeps` seam —
  no disk persistence, no schema, no new `gh` calls.
- **Story count:** 3 small stories (dedup no-PR + terminal-state skips, dedup
  no-Source-Ref skip, benign rewording).
- **Risk:** low — logging-only behavior change; the announce/upsert paths are untouched.

Per tier rules: architecture-diagram, architecture-review, and conflict-check are skipped;
track is technical, so PRD is skipped.
