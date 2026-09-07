---
slug: clamp-resume-entry-to-a-runnable-step-and-halt-whe
spec_hash: 3b66d8e667a858ac2879ec7d0656eade9f775f3650b7ea934044a2da67d4952b
pr: https://github.com/jstoup111/ai-conductor/pull/2385
shipped: 2026-09-07
engine_version: 20260907T010722Z-eea91ff29185
---

## Cost
input: 1113095
output: 151400
cache_read: 25705069
cache_creation: 882882
cost_usd: 23.8481
dispatches: 42
retries: 2
halts: 2
unmetered: count: 12, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1112937, output: 82310, cache_read: 18855808, cache_creation: 0, cost_usd: 9.3153, dispatches: 20, cost_unmetered: 0
  claude: input: 158, output: 69090, cache_read: 6849261, cache_creation: 882882, cost_usd: 14.5327, dispatches: 10, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:finish

## Build Review
laps_to_pass: 3
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 2, judged: 5
skip_reasons:
