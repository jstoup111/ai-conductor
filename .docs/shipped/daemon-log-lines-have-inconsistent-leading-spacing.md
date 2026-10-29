---
slug: daemon-log-lines-have-inconsistent-leading-spacing
spec_hash: 6cb73d2b7dbd4d02b45cecd8d6f09101017385ad34fc218c3d2faafe374f07fa
pr: https://github.com/jstoup111/ai-conductor/pull/3536
shipped: 2026-10-29
engine_version: 20261029T135834Z-54bb2b838304
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "This test-hygiene change stops the provider test from creating a directory in the operator's real /tmp, which a leak guard would catch. It sits outside this feature's intent of consistent daemon log line shape. It touches only test code, so it is not user-visible."
    accepted: false
    authority: engine
  - gate: architecture_review_as_built
    finding: "as-built:6f7a6017-158f-498a-a0e7-9bbf644db75b:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-07-04-kickback-event-emission-and-log-prominence decision 1"
    outcome: remediated
    summary: "Verified (99%): D1 requires prefix-free `↩ KICKBACK...` output. daemon-line-shape.ts:26 assigns kickback depth 1, and daemon-cli.ts:3556 adds `· ` to its output. Changed expectations encode this violation at test/engine/daemon-render.test.ts:272, :278, :284, :636 and test/engine/daemon-mode-feature-log.integration.test.ts:122 (all beneath src/conductor/). The approved kickback diagram corroborates D1."
---

## Cost
input: 954990
output: 75063
cache_read: 15601341
cache_creation: 323425
cost_usd: 10.6711
dispatches: 21
retries: 1
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 4
providers:
  codex: input: 954908, output: 48757, cache_read: 13932928, cache_creation: 0, cost_usd: 7.2236, dispatches: 13, cost_unmetered: 4
  claude: input: 82, output: 26306, cache_read: 1668413, cache_creation: 323425, cost_usd: 3.4475, dispatches: 8, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","523fa539-7180-4d1b-a6eb-d45d83293be4","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 2
  implementationQuality: failures: 0, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 2
skip_reasons:
