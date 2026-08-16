---
slug: harden-intake-ledger-durability
spec_hash: 2adcaabbc959973a2b7d33f94c7a0a2548f821f5205c191f50041ac3f29d63a9
pr: https://github.com/jstoup111/ai-conductor/pull/1541
shipped: 2026-08-16
engine_version: 20260816T141732Z-93e58a198b6a
---

## Cost
input: 92051779
output: 409725
cache_read: 98273116
cache_creation: 1137838
cost_usd: 19.9001
dispatches: 69
retries: 14
halts: 8
unmetered: count: 16, duration_ms: 0
cost_unmetered: count: 41
providers:
  codex: input: 92051575, output: 314490, cache_read: 87700992, cache_creation: 0, cost_usd: 0, dispatches: 41, cost_unmetered: 41
  claude: input: 204, output: 95235, cache_read: 10572124, cache_creation: 1137838, cost_usd: 19.9001, dispatches: 18, cost_unmetered: 0

## Time
state: partial

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 34
infrastructure_failures: 0
rubrics:
  completeness: failures: 0, judged: 12
  rootCause: failures: 7, judged: 12
  scope: failures: 0, judged: 12
  tautology: failures: 4, judged: 12
skip_reasons:


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

Accepted findings: 1

- Finding: `sha256:9d6718f780cea08fd1ab24b32652dba08e4b1b9f2c882cfb74efc1a085380039` — rubric: rootCause

Details are retained in the feature's local build-review disposition store.
<!-- build-review-accepted-risk:end -->