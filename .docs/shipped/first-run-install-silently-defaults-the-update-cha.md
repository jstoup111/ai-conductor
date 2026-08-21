---
slug: first-run-install-silently-defaults-the-update-cha
spec_hash: 49fc9e0a431881cc1c3377869c1b8aab7878e0d970a17df4b3895a04df2af1da
pr: https://github.com/jstoup111/ai-conductor/pull/1720
shipped: 2026-08-21
engine_version: 20260821T132822Z-7fd289457471
---

## Cost
input: 1019953
output: 174718
cache_read: 27623070
cache_creation: 996698
cost_usd: 17.6566
dispatches: 45
retries: 14
halts: 10
unmetered: count: 11, duration_ms: 0
cost_unmetered: count: 14
providers:
  codex: input: 1019663, output: 65357, cache_read: 17714688, cache_creation: 0, cost_usd: 0, dispatches: 14, cost_unmetered: 14
  claude: input: 290, output: 109361, cache_read: 9908382, cache_creation: 996698, cost_usd: 17.6566, dispatches: 24, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:wiring_check,step:build_review,step:finish

## Build Review
laps_to_pass: 5
skipped: 4
cache_hits: 22
infrastructure_failures: 7
rubrics:
  completeness: failures: 3, judged: 4
  rootCause: failures: 0, judged: 11
  scope: failures: 10, judged: 11
  tautology: failures: 3, judged: 7
skip_reasons:
  disabled: 4
