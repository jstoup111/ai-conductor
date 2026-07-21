# Complexity: acceptance_specs RED-evidence determinism (#741)

Tier: M

## Signals
- Models / schemas: 0 new data models
- Integrations: 0 external
- Auth / state machines: touches the acceptance_specs completion gate + step
  retry/self-heal path (existing state machine, not a new one)
- Story count: ~5-6 (engine self-heal on missing marker, cwd-robust resolution,
  skill records run contract, negative paths: genuine PASS / skipped / errors)

## Rationale
Focused, single-subsystem change (the `acceptance_specs` gate in artifacts.ts) but
carries a genuine architectural seam: a new skill->engine run-contract handshake and
a shift of execution ownership from the prompt-driven skill to the engine. That seam
warrants a lightweight architecture-review + conflict-check, so this is Medium — above
Small (which would skip architecture entirely) and below Large (no new models,
integrations, or state machines).
