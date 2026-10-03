---
slug: a-trace-cannot-be-tied-to-the-commit-pr-or-issue-t
spec_hash: 09ca516cf1749fa7d89a6f0bc2d7a244a7c1b73827ef3a661cc5ca066937e5de
pr: https://github.com/jstoup111/ai-conductor/pull/2937
shipped: 2026-10-03
engine_version: 20261003T122408Z-086e998df5dd
findings:
  - gate: architecture_review_as_built
    finding: AB-1
    class: REMEDIABLE
    governing_clause: "Task 7"
    outcome: remediated
    summary: "Verified (99% confidence): daemon-backlog.ts:1111-1181 supplies item.sourceRef, but daemon-cli.ts:1314-1323 omits it from wireOtelVisualizer. Daemon traces therefore cannot export conductor.source.ref; only the foreground path is wired."
  - gate: architecture_review_as_built
    finding: AB-2
    class: REMEDIABLE
    governing_clause: "adr-014-otel-observability-exporter decision 19"
    outcome: remediated
    summary: "Verified (98% confidence): conductor.ts:6131-6139 derives loop_halt PR provenance only from its transient prUrl argument and ignores haltState.pr_url. A halt after the SHIP draft PR is stored can therefore omit prUrl and report unrecorded instead of opened."
---

## Cost
input: 1744564
output: 182982
cache_read: 34631766
cache_creation: 784153
cost_usd: 23.8735
dispatches: 37
retries: 2
halts: 4
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1744404, output: 116015, cache_read: 30368384, cache_creation: 0, cost_usd: 14.1344, dispatches: 22, cost_unmetered: 0
  claude: input: 160, output: 66967, cache_read: 4263382, cache_creation: 784153, cost_usd: 9.7391, dispatches: 15, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","2f8a5cc0-d205-47e2-9c47-745f80b004a9","lifecycle-step","finish"]

## Build Review
laps_to_pass: 4
skipped: 0
cache_hits: 5
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 5
  security: failures: 0, judged: 5
  testQuality: failures: 4, judged: 5
skip_reasons:
