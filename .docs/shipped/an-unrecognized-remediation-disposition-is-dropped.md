---
slug: an-unrecognized-remediation-disposition-is-dropped
spec_hash: 581c7921ee0b9935b63c69166f2beef4c9cab1f0a82c6e3262c18e176b55390f
pr: https://github.com/jstoup111/ai-conductor/pull/2194
shipped: 2026-09-05
engine_version: 20260905T014027Z-b9d908fa9678
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "`src/conductor/src/engine/artifacts.ts:5221` — surviving gaps now take `id: gapId`, so a recognized gap with no `id` renders as `#3` instead of the previous `?` in halt and route text"
    accepted: true
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.2
    summary: "`src/conductor/test/acceptance/off-tag-checkout-reports-up-to-date-forever-tagged.acceptance.test.ts:101` and `src/conductor/test/acceptance/update-check-config-single-source-of-truth.acceptance.test.ts:110` — commit 738632d87 symlinks `/usr/bin/python3` into two update-check acceptance fixtures, unrelated to remediation dispositions"
    accepted: false
---

## Cost
input: 766389
output: 86981
cache_read: 18972526
cache_creation: 198099
cost_usd: 10.6584
dispatches: 12
retries: 1
halts: 0
unmetered: count: 3, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 766321, output: 66614, cache_read: 16583808, cache_creation: 0, cost_usd: 6.9735, dispatches: 7, cost_unmetered: 0
  claude: input: 68, output: 20367, cache_read: 2388718, cache_creation: 198099, cost_usd: 3.6849, dispatches: 2, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 1
skip_reasons:
