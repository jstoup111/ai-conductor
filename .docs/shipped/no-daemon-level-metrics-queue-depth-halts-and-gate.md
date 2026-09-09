---
slug: no-daemon-level-metrics-queue-depth-halts-and-gate
spec_hash: 0c6b283e23ddadd23244fde41894728127b75b3141eb4807e8e2e5bd6f8fcf54
pr: https://github.com/jstoup111/ai-conductor/pull/2423
shipped: 2026-09-09
engine_version: 20260907T120758Z-4f8bdec36946
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: ".github/workflows/live-daemon-e2e.yml:156-160 — commit 0041c9762 restructures the live-provider gate's final conditional from `if success; then echo; exit 0; fi; echo; exit 1` to an if/else, a behavior-identical edit to a CI surface no plan task or story criterion names"
    accepted: false
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.2
    summary: "src/conductor/test/tmpdir-leak-guard.ts:224-233 — commit 9314ff9f9 moves `chmodSync(path, 0o700)` before `readdirSync` in makeDirectoriesWritableSync so a 000 path component left by an interrupted run cannot make a run root unreapable; test-harness only, landed to repair this feature's own metric projection tests"
    accepted: true
  - gate: architecture_review_as_built
    finding: AB-1
    class: REMEDIABLE
    governing_clause: "Task 19"
    outcome: remediated
    summary: "Listener coverage checks subscription declarations, not actual handler cases."
  - gate: architecture_review_as_built
    finding: AB-2
    class: REMEDIABLE
    governing_clause: "adr-014-otel-observability-exporter decision 5"
    outcome: remediated
    summary: "Metric flush and shutdown failures can escape telemetry teardown without the required bounded warning."
  - gate: architecture_review_as_built
    finding: AB-3
    class: REMEDIABLE
    governing_clause: "Task 9"
    outcome: remediated
    summary: "Busy-pool snapshots reuse cached blocking flags instead of sampling the current pass."
  - gate: architecture_review_as_built
    finding: AB-4
    class: REMEDIABLE
    governing_clause: "Task 14"
    outcome: remediated
    summary: "The telemetry halt reader reverses the approved absent-versus-explicit-legacy classification boundary."
  - gate: architecture_review_as_built
    finding: AB-5
    class: REMEDIABLE
    governing_clause: "Task 14"
    outcome: remediated
    summary: "Halt-step attribution reads phase-active after Conductor removed it, yielding unknown."
  - gate: architecture_review_as_built
    finding: AB-6
    class: REMEDIABLE
    governing_clause: "adr-014-otel-observability-exporter D7"
    outcome: remediated
    summary: "Trace identity changed from project/feature to project/worker and gained conductor.worker despite the byte-identical contract."
  - gate: architecture_review_as_built
    finding: AB-7
    class: REMEDIABLE
    governing_clause: "adr-014-otel-observability-exporter D8"
    outcome: remediated
    summary: "Daemon metric Resource sets conductor.project to basename(projectRoot), not the absolute project root."
  - gate: architecture_review_as_built
    finding: AB-8
    class: REMEDIABLE
    governing_clause: "adr-014-otel-observability-exporter D9"
    outcome: remediated
    summary: "DiscoverySnapshot excludes parked, so no parked oldest-age value can be produced."
  - gate: architecture_review_as_built
    finding: AB-9
    class: REMEDIABLE
    governing_clause: "Task 3"
    outcome: remediated
    summary: "The required commented otel.worker_name entry is absent from the project config template."
  - gate: architecture_review_as_built
    finding: AB-10
    class: REMEDIABLE
    governing_clause: "Task 10"
    outcome: remediated
    summary: "Backlog age remains immutable first-ever-discovery time instead of resetting on state transitions."
  - gate: architecture_review_as_built
    finding: AB-11
    class: REMEDIABLE
    governing_clause: "Task 15"
    outcome: remediated
    summary: "Shipment timing directly reads and parses conduct-state.json instead of using the approved readState contract."
---

## Cost
input: 5093513
output: 1232403
cache_read: 264882805
cache_creation: 5751888
cost_usd: 246.75
dispatches: 92
retries: 8
halts: 16
unmetered: count: 22, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 5092017, output: 530556, cache_read: 158262784, cache_creation: 0, cost_usd: 62.3957, dispatches: 29, cost_unmetered: 0
  claude: input: 1496, output: 701847, cache_read: 106620021, cache_creation: 5751888, cost_usd: 184.3543, dispatches: 41, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:finish

## Build Review
laps_to_pass: 4
skipped: 0
cache_hits: 0
infrastructure_failures: 1
rubrics:
  testQuality: failures: 11, judged: 12
skip_reasons:


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

Accepted findings: 1

- Finding: `sha256:fab0e4def863cd7c0224f920d3025acc922ed6a57a4137fbfe35b3c57a9f683d` — rubric: testQuality

Details are retained in the feature's local build-review disposition store.
<!-- build-review-accepted-risk:end -->