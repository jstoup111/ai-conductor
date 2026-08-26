---
slug: every-as-built-blocked-verdict-halts-needs-human-i
spec_hash: 7d474cbb62c8e3ada4fb41196a6ff483d86107bc1f693e9de82618a7c8dd9716
pr: https://github.com/jstoup111/ai-conductor/pull/1908
shipped: 2026-08-26
engine_version: 20260826T032530Z-e77b20b881a4
---

## Cost
input: 6487269
output: 1032002
cache_read: 235509178
cache_creation: 3542606
cost_usd: 164.818
dispatches: 80
retries: 3
halts: 12
unmetered: count: 20, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 6485575, output: 493553, cache_read: 151201280, cache_creation: 0, cost_usd: 73.7683, dispatches: 29, cost_unmetered: 0
  claude: input: 1694, output: 538449, cache_read: 84307898, cache_creation: 3542606, cost_usd: 91.0497, dispatches: 31, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,parallel:wiring_check

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 1
rubrics:
  testQuality: failures: 1, judged: 6
skip_reasons:
