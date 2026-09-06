# Intake origin: run-the-harness-integrity-suite-in-build-s-test-su

Source-Ref: jstoup111/ai-conductor#658
Owner: jstoup111

## Desired outcome
- A release-gate failure whose check emits a known mechanical remediation (regenerate-and-commit) is self-healed by the engine (run the printed command, commit the result, re-run the gate) or routed as a concrete task — it does not terminally halt the feature.
- Alternatively/complementarily: the build phase runs `bin/generate-model-table` whenever `model-table-metadata.ts` changes, so drift never reaches the ship gate.
- `2026-07-12-wiring-reachability-gate` ships without an operator hand-running the generator.
