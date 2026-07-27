# Retro: Per-step provider routing (#927)

**Date:** 2026-07-25 | **Stats:** 40 tasks, gate/rework history INCOMPLETE (at least 29 reconstructed cycles), 5 recorded operator conflict resolutions, 8,359 tests passing / 11 skipped, Cost: input 0, output 0, cache_read 0, cache_creation 0, cost_usd 0, dispatches 0, retries 0, halts 0, unmetered count 0 / duration_ms 0

## Part A: Harness

### Correctness

- **H-1:** The missing-ledger negative test asserts only that the Cost block contains the word `unmetered`, so `unmetered.count: 0` passed while the shipped record falsely reported zero work; `src/conductor/test/acceptance/per-feature-cost-rollup-committed-at-ship.acceptance.test.ts:209-222`; severity: high; fix: assert a non-zero machine-readable incomplete/unmetered value and add the accepted RF-927-1 regression story.

### Gate Quality

- **H-2:** Primary gate/rework history is INCOMPLETE because `.pipeline/audit-trail/events.jsonl` is absent despite ten executed build batches; severity: high; fix: make pipeline completion fail closed on a missing audit stream or reconstruct and persist an explicit fallback stream before retro.
- **H-3:** Build and finish gates did not reconcile durable evidence into state: all 40 `.pipeline/task-status.json` rows remain `in_progress` and `.pipeline/conduct-state.json:18-22` stops at acceptance specs despite a shipped record and merged PR; severity: medium; fix: derive terminal task/step state from commit evidence and ship markers at every checkpoint, with a merged-feature reconciliation test.

### Autonomy

No issues.

**Proposed changes:**

- [ ] H-1: Strengthen the missing-ledger acceptance assertion as specified by RF-927-1.
- [ ] H-2: Require audit-stream completeness or an explicit fallback artifact before retro.
- [ ] H-3: Add end-to-end state reconciliation from task evidence through merged shipment.

## Part B: Application

### Architecture & Code Quality

- **A-1:** `computeCostRollup` converts any missing/unreadable event ledger into a clean all-zero result, contradicting the accepted token-accounting negative path; `src/conductor/src/engine/cost-rollup.ts:62-72`; severity: high; fix: distinguish readable-empty from absent/unreadable and emit a non-zero incomplete/unmetered sentinel via RF-927-1.
- **A-2:** `executeProviderCandidates` is a 132-line multi-branch method combining configuration, sessions, invocation, attribution, terminal results, and warnings; `src/conductor/src/engine/provider-execution.ts:195-326`; severity: medium; fix: extract independently tested native-resolution, invocation/session, and attempt-result helpers under RF-927-2 without changing public behavior.

### Test Quality

See H-1.

### Security, Performance & Debt

No issues.

**Proposed changes:**

- [ ] A-1: Implement RF-927-1 and keep ship non-blocking while making missing accounting visible.
- [ ] A-2: Implement RF-927-2 as a behavior-preserving provider-execution decomposition.

## Part C: Context Efficiency

### Context Efficiency

Cost block figures: input 0, output 0, cache_read 0, cache_creation 0, cost_usd 0, dispatches 0, retries 0, halts 0, unmetered count 0 / duration_ms 0. These are the committed figures, but H-1 proves they cannot support per-skill or per-dispatch attribution for this run.

- **C-1:** `retro` treats a zero-dispatch Cost block as complete even when independent task/build evidence proves execution occurred; `skills/retro/SKILL.md` Cost-block rule and `.docs/shipped/2026-07-24-per-step-provider-routing-927.md:8-17`; impact: quantitative context analysis becomes falsely precise; proposed change: report `unmetered/absent` when a zero-dispatch record contradicts task, progress, or audit evidence.
- **C-2:** At least 29 reconstructed rework cycles were spread across ten four-task batches, including seven cycles in the production-composition batch; `.pipeline/progress.log:55-76`; impact: repeated rediscovery of provider-boundary invariants; proposed change: have `pipeline` inject a compact ADR-derived invariant ledger (recovery precedence, session scope, attempt-before-transition ordering, provider-native settings) into every affected batch prompt.
- **C-3:** The interactive recovery bypass was found only after all 40 tasks and final audit, forcing a full SHIP remediation and another 8,359-test run; `.pipeline/progress.log:81-84`; impact: late broad revalidation; proposed change: add a plan-time executable-root inventory to provider-routing features and require each root to map to one acceptance scenario before BUILD.

**Proposed changes:**

- [ ] C-1: Amend `skills/retro/SKILL.md` with a contradiction check between Cost-block dispatches and independent execution evidence.
- [ ] C-2: Add an invariant-ledger field to provider-boundary pipeline batch prompts.
- [ ] C-3: Add executable-root-to-acceptance traceability to provider-routing plans.

### Proposed harness diffs

```diff
--- a/skills/retro/SKILL.md
+++ b/skills/retro/SKILL.md
@@ Part C: Context Efficiency Retro
+- If a Cost block reports `dispatches: 0` but task, progress, audit, or shipped
+  evidence proves execution occurred, treat token/cost figures as
+  `unmetered/absent` and record the contradiction as a telemetry finding.
--- a/skills/pipeline/SKILL.md
+++ b/skills/pipeline/SKILL.md
@@ Batch dispatch prompt
+- For cross-cutting execution features, include a compact invariant ledger and
+  the plan's executable-root-to-acceptance mapping in every affected batch.
```

## Trends

- Missing primary audit events recurred from the #902 retro, so telemetry completeness remains unresolved.
- Stale task-status reconciliation recurred from the #902 retro and expanded from 20 pending rows to 40 `in_progress` rows.
- Cost reporting moved from absent in #902 to present-but-falsely-complete zeros in #927; this is a visibility regression, not improved accounting.
