---
slug: reset-the-daemon-idle-poll-counter-when-work-is-di
spec_hash: 1d45a2d0f5bea07f3862917877df2c57bd8efdd17a548112b57d109927fe4c1f
pr: https://github.com/jstoup111/ai-conductor/pull/2452
shipped: 2026-09-08
engine_version: 20260907T120758Z-4f8bdec36946
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "src/conductor/test/acceptance/daemon-e2e-live-agent-tier.acceptance.test.ts:126 — commit 2c0b5106a deletes `expect(workflow).not.toMatch(/exit\\s+0/)` from the live-provider workflow guard; the file is declared by neither plan task and the change is unrelated to the idle-poll ceiling"
    accepted: false
---

## Cost
input: 440718
output: 51627
cache_read: 9501714
cache_creation: 206758
cost_usd: 7.194
dispatches: 12
retries: 0
halts: 0
unmetered: count: 4, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 440674, output: 31639, cache_read: 7553408, cache_creation: 0, cost_usd: 3.4171, dispatches: 6, cost_unmetered: 0
  claude: input: 44, output: 19988, cache_read: 1948306, cache_creation: 206758, cost_usd: 3.7769, dispatches: 2, cost_unmetered: 0

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
