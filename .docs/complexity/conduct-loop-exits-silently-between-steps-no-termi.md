# Complexity: Conduct loop no-verdict diagnostics

Tier: S

## Rationale

Bounded, single-file robustness/diagnostics fix in the conductor engine
(`src/conductor/src/engine/conductor.ts`), scoped to the existing terminal
handlers (the `catch` at ~5125 and the daemon-only `finally` backstop at
~5166) plus a running breadcrumb updated as the main loop advances.

Signals (same the conductor uses):
- **Models:** none added.
- **Integrations:** none — no new external surface, CLI flag, hook, or schema.
- **Auth:** none.
- **State machines:** no new machine; reuses the existing loop. Adds one
  in-memory breadcrumb + reconstructs `last_step` from already-present state
  keys.
- **Story count:** ~2–3 (enriched HALT diagnostics; eliminate `last step:
  unknown`; convert escaped async rejection to a normal HALT).

Per the tier rules this Small spec **skips** `/architecture-diagram`,
`/architecture-review`, and `/conflict-check`. DECIDE proceeds
explore → complexity → stories → plan.
