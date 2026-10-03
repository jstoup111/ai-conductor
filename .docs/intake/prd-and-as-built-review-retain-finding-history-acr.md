# Intake origin: prd-and-as-built-review-retain-finding-history-acr

Source-Ref: jstoup111/ai-conductor#2440
Owner: jstoup111

## Desired outcome

- PRD audit and as-built review can reconcile every current finding against their relevant prior findings, decisions, attempted repairs, and resolution evidence across laps and restarts.
- Rewording, reordering, or shifted report-local identifiers alone do not create a new unresolved obligation. A materially changed or recurring defect can be reopened with its reason recorded.
- PRD-audit criterion findings and NC findings are both covered; approved widening decisions from #2429 remain authoritative within their original scope.
- As-built review retains ADR-based authority; PRD audit retains requirement/criterion authority. Neither a previous autonomous dismissal nor another gate's approval silently grants operator approval or makes a gate pass.
- Missing, corrupt, ambiguous, or over-limit history produces an explicit recoverable result rather than silent omission, invented continuity, or a success verdict.
- Every source finding remains traceable to its reconciliation result, including findings requiring a human decision.
- Claude and Codex receive the same engine-owned contract; review output validation failures remain mechanical failures.
