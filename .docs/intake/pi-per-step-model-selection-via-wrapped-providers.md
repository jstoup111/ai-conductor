# Intake origin: pi-per-step-model-selection-via-wrapped-providers

Source-Ref: jstoup111/ai-conductor#1885
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#1885 digest=bd8e0a747a9b702e166d1ce0cad03c264853c8a4166e3054eb5b175ef3904c41 >>>
## Desired outcome

- Each engine step dispatched through Pi runs on a deliberately chosen underlying provider+model+thinking level, and that choice is visible in config and in the run's telemetry/events (not left to Pi's own defaults).
- The per-step model tiers the harness expresses today for claude/codex (cheap steps on small models, L-tier promotions, effort levels) are expressible when Pi is the selected host, including models from more than one underlying provider within a single run.
- Model escalation on retry and the availability fallback ladder function for Pi selections: an unavailable underlying model steps to the configured next one, observably logged.
- `bin/generate-model-table --check` passes with Pi represented: the HARNESS.md model-selection table shows Pi's per-step selections without corrupting the claude/codex columns.
- Config validation rejects a Pi model selection naming an unknown underlying provider/model with a specific error, and a valid selection round-trips through resolved-config unchanged.
<<< END INBOUND >>>
