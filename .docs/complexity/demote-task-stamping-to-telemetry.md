# Complexity: Demote task-stamping to telemetry (#773)

Tier: L

## Rationale
- **Blast radius across the most load-bearing subsystem.** Changes the harness's build-completion
  authority: removes the per-task evidence gate that everything in the BUILD phase currently keys on.
  Touches ~15+ engine modules (artifacts.ts predicate, autoheal.ts, attribution-lane/validate,
  daemon-auto-park, task-seed, conductor.ts build-gate + stall blocks, git/session hook assets).
- **New gate to design, not just deletion.** Adds a build-end LLM plan-completeness judgement gate
  (contract, placement, gap routing, kickback bounding) — genuine architectural design work, not a
  mechanical refactor.
- **Large test rewrite.** Multiple acceptance + engine test suites assert the deleted gating
  behavior and must be removed/rewritten; new gate needs its own acceptance coverage.
- **State-machine change.** Alters the build step's completion predicate and the stall/park verdict
  logic — a change to the pipeline state machine, not additive.

## Counter-signals (why not M, as the GitHub label suggested)
- No new models/integrations/auth. But the completion-authority blast radius + a net-new semantic
  gate outweigh those; misjudging completion is a correctness risk that warrants full architecture
  review, conflict-check, and an as-built architecture diagram. Tier L selected deliberately.

## Tier consequences (drives daemon BUILD-phase step skipping)
- Full architecture-review + ADRs, architecture-diagram, and conflict-check are REQUIRED (not skipped).
