---
slug: link-intake-depends-on-with-a-typed-issue-id
spec_hash: cdf8bc2569c618d6096c6cff1b0acf81f9b3ec5e6e0a26c1b51fd48332e84beb
pr: https://github.com/jstoup111/ai-conductor/pull/2831
shipped: 2026-09-29
engine_version: 20260929T224340Z-3ed99833a1db
---

## Cost
input: 2114291
output: 163342
cache_read: 26597788
cache_creation: 580279
cost_usd: 22.6846
dispatches: 34
retries: 3
halts: 3
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2114151, output: 121788, cache_read: 23739008, cache_creation: 0, cost_usd: 16.8213, dispatches: 18, cost_unmetered: 0
  claude: input: 140, output: 41554, cache_read: 2858780, cache_creation: 580279, cost_usd: 5.8633, dispatches: 16, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","55b74d4f-25f2-4f27-90f8-201b7a406262","lifecycle-step","architecture_review_as_built"],step:execution\u0000["timing-rollup","persisted-ledger","8b69ad15-1a7d-4728-a59f-e232f953a732","lifecycle-step","prd_audit"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 3
  security: failures: 0, judged: 3
  testQuality: failures: 0, judged: 3
skip_reasons:
