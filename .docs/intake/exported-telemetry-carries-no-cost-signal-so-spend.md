# Intake origin: exported-telemetry-carries-no-cost-signal-so-spend

Source-Ref: jstoup111/ai-conductor#1936
Owner: jstoup111

## Desired outcome

- Exported telemetry carries the engine's own computed cost, so a consumer can chart spend
  without knowing the rate card or re-deriving prices.
- Cost is attributable along the dimensions an operator asks about — at minimum per step and per
  model, and per feature/project to the same degree other metrics are.
- Dispatches the engine treats as unmetered are distinguishable from zero-cost ones, rather than
  both appearing as absent data.
- A step that reports no cost produces no cost data point — no zero-fill, no NaN, matching the
  existing token behavior.
- Historical cost is never re-priced by a later rate-card change, consistent with the existing
  rate-card rule in `docs/reference/configuration.md:85`.
