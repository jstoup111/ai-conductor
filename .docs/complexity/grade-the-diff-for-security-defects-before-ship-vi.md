# Complexity: Grade the diff for security defects before ship via a build_review security rubric

Tier: M

Rationale: Additive membership in an existing container. The rubric joins the closed built-in
registry that adr-2026-08-22 designed for exactly this, so dispatch, caching, containment,
aggregation, and adjudication are reused unchanged. The work is one new skill
(`skills/build-review-security/SKILL.md`), one new projection member and finding vocabulary,
widening ~10 hardcoded `['testQuality']` sites (registry, config types, config validation,
resolved-config defaults, aggregate, anchor parser, dispatch label, integrity check 25, model
table), and removing the incidental security bullets from `skills/code-review/SKILL.md`. No new
lifecycle step, no schema migration, no new event kind, no new consumer config key. Not S because
the vocabulary/anchor grammar is a new contract surface that the CI vocabulary guard executes
against the engine; not L because nothing crosses a provider, containment, or store boundary.

**Agreement with intake:** jstoup111/ai-conductor#2034 carries `size: M`, which matches this assessment.
