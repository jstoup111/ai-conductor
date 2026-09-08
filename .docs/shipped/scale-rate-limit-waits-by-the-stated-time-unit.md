---
slug: scale-rate-limit-waits-by-the-stated-time-unit
spec_hash: 5e8bd8fec042f3af32bd99c4c50d43d7816194bced84ffaef56e31cd67708855
pr: https://github.com/jstoup111/ai-conductor/pull/2456
shipped: 2026-09-08
engine_version: 20260907T120758Z-4f8bdec36946
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: ".github/workflows/live-daemon-e2e.yml:155-161 — commit 72c4bb447 `fix(ci): preserve live-provider gate success` restructures the live-provider gate's success branch from `exit 0` inside the `if` plus a trailing `exit 1` into an `if/else`; no plan task declares a `.github/` file and the change carries no `Scope:` trailer"
    accepted: false
---

## Cost
input: 566355
output: 59014
cache_read: 12442085
cache_creation: 235639
cost_usd: 8.468
dispatches: 13
retries: 0
halts: 0
unmetered: count: 4, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 566313, output: 39942, cache_read: 10745600, cache_creation: 0, cost_usd: 4.4193, dispatches: 6, cost_unmetered: 0
  claude: input: 42, output: 19072, cache_read: 1696485, cache_creation: 235639, cost_usd: 4.0487, dispatches: 3, cost_unmetered: 0

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
