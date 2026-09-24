# Track: post-plan DECIDE amendments reconcile with the plan

Track: technical

Scope boundary: Surface a plan that fails to carry an ADR decision (D<n>) or an amended DECIDE clause at BUILD entry, before any build_review lap, by extending `coverage_binding`'s existing judge; an operator reseal that changes DECIDE content invalidates the prior coverage verdict so the next BUILD entry re-judges, and completed tasks the amendment contradicts reopen. Excluded: halt clause-naming (already delivered post-v1), an operator-ruling scope channel (operator reseal already authorizes, adr-2026-08-12), `prd`/`stories` remediation dispositions (case-v2 `escalate` owner covers; daemon never re-enters DECIDE), and #1643, #1778, #1851.

Internal harness gating with no user-facing product behavior; recurred post-v1 on 2026-09-10 (`render-every-declared-render-event-in-inline-runs`).
