# Track: coherence_check L-tier model escalation (#2789)

Track: technical

Scope boundary: Minimal — add the L-tier `coherence_check` override to both Claude (opus) and Codex (gpt-5.6-sol) policies in `provider-model-policy-defaults.ts`, and make `skills/coherence-check/SKILL.md` (and any model-table doc listing tier pins) agree. M/S tiers unchanged. No cross-skill audit or new drift-detection check.

Internal model-routing policy fix mirroring the existing `conflict_check` L pin; no product requirements, so no PRD.
