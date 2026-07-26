# Retro: Codex Authentication and Autonomous Execution Readiness (#905)

**Date:** 2026-07-26 | **Stats:** 13 planned tasks, gate/rework history INCOMPLETE, at least 5 audit-to-BUILD corrective cycles, 1 operator intervention, 8,610 tests passing / 14 skipped, Cost: unmetered/absent

## Part A: Harness

### Correctness

- **H-1:** Primary gate history is absent because `.pipeline/audit-trail/events.jsonl` and `.pipeline/events.jsonl` do not exist, while the final audit trail has multiple rework commits; severity: high; fix: fail the retro-precondition or write a durable reconstructed event stream before SHIP.
- **H-2:** Source identity and permission disposition were initially dropped at scalar and grouped adapters, and only fresh PRD/as-built/code review caught the paths; `src/conductor/src/engine/step-runners.ts:867`, `src/conductor/src/engine/group-core.ts:544`; severity: high; fix: make provider-boundary plans carry an executable-root × metadata-propagation matrix that TDD must cover before batch review.

### Gate Quality

- **H-3:** A full-suite run timed out in two `self-host/wiring` cases although the isolated file passed immediately and the clean aggregate rerun passed; `src/conductor/test/engine/self-host/wiring.test.ts:180`, `:260`; severity: medium; fix: record process/resource diagnostics on timeouts and treat a passing isolated rerun plus passing aggregate rerun as an order-dependent test-infrastructure finding, not a product regression.

### Autonomy

- **H-4:** `.pipeline/task-status.json` remains entirely `pending` and `.pipeline/conduct-state.json` remains at `acceptance_specs` after completed pipeline, audit, and review gates; severity: medium; fix: reconcile conduct state from trailered commits and current gate artifacts before `/conduct` reports the next step.

**Proposed changes:**

- [ ] H-1: Make `/pipeline` write/reconstruct a non-empty audit event stream before permitting `/retro`.
- [ ] H-2: Add a mandatory provider-result propagation checklist to `/pipeline` evaluator prompts and `/writing-system-tests` for cross-boundary provider work.
- [ ] H-3: Add timeout-process diagnostics and aggregate-rerun classification to the full-suite verifier.
- [ ] H-4: Add a conduct reconciliation test for trailered commits plus fresh audit artifacts.

## Part B: Application

### Architecture & Code Quality

No issues.

### Test Quality

No issues.

### Security, Performance & Debt

No issues.

## Part C: Context Efficiency

### Context Efficiency

Cost figures are **unmetered/absent**: no #905 shipped record or Cost block exists, and both primary event streams are absent.

- **C-1:** Repeated final-gate rediscovery required five corrective cycles across provider, scalar, group, and terminal adapters; impact: repeated full-suite runs and evaluator dispatches; proposed change: inject an adapter inventory with required metadata fields into each provider-boundary Task prompt.
- **C-2:** The stale state and missing audit stream forced manual reconstruction from git history and prior reports; impact: retrospective/context work used broad artifact reads instead of a compact event summary; proposed change: persist one per-batch summary with verdicts, test results, and rework links.
- **C-3:** The medium-tier final evaluator was proportionate, but its prompt needed several re-reviews because each correction exposed a sibling adapter; impact: evaluator context and elapsed time; proposed change: require an exhaustive discriminated-result consumer search whenever a provider result field is added.

**Proposed changes:**

- [ ] C-1: Amend `/pipeline` task prompts for provider features with a source/auth/permission propagation table.
- [ ] C-2: Add a durable per-batch summary artifact to the pipeline audit trail.
- [ ] C-3: Add a `rg`-based all-consumer check to `/code-review` for newly propagated result fields.

## Trends

- Missing primary audit events and stale conduct/task state recur from the #927 retro; the visibility gap remains unresolved.
- This feature repeats #927’s late provider-boundary discovery pattern, but final evaluators converted it into bounded corrective work rather than an unreported ship gap.
