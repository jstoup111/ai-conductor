---
slug: reap-stale-resolution-worktree-registration-before
spec_hash: 6e4528ba42ee283a7ef33567b6ab243810474b7ae5620b0915dec6d211ce78a7
pr: https://github.com/jstoup111/ai-conductor/pull/2437
shipped: 2026-09-08
engine_version: 20260907T120758Z-4f8bdec36946
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "src/conductor/test/acceptance/daemon-e2e-live-agent-tier.acceptance.test.ts:128-132 — narrows a pre-existing whole-workflow `exit 0` assertion to the provider-smoke step; unrelated to either story, test-only, no shipped behavior changes"
    accepted: false
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.2
    summary: "src/conductor/test/engine/ci-fix.test.ts:865 — `queuedOperations` expectation raised 2 to 3 in a file no plan task names; entailed by Task 1 done-when 1, which requires the reap to route through the lifecycle-queue wrapper"
    accepted: true
---

## Cost
input: 630859
output: 51727
cache_read: 12712619
cache_creation: 175105
cost_usd: 7.4309
dispatches: 12
retries: 0
halts: 2
unmetered: count: 4, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 630831, output: 34164, cache_read: 11927808, cache_creation: 0, cost_usd: 4.4416, dispatches: 6, cost_unmetered: 0
  claude: input: 28, output: 17563, cache_read: 784811, cache_creation: 175105, cost_usd: 2.9894, dispatches: 2, cost_unmetered: 0

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
