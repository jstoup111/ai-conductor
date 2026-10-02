# Track: Fence SHIP validator verdict artifacts from BUILD writers (skill-only)

Track: technical

Scope boundary: Skill-text only. The `pipeline` (BUILD orchestrator), `tdd` (BUILD implementer) and `remediate` skills state that SHIP validator verdict artifacts (`.pipeline/prd-audit.md`, `.pipeline/architecture-review-as-built.md`, `.pipeline/architecture-review-as-built.json`, and their code-stamp sidecars) are read-only evidence that BUILD, remediation and test_suite sessions may read but never write, delete, or recreate. `test_suite` runs no LLM session, so no skill text applies to it. Excluded: engine, hook, provider-sandbox, or verdict-provenance machinery (deferred to a separate low-priority intake for a mechanical per-step write policy); #2415 validator-side fences.

Internal agent-instruction change with no user-facing product behavior; operator chose a skill-only fix because the incident is infrequent and low impact.
