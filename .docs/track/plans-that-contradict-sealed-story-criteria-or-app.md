# Track: plans-that-contradict-sealed-story-criteria-or-app

Track: technical

Scope boundary: Balanced (operator-confirmed). Extend the `coverage_binding` judge with a
joint-satisfiability (conflict) claim class: every sealed story criterion, and every approved ADR
decision the plan is subject to, is judged against ALL plan tasks' `Done when` checks — not only
the tasks a coverage row cites — on every tier including S. A conflict halts `needs-human` before
any task code is built, naming the criterion or decision and the conflicting task(s). Plans whose
tasks merely cover different criteria pass with no new refusal. The six evidence cases (three
story-criterion conflicts from #2750, three ADR-decision conflicts from the #2750 comment) are
replayed as fixtures. Excluded: task↔task contradictions with no criterion/decision involved,
story↔ADR contradictions, a land-time or pre-PR DECIDE judge, and any change to the
`coverage_binding.judge.enabled` default.

## Rationale

Internal harness gate behavior with no user-facing product surface; acceptance criteria belong in
stories, not a PRD. → **technical track** (skip `/prd`).
