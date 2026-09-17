---
slug: skip-registered-projects-whose-path-is-missing-ins
spec_hash: d320f3b1e971d75aa46e6bb739a99bc40242d36aa5d3d0723b542568adcc0cd9
pr: https://github.com/jstoup111/ai-conductor/pull/2566
shipped: 2026-09-17
engine_version: 20260917T120938Z-cb86a041782a
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "src/conductor/test/acceptance/canonical-tracker-client-seam-with-per-backend-tra.acceptance.test.ts:72 and src/conductor/test/engine/engineer/engineer-cli-intake.test.ts:70 — two test files named by no active plan task gained `mkdir` of their registered fixture paths"
    accepted: true
---

## Cost
input: 1218193
output: 182414
cache_read: 23064689
cache_creation: 915718
cost_usd: 25.6
dispatches: 26
retries: 2
halts: 3
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1218043, output: 101881, cache_read: 17805696, cache_creation: 0, cost_usd: 10.0886, dispatches: 15, cost_unmetered: 0
  claude: input: 150, output: 80533, cache_read: 5258993, cache_creation: 915718, cost_usd: 15.5114, dispatches: 11, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:build,step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 0, judged: 4
skip_reasons:
