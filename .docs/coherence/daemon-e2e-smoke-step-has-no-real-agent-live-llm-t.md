# Coherence: Live-agent daemon E2E smoke tier (#1124)

Plan stem: `daemon-e2e-smoke-step-has-no-real-agent-live-llm-t`. Tier M, technical track — the `fr`
row class is omitted (no PRD; acceptance criteria live in the stories).

Ids resolve as follows. `outcome-1`–`outcome-4` are the four staged intake bullets in
`.pipeline/intake-outcomes.md`, taken verbatim from jstoup111/ai-conductor#1124. Story ids are the
`## Story ST-1124-N:` headings in
`.docs/stories/daemon-e2e-smoke-step-has-no-real-agent-live-llm-t.md`. Task ids `1`–`6` are the
`### Task N:` headers in `.docs/plans/daemon-e2e-smoke-step-has-no-real-agent-live-llm-t.md`, and
each plan task cites exactly one story id on its `**Story:**` line.

Three outcome rows carry the verdict `covered-with-deviation`. All three are deliberate,
operator-approved narrowings recorded in
`.docs/decisions/adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate.md`, not omissions.
The issue proposed a nightly `schedule` trigger and named "claude and/or codex"; the operator chose
`workflow_dispatch` plus a reusable fail-closed `workflow_call` gate mode, and one Claude leg with
the Codex leg deferred to a follow-on. The substance each bullet asks for — a real agent subprocess
driving the fixture claim-to-finish, a hard cost bound, diagnosable failures, and never blocking a
per-PR merge — is delivered in full. The issue's own wording ("and/or") already admits a single
provider.

Coverage of ST-1124-2 is split across two tasks by design: task-2 owns the meter and the cap
predicate with its own RED/GREEN, and task-4 applies that predicate to the live run. Task-4 cites
ST-1124-1 because its subject is the live run itself.

| Row class | Id | Counterpart id(s) | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-ST-1124-1, story-ST-1124-5 | covered-with-deviation | A CI job drives the fixture claim-to-finish with a real claude subprocess; the trigger is operator dispatch rather than a nightly schedule, and the codex leg is a deferred additive matrix entry |
| outcome | outcome-2 | story-ST-1124-2 | covered | Token cap in-test plus an independent job wall-clock bound, over the setup-token auth pattern the bullet names |
| outcome | outcome-3 | story-ST-1124-3 | covered | Daemon log tail plus HALT, park marker, task-status.json and task-evidence.json printed on failure from one dump implementation both tiers share |
| outcome | outcome-4 | story-ST-1124-4 | covered-with-deviation | No pull_request trigger, absent from ci-gate, excluded from npm test by the smoke name; advisory on dispatch and fail-closed only when called as a release gate |
| story | story-ST-1124-1 | task-4 | covered | Real-Claude terminal-finish run plus the halt negative that proves it is not vacuous |
| story | story-ST-1124-2 | task-2 | covered | RED/GREEN on the metering decorator and the cap predicate; applied to the live run in task-4 |
| story | story-ST-1124-3 | task-1, task-6 | covered | RED/GREEN on the widened diagnostics dump, and its documentation |
| story | story-ST-1124-4 | task-5 | covered | Workflow triggers and matrix, plus the in-task proof that neither npm test nor ci-gate runs it |
| story | story-ST-1124-5 | task-3 | covered | Skip-when-uncredentialed advisory gate and the real-exec guard assertion |
| task | task-1 | story-ST-1124-3 | covered | RED then GREEN: diagnostics dump task status and evidence, and is exported for the live tier |
| task | task-2 | story-ST-1124-2 | covered | RED then GREEN: transparent metering decorator plus a cap predicate naming cap and observed total |
| task | task-3 | story-ST-1124-5 | covered | skipIf gate on binary, credential and kill switch; clears and asserts AI_CONDUCTOR_NO_REAL_EXEC |
| task | task-4 | story-ST-1124-1 | covered | Real Claude provider at the DefaultStepRunner seam; outcome-shaped terminal assertions, cap applied, halt negative, no retry |
| task | task-5 | story-ST-1124-4 | covered | Dispatch-only workflow with require_credentials fail-closed input, wall-clock bound, absent from ci-gate, npm-test exclusion proven |
| task | task-6 | story-ST-1124-3 | covered | Smoke-table row, prose subsection, changelog, full validation suite |

All rows covered; zero gaps.
