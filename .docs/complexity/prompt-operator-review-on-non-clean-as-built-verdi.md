# Complexity: Prompt operator review on non-clean as-built verdicts

Tier: S

Operator scope: option A approved by the operator on 2026-09-28; small.

The change adds one pure decision function beside the existing typed-verdict reader, branches the existing conditional review gate for the as-built step onto it, and corrects four comment or reference lines that describe the marker mechanism. It touches four production files (as-built-verdict-store.ts, conductor.ts, resolved-config.ts, types/config.ts) plus two reference docs and two test files. It introduces no new state, schema, event, CLI surface, or ADR, and reuses the existing `onReviewArtifacts` callback and approval recording. Small-tier architecture, conflict, and coherence artifacts are not required.
