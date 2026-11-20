Waives: outcome-4

Rationale: jstoup111/ai-conductor#3677 asked that features with small as-built histories behave
exactly as today. During explore on 2026-11-15 the operator chose always-by-file delivery of
remediation history (Approach A) over an inline-until-the-cap design, and explicitly accepted that
small histories change delivery too: the history moves from the prompt to engine-written files for
every gap-plan dispatch. The decision is recorded as the scope boundary in
`.docs/track/prd-audit-halts-needs-human-when-as-built-case-his.md` and as design decision 1 of
`architecture-review-2026-11-15-prd-audit-halts-needs-human-when-as-built-case-his`. What small
histories keep: the same cases, findings, laps, and refusals reach the agent in full, and plan
validation is unchanged (Story 6). No follow-up is owed; this waiver records the operator's decision
as the outcome's disposition.
