# Track: Remediation lap caps derive from the feature's complexity tier

Track: technical

Scope boundary: Balanced. `prd_audit.max_remediation_laps` and
`architecture_review_as_built.max_remediation_laps` each accept either a positive integer (applies
to every tier) or an `{S, M, L}` map; an unset key or unset tier entry resolves to the defaults
Small 2 / Medium 3 / Large 4; a feature with no recorded tier is treated as Medium (3). Every
enforcement and display site resolves the cap lazily with the feature's current tier (including
the prd_audit cap `run()` caches before the complexity step), and lap-cap halts, `kickback-budget
inspect`, and daemon observe name the tier and the allowance measured against. The per-feature
`kickback-budget raise` override (`effectiveLapCap`) keeps precedence. This repo's two TEMPORARY
root-config overrides (`prd_audit: 2`, `architecture_review_as_built: 3`) are removed, and the
TEMPORARY `prd_audit.max_appended_tasks: 10` grant tied to them reverts to its prior 8
(operator-confirmed 2026-10-25).
Excluded: pinning the resolved allowance into the kickback ledger at the first lap, and unifying
the serial prd-audit impl-gap path (conductor.ts ~14505) that ignores raises.

Engine policy and config-semantics change to the harness's own remediation budget; acceptance
criteria live in stories, no product requirements warrant a PRD. Source: intake
jstoup111/ai-conductor#2413.
