---
slug: build-review-rubric-findings-arrive-as-typed-struc
spec_hash: 5b231ce7288cca1293f3bc43bd93f651a8898b552f3b056925e53cd9cd578a0f
pr: https://github.com/jstoup111/ai-conductor/pull/2660
shipped: 2026-09-23
engine_version: 20260923T174345Z-bac5a548b9cc
findings:
  - gate: architecture_review_as_built
    finding: AB-1
    class: REMEDIABLE
    governing_clause: "Task 3"
    outcome: remediated
    summary: "The introduced custom-v1 projection builder has no production invocation. Confidence 99%, verified from the current production caller graph."
  - gate: architecture_review_as_built
    finding: AB-2
    class: REMEDIABLE
    governing_clause: "adr-2026-08-13-engine-managed-build-review-rubric-branches D2.2"
    outcome: remediated
    summary: "Built-in projection/cache versions still read duplicate registry fields instead of the rubric contract descriptor. Confidence 99%, verified from current source."
  - gate: architecture_review_as_built
    finding: AB-3
    class: REMEDIABLE
    governing_clause: "adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane D2.2"
    outcome: remediated
    summary: "Provider adapters turn absent or malformed terminal structured output into generic invocation failure before build_review can classify it as invalid-structured-result. Confidence 99%, verified from both adapter paths."
  - gate: architecture_review_as_built
    finding: AB-4
    class: REMEDIABLE
    governing_clause: "Task 11"
    outcome: remediated
    summary: "Custom root/parser/source-region failures bypass the field-named diagnosis and invalid-structured-result lane, while unsupported-policy is converted to infrastructure failure instead of remaining the explicit branch result. Confidence 99%, verified from current source and sealed criteria."
  - gate: architecture_review_as_built
    finding: AB-5
    class: REMEDIABLE
    governing_clause: "Task 10"
    outcome: remediated
    summary: "The existing event type admits cause/rejection, but its production emitter drops both, so the typed mechanical-fault evidence never reaches the event spine. Confidence 99%, verified from current source and producer search."
---

## Cost
input: 3607024
output: 488906
cache_read: 114226668
cache_creation: 1913112
cost_usd: 81.2342
dispatches: 66
retries: 5
halts: 6
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 3606628, output: 311832, cache_read: 101211776, cache_creation: 0, cost_usd: 40.0695, dispatches: 40, cost_unmetered: 0
  claude: input: 396, output: 177074, cache_read: 13014892, cache_creation: 1913112, cost_usd: 41.1647, dispatches: 26, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","6970b2fa-516b-4abb-b9ba-b265e22a23a4","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 6
  testQuality: failures: 0, judged: 6
skip_reasons:
