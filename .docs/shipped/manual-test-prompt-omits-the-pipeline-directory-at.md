---
slug: manual-test-prompt-omits-the-pipeline-directory-at
spec_hash: 018dac41ce15f55879751356b5a70914f94feef31b0419014b633e59169ce5d7
pr: https://github.com/jstoup111/ai-conductor/pull/3679
shipped: 2026-11-10
engine_version: 20261109T160131Z-3c6fb4eda614
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "This unplanned test-harness change lets the leak guard ignore temp directories that an unrelated concurrent project creates on the same host. It repairs a test_suite failure that was not caused by this feature. It touches only test infrastructure: no product code, CLI output or persisted state."
    accepted: false
    authority: engine
---

## Cost
input: 1373523
output: 95440
cache_read: 19135158
cache_creation: 615064
cost_usd: 15.3276
dispatches: 23
retries: 0
halts: 2
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1373453, output: 69772, cache_read: 17347456, cache_creation: 0, cost_usd: 9.5359, dispatches: 16, cost_unmetered: 0
  claude: input: 70, output: 25668, cache_read: 1787702, cache_creation: 615064, cost_usd: 5.7917, dispatches: 7, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","bea6d89f-21ca-453a-94f3-110185aadb4c","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 2
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 2
  implementationQuality: failures: 0, judged: 2
  security: failures: 0, judged: 2
  testQuality: failures: 0, judged: 2
skip_reasons:
  paths-unmatched: 2
