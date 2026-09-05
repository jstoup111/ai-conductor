# Complexity: remediable-as-built-blocked-verdict-halts-needs-hu

Tier: S

Rationale: diagnostic-only change confined to three known sites — `planRemediation`'s terminal
`none` exit (conductor.ts ~4702), the as-built gate reason (artifacts.ts ~3441), and the
validation-group as-built halt (conductor.ts ~7367). No new route, state, schema, or config; the
bounded remediation route and its lap/growth budgets are untouched. Halt classes stay within
adr-2026-08-25 (decisions 4/6/8) and adr-2026-08-29; the change only makes existing terminals
name their cause. Regression tests exist for each site and extend rather than restructure.
