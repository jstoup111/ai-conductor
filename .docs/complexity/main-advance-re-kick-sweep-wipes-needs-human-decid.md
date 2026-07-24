# Complexity: Main-advance re-kick sweep wipes needs-human DECIDE halts

Tier: S

Rationale:
- Single subsystem: the daemon engine's halt marker + re-kick sweep
  (`halt-marker.ts`, `daemon-rekick.ts`, the enumerable needs-human halt writer
  sites in `conductor.ts` / `rebase.ts` / self-host gates).
- No new integrations, no auth, no schema/CLI surface changes, no model-selection
  impact; one new machine-readable field persisted next to an existing marker.
- Small story count (3) with deterministic, unit-testable acceptance criteria —
  `rekickSweep` is already dependency-injected and pure.
- Matches the intake sizing (size: S) on jstoup111/ai-conductor#921.
