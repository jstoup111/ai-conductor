# Intake: Retry loop re-runs steps that cannot self-resolve — classify rerun-vs-route (#646)

Source: jstoup111/ai-conductor#646
Owner: jstoup111
Size (filed): M
Labels: enhancement

See the GitHub issue for the full WHAT/impact/desired-outcomes/non-goals and the 2026-07-13 live
datum (`architecture_review_as_built` BLOCKED 3× identically before kickback fired).

## Scope re-statement (as specced)

A minimal deterministic classifier at the completion-gate-miss seam that decides **rerun-vs-route
BEFORE burning a retry** for the SHIP-tail verdict steps (`architecture_review_as_built`, `prd_audit`,
`build_review`), plus a general "identical-repeat on unchanged inputs" signal:

- **ROUTE-CLASS** when the failure is deterministic given unchanged inputs — either (a) the completion
  check names a route (a fresh adverse verdict whose resolution is a known remediation/kickback target)
  on **try 1**, or (b) the same step failed with a byte-identical reason on the immediately-prior
  attempt with no intervening input change (HEAD sha unchanged + verdict-artifact mtimes unchanged) on
  **try 2**.
- ROUTE-CLASS engages the EXISTING `planRemediation`/kickback routing immediately instead of exhausting
  the per-step retry budget — respecting #644's DECIDE-halt guard and #648's no-op escalation.
- Per-retry `retry_decision` audit event (rerun vs route + signal + outcome) so the operator can measure
  success-% of same-step reruns vs routed retries.
- Halts on the routed path state the unchanged input, not "retries exhausted".
- Config kill-switch `retry_routing.enabled` defaulting ON; `false` is an exact revert.

## Corrected premise

The issue frames prd_audit as a contrast that "already knows how to route". Verified: prd_audit
**already** short-circuits its retry loop on a fresh blocking report (`conductor.ts:2128`, via
`classifyPrdAuditGaps`). The gap is that `architecture_review_as_built` and `build_review` have **no**
such short-circuit — they burn the full retry budget then route only at `step_failed`. The spec
generalizes the existing prd_audit precedent into one classifier covering all three verdict steps and
adds the input-unchanged (signal b) case.

Non-goals honored: no new retry budgets/ceilings (#280 owns those); the `build` step's own
retry/progress accounting is untouched; the classifier is scoped to the verdict steps.

ADR: `.docs/decisions/adr-2026-07-13-retry-classify-rerun-vs-route.md`.
