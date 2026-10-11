# Intake origin: source-grounded-plan-defects-pass-every-decide-gat

Source-Ref: jstoup111/ai-conductor#3038
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3038 digest=0cd2a10c3ffc4b954a48467efb0363d872c3bf30a6a584c95e4c9d664f2dd5d6 >>>
## Desired outcome

- Before land, for a Medium or Large spec, a plan task that would turn an existing test red without updating it is reported, naming the test and the task.
- Before land, a newly introduced export or primitive with no named production caller is reported.
- Before land, a task whose Done-when cannot pass at its position in the declared dependency order is reported, naming both tasks.
- Every finding of this review names its severity, the artifact and task, story or decision id it concerns, and `file:line` evidence from the source.
- Blocking findings stop the spec before land, and the operator sees them in DECIDE, not during BUILD.
- Total review effort per spec is bounded: a fixed number of review and re-check passes, after which remaining findings go to the operator instead of another round.
- A spec with no such defects lands with no added operator interaction, and Small-tier specs are unaffected.
<<< END INBOUND >>>
