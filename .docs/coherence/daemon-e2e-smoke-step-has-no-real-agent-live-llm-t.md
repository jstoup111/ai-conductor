# Coherence: Live-agent daemon E2E smoke tier (#1124)

Plan stem: `daemon-e2e-smoke-step-has-no-real-agent-live-llm-t`. Tier M, technical track — the `fr`
row class is omitted (no PRD; acceptance criteria live in the stories).

Ids resolve as follows. `outcome-1`–`outcome-4` are the four staged intake bullets in
`.pipeline/intake-outcomes.md`, taken verbatim from jstoup111/ai-conductor#1124. Story ids are the
`## Story ST-1124-N:` headings in
`.docs/stories/daemon-e2e-smoke-step-has-no-real-agent-live-llm-t.md`. Task ids `1`–`13` are the
`### Task N:` headers in `.docs/plans/daemon-e2e-smoke-step-has-no-real-agent-live-llm-t.md`, and
each plan task cites exactly one story id on its `**Story:**` line.

Two outcome rows carry the verdict `covered-with-deviation`. Both are deliberate,
operator-approved narrowings recorded in
`.docs/decisions/adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate.md`, not omissions:
the issue proposed a nightly `schedule` trigger, and the operator chose `workflow_dispatch` plus a
reusable fail-closed `workflow_call` gate mode instead. The substance each bullet asks for — a real
`claude`/`codex` subprocess driving the fixture claim-to-finish, and never blocking a per-PR merge —
is delivered in full.

| Row class | Id | Counterpart id(s) | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| outcome | outcome-1 | story-ST-1124-1, story-ST-1124-5 | covered-with-deviation | A CI job drives the fixture claim-to-finish with real `claude` and `codex` subprocesses; the trigger is operator dispatch rather than a nightly schedule |
| outcome | outcome-2 | story-ST-1124-2 | covered | Token cap in-test plus an independent job wall-clock bound, over the setup-token auth pattern the bullet names |
| outcome | outcome-3 | story-ST-1124-3 | covered | Daemon log tail plus HALT, park marker, task-status.json and task-evidence.json printed on failure from one shared helper |
| outcome | outcome-4 | story-ST-1124-4 | covered-with-deviation | No pull_request trigger, absent from ci-gate, excluded from npm test by the smoke name; advisory on dispatch and fail-closed only when called as a release gate |
| story | story-ST-1124-1 | task-6, task-7, task-9 | covered | Real-Claude terminal-finish run, the halt/park negative that proves it is not vacuous, and the Codex leg |
| story | story-ST-1124-2 | task-3, task-4, task-8 | covered | RED/GREEN on the metering decorator, then cap enforcement and unconditional cost reporting |
| story | story-ST-1124-3 | task-1, task-2, task-13 | covered | RED/GREEN on the widened shared diagnostics dump, and its documentation |
| story | story-ST-1124-4 | task-10, task-12 | covered | Workflow triggers and matrix, then the proof that neither npm test nor ci-gate runs it |
| story | story-ST-1124-5 | task-5, task-11 | covered | Skip-when-uncredentialed advisory gate plus the real-exec guard, then fail-closed gate mode and the credential summary |
| task | task-1 | story-ST-1124-3 | covered | RED: diagnostics must dump task status and evidence |
| task | task-2 | story-ST-1124-3 | covered | GREEN: extract the shared helper, widen it, keep the deterministic tier green |
| task | task-3 | story-ST-1124-2 | covered | RED: decorator must sum tokenUsage and stay behaviorally transparent |
| task | task-4 | story-ST-1124-2 | covered | GREEN: implement the transparent metering decorator |
| task | task-5 | story-ST-1124-5 | covered | skipIf gate on binary, credential and kill switch; clears and asserts AI_CONDUCTOR_NO_REAL_EXEC |
| task | task-6 | story-ST-1124-1 | covered | Real Claude provider at the DefaultStepRunner seam; outcome-shaped terminal assertions |
| task | task-7 | story-ST-1124-1 | covered | Halt or park fails the tier, with no retry |
| task | task-8 | story-ST-1124-2 | covered | Cap asserted and named on breach; observed total printed on success |
| task | task-9 | story-ST-1124-1 | covered | Codex leg, independently gated from the Claude leg |
| task | task-10 | story-ST-1124-4 | covered | Dispatch-only workflow, provider matrix, wall-clock bound, absent from ci-gate |
| task | task-11 | story-ST-1124-5 | covered | require_credentials fail-closed input and the advisory credential summary |
| task | task-12 | story-ST-1124-4 | covered | Proves npm test and the structural policy test both stay green |
| task | task-13 | story-ST-1124-3 | covered | Smoke-table row, prose subsection, changelog, full validation suite |

All rows covered; zero gaps.
