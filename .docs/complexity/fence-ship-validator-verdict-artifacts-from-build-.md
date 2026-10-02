# Complexity: Fence SHIP validator verdict artifacts from BUILD writers (skill-only, #2874)

Tier: S

Rationale: prose-only change to three shipped skills (`pipeline`, `tdd`, `remediate`) plus
assertions in two existing skill-contract tests. No engine, hook, provider, schema, or event
change; no new models, integrations, or state. Expected 2 stories. Skips (per Tier S):
architecture-diagram, architecture-review, conflict-check, coherence-check. Technical track: no
PRD. The mechanical write-policy fix is deferred to a separate low-priority intake.
