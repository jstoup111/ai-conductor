---
slug: custom-build-review-rubrics-cannot-run-off-linux-o
spec_hash: c346722f505a8b4424733b9134dd11e1c4388d8461d0166390826ae752c400c3
pr: https://github.com/jstoup111/ai-conductor/pull/2747
shipped: 2026-09-26
engine_version: 20260926T130155Z-4676e13f10c4
---

## Cost
input: 5390889
output: 1059338
cache_read: 147430749
cache_creation: 3941729
cost_usd: 182.5466
dispatches: 112
retries: 16
halts: 16
unmetered: count: 3, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 5389979, output: 521593, cache_read: 115613184, cache_creation: 0, cost_usd: 56.1009, dispatches: 62, cost_unmetered: 0
  claude: input: 910, output: 537745, cache_read: 31817565, cache_creation: 3941729, cost_usd: 126.4457, dispatches: 50, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","958283c7-c717-4f4a-933c-313bed3fea4a","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 1, judged: 10
  testQuality: failures: 0, judged: 10
skip_reasons:
