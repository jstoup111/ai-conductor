# Complexity: daemon-mode-route-halt-user-input-required-through

Tier: M

## Rationale

- Touches the conductor build-retry state machine (`conductor.ts` stall breaker + a new
  no-burn resume branch alongside sessionExpired) — behavioral engine change, not cosmetic.
- Extends the `/remediate` skill contract with a new input class (stall question) and a new
  engine trigger (`build_stall`) into `planRemediation()` — cross-cutting engine + skill.
- New evidence artifact (persisted stall question) plus fail-safe question-preservation into
  `.pipeline/HALT`.
- No new models, external integrations, auth surfaces, or schema changes; reuses the
  existing remediation dispatch, taxonomy, and `remediationRounds` budget.
- Estimated 4–6 stories. Medium: architecture diagram + lightweight architecture review +
  conflict-check required.
