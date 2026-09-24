# Complexity: skip-prd-audit-as-built-re-dispatch-after-a-kickba

Tier: S

Rationale: one new registry attribute on four existing step declarations (`steps.ts`) and one
new branch in the step loop's pre-dispatch skip check (`conductor.ts`) that calls the existing
`checkStepCompletion` predicate and the existing `verdict_freshness` event. The preserve
decision itself (stamp, `gateVerdictStillValid`, report-clean re-check, kill-switch) already
lives in the completion predicates and the sweep per adr-2026-07-22 D2/D4/D6; this change only
consults it before paying for a judge session on a `stale` re-entry. No new seam, subsystem,
event kind, config key, or ADR. Tests are unit tests against the step loop with mocked
predicates plus one acceptance test per gate.
