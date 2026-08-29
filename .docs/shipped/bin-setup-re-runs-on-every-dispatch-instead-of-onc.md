---
slug: bin-setup-re-runs-on-every-dispatch-instead-of-onc
spec_hash: 662937518f935147051ff0f09caf2b155fa2647b29b2928d0e6c6bc4f044c447
pr: https://github.com/jstoup111/ai-conductor/pull/1968
shipped: 2026-08-29
engine_version: 20260829T023303Z-bae4facf3f45
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "src/conductor/src/engine/worktree-prepare.ts:840-856 — a `bin/setup` that disappears between the decision and the run now throws `SetupFailureError` (previously a silent no-op return)"
    accepted: true
  - gate: architecture_review_as_built
    finding: AB-1
    class: REMEDIABLE
    governing_clause: "adr-2026-08-26-setup-once-per-worktree-marker decision 7"
    outcome: remediated
    summary: "The generic resolve-worktree default applies the new dispatch-start lifecycle to autoresolve and CI-fix despite the approved daemon-dispatch/setup-triage-only boundary."
---

## Cost
input: 4803491
output: 743398
cache_read: 129108247
cache_creation: 3129684
cost_usd: 112.5227
dispatches: 76
retries: 6
halts: 12
unmetered: count: 16, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 4802221, output: 344498, cache_read: 72836864, cache_creation: 0, cost_usd: 43.0214, dispatches: 31, cost_unmetered: 0
  claude: input: 1270, output: 398900, cache_read: 56271383, cache_creation: 3129684, cost_usd: 69.5013, dispatches: 29, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,parallel:wiring_check,step:finish

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 3, judged: 10
skip_reasons:
