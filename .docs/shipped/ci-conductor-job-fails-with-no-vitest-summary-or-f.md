---
slug: ci-conductor-job-fails-with-no-vitest-summary-or-f
spec_hash: 0fca0e1d139ff83bbd8f2b09aea74bd99aff1ae13f9d534e311570536e4ff92d
pr: https://github.com/jstoup111/ai-conductor/pull/3083
shipped: 2026-10-10
engine_version: 20261010T132818Z-14d7967cd432
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "This documents the self-host live-boundary exclusion list, a mechanism unrelated to CI Vitest progress reporting, and no story or task covers it. It is docs-only and brings the guide in line with existing code, so it changes no behavior. Most likely it was a docs-currency catch-up after a rebase."
    accepted: false
    authority: engine
---

## Cost
input: 1135762
output: 118437
cache_read: 20826968
cache_creation: 682914
cost_usd: 16.0193
dispatches: 45
retries: 0
halts: 4
unmetered: count: 4, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1135562, output: 66949, cache_read: 17930880, cache_creation: 0, cost_usd: 8.9462, dispatches: 22, cost_unmetered: 0
  claude: input: 200, output: 51488, cache_read: 2896088, cache_creation: 682914, cost_usd: 7.0731, dispatches: 23, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","42f5c31e-05ac-4aee-aedb-e0385cb0a702","lifecycle-step","finish"]

## Build Review
laps_to_pass: 7
skipped: 0
cache_hits: 29
infrastructure_failures: 4
rubrics:
  eventSpine: failures: 14, judged: 14
  security: failures: 0, judged: 16
  testQuality: failures: 0, judged: 16
skip_reasons:


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

Accepted findings: 1

- Finding: `sha256:12f2afb5014d1f8460d4c3cffee966e1b16d1c0d9c45653c02a5589cdb97df44` — rubric: eventSpine

Details are retained in the feature's local build-review disposition store.
<!-- build-review-accepted-risk:end -->