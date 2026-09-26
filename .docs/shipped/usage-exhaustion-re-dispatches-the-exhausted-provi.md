---
slug: usage-exhaustion-re-dispatches-the-exhausted-provi
spec_hash: 841afa8d365bc620b74d04370eae4b561ab419eff927dd76800b4a89c625a304
pr: https://github.com/jstoup111/ai-conductor/pull/2743
shipped: 2026-09-26
engine_version: 20260925T125013Z-084a4eab8370
findings:
  - gate: architecture_review_as_built
    finding: AB-1
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability D2"
    outcome: remediated
    summary: "Disallowed substitution retains the global-provider union instead of narrowing resolution to the step selection."
  - gate: architecture_review_as_built
    finding: AB-2
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability D7"
    outcome: remediated
    summary: "A pinned suppressed provider plus a policy-refused fallback yields ordinary unavailability instead of the required rate-limited wait."
  - gate: architecture_review_as_built
    finding: AB-3
    class: REMEDIABLE
    governing_clause: "adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability D3"
    outcome: remediated
    summary: "The declared policy-refused telemetry arm has no production producer."
  - gate: architecture_review_as_built
    finding: AB-4
    class: REMEDIABLE
    governing_clause: "Task 18"
    outcome: remediated
    summary: "Daemon-origin suppression persistence and restart restoration shown by the corrected diagram are absent."
---

## Cost
input: 2682997
output: 426764
cache_read: 59534865
cache_creation: 1450827
cost_usd: 56.0222
dispatches: 76
retries: 5
halts: 4
unmetered: count: 18, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2682671, output: 249596, cache_read: 48812032, cache_creation: 0, cost_usd: 24.1339, dispatches: 54, cost_unmetered: 0
  claude: input: 326, output: 177168, cache_read: 10722833, cache_creation: 1450827, cost_usd: 31.8883, dispatches: 22, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","852ba8cd-9e95-415e-80a5-921ea3b74453","lifecycle-step","test_suite"],step:execution\u0000["timing-rollup","persisted-ledger","88432573-4228-45a1-aac1-8e1d94b55a40","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 6
  testQuality: failures: 1, judged: 6
skip_reasons:
