---
slug: routed-repair-hosts-a-finding-on-a-stack-child-tha
spec_hash: 36b86c4588e3acd4109ccb06e18c28290cc5d87b3524c84c0529077111d32fc1
pr: https://github.com/jstoup111/ai-conductor/pull/3567
shipped: 2026-11-01
engine_version: 20261101T162011Z-b317a8dbaaa5
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "The helper rewrite appears to preserve behavior at the three existing sites. The per-attempt record goes beyond the plan, which needed only an unsuccessful attempt carrying the settlement detail. The effects are limited to internal outcome records: a duplicate on the exhausted attempt, and a null gate that can miss a no-op comparison when a rejected claim is the latest record. No stated story outcome changes, and the operator-facing halt and event flow are not altered by it."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-2
    summary: "This changes where test fixtures put temporary files and is unrelated to routed-repair hosting. It does not touch production behavior or anything a user sees."
    accepted: false
    authority: engine
---

## Cost
input: 3778415
output: 360035
cache_read: 62165906
cache_creation: 1713150
cost_usd: 47.7193
dispatches: 74
retries: 12
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 9
providers:
  codex: input: 3778203, output: 203655, cache_read: 55020160, cache_creation: 0, cost_usd: 29.4565, dispatches: 48, cost_unmetered: 9
  claude: input: 212, output: 156380, cache_read: 7145746, cache_creation: 1713150, cost_usd: 18.2628, dispatches: 26, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","754906bf-ea8a-485f-8928-0ee5cc4e7cba","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 6
  implementationQuality: failures: 1, judged: 6
  security: failures: 0, judged: 6
  testQuality: failures: 1, judged: 6
skip_reasons:
