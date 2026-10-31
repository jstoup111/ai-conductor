---
slug: operator-command-to-inspect-and-recover-wedged-rou
spec_hash: 7bccd72681acb12b22b69692cb6f52113c67fbbbfc7bc84d930b7ab94bcf2377
pr: https://github.com/jstoup111/ai-conductor/pull/3542
shipped: 2026-10-31
engine_version: 20261031T004009Z-fa5d3fe03904
findings:
  - gate: architecture_review_as_built
    finding: "as-built:4aa40d7c-a46b-4b43-b538-e461b4228322:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-12-routed-whole-feature-repair decision 6"
    outcome: remediated
    summary: "99% confidence, source-verified: concurrent closes can close the sole remaining round without leaf return. stack-rounds-cli.ts:340 checks survival before the lease; :346 passes the stale result to the writer; :75 CAS-checks only the target record. Two commands can each check r4/r5 as the other's survivor, then acquire the lease sequentially and successfully close both. D6 requires another round to stay non-closed. Preserve preliminary refusals and revalidate survival under the lease or atomically verify the surviving ref."
  - gate: architecture_review_as_built
    finding: "as-built:4aa40d7c-a46b-4b43-b538-e461b4228322:2"
    class: REMEDIABLE
    governing_clause: "Task 2"
    outcome: remediated
    summary: "99% confidence, verified repository reference search: dispatchStackRoundsIfDetected at src/conductor/src/cli.ts:522 has no production caller. Its only invocation is test/cli/stack-rounds-detect.test.ts:48; index.ts:998-1000 bypasses it with direct detector and dispatcher calls. Connect this helper to the production CLI entry so its rejected-vector proof exercises the shipped path."
  - gate: architecture_review_as_built
    finding: "as-built:eb8e91aa-f041-49be-a9d8-7f09450add88:1"
    class: REMEDIABLE
    governing_clause: "Task 2"
    outcome: remediated
    summary: "99% confidence, source-verified: prior reachability finding remains unresolved. dispatchStackRoundsIfDetected at src/conductor/src/cli.ts:522 has no production caller; production-source search finds only its definition. src/conductor/src/index.ts:998-1000 bypasses it with direct detector/dispatcher calls, while test/cli/stack-rounds-detect.test.ts:48 exercises only the helper. HEAD commit 5bbe6c6d12 removed the production wiring and dispatcher-spied entry test. Restore the production helper path and its rejected-vector entry proof as already required by task 2 and the existing remediation tasks."
---

## Cost
input: 3570313
output: 276678
cache_read: 57650994
cache_creation: 1361190
cost_usd: 39.1978
dispatches: 64
retries: 6
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 12
providers:
  codex: input: 3570115, output: 174126, cache_read: 49473920, cache_creation: 0, cost_usd: 24.621, dispatches: 43, cost_unmetered: 12
  claude: input: 198, output: 102552, cache_read: 8177074, cache_creation: 1361190, cost_usd: 14.5768, dispatches: 21, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","151e9761-9c7f-4c41-b9b0-aa759e7f51c8","lifecycle-step","finish"]

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 6
  implementationQuality: failures: 1, judged: 6
  security: failures: 0, judged: 6
  testQuality: failures: 1, judged: 6
skip_reasons:
