# Track: build_review rubrics need a post-join adjudicator so findings do not compete

Track: technical

Scope boundary: Full jstoup111/ai-conductor#2033 outcome, operator-confirmed 2026-08-29. Keep
rubric graders independent, mechanically join their raw outcomes, and dispatch the existing
`remediate` judgement capability once over all current findings plus prior adjudication history.
The engine validates and persists one source-complete result, files judged deferrals, charges only
actionable work to one `build_review` budget decision, and fails closed when synthesis cannot
complete. No second adjudicator skill or dispatch is introduced. The related validation-group
accounting repair in #2060 remains a separate feature: it reuses the same fan-in contract but fixes
the post-`remediate` split into per-gate budgets, appends, and terminal paths. Rubric catalog
expansion in #2020 remains separately owned.

This is engine orchestration and internal review-gate behavior rather than a user-facing product
capability, so acceptance criteria belong directly in stories and no PRD is required.
