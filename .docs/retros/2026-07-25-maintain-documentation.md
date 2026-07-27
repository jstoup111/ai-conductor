# Retro: Maintain Documentation
**Date:** 2026-07-25 | **Stats:** 19 tasks, 1 verified SHIP rework cycle, interventions incomplete, 381 affected tests passing, Cost: unmetered/absent

## Part A: Harness

### A1. Correctness

- **H-1:** The custom-step gate-loop tests used a fake `StepRunner`, so the real `DefaultStepRunner` crashed on `maintain-documentation` only at the as-built review (`src/conductor/test/integration/gate-loop.test.ts:80`, `src/conductor/src/engine/step-runners.ts:415`); HIGH; require every dynamically registered dispatchable step to have one real-runner test that reaches the provider boundary.

### A2. Gate Quality

- **H-2:** The PRD audit blocked a correctly classified technical-track feature whose PRD was explicitly skipped (`skills/prd-audit/SKILL.md:46`, `.pipeline/conduct-state.json:3`); MEDIUM false positive; make the audit emit `SKIPPED` when persisted conduct state proves `track: technical` and `prd: skipped`.
- **H-3:** Executed tasks remained `pending` and both event streams were absent (`.pipeline/task-status.json:3`, `.pipeline/audit-trail/events.jsonl`, `.pipeline/events.jsonl`); HIGH observability gap; add a SHIP integrity check that reconciles task trailers with task status and fails when an executed run has no audit stream.

### A3. Autonomy

No issues.

**Proposed changes:**

- [ ] H-1: Add a real-`DefaultStepRunner` production-boundary pattern to `skills/writing-system-tests/SKILL.md` for dynamic registry additions.
- [ ] H-2: Add the verified technical-track `SKIPPED` preflight to `skills/prd-audit/SKILL.md`.
- [ ] H-3: Add task-status reconciliation and audit-stream presence checks before SHIP.

## Part B: Application

### B1. Architecture & Code Quality

- **A-1:** Custom step execution derives the command from the step key while configuration stores an independent skill path (`src/conductor/src/engine/step-runners.ts:470`, `src/conductor/src/engine/steps.ts:572`); MEDIUM latent dispatch risk when those names differ; resolve the command from the configured skill identity or reject mismatched identities during validation.

### B2. Test Quality

- **A-2:** The remediation regression covers only default-mode direct-provider dispatch, leaving daemon `auto` mode and provider-aware execution unasserted (`src/conductor/test/engine/step-runners.test.ts:783`, `src/conductor/src/engine/step-runners.ts:564`); MEDIUM; add a table test spanning default/auto modes and direct/provider-aware runtimes with a step key distinct from its configured skill.

### B3. Security, Performance & Debt

No issues beyond A-1.

**Proposed changes:**

- [ ] A-1: Implement `.docs/stories/custom-step-skill-identity-dispatch.md` so configured skill identity is authoritative for custom-step invocation.
- [ ] A-2: Satisfy that story's interactive, daemon, Claude, Codex, direct-runner, and provider-aware scenarios.

## Part C: Context Efficiency

### Context Efficiency

Input tokens: unmetered/absent | Output tokens: unmetered/absent | Cache read: unmetered/absent | Cache creation: unmetered/absent | Cost USD: unmetered/absent | Dispatches: unmetered/absent | Retries: unmetered/absent | Halts: unmetered/absent

- **C-1:** No shipped Cost block or raw event stream exists (`.docs/shipped/2026-07-25-maintain-documentation.md`, `.pipeline/events.jsonl`); HIGH measurement gap; persist a cost snapshot and event stream before retro so context findings can use measured dispatch and retry data.
- **C-2:** Explicit PRD-audit dispatch consumed a full gate pass for a state already proving the gate inapplicable (`.pipeline/conduct-state.json:3`, `.pipeline/conduct-state.json:7`); MEDIUM; apply H-2 before loading PRDs or dispatching auditors.
- **C-3:** A full suite labeled final ran before as-built review found H-1, invalidating that evidence and requiring another full gate (`.pipeline/architecture-review-as-built.md:24`, `src/conductor/test/engine/step-runners.test.ts:783`); MEDIUM; keep aggregate suites provisional until SHIP reviews pass and require one replacement final suite after any SHIP kickback.

**Proposed changes:**

- [ ] C-1: Make `conduct shipped-record` cost capture available before retro, or add a read-only pre-ship KPI snapshot command.
- [ ] C-2: Short-circuit inapplicable PRD audits before any audit-context load.
- [ ] C-3: Encode provisional-versus-final suite evidence in `skills/conduct/SKILL.md` and `skills/finish/SKILL.md`.

## Trends

- Production-reachability gaps recur: the 2026-06-29 OTEL retro found an unwired callback after evaluator approval; H-1 repeats the same component-tested-but-not-production-dispatched pattern.
- PRD-audit calibration remains uneven: prior retros reduced auditor fan-out, while H-2 shows track applicability still needs a preflight.
- Missing run telemetry prevents intervention and context-cost trend comparison for this feature.

## Feedback-Loop Disposition

- Memory persistence is intentionally skipped by operator instruction; repository policy remains in the skill and committed feature artifacts.
- A-1 and A-2 are tracked by `.docs/stories/custom-step-skill-identity-dispatch.md`; conflict check passed with zero conflicts, and no remediation implementation is started during this feature checkpoint.
