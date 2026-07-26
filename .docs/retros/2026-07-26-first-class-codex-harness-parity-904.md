# Retro: First-Class Codex Harness Parity (#904)

**Date:** 2026-07-26 | **Stats:** 29 tasks, 2 evaluator rework cycles, 2 preventable interventions, 8,555 conductor tests passing, Cost: unmetered/absent

## Part A: Harness

- **H-1:** Gate/rework history is incomplete because `.pipeline/audit-trail/events.jsonl` was absent; severity: medium; fix: make the pipeline start/batch boundary create and append the canonical event stream before dispatch.
- **H-2:** Evidence-only commits initially placed a blank line between `Task:` and `Evidence:`, so Git did not parse the task trailer and completion reconciliation missed four tasks; severity: high; fix: add a TDD/pipeline test and exact contiguous-trailer commit template.
- **H-3:** The as-built architecture gate caught an operator-facing Codex syntax leak after the PRD audit had passed; severity: medium; fix: add host-native operator diagnostics to the PRD-audit FR-8/FR-13 evidence checklist.

**Proposed changes:**

- [ ] H-1: Add audit-trail event-stream creation/append coverage to the pipeline engine.
- [ ] H-2: Enforce contiguous `Task:` + `Evidence:` trailers in the evidence-commit helper and TDD skill.
- [ ] H-3: Extend PRD-audit scoping to inspect runtime diagnostics for host-native invocation text.

## Part B: Application

- **A-1:** `bin/install --providers Codex` is rejected even though help text names `Codex` as supported; severity: medium; fix: normalize provider selection case before validation and add an installer regression.

**Proposed changes:**

- [ ] A-1: File a future intake only if case-insensitive provider selection becomes operator-impacting; do not add it to this completed feature plan.

## Part C: Context Efficiency

Cost data: unmetered/absent — no shipped record exists yet.

- **C-1:** The temporary-home live probe required two attempts because its isolated HOME omitted Codex credentials; impact: an avoidable external-agent retry; fix: document a probe wrapper that isolates the skill catalog while explicitly retaining read-only `CODEX_HOME`.
- **C-2:** The final full suite first ran in the restricted sandbox, where real shell/Git fixtures fail with `EPERM`; impact: duplicated 118-second run; fix: classify those fixture families as host-required before invoking the aggregate verifier.

**Proposed changes:**

- [ ] C-1: Add a live-probe recipe to the verification task with isolated HOME plus read-only credential configuration.
- [ ] C-2: Add a documented host-required trigger for the conductor full-suite verifier.

## Trends

- Host-specific syntax leaks remain detectable late; see H-3.
