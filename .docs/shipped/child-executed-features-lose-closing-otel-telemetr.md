---
slug: child-executed-features-lose-closing-otel-telemetr
spec_hash: 1a7bdbb70cac1021ebef55e507c244b6348da9e91d39b560a9a3c171e32c9daa
pr: https://github.com/jstoup111/ai-conductor/pull/3690
shipped: 2026-11-22
engine_version: 20261122T004707Z-42ca887c19f7
---

## Cost
input: 3356698
output: 279330
cache_read: 38225583
cache_creation: 2282474
cost_usd: 49.0884
dispatches: 92
retries: 12
halts: 12
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 3356400, output: 167111, cache_read: 31332608, cache_creation: 0, cost_usd: 27.2045, dispatches: 51, cost_unmetered: 0
  claude: input: 298, output: 112219, cache_read: 6892975, cache_creation: 2282474, cost_usd: 21.884, dispatches: 41, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","6a73a66c-f976-43eb-99b8-5823579453b7","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 11
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 6
  implementationQuality: failures: 5, judged: 6
  security: failures: 0, judged: 6
  testQuality: failures: 0, judged: 6
skip_reasons:
  paths-unmatched: 7
  scope-empty: 4


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

Accepted findings: 0


- Operator-resolved case: `3018e83d-67e6-4176-b3a0-d6f8eadbc9e8` — source ids: `implementationQuality:sha256:fac01cd2dca1ae8983d50ad97d8ed7fe6114e276ebf6797875bcf770f4088eeb`, `implementationQuality:sha256:10bcb84748574b5ccec72566d86a17f192ddb8930216f076139b2b419ad7a084`, `implementationQuality:sha256:89646a3b78efd23603a79221f8db402ea6d900ffabe5ca35229b678d2fb17660`
- Operator-resolved case: `c43d1fbc-0fee-4172-b7d1-a448b6e20dc5` — source ids: `implementationQuality:sha256:2eca8cc292205d2211d1e8f7d5747928b03673db5a3b0508240d8116e71b87c8`, `implementationQuality:sha256:50a46135e2f51ea3564486e44ca083821d4729304ea1f002a5575f644013359c`

Details are retained in the feature's local build-review disposition store.
<!-- build-review-accepted-risk:end -->