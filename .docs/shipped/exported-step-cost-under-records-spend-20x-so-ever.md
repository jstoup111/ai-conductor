---
slug: exported-step-cost-under-records-spend-20x-so-ever
spec_hash: e6dd1a21842c42c0d8366e9f7804df86da5e45112c89cb7343d26d901f4220ac
pr: https://github.com/jstoup111/ai-conductor/pull/2104
shipped: 2026-08-31
engine_version: 20260831T173643Z-391706023b73
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "src/conductor/src/daemon-cli.ts:631 — exported `runDaemonMode` return type widened from `Promise<void>` to `Promise<DaemonResult or undefined>`, returning `result` at daemon-cli.ts:2174; no plan task authorises a production change to this seam"
    accepted: false
---

## Cost
input: 3251141
output: 554880
cache_read: 117946146
cache_creation: 3042002
cost_usd: 100.5635
dispatches: 55
retries: 6
halts: 3
unmetered: count: 15, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 3250137, output: 226261, cache_read: 54597120, cache_creation: 0, cost_usd: 29.9953, dispatches: 21, cost_unmetered: 0
  claude: input: 1004, output: 328619, cache_read: 63349026, cache_creation: 3042002, cost_usd: 70.5682, dispatches: 19, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,step:finish

## Build Review
laps_to_pass: 5
skipped: 0
cache_hits: 5
infrastructure_failures: 0
rubrics:
  testQuality: failures: 10, judged: 14
skip_reasons:
