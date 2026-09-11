# Complexity: Roll back a failed rewind fully, including never-run steps

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

One production file changes: the engine's rewind module. The rollback reuses the state store's existing explicit field-deletion authority rather than introducing a new port operation, and reversible gate-verdict clearing follows the stage-then-delete shape the same file already uses for the halt markers. No new module, type, config key, CLI flag, event variant, or storage format is introduced, and no approved decision record is amended. Coverage is three focused additions to the existing rewind test file, exercising the command boundary with an injected clear failure. Small-tier architecture, conflict-check, and coherence artifacts are not required.
