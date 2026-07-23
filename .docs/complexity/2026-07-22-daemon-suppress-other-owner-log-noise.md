# Complexity: suppress other-owner gate-writeback log noise unless verbose

Tier: S

## Rationale

- **Surface:** one module (`src/conductor/src/engine/gate-writeback.ts`) plus one
  production wiring site (`src/conductor/src/daemon-cli.ts`, the `gatedWritebackDeps`
  construction at ~line 1093) and one config-schema key
  (`src/conductor/src/engine/config.ts`). An existing test file
  (`test/engine/gate-writeback.test.ts`) is extended.
- **Every gated spec is `other-owner` by construction.** `GatedReason = 'other-owner'` is
  the only gating reason (`gate-writeback.ts:52-56`; `decideSpecGate` in `owner-gate/gate.ts`
  returns `build:false` only for `other-owner`). So `announceGatedPr`/`announceGatedIssue`
  are only ever called over other-owner specs — gating their skip-notice log calls behind a
  verbose flag suppresses exactly the non-assigned-work noise from #840 and nothing else.
- **No new models, integrations, auth, or state machines.** The verbose signal is a single
  boolean threaded through the existing `GateWritebackDeps` seam (alongside `warnedSkips`)
  and sourced from an already-validated config key. No disk persistence, no new schema
  object, no new `gh` calls, no control flow beyond one guard in the existing `logSkipOnce`.
- **The operator's OWN work is on a different code path.** Own-work build/start/resume/status
  lines flow through the `daemon-cli.ts` `log` closure and the conductor event renderer, not
  through gate-writeback — they are untouched, so default verbosity keeps logging own work.
- **Story count:** 4 small stories (default suppresses no-PR notice, default suppresses
  pr-terminal + no-source-ref notices, verbose surfaces them, own-work still logs +
  announcement writes unchanged).
- **Risk:** low — logging-only behavior change gated behind a default-off flag; the
  announce/upsert paths, the `warnedSkips` dedup, and the non-throwing contract are untouched.

Per tier rules: architecture-diagram, architecture-review, and conflict-check are skipped;
track is technical, so PRD is skipped. No mermaid diagrams are authored (Small tier).
