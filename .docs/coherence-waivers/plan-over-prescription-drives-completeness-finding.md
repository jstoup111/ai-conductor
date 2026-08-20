# Coherence Waiver: plan-over-prescription-drives-completeness-finding

Waives: outcome-3, outcome-4

Rationale: Issue jstoup111/ai-conductor#1580 was filed with four desired-outcome bullets. The
operator narrowed this spec to outcomes 1 and 2 on 2026-08-16 after both remaining bullets were
measured and found to rest on premises that do not hold as filed. Claiming them as covered here
would be a false traceability claim, so they are waived rather than asserted. The narrowing is
recorded as the binding `Scope boundary:` in
`.docs/track/plan-over-prescription-drives-completeness-finding.md`.

Outcome 3 — "Plans stop routinely landing at the top of the task-count warning band for ordinary
features; the band is a real boundary rather than the observed norm" — rests on a distribution claim
that measurement refutes. `skills/plan/SKILL.md:280-290` sets the band at 1-20 normal, 21-40 warning,
41+ hard stop. Counting `^### Task ` headers across the 60 most recently modified plans in
`.docs/plans/` gives 49 in the normal band, 10 in the warning band, and 1 past the hard stop. The
warning band is therefore not the observed norm for ordinary features; 82% of recent plans never
reach it. What is real is a tail — 49, 40, 39, 38, 38 and 34 tasks — including
`build-review-rubric-dispositions-and-fan-out` at 49, which cleared a documented hard stop and
proceeded anyway. Making the band bite is a genuine improvement, but it is a volume lever aimed at a
tail rather than a fix for the finding-generating mechanism this spec addresses, and it cannot
distinguish a good 30-task plan from a bad one. It also re-enters the `skills/plan/SKILL.md`
scope-check territory that #1602 will rework, which the operator has sequenced separately.

Outcome 4 — "Completeness findings that amount to 'the plan over-specified' have a resolution path
that does not require a needs-human DECIDE halt per finding" — asks for a routing-policy change whose
valve already shipped. The halt the issue cites is `/remediate` diagnosing a completeness finding as
needing a plan-text revision, attempting to route to the `plan` step, and the daemon refusing
("remediation requires a DECIDE revision of DECIDE step 'plan' … explicit operator grant required").
That refusal is the current design working as intended, and reversing it needs its own ADR rather
than a clause inside this spec. Meanwhile the non-halt path landed as rubric dispositions
(`adr-2026-08-13-stable-build-review-finding-dispositions`, PR #1563, merged 2026-08-15) — after
#1580 was filed — which let an operator accept a finding per occurrence instead of amending the plan.
The issue's own third hypothesis anticipates this, calling dispositions "the complementary valve, not
a substitute". Separately, this spec's delivery of outcomes 1 and 2 removes most of the finding
family that reaches that halt at all, which is strictly better than giving it a smoother resolution.

Both outcomes remain open questions rather than dropped ones. Whether either warrants its own ticket
is being re-checked against #1602 (enumeration-vs-invariant plan authorization), which reworks the
same `skills/plan/SKILL.md` authorization surface and may subsume them.
