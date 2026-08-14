# Complexity: Implementation drifts from local patterns and over-tests behavior

Tier: M

## Rationale

The change coordinates consumer-facing guidance across `HARNESS.md`, several existing DECIDE/BUILD skills, and existing implementation/review agent prompts. It introduces a semantic, feature-specific pattern basis that BUILD re-discovers against current `HEAD`, plus a consistent lowest-sufficient-test-layer rule.

It adds no new skill, parser, manifest, configuration schema, external integration, authentication boundary, persistent model, or state machine. Testing is intentionally minimal: no skill-wording assertions, only narrow tests for any machine-readable or executable behavior actually introduced. The breadth is cross-cutting but the implementation remains primarily Markdown contract updates, so Medium is appropriate.
