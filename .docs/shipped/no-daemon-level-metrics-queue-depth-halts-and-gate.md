---
slug: no-daemon-level-metrics-queue-depth-halts-and-gate
spec_hash: 0c6b283e23ddadd23244fde41894728127b75b3141eb4807e8e2e5bd6f8fcf54
pr: https://github.com/jstoup111/ai-conductor/pull/2423
shipped: 2026-09-09
engine_version: 20260907T120758Z-4f8bdec36946
---

## Cost
input: 5093513
output: 1232403
cache_read: 264882805
cache_creation: 5751888
cost_usd: 246.75
dispatches: 92
retries: 8
halts: 16
unmetered: count: 22, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 5092017, output: 530556, cache_read: 158262784, cache_creation: 0, cost_usd: 62.3957, dispatches: 29, cost_unmetered: 0
  claude: input: 1496, output: 701847, cache_read: 106620021, cache_creation: 5751888, cost_usd: 184.3543, dispatches: 41, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:finish

## Build Review
laps_to_pass: 4
skipped: 0
cache_hits: 0
infrastructure_failures: 1
rubrics:
  testQuality: failures: 11, judged: 12
skip_reasons:


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

Accepted findings: 1

- Finding: `sha256:fab0e4def863cd7c0224f920d3025acc922ed6a57a4137fbfe35b3c57a9f683d` — rubric: testQuality

Details are retained in the feature's local build-review disposition store.
<!-- build-review-accepted-risk:end -->