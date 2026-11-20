---
slug: pi-upstream-model-not-found-under-an-explicit-prov
spec_hash: db4177f200b3499cfec48221572cb7670ac7e97bd97a29a2169f162f86ab8125
pr: https://github.com/jstoup111/ai-conductor/pull/3711
shipped: 2026-11-20
engine_version: 20261118T023224Z-cfa8d246f3c8
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "This reformatting is outside the planned tasks. It changes no operator-visible output, CLI result, or persisted state; the only cost is a larger review diff and possible merge-conflict surface."
    accepted: false
    authority: engine
---

## Cost
input: 1400057
output: 90687
cache_read: 15246184
cache_creation: 665074
cost_usd: 12.9114
dispatches: 37
retries: 2
halts: 3
unmetered: count: 1, duration_ms: 0
cost_unmetered: count: 4
providers:
  codex: input: 1399959, output: 63355, cache_read: 13380864, cache_creation: 0, cost_usd: 6.6708, dispatches: 24, cost_unmetered: 4
  claude: input: 98, output: 27332, cache_read: 1865320, cache_creation: 665074, cost_usd: 6.2407, dispatches: 13, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","881b3510-04a7-4e89-949a-f1f08a898dc6","lifecycle-step","finish"]

## Build Review
laps_to_pass: 4
skipped: 5
cache_hits: 3
infrastructure_failures: 1
rubrics:
  eventSpine: failures: 0, judged: 5
  implementationQuality: failures: 3, judged: 4
  security: failures: 0, judged: 5
  testQuality: failures: 0, judged: 5
skip_reasons:
  paths-unmatched: 5


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

Accepted findings: 0


- Operator-resolved case: `bd687f1f-6852-419c-b7f2-665fd6722e53` — source ids: `implementationQuality:sha256:8fec2a90dcea9550a6daae477169798086d274695697e9ccb6deaba09f805e4c`, `implementationQuality:sha256:3ffbd704139d027da07b0b6e50a91e2fdeabe97860568a917af13605bae86c2e`

Details are retained in the feature's local build-review disposition store.
<!-- build-review-accepted-risk:end -->