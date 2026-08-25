---
slug: coherence-rows-assert-story-task-coverage-that-not
spec_hash: 0d3f5d73457948db00477d3d2af23aa2cdee4f4d112e4b3846fa9666e5bf09f2
pr: https://github.com/jstoup111/ai-conductor/pull/1847
shipped: 2026-08-25
engine_version: 20260825T004000Z-fa61930a8d75
---

## Cost
input: 1334756
output: 189103
cache_read: 42078937
cache_creation: 685654
cost_usd: 14.3774
dispatches: 48
retries: 4
halts: 9
unmetered: count: 31, duration_ms: 0
cost_unmetered: count: 9
providers:
  codex: input: 1334502, output: 99326, cache_read: 31528704, cache_creation: 0, cost_usd: 0, dispatches: 19, cost_unmetered: 9
  claude: input: 254, output: 89777, cache_read: 10550233, cache_creation: 685654, cost_usd: 14.3774, dispatches: 20, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,parallel:wiring_check,step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 1, judged: 3
skip_reasons:


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

Accepted findings: 1

- Finding: `sha256:1ae9fa184c7adff05270487606a7999052cdb51a8737fa905c98ec9bdac71283` — rubric: testQuality

Details are retained in the feature's local build-review disposition store.
<!-- build-review-accepted-risk:end -->