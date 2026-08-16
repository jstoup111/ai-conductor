# Track: Plan over-prescription drives completeness finding load and halts (#1580)

Track: technical

Scope boundary: Outcomes 1 and 2 only — a narrow, engine-anchored preservation/relocation
exception for the Completeness rubric (judged at assertion-equivalence level, anchored to the
v2 projection's existing `removalContext`), PLUS the plan-side authoring form that lets a plan
state "this coverage must not regress" at behavior level instead of naming individual test
cases. Excludes: outcome 3 (making the task-count warning band bite) and outcome 4 (a non-human
resolution path for "the plan over-specified"). Both were operator-excluded after measurement —
outcome 3's premise did not hold (49 of the last 60 plans sit in the normal 1-20 band, so the
warning band is a tail problem, not the norm), and outcome 4's valve already shipped as rubric
dispositions (PR #1563, 2026-08-15) after this issue was filed. Re-check both against #1602
before filing any follow-up.

Related, deliberately NOT coordinated with: #1602 (enumeration-vs-invariant plan authorization)
touches the same `skills/plan/SKILL.md` section. Operator direction 2026-08-16 is to design
#1580 on its own merits and let #1602 reconcile the two forms when it is specced.

Harness-internal review/authoring machinery with no user-facing product surface — same track as
the #1579 verify-only and #1521 removal-maintenance siblings, both of which reshaped a
build_review rubric contract without a PRD.
