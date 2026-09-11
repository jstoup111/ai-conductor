---
slug: refuted-build-review-finding-cycles-to-a-needs-hum
spec_hash: dadab3110e231f8a9eaa8f6ad3c7307f90a140eabafa61be14b788ea4b1a47be
pr: https://github.com/jstoup111/ai-conductor/pull/2506
shipped: 2026-09-11
engine_version: 20260910T220211Z-39b4ec92e0a6
findings:
  - gate: architecture_review_as_built
    finding: AB-1
    class: REMEDIABLE
    governing_clause: "Task 6"
    outcome: remediated
    summary: "An exact-ID re-raised action case is rejected as `illegal-source-link` instead of settling as a refutation."
  - gate: architecture_review_as_built
    finding: AB-2
    class: REMEDIABLE
    governing_clause: "Task 10"
    outcome: remediated
    summary: "The exact-id/drifted-id proof seeds an already-refuted record instead of exercising the required two-lap coordinator path from admission through later settlement."
  - gate: architecture_review_as_built
    finding: AB-3
    class: REMEDIABLE
    governing_clause: "Task 11"
    outcome: remediated
    summary: "The refute-specific residual executor proof covers marker reuse and applied state but does not prove new issue filing or sanitization."
  - gate: architecture_review_as_built
    finding: AB-4
    class: REMEDIABLE
    governing_clause: "Task 10"
    outcome: remediated
    summary: "A re-raised exact source with an unfinished residual is sent back to the judge before the promised unfinished-effect blocker can decide the lap."
---

## Cost
input: 2416731
output: 355333
cache_read: 66545075
cache_creation: 2543840
cost_usd: 63.5506
dispatches: 36
retries: 6
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2416411, output: 181701, cache_read: 45606784, cache_creation: 0, cost_usd: 20.7192, dispatches: 19, cost_unmetered: 0
  claude: input: 320, output: 173632, cache_read: 20938291, cache_creation: 2543840, cost_usd: 42.8313, dispatches: 17, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:finish

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 2
rubrics:
  testQuality: failures: 1, judged: 5
skip_reasons:
