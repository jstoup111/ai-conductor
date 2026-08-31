# Complexity: plan-growth-allowance-is-spent-on-work-existing-ta

Tier: M

Rationale: A new remediation disposition touches the disposition union and validator
(artifacts.ts), the remediate skill contract, remediation routing and both gate budgets in
conductor.ts, and halt wording — roughly six coordinated sites across two files plus tests, but
no new subsystem and a clear precedent (`publication`) to follow. Matches the issue's size: M
label.
