# Complexity: maintenance-change lane on existing machinery (#1790)

Tier: S

Rationale: no engine code change. The diff is one repository config toggle
(`feature_applicability.enabled: true` in `.ai-conductor/config.yml`), shipped-skill prose that
documents the maintenance-change recipe and names the DECIDE skill that authors
`.docs/applicability/<stem>.md`, and corrections to stale references to the retired
`scope`/`completeness`/`tautology` rubrics and to the technical track skipping `prd_audit`
(skill/doc prose plus three code comments). No data models, external integrations, auth, or state
machines; expected story count 2–3. Enabling the toggle changes daemon handling only for features
that commit an applicability marker; none exist, so existing feature flow is unchanged.
Per tier rules: architecture-diagram, architecture-review, conflict-check, coherence-check, and
acceptance_specs are skipped. Operator-confirmed 2026-10-06.
