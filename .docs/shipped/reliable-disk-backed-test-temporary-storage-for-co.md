---
slug: reliable-disk-backed-test-temporary-storage-for-co
spec_hash: b7e99a8a213f7879c0615eeb2577e3333b9d52f5b056ce8e17661e04977b2e0b
pr: https://github.com/jstoup111/ai-conductor/pull/2537
shipped: 2026-09-14
engine_version: 20260914T134752Z-60233f3ba6d3
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "src/conductor/scripts/smoke.ts:22-25 — local smoke entry prepends src/conductor/node_modules/.bin to PATH for the smoke run and restores it in finally (commits 4cfc91dfb, ba6bb0150); PATH mutation is not named in the plan"
    accepted: true
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.2
    summary: "src/conductor/test/engine/{worktree-prepare.test.ts,park-reconciliation.test.ts,memory-store-concurrency.test.ts,memory-writer-helper.ts} — undeclared fixture adaptations (CommonJS package.json markers, tsx via node --import) required because relocated test storage sits under the ESM package with longer socket paths (commits 5de7e664c, 7090c6db6)"
    accepted: true
  - gate: architecture_review_as_built
    finding: AB-1
    class: REMEDIABLE
    governing_clause: "Task 1"
    outcome: remediated
    summary: "An unset caller TMPDIR produces no preserved original-directory context, so config reuse rejects the root installed by the ordinary launcher."
  - gate: architecture_review_as_built
    finding: AB-2
    class: REMEDIABLE
    governing_clause: "Task 5"
    outcome: remediated
    summary: "The feature edits the shared smoke engine despite the task's explicit unchanged-engine boundary."
  - gate: architecture_review_as_built
    finding: AB-3
    class: REMEDIABLE
    governing_clause: "Task 5"
    outcome: remediated
    summary: "The sealed concurrent/nested isolation criterion lacks the required surviving-sentinel fixture proof."
  - gate: architecture_review_as_built
    finding: AB-4
    class: REMEDIABLE
    governing_clause: "Task 6"
    outcome: remediated
    summary: "Reusing a nested root discards its selected storage parent, so global setup omits that configured parent from stale-root sweeping."
  - gate: architecture_review_as_built
    finding: AB-5
    class: REMEDIABLE
    governing_clause: "Task 6"
    outcome: remediated
    summary: "Supported-interrupt cleanup exits without restoring the caller's temporary-directory environment."
  - gate: architecture_review_as_built
    finding: AB-6
    class: REMEDIABLE
    governing_clause: "Task 7"
    outcome: remediated
    summary: "The required relocated tmux-boundary proof is absent for explicit own/reaped roots and the planned refusal cases."
  - gate: architecture_review_as_built
    finding: AB-7
    class: REMEDIABLE
    governing_clause: "Task 8"
    outcome: remediated
    summary: "The required actual-global-setup proof for a planted leak in a separate original temporary directory is absent."
---

## Cost
input: 1897167
output: 340202
cache_read: 53777434
cache_creation: 2043467
cost_usd: 56.6667
dispatches: 37
retries: 5
halts: 4
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1896881, output: 178248, cache_read: 36789120, cache_creation: 0, cost_usd: 17.3553, dispatches: 19, cost_unmetered: 0
  claude: input: 286, output: 161954, cache_read: 16988314, cache_creation: 2043467, cost_usd: 39.3115, dispatches: 18, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 2, judged: 6
skip_reasons:
