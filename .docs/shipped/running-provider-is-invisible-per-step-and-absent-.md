---
slug: running-provider-is-invisible-per-step-and-absent-
spec_hash: ca5c16b51915eadc6668a67b68a88176a7dabb2755e582e1c407743ca5bab18f
pr: https://github.com/jstoup111/ai-conductor/pull/3245
shipped: 2026-10-15
engine_version: 20261015T004522Z-65702d1bcf72
findings:
  - gate: architecture_review_as_built
    finding: "as-built:aa4bb60e-bc53-48d8-960f-fbaec9c7cb43:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-12-enforced-source-layer-directions decision 1"
    outcome: remediated
    summary: "Verified, 99% confidence: src/conductor/src/engine/provider-execution.ts:64 introduces an engine → UI type import, used by Pick<ConductorEventEmitter, 'emit'> at :374. Decision 1 prohibits upward imports, explicitly including type-only imports. This is the sole newly introduced violating import in the reviewed diff."
---

## Cost
input: 853994
output: 114924
cache_read: 20014847
cache_creation: 491677
cost_usd: 14.8908
dispatches: 19
retries: 2
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 853878, output: 61961, cache_read: 15145472, cache_creation: 0, cost_usd: 8.9238, dispatches: 11, cost_unmetered: 0
  claude: input: 116, output: 52963, cache_read: 4869375, cache_creation: 491677, cost_usd: 5.967, dispatches: 8, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","e4e42242-5453-48e7-801f-2b398e058557","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 2
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 2
skip_reasons:
  disabled: 2
