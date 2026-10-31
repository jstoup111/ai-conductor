---
slug: as-built-review-re-raises-reworded-findings-as-new
spec_hash: cfef5080ac3c42b202a76fc92e7ce308cc721d2ac05f717e23c3da8563cc121e
pr: https://github.com/jstoup111/ai-conductor/pull/3533
shipped: 2026-10-31
engine_version: 20261031T181032Z-1677e5b98206
findings:
  - gate: architecture_review_as_built
    finding: "as-built:af950c08-9055-4390-92c1-aa00c25f5ec2:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-28-as-built-finding-reconciliation decision 6"
    outcome: remediated
    summary: "Verified, 99% confidence: DESIGN verdicts halt without recording their findings or reconciliation events at both conductor.ts:9842 (validation group) and conductor.ts:15046 (serial), under src/conductor/src/engine/. The only needs-human recording caller is planner-halt handling at conductor.ts:5218, which DESIGN verdicts bypass. Wire recording of every verdict finding before both halts."
  - gate: architecture_review_as_built
    finding: "as-built:af950c08-9055-4390-92c1-aa00c25f5ec2:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-28-as-built-finding-reconciliation decision 6"
    outcome: remediated
    summary: "Verified, 99% confidence: src/conductor/src/engine/conductor.ts:1353 resolves cases only for literal APPROVED, leaving them open after APPROVED WITH DRIFT NOTES or delivered PLAN_GAP, both successful gate outcomes. The early return at :1343 also skips settlement whenever pending findings are empty. Resolve durable open cases on every authoritative gate pass independently of pending-context presence. These omissions also contradict the approved diagram's gate-pass edge."
  - gate: architecture_review_as_built
    finding: "as-built:af950c08-9055-4390-92c1-aa00c25f5ec2:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-28-as-built-finding-reconciliation decision 7"
    outcome: remediated
    summary: "Verified, 99% confidence: src/conductor/src/engine/conductor.ts:4188 builds the next as-built projection without draining the case-store outbox; remediation-projection.ts:427 reads the store without delivery. Drains occur only later during recording or settlement. After a crash, projection failure or rejected planning can leave recorded events undelivered. Drain through emitOrThrow before the next as-built projection."
  - gate: architecture_review_as_built
    finding: "as-built:af950c08-9055-4390-92c1-aa00c25f5ec2:4"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-28-as-built-finding-reconciliation decision 6"
    outcome: remediated
    summary: "Verified, 98% confidence: a mixed append-and-halt plan can successfully append at src/conductor/src/engine/conductor.ts:4922, then record only halt dispositions and return at :5208–5224. This bypasses reconciliation at :5406–5428 for successfully appended findings, losing their durable sources and events. Preserve recording for successful appends when a sibling disposition halts."
  - gate: architecture_review_as_built
    finding: "as-built:b047f951-e3c6-481e-b5d8-6663f2eafc54:1"
    class: REMEDIABLE
    governing_clause: "Task 12"
    outcome: remediated
    summary: "Verified, 99% confidence: new terminal recording calls at src/conductor/src/engine/conductor.ts:9897 and :15119 also run after rejected or missing gap plans return kind 'none' at :4341. They create needs-human cases and reconciliation events despite task 12 requiring no recording for those rounds. Restrict fallback recording to DESIGN verdicts; preserve explicit planner-halt recording. Both violating sites were introduced by the prior-finding repair."
  - gate: architecture_review_as_built
    finding: "as-built:b047f951-e3c6-481e-b5d8-6663f2eafc54:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-28-as-built-finding-reconciliation decision 6"
    outcome: remediated
    summary: "Verified, 99% confidence: the new mixed-halt recording at src/conductor/src/engine/conductor.ts:5268–5277 includes existing-task bindings merely resolved at :4737. The branch returns before admitAndRestageRepair at :5419, yet records their sources/events and can reopen or increment cases. D6 requires successful append or binding before recording. Preserve successful append recording while excluding bindings whose admission/restage has not succeeded."
---

## Cost
input: 5131857
output: 469941
cache_read: 98838230
cache_creation: 3735050
cost_usd: 81.4362
dispatches: 104
retries: 10
halts: 7
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 18
providers:
  codex: input: 5131483, output: 267659, cache_read: 77724416, cache_creation: 0, cost_usd: 43.2859, dispatches: 63, cost_unmetered: 18
  claude: input: 374, output: 202282, cache_read: 21113814, cache_creation: 3735050, cost_usd: 38.1503, dispatches: 41, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","25e070e7-9144-4b8f-b087-8c6c2aef0a4f","lifecycle-step","finish"]

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 8
  implementationQuality: failures: 3, judged: 8
  security: failures: 0, judged: 8
  testQuality: failures: 2, judged: 8
skip_reasons:


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

Accepted findings: 0


- Operator-resolved case: `69ce335b-ff87-49f2-9309-ebc01db683de` — source ids: `testQuality:sha256:c2d9a7df9e116c5742429bdb062d00ae7694e1168b1221f6c984329bddb97702`

Details are retained in the feature's local build-review disposition store.
<!-- build-review-accepted-risk:end -->