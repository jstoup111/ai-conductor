# Intake origin: namespace-harness-skill-and-agent-names-so-they-ca

Source-Ref: jstoup111/ai-conductor#885
Owner: jstoup111

## Desired outcome

- Invoking any harness skill or agent is unambiguous on a machine that also has same-named third-party or personal skills/agents installed — no collision, no shadowing, in either direction.
- All harness-internal cross-references (SKILL.md `/skill-name` links, HARNESS.md model table, engine step→skill dispatch, `conduct-ts engineer` canonical DECIDE order, hooks) resolve to the harness's own skills under the new naming — the integrity suite's cross-reference checks pass.
- Existing consumer projects keep working across the update (migration path per the CHANGELOG migration-block gate if invocation names change).
- Operator-facing docs state the canonical invocation names.
