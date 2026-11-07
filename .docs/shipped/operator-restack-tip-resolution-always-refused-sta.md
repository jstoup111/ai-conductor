---
slug: operator-restack-tip-resolution-always-refused-sta
spec_hash: ad6eb4dedc9cee7766b426a499ff3b610243e7cfed9e000d18638fa2c2e1f008
pr: https://github.com/jstoup111/ai-conductor/pull/3596
shipped: 2026-11-07
engine_version: 20261106T225817Z-648f7e8ce580
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "This is an unplanned test-budget change in an unrelated acceptance suite. It changes no product behavior."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-2
    summary: "No task asked for this module extraction. It does serve Task 13, because halt-record.ts must call hasDurableChildState without depending on slice-topology or rebase orchestration. Behavior is preserved and the re-export keeps callers unchanged, so the change is within intent."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-3
    summary: "This unplanned test-harness change widens the tmpdir leak guard's ignore list to cover live daemon Claude prompt files. It is unrelated to the restack and halt-record stories and not user-visible. It does slightly weaken leak detection for that prefix."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-4
    summary: "This removes existing coverage that no task asked to remove. The EventPersister persistence of restack_resolution 'recorded' (with operator) and 'consumed' (without) is no longer asserted at the unit level. Real-git tests only listen for those events on the emitter, and only 'retired' is checked through EventPersister. Production behavior is unchanged, so the effect is lost regression coverage, not a user-visible change."
    accepted: false
    authority: engine
  - gate: architecture_review_as_built
    finding: "as-built:ad5a59ed-1d33-41d7-ad18-a4ade9a6780c:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-02-stacked-restack-recovery-and-halt-record-ref decision 5"
    outcome: remediated
    summary: "Verified, 99% confidence: unreadable conflict records block orphan retirement. restack-conflict-record.ts:399 returns unavailable before deleting the resolution, including for malformed JSON. Consequently restack-executor.ts:757 throws and restack-recovery.ts:773 returns unavailable; neither emits retired nor continues ordinary replay. All paths are under src/conductor/src/engine/restack/."
  - gate: architecture_review_as_built
    finding: "as-built:ad5a59ed-1d33-41d7-ad18-a4ade9a6780c:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-11-02-stacked-restack-recovery-and-halt-record-ref decision 5"
    outcome: remediated
    summary: "Verified, 97% confidence: src/conductor/src/engine/restack/restack-recovery.ts:771 handles only one orphan before resuming. A second child's orphan falls into :824, aborts the journal, and returns unavailable at :830 because no matching record exists. Its retirement event and ordinary replay are skipped."
---

## Cost
input: 5009431
output: 402788
cache_read: 136531751
cache_creation: 1651423
cost_usd: 62.4601
dispatches: 55
retries: 11
halts: 3
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 5009303, output: 315299, cache_read: 131042688, cache_creation: 0, cost_usd: 46.4006, dispatches: 41, cost_unmetered: 0
  claude: input: 128, output: 87489, cache_read: 5489063, cache_creation: 1651423, cost_usd: 16.0595, dispatches: 14, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","58b835ca-4b54-48bf-b815-25e237d37a86","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 3
  implementationQuality: failures: 0, judged: 3
  security: failures: 0, judged: 3
  testQuality: failures: 1, judged: 3
skip_reasons:
