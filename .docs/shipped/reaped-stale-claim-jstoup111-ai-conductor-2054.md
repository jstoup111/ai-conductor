---
slug: reaped-stale-claim-jstoup111-ai-conductor-2054
spec_hash: 56264893b28d70deae078e5b3db1a712cb1c93271f44a5560703ba3d5344693f
pr: https://github.com/jstoup111/ai-conductor/pull/2133
shipped: 2026-09-02
engine_version: 20260902T161129Z-9f7f57c27ee1
findings:
  - gate: architecture_review_as_built
    finding: AB-1
    class: REMEDIABLE
    governing_clause: "adr-2026-09-02-adr-decision-citability-contract decision 2"
    outcome: remediated
    summary: "[100% verified] The shared parser narrows the pre-change AB-R12 grammar, violating the required backwards-compatible superset."
---

## Cost
input: 1195821
output: 167044
cache_read: 28971926
cache_creation: 740273
cost_usd: 25.0326
dispatches: 24
retries: 2
halts: 1
unmetered: count: 5, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1195571, output: 82821, cache_read: 17528192, cache_creation: 0, cost_usd: 9.8012, dispatches: 12, cost_unmetered: 0
  claude: input: 250, output: 84223, cache_read: 11443734, cache_creation: 740273, cost_usd: 15.2314, dispatches: 7, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:build,step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 2
skip_reasons:
