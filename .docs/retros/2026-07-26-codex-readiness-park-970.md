# Retro: Codex readiness park (#970)

**Date:** 2026-07-26 | **Stats:** 12 tasks, 2 rework cycles, 1 intervention, 8,722 tests passing / 14 skipped, Cost: unmetered/absent

## Part A: Harness

- **H-1:** Gate/rework history is INCOMPLETE because both `.pipeline/audit-trail/events.jsonl` and `.pipeline/events.jsonl` are empty despite two recorded Task 10 rework cycles; severity: high; fix: make `/pipeline` emit a durable per-batch event summary before retro.
- **H-2:** The aggregate verifier passed but `.pipeline/test-suite-evidence.json` was absent, blocking `/conduct` until manual reconstruction; `.pipeline/test-suite-evidence.json`; severity: medium; fix: make `/test-suite` write evidence atomically after every completed verifier process, including host-context retries.
- **H-3:** The first timeout-matrix rework used labels while calling only the shared helper, so the final evaluator had to reject it twice; `src/conductor/test/engine/conductor-auth-park.test.ts:275` (superseded test shape); severity: medium; fix: add a pipeline evaluator checklist item requiring each named dispatch shape to enter its real caller seam.

**Proposed changes:**

- [ ] H-1: Add a pipeline batch-event writer and retro preflight assertion.
- [ ] H-2: Add an integration test for host-context test-suite evidence persistence.
- [ ] H-3: Amend the evaluator prompt template with real-caller-seam verification for cross-dispatch matrices.

## Part B: Application

- **A-1:** `parkOnAuthFailure` combines source policy, timing, telemetry, and terminal outcome construction in a 99-line, multi-branch method; `src/conductor/src/engine/conductor.ts:1290`; severity: medium; fix: track `.docs/stories/auth-park-coordinator-decomposition.md` and extract source-specific policy helpers without changing caller contracts.

**Proposed changes:**

- [ ] A-1: Run DECIDE for `auth-park-coordinator-decomposition` before implementation.

## Part C: Context Efficiency

Cost figures are **unmetered/absent**: no #970 shipped record with a `## Cost` block exists.

- **C-1:** Task 10 consumed two rework cycles because its initial matrix prompt did not require actual serial/grouped/judgment/auxiliary entry points; `.docs/plans/2026-07-26-codex-readiness-park-970.md:172`; impact: repeated evaluator and test context; fix: require caller-seam paths in the task prompt.
- **C-2:** Missing event history and test-suite evidence forced broad artifact reconstruction during SHIP; `.pipeline/audit-trail/events.jsonl`; impact: unnecessary context reads; fix: persist compact gate summaries at each phase boundary.

**Proposed changes:**

- [ ] C-1: Add a cross-dispatch-matrix prompt clause to `skills/pipeline/SKILL.md`.
- [ ] C-2: Include verifier result and session context in the pipeline summary schema.

## Trends

- Stale state/audit visibility continues the #905 retro pattern; #970 adds missing aggregate-evidence persistence as a concrete instance.
