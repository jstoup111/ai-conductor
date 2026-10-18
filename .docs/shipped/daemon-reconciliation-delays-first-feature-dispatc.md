---
slug: daemon-reconciliation-delays-first-feature-dispatc
spec_hash: 9c6295c4f7fb24976d9610c13c65e78cd9832b7fe4421a87ade16aaaad5760f1
pr: https://github.com/jstoup111/ai-conductor/pull/3246
shipped: 2026-10-18
engine_version: 20261018T130307Z-2917a81aaac0
---

## Cost
input: 10471587
output: 1089035
cache_read: 188103686
cache_creation: 6687123
cost_usd: 150.0993
dispatches: 205
retries: 23
halts: 22
unmetered: count: 3, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 10471035, output: 713504, cache_read: 172011136, cache_creation: 0, cost_usd: 85.8709, dispatches: 104, cost_unmetered: 0
  claude: input: 552, output: 375531, cache_read: 16092550, cache_creation: 6687123, cost_usd: 64.2283, dispatches: 101, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","df614bec-644d-46ef-ab1e-468f2de5f0a6","lifecycle-step","finish"]

## Build Review
laps_to_pass: 30
skipped: 3
cache_hits: 9
infrastructure_failures: 16
rubrics:
  eventSpine: failures: 12, judged: 12
  implementationQuality: failures: 24, judged: 24
  security: failures: 0, judged: 32
  testQuality: failures: 6, judged: 32
skip_reasons:
  disabled: 3


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

Accepted findings: 3

- Finding: `sha256:04d92ff198bc0487da97794f37532358af61c954dfaf9f2394c96f4e969c7137` — rubric: implementationQuality
- Finding: `sha256:76f3bfb788250eb54c7a46d61f7d8ae648730e9b9e06892f064e0f7791ed4a09` — rubric: implementationQuality
- Finding: `sha256:fd3e7cf47eee6b183bf8ee0d4095cf969d4a949224adcaa8658dc87a4493a034` — rubric: implementationQuality

Details are retained in the feature's local build-review disposition store.
<!-- build-review-accepted-risk:end -->