---
slug: module-layering-is-prose-only-violations-merge-wit
spec_hash: a859b292287a792876d1aa167a5bedf02305c5741d378396579d12cd45985a9d
pr: https://github.com/jstoup111/ai-conductor/pull/3424
shipped: 2026-10-26
engine_version: 20261026T015452Z-d74b2ab722ef
---

## Cost
input: 980921
output: 86767
cache_read: 17733322
cache_creation: 767523
cost_usd: 17.3585
dispatches: 20
retries: 2
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 980849, output: 53379, cache_read: 15640192, cache_creation: 0, cost_usd: 10.1317, dispatches: 13, cost_unmetered: 0
  claude: input: 72, output: 33388, cache_read: 2093130, cache_creation: 767523, cost_usd: 7.2269, dispatches: 7, cost_unmetered: 0

## Time
state: partial
reason: active-evidence-incomplete

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
