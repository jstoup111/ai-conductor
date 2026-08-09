# Intake origin: out-of-plan-production-edits-reach-build-review-in

Source-Ref: jstoup111/ai-conductor#1390
Owner: jstoup111

## Desired outcome

- A commit whose staged files fall outside its attributed plan task's declared scope does not land — the commit is refused at the moment it is written, not discovered at `build_review`.
- The refusal names the offending path(s) and the task whose scope they escaped.
- A build that legitimately needs an out-of-plan path has an in-band route that succeeds without operator intervention, and the resulting diff passes `build_review` scope without a kickback.
- A containment check that cannot reach a verdict (tool crash, unresolvable state) does not silently permit the commit — the ambiguity is visible in the build record.
- A commit fully inside its task's declared scope is unaffected — no new friction on the common path.
