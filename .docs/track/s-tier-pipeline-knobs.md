# Track: s-tier-pipeline-knobs

Track: technical

## Rationale

This feature changes the **engine's internal resolution mechanics** — the per-step tier-override
table (`resolved-config.ts` `DEFAULT_STEP_TIER_OVERRIDES`) and the model/effort rationale metadata
(`model-table-metadata.ts` → generated HARNESS.md). There is no product-facing surface, no user
requirement to spec, and no external contract: it is a tuning change to how the existing pipeline
resolves cost knobs for the `S` complexity tier, plus an optional deterministic label→tier seed on
the DECIDE `complexity` step. Acceptance criteria live in the stories doc (technical track — no PRD).
