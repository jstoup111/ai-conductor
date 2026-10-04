---
slug: monitor-daemon-halts-through-a-guided-resolution-q
spec_hash: cde2a62bace71b412ef3e96a49b8272be9dd29c7535c14f023a6acf8ea33e112
pr: https://github.com/jstoup111/ai-conductor/pull/2818
shipped: 2026-10-04
engine_version: 20261003T201457Z-42a8ad9bcd91
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.2
    summary: "Test-runner temp containment: TMP/TEMP alias handling in src/conductor/scripts/run-vitest.mjs and scripts/vitest-temp.mjs, plus test/setup.ts, test/global-setup.ts, test/tmpdir-leak-guard.ts, vitest.smoke.config.ts and the intake-helper fixture tests (bundled-helper-resolution.test.ts re-touched in 5f9c9c203); no plan task owns it"
    accepted: true
  - gate: architecture_review_as_built
    finding: AR-001
    class: REMEDIABLE
    governing_clause: "adr-2026-09-20-halt-resolution-queue-derived-from-markers decision 3"
    outcome: remediated
    summary: "Verified from current-source imports and callers (99%): production writes deferrals but never calls readDeferrals, so restart replay and corrupt-record copy recovery do not occur."
  - gate: architecture_review_as_built
    finding: AR-002
    class: REMEDIABLE
    governing_clause: "adr-2026-09-20-halt-resolution-queue-derived-from-markers decision 4"
    outcome: remediated
    summary: "Verified (99%): isDeferred has no production caller, so stored project/feature/halt identities are never compared with current markers."
  - gate: architecture_review_as_built
    finding: AR-003
    class: REMEDIABLE
    governing_clause: "adr-2026-09-20-halt-resolution-queue-derived-from-markers decision 5"
    outcome: remediated
    summary: "Verified (99%): orderMonitorQueue is test-only; production offers raw inventory and displays neither priority band nor ordering basis."
  - gate: architecture_review_as_built
    finding: AR-004
    class: REMEDIABLE
    governing_clause: "adr-2026-09-20-halt-resolution-queue-derived-from-markers decision 6"
    outcome: remediated
    summary: "Verified (99%): the event members and sinks exist, but the production monitor supplies no emitter or persister, so every transition emission is an optional no-op."
  - gate: architecture_review_as_built
    finding: AR-005
    class: REMEDIABLE
    governing_clause: "adr-2026-09-20-operator-launched-sessions-retain-conductor-authority decision 3"
    outcome: remediated
    summary: "Verified (99%): the composer still spawns an unmarked interactive provider through engineer-cli.ts:552 and :983 instead of the new sole provider-agnostic launch seam."
  - gate: architecture_review_as_built
    finding: AR-006
    class: REMEDIABLE
    governing_clause: "Task 19"
    outcome: remediated
    summary: "Verified (99%): production supplies no reconcileHaltIssues callback, so every monitoring cycle takes the no-op branch at loop.ts:77-78."
  - gate: architecture_review_as_built
    finding: AR-007
    class: REMEDIABLE
    governing_clause: "Task 4"
    outcome: remediated
    summary: "Verified (99%): clearDeferrals is a newly exported, test-only primitive with no production caller."
  - gate: architecture_review_as_built
    finding: AR-008
    class: REMEDIABLE
    governing_clause: "Task 14"
    outcome: remediated
    summary: "Verified (99%): advanceAfterGuidedSession is a newly exported, test-only primitive with no production caller."
  - gate: architecture_review_as_built
    finding: AR-009
    class: REMEDIABLE
    governing_clause: "Task 9"
    outcome: remediated
    summary: "Verified at 99% confidence: the non-guided Codex branch in src/conductor/src/execution/interactive-launch.ts:66-71 remains unreachable. The sole production caller at src/conductor/src/engine/monitor/session.ts:100-103 always supplies mode \"guided-monitor\"; the D8-compliant composer route deliberately retains its separate direct spawn."
  - gate: architecture_review_as_built
    finding: AR-011
    class: REMEDIABLE
    governing_clause: "adr-2026-09-20-halt-resolution-queue-derived-from-markers decision 6"
    outcome: remediated
    summary: "Verified at 99% confidence: after the provider session has ended, an interrupt during the post-session choice returns at src/conductor/src/engine/monitor/loop.ts:188-190 before the sole monitor_session_ended emission at line 196. The durable event spine therefore omits the session-ended occurrence required by D6. This is the sole violating site and remains unchanged since the prior lap."
---

## Cost
input: 11038170
output: 1098340
cache_read: 249504526
cache_creation: 2594989
cost_usd: 128.8465
dispatches: 165
retries: 15
halts: 27
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 11037488, output: 804909, cache_read: 228206720, cache_creation: 0, cost_usd: 92.6734, dispatches: 119, cost_unmetered: 0
  claude: input: 682, output: 293431, cache_read: 21297806, cache_creation: 2594989, cost_usd: 36.1731, dispatches: 46, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","62b91dfc-f9fe-443f-b6df-ebe79edebe4b","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 2, judged: 8
  security: failures: 0, judged: 8
  testQuality: failures: 1, judged: 8
skip_reasons:
