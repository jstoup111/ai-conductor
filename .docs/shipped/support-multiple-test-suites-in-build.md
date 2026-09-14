---
slug: support-multiple-test-suites-in-build
spec_hash: 2cdc9078236da51c763c398fe8e57dbc552771bb403de1e1d5f7ce9d460909bc
pr: https://github.com/jstoup111/ai-conductor/pull/2536
shipped: 2026-09-14
engine_version: 20260912T002443Z-24ab600a1a43
findings:
  - gate: architecture_review_as_built
    finding: AB-1
    class: REMEDIABLE
    governing_clause: "Task 16"
    outcome: remediated
    summary: "Production CLI and conductor callers pass a pre-lock stale inspection into `ensure`; after contention, `ensureLocked` can reuse that stale snapshot and execute the collection again instead of re-inspecting and reusing the first caller's PASS."
  - gate: architecture_review_as_built
    finding: AB-2
    class: REMEDIABLE
    governing_clause: "Task 10"
    outcome: remediated
    summary: "The v5 reader accepts contradictory list evidence, including multiple failed attempts, inconsistent typed termination, and list PASS records carrying forbidden scalar command/directory fields."
  - gate: architecture_review_as_built
    finding: AB-3
    class: REMEDIABLE
    governing_clause: "Task 18"
    outcome: remediated
    summary: "Execution summaries directly reuse broader evidence-entry objects, causing persisted events to contain path and termination fields outside the approved summary contract."
  - gate: architecture_review_as_built
    finding: AB-4
    class: REMEDIABLE
    governing_clause: "Task 13"
    outcome: remediated
    summary: "Scalar fingerprint serialization now always adds `commands: null`, changing unchanged scalar identities and invalidating reusable version-4 proof."
  - gate: architecture_review_as_built
    finding: AB-5
    class: REMEDIABLE
    governing_clause: "Task 16"
    outcome: remediated
    summary: "Current list proof may be reused before every entry directory is resolved and checked, contrary to the approved validation-before-reuse sequence."
  - gate: architecture_review_as_built
    finding: AB-6
    class: REMEDIABLE
    governing_clause: "Task 12"
    outcome: remediated
    summary: "The verifier's list failure description omits required suite identity, context, duration, termination, and unexecuted-count fields."
  - gate: architecture_review_as_built
    finding: AB-7
    class: REMEDIABLE
    governing_clause: "Task 17"
    outcome: remediated
    summary: "The standalone CLI prints only the failed ordinal plus generic guidance and does not print the verifier's actionable typed failure description."
---

## Cost
input: 1822195
output: 276062
cache_read: 44897732
cache_creation: 1434404
cost_usd: 38.2522
dispatches: 32
retries: 6
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1821993, output: 180624, cache_read: 36152704, cache_creation: 0, cost_usd: 17.1487, dispatches: 19, cost_unmetered: 0
  claude: input: 202, output: 95438, cache_read: 8745028, cache_creation: 1434404, cost_usd: 21.1035, dispatches: 13, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:finish

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 1, judged: 5
skip_reasons:
