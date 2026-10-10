# Complexity: Draft spec corrections retain obsolete text under amendment policy

Tier: S

Operator scope: decided before DECIDE (delegated, 2026-10-09): drafts not on the base branch are revised in place; amendment notes only for artifacts already on the base branch.

The change is one paragraph of consumer-facing rule text in `HARNESS.md`, matching sentences in three shipped DECIDE skills, and one additional refusal in the existing `landSpec` primitive that reuses the merge-base tree listing that primitive already computes and the existing `LandGateError`/`land_gate_rejected` reporting. It adds no new command, option, schema, storage, step, or event variant. Existing contract tests that pin the amendment wording are updated alongside the text. Small-tier architecture, conflict-check, and coherence artifacts are not required.
