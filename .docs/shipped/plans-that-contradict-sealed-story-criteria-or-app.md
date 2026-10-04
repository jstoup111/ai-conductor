---
slug: plans-that-contradict-sealed-story-criteria-or-app
spec_hash: 15d79bf5da99b6e9fe4e08b4280893592f550e86604ae1a3295d06fb1656ed24
pr: https://github.com/jstoup111/ai-conductor/pull/2968
shipped: 2026-10-04
engine_version: 20261004T174827Z-4925f7bb7cbf
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "src/conductor/src/engine/step-runners.ts:4609-4626,4638-4641 — amendment base lookup now fails closed (infrastructure failure) when origin ref, merge base, or a present-at-base `git show` cannot be resolved; previously an unresolvable base kept every block; tests coverage-binding-runner.test.ts:350,367"
    accepted: true
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.2
    summary: "src/conductor/src/engine/step-runners.ts:4597-4605 — a DECIDE-set amendment input that is absent on disk (ENOENT) is now skipped instead of failing the step"
    accepted: true
  - gate: architecture_review_as_built
    finding: AB-1
    class: REMEDIABLE
    governing_clause: "Task 6"
    outcome: remediated
    summary: "Verified 99%: the conflict-claim branch in planCoverageBindingBatches remains unreachable. Its only production caller passes criterion and amendment claims at step-runners.ts:4634,4752; conflict claims instead go exclusively to planConflictBatches at step-runners.ts:4915."
  - gate: architecture_review_as_built
    finding: AB-2
    class: REMEDIABLE
    governing_clause: "adr-2026-08-31-coverage-binding-judge-step decision 21"
    outcome: remediated
    summary: "Verified 99%: step-runners.ts:4618 still uses the slug/stem heuristic resolveFeatureStoriesPath instead of the plan's normalized **Stories:** reference required by D21. Subject-ADR resolution is also nested under that lookup succeeding at lines 4619-4625, so a custom-named stories artifact can suppress both story and ADR conflict claims. This is also the sole code-versus-diagram drift site."
  - gate: architecture_review_as_built
    finding: AB-4
    class: REMEDIABLE
    governing_clause: "adr-2026-08-31-coverage-binding-judge-step decision 18"
    outcome: remediated
    summary: "Verified 99%: D18 requires amendment claims to include only blocks added relative to a proven merge base. src/conductor/src/engine/step-runners.ts:4591-4594 converts unresolved origin or merge-base failures to undefined; lines 4599-4600 silently omit unreadable current artifacts; lines 4604-4606 convert failed base reads to undefined. src/conductor/src/engine/coverage-binding-inputs.ts:88-90 then treats undefined as an empty inherited set. Inherited blocks can therefore be misclassified as branch-added, while unreadable branch additions can disappear."
  - gate: architecture_review_as_built
    finding: AB-5
    class: REMEDIABLE
    governing_clause: "adr-2026-08-31-coverage-binding-judge-step decision 24"
    outcome: remediated
    summary: "Verified 99%: cached and not-applicable conflict claims emit coverage_binding_conflict_judged twice, violating D24's once-per-claim contract. src/conductor/src/engine/step-runners.ts:4756-4757 adds planned.conflictEntries to entries; lines 4786-4799 emit them through emitEntry; lines 4922-4925 emit the same entries again. Pending and judge-disabled claims retain a single emission path."
---

## Cost
input: 3180809
output: 370648
cache_read: 59546949
cache_creation: 1257712
cost_usd: 43.764
dispatches: 61
retries: 4
halts: 5
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 3180395, output: 198047, cache_read: 48441088, cache_creation: 0, cost_usd: 25.4428, dispatches: 37, cost_unmetered: 0
  claude: input: 414, output: 172601, cache_read: 11105861, cache_creation: 1257712, cost_usd: 18.3212, dispatches: 24, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","fd43c5f1-945f-45ae-9f54-4570c29ebf8c","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 4
  security: failures: 0, judged: 4
  testQuality: failures: 0, judged: 4
skip_reasons:
