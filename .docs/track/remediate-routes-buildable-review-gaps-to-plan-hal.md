# Track: remediate routes buildable review gaps to plan, halting features needs-human

Track: technical

Scope boundary: The `/remediate` skill and the `remediation-planner` agent carry the fix —
a `build_review` trigger row with its gap-id format, a mandatory existing-plan-task coverage
check before any `plan` disposition, the fact that `plan` is a terminal needs-human HALT in a
daemon run (never a re-plan), and a `rationale` that names the plan task(s) the gap was matched
against. Two enabling engine changes are in scope because the skill cannot reach them: the
build_review→remediate dispatch string at `conductor.ts:7457` (it primes the planner with "the
plan task may be under-decomposed"), and passing the active plan path into that dispatch context
so the coverage check is executable inside a daemon worktree whose `.docs/plans/` also holds every
merged plan from main.

Excluded: fail-closed engine validation of a `plan` disposition's coverage evidence in
`readRemediationPlan` (operator decision — guards future drift rather than fixing this bug);
any change to `decide-entry-policy.ts`, whose refusal of autonomous `plan` entry behaved
correctly and must stay intact.

Internal harness routing and prompt-contract work with no user-facing product requirement, so
acceptance criteria live directly in the stories and no PRD is authored.
