---
slug: build-review-remediate-context-grows-with-the-whol
spec_hash: baa5aca95982caec476c4e3dece6dda4ffa4824fc7baa72b0b3eb183996cdd01
pr: https://github.com/jstoup111/ai-conductor/pull/3388
shipped: 2026-10-24
engine_version: 20261024T032359Z-cd0b22be83ca
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "This is an unplanned change to a validator rejection code, which shows up in operator HALT text as 'invalid remediation judgement invalid-action-effect'. It keeps malformed ids out of the new index-only/absent classification, so it serves the story 2/3 intent. It affects only already-invalid judgements and changes nothing for a well-formed lap."
    accepted: false
    authority: engine
  - gate: architecture_review_as_built
    finding: "as-built:e34b7f45-090f-4e05-9a5f-2574a217cbe0:1"
    class: REMEDIABLE
    governing_clause: "Task 3"
    outcome: remediated
    summary: "Verified, 98% confidence: src/conductor/src/engine/build-review-adjudication-coordinator.ts:777 assembles selected bodies before settled-source exclusion at :806, and :779 returns immediately on overflow. A settled finding matching 129 tasks can therefore exceed the 128-body limit before an otherwise bounded live context is assembled—or before an all-settled lap finalizes. This also violates approved mixed-laps ADR D5's reduced-source/finalization requirement. The later fresh and expansion assemblies correctly use dispatchSources."
---

## Cost
input: 1342315
output: 113431
cache_read: 19471143
cache_creation: 535082
cost_usd: 16.7549
dispatches: 26
retries: 4
halts: 0
unmetered: count: 2, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1342245, output: 78994, cache_read: 17666688, cache_creation: 0, cost_usd: 11.4243, dispatches: 18, cost_unmetered: 0
  claude: input: 70, output: 34437, cache_read: 1804455, cache_creation: 535082, cost_usd: 5.3306, dispatches: 8, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","c536f130-93bf-4648-97da-23800fe96570","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 2
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 2
skip_reasons:
  disabled: 2
