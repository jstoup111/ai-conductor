# Intake origin: plan-over-prescription-drives-completeness-finding

Source-Ref: jstoup111/ai-conductor#1580
Owner: jstoup111

## Desired outcome

- Median completeness findings per review lap drops, while a plan task whose behavior is genuinely absent from the diff still FAILs completeness (negative path).
- A plan can express "existing coverage must not regress" without enumerating named test cases whose deletion-with-equivalent-replacement then reads as a gap — relocated or reorganized coverage with equivalent assertions produces no finding.
- Plans stop routinely landing at the top of the task-count warning band for ordinary features; the band is a real boundary rather than the observed norm.
- Completeness findings that amount to "the plan over-specified" have a resolution path that does not require a needs-human DECIDE halt per finding.
