---
slug: build-review-re-raises-already-decided-findings-ev
spec_hash: 73b8adf8db1143942ae06a1092fc37afb1ef57b00e0db33f04fee73273727692
pr: https://github.com/jstoup111/ai-conductor/pull/3414
shipped: 2026-10-28
engine_version: 20261027T031452Z-97f09b9bd067
---

## Cost
input: 9972140
output: 1202865
cache_read: 247890106
cache_creation: 8706418
cost_usd: 196.9673
dispatches: 165
retries: 16
halts: 19
unmetered: count: 8, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 9971090, output: 715449, cache_read: 192526720, cache_creation: 0, cost_usd: 106.4907, dispatches: 104, cost_unmetered: 0
  claude: input: 1050, output: 487416, cache_read: 55363386, cache_creation: 8706418, cost_usd: 90.4765, dispatches: 61, cost_unmetered: 0

## Time
state: partial
reason: active-evidence-incomplete

## Build Review
laps_to_pass: 1
skipped: 30
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 18
  security: failures: 0, judged: 8
  testQuality: failures: 0, judged: 16
skip_reasons:
  disabled: 18
  leaf-only: 10
  test_quality_empty_scope: 2
