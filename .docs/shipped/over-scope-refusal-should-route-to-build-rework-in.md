---
slug: over-scope-refusal-should-route-to-build-rework-in
spec_hash: 5a35bb545192b279410a0e5f59f238c1d80244d072899e7de4866f10a99f6646
pr: https://github.com/jstoup111/ai-conductor/pull/3010
shipped: 2026-10-07
engine_version: 20261007T111857Z-63892f4676f7
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "This is an unplanned change to an unrelated test fixture, likely adjusting to configured provider state. It touches only test code and changes no shipped behavior."
    accepted: false
    authority: engine
  - gate: architecture_review_as_built
    finding: AB-1
    class: REMEDIABLE
    governing_clause: "adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework decision 2"
    outcome: remediated
    summary: "Verified, 100% confidence: src/conductor/src/engine/prd-widening-refusal-rework.ts:83 omits caseId from rendered NC refusal evidence, although the evidence object contains it. Both SHIP shapes therefore dispatch without the required durable case identity."
  - gate: architecture_review_as_built
    finding: AB-2
    class: REMEDIABLE
    governing_clause: "adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework decision 6"
    outcome: remediated
    summary: "Verified source, 99% confidence: grouped exhausted/unavailable remediation still bypasses the refused HALT helper. Guards at src/conductor/src/engine/conductor.ts:9688, :9862 and :10005 exclude planning; the manual-test fallback at :9983 and generic fallback at :10160–10168 do not preserve the serial refused over-scope result. Planner exception/rejection handling is repaired, but this prior finding remains."
  - gate: architecture_review_as_built
    finding: AB-3
    class: REMEDIABLE
    governing_clause: "adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework decision 5"
    outcome: remediated
    summary: "Verified source, 99% confidence: durable allowance checking is repaired only for serial routing at src/conductor/src/engine/conductor.ts:12267. Grouped planner calls at :9611, :9704, :9884 and :10059 still reach dispatch at :5041 before budget reading at :5582 and append at :5613. Spent or malformed durable allowance can therefore dispatch remediation instead of producing the admission-time refused HALT. The configuration-only guard at :9688 also ignores a raised durable allowance."
  - gate: architecture_review_as_built
    finding: AB-4
    class: REMEDIABLE
    governing_clause: "adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework decision 5"
    outcome: remediated
    summary: "Verified, 100% confidence: src/conductor/src/engine/conductor.ts:5163 resolves receipt criteria only through the FIXABLE map populated at :5180. Refusal gap IDs therefore lose their presentation keys at :5676. The BUILD growth-overflow formatter at :10266 consequently lists only FIXABLE criteria or task IDs, rather than every refused key."
  - gate: architecture_review_as_built
    finding: AB-5
    class: REMEDIABLE
    governing_clause: "adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework decision 4"
    outcome: remediated
    summary: "Verified source, 99% confidence: src/conductor/src/engine/remediation-append.ts:203 compares titles after deriving the decision-bound ID. At :213 it allocates an ordinal suffix when the planner rewords the same decision's task, so recurrence duplicates work instead of upserting by durable identity."
  - gate: architecture_review_as_built
    finding: AB-6
    class: REMEDIABLE
    governing_clause: "adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework decision 4"
    outcome: remediated
    summary: "Verified source, 99% confidence: idempotent refusal recurrence consumes growth again. src/conductor/src/engine/conductor.ts:5296 counts all requested tasks, :5550 passes that count unchanged, and :5669 charges it in a fresh receipt. src/conductor/src/engine/remediation-append.ts:204 returns existing IDs for no-op appends, so this path charges growth despite adding no task."
  - gate: architecture_review_as_built
    finding: AB-7
    class: REMEDIABLE
    governing_clause: "adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework decision 4"
    outcome: remediated
    summary: "Verified source, 99% confidence: the AB-5 repair introduces a multi-task regression. src/conductor/src/engine/remediation-append.ts:198 assigns every task within a refusal gap the same canonical ID; after :243 records the first task, the new branch at :204–209 skips all subsequent tasks, losing their work. Meanwhile conductor.ts:5334, :5588 and :5705 charge growth for every requested task. A two-task refusal therefore appends one task and charges two. This finding concerns newly changed code."
---

## Cost
input: 2466263
output: 251621
cache_read: 48831925
cache_creation: 1323857
cost_usd: 33.733
dispatches: 84
retries: 16
halts: 28
unmetered: count: 25, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2466065, output: 170283, cache_read: 41986432, cache_creation: 0, cost_usd: 21.6843, dispatches: 38, cost_unmetered: 0
  claude: input: 198, output: 81338, cache_read: 6845493, cache_creation: 1323857, cost_usd: 12.0486, dispatches: 21, cost_unmetered: 0
  pi: input: 0, output: 0, cache_read: 0, cache_creation: 0, cost_usd: 0, dispatches: 25, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","3c6d2a1a-c5f3-4884-96ee-2259d9e3eebe","lifecycle-step","finish"],step:execution\u0000["timing-rollup","persisted-ledger","8912aa53-3a93-4c39-84c6-3c82e9ba0540","lifecycle-step","test_suite"]

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 2
rubrics:
  eventSpine: failures: 0, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 2
skip_reasons:
