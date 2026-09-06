---
slug: enable-single-repo-daemon-concurrency-un-clamp-the
spec_hash: 6d94cc31982424aeeff6827c26ab208e8323bbe3af9ae116fe740dcbe9917ae4
pr: https://github.com/jstoup111/ai-conductor/pull/2075
shipped: 2026-09-06
engine_version: 20260905T212222Z-dbc805b66e06
---

## Cost
input: 10245519
output: 1892847
cache_read: 400189927
cache_creation: 7572903
cost_usd: 294.1325
dispatches: 137
retries: 10
halts: 23
unmetered: count: 34, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 10242689, output: 832401, cache_read: 248446592, cache_creation: 0, cost_usd: 116.0065, dispatches: 55, cost_unmetered: 0
  claude: input: 2830, output: 1060446, cache_read: 151743335, cache_creation: 7572903, cost_usd: 178.126, dispatches: 50, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit

## Build Review
laps_to_pass: 5
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 5, judged: 11
skip_reasons:
