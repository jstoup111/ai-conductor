---
slug: gate-satisfied-without-dispatch-leaves-no-state-ke
spec_hash: 34b2b7fc18814eac64d928266265281d7c9b320646ad29c010d8e0e5c5eb649f
pr: https://github.com/jstoup111/ai-conductor/pull/2573
shipped: 2026-09-16
engine_version: 20260916T053126Z-6252aaa60558
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "src/conductor/test/acceptance/unattended-finish-publication.acceptance.test.ts:6 — a `Covers: S2.1` annotation added to a foreign feature's acceptance file, which declares `Stories: .docs/stories/unattended-finish-spends-minutes-before-determinis.md`"
    accepted: true
---

## Cost
input: 622919
output: 75447
cache_read: 15890561
cache_creation: 358089
cost_usd: 12.348
dispatches: 10
retries: 0
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 622877, output: 48029, cache_read: 13009408, cache_creation: 0, cost_usd: 5.5818, dispatches: 7, cost_unmetered: 0
  claude: input: 42, output: 27418, cache_read: 2881153, cache_creation: 358089, cost_usd: 6.7662, dispatches: 3, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 1
skip_reasons:
