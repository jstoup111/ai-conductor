---
slug: daemon-reconciliation-delays-first-feature-dispatc
spec_hash: 9c6295c4f7fb24976d9610c13c65e78cd9832b7fe4421a87ade16aaaad5760f1
pr: https://github.com/jstoup111/ai-conductor/pull/3246
shipped: 2026-10-18
engine_version: 20261018T130307Z-2917a81aaac0
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "No story or plan task covers CLI help routing. The change alters CLI behavior for daemon-managed sessions (help is answered before the session guard), which is user-visible and outside the dispatch-first intent."
    accepted: true
    decision: accept
    rationale: "Operator accepts: read-only help before the daemon-session guard is acceptable. The now-redundant help route inside dispatchCliCommand will be removed by a follow-up hotfix after this feature ships."
    authority: jstoup111
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-2
    summary: "These are test-stability edits unrelated to daemon maintenance ordering. They change no production behavior."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-3
    summary: "Retiring inline-dispatch coverage follows from Task 13's move to queued repairs, so it is within intent. No task plans skipping, rather than deleting or migrating, these suites, so skipped dead suites remain in the tree."
    accepted: false
    authority: engine
  - gate: architecture_review_as_built
    finding: "as-built:ddbfcb83-bd4d-4e83-bb8e-8fa34d1ae0b0:5"
    class: REMEDIABLE
    governing_clause: "Task 7"
    outcome: remediated
    summary: "Verified, 99%: width-one busy refresh is not connected. The busy poll at src/conductor/src/engine/daemon.ts:2028 triggers a job whose steps at :1309 contain no origin refresh; rekick explicitly uses refresh:false at :1331. The only startRefresh invocation, :1679, is inside the free-slot branch. A width-one daemon cannot perform the required refresh while its worker occupies the slot."
  - gate: architecture_review_as_built
    finding: "as-built:ddbfcb83-bd4d-4e83-bb8e-8fa34d1ae0b0:6"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-14-dispatch-first-daemon-maintenance decision 5"
    outcome: remediated
    summary: "Verified, 100%: repair priority-band ordering is unwired. src/conductor/src/engine/daemon.ts:1044 reads optional repairPriority, but production dependencies at src/conductor/src/daemon-cli.ts:2585 supply none. Source search finds only the declaration and consumption; tests alone inject it. Every production repair receives the fallback rank and sorts solely by PR age."
  - gate: architecture_review_as_built
    finding: "as-built:ddbfcb83-bd4d-4e83-bb8e-8fa34d1ae0b0:7"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-14-dispatch-first-daemon-maintenance decision 5"
    outcome: remediated
    summary: "Verified, 100%: both repair adapters can execute without durable attempt accounting. src/conductor/src/daemon-cli.ts:1230 relies on updateWatch succeeding before adapter calls at :1247 and :1250. However, src/conductor/src/engine/mergeable-sweep.ts:333 calls rewriteWatch, which swallows persistence failures at :288-297, then returns the successful claim result. Failed persistence must prevent repair execution."
  - gate: architecture_review_as_built
    finding: "as-built:ddbfcb83-bd4d-4e83-bb8e-8fa34d1ae0b0:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-14-dispatch-first-daemon-maintenance decision 2"
    outcome: remediated
    summary: "Verified, 99%: armed self-host startup still refreshes twice before dispatch. Startup discovery at src/conductor/src/engine/daemon.ts:1370 reaches fastForwardRoot through src/conductor/src/daemon-cli.ts:2441. The first stale-engine check at daemon.ts:1700 calls refreshEngineSource at :1490, whose independent fresh throttle invokes fastForwardRoot again at daemon-cli.ts:2787. recordRefresh does not seed that throttle."
  - gate: architecture_review_as_built
    finding: "as-built:ddbfcb83-bd4d-4e83-bb8e-8fa34d1ae0b0:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-14-dispatch-first-daemon-maintenance decision 3"
    outcome: remediated
    summary: "Verified, 99%: subsequent fill passes await a background maintenance step. src/conductor/src/engine/daemon.ts:1639 awaits consumeResumeAuthorizations; :1295 returns the same pending promise used by the job at :1333. A slow step blocks dispatch and collection, and its rejection can escape runDaemon despite the job's best-effort catch."
  - gate: architecture_review_as_built
    finding: "as-built:ddbfcb83-bd4d-4e83-bb8e-8fa34d1ae0b0:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-14-dispatch-first-daemon-maintenance decision 3"
    outcome: remediated
    summary: "Verified, 99%: maintenance settlement is missing from several restart boundaries. In src/conductor/src/engine/daemon.ts, predispatch :1700 reaches refresh :1490, rebuild :1503 and restart :1528 without settling the job. Natural-idle settlement at :1733 applies only after an explicit drain; queued refresh :1760, relink :1781, restart :1792, bare restart consumption :1809 and stale restart :1894 can therefore act while maintenance is running."
  - gate: architecture_review_as_built
    finding: "as-built:ddbfcb83-bd4d-4e83-bb8e-8fa34d1ae0b0:4"
    class: REMEDIABLE
    governing_clause: "Task 9"
    outcome: remediated
    summary: "Verified, 98%: shutdown can start new maintenance after stopping. src/conductor/src/engine/daemon.ts:1561 exits the loop without closing the job; draining workers at :2036 invokes collectOne, whose repair and feature completion paths trigger maintenance at :1116 and :1131. The job closes only at :2045. Close it before shutdown collection can schedule additional passes."
  - gate: architecture_review_as_built
    finding: "as-built:ddbfcb83-bd4d-4e83-bb8e-8fa34d1ae0b0:8"
    class: REMEDIABLE
    governing_clause: "Task 13"
    outcome: remediated
    summary: "Verified, 99%: new public primitives RepairQueue.has and RepairQueue.take at src/conductor/src/engine/repair-queue.ts:84 and :92 have no production callers. Production source uses list and takeByUrl; repository searches locate these convenience methods only in tests. Remove the unused production surface or connect an approved production caller."
  - gate: architecture_review_as_built
    finding: "as-built:91803fac-f219-4215-8b72-9965d8c7226b:4"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-14-dispatch-first-daemon-maintenance decision 3"
    outcome: remediated
    summary: "Verified, 99%: remediation permanently disables maintenance during normal continued operation. src/conductor/src/engine/daemon.ts:1509 closes the job before determining staleness; fresh-engine, suppressed, unavailable-restart, and unfired-restart returns at :1539, :1550, :1554 and :1557 allow dispatch to continue. All later triggers then no-op because src/conductor/src/engine/daemon-maintenance.ts:46 rejects a permanently closed job. Preserve recurring maintenance when no restart occurs."
  - gate: architecture_review_as_built
    finding: "as-built:91803fac-f219-4215-8b72-9965d8c7226b:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-14-dispatch-first-daemon-maintenance decision 3"
    outcome: remediated
    summary: "Verified, 99%: prior restart-settlement finding remains partially unresolved. Natural-idle stale restart at src/conductor/src/engine/daemon.ts:1933 calls requestRestart without closing and settling maintenance. Settlement at :1768 covers explicit drains only. Protect this remaining restart boundary."
  - gate: architecture_review_as_built
    finding: "as-built:91803fac-f219-4215-8b72-9965d8c7226b:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-14-dispatch-first-daemon-maintenance decision 3"
    outcome: remediated
    summary: "Verified, 99%: remediation commit 659233bb9b adds await maintenanceJob.settled() inside beginDrain at src/conductor/src/engine/daemon.ts:1431. The busy observer awaits it at :2019 before worker collection, so pending maintenance blocks collection while workers remain active. Close on drain initiation, but await settlement only at the drained action boundary."
  - gate: architecture_review_as_built
    finding: "as-built:91803fac-f219-4215-8b72-9965d8c7226b:5"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-14-dispatch-first-daemon-maintenance decision 3"
    outcome: remediated
    summary: "Verified, 98%: remediation commit 1a750770c8 reconnects background maintenance to foreground waits. The shared reconciliation tail at src/conductor/src/engine/daemon.ts:1215 and :1239 is used by the job at :1350 and awaited by foldRefresh at :1289, reached from :1712 and :1720. A pending background rekick therefore blocks subsequent dispatch and collection when a refreshed backlog is folded. Preserve serialization without awaiting background reconciliation from ordinary fill passes."
  - gate: architecture_review_as_built
    finding: "as-built:91803fac-f219-4215-8b72-9965d8c7226b:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-14-dispatch-first-daemon-maintenance decision 5"
    outcome: remediated
    summary: "Verified, 100%: prior durable-attempt finding remains unresolved. rewriteWatch at src/conductor/src/engine/mergeable-sweep.ts:288 swallows persistence failures; updateWatch at :333 returns a successful claim afterward. Both adapters at src/conductor/src/daemon-cli.ts:1251 and :1254 can consequently execute without durable attempt accounting. Propagate claim-write failures and prevent adapter execution."
  - gate: architecture_review_as_built
    finding: "as-built:9c27232c-df7d-4ecf-9d5b-dce0fb984304:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-14-dispatch-first-daemon-maintenance decision 3"
    outcome: remediated
    summary: "Verified, 99%: the prior unfired-restart finding remains partially unresolved. daemon.ts:1559 and :1938 permanently close maintenance before requestRestart. A fired:false result allows feature dispatch or idle polling to continue (:1562, :1949), but all later maintenance triggers no-op (daemon-maintenance.ts:46). This occurs in production when session-hosted relink fails: daemon-cli.ts:803 returns fired:false before creating a restart marker. Both close sites changed in remediation ef71db884b. Preserve settlement around restart operations while restoring recurring maintenance when restart aborts without a pending restart."
---

## Cost
input: 10471587
output: 1089035
cache_read: 188103686
cache_creation: 6687123
cost_usd: 150.0993
dispatches: 205
retries: 23
halts: 22
unmetered: count: 3, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 10471035, output: 713504, cache_read: 172011136, cache_creation: 0, cost_usd: 85.8709, dispatches: 104, cost_unmetered: 0
  claude: input: 552, output: 375531, cache_read: 16092550, cache_creation: 6687123, cost_usd: 64.2283, dispatches: 101, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","df614bec-644d-46ef-ab1e-468f2de5f0a6","lifecycle-step","finish"]

## Build Review
laps_to_pass: 30
skipped: 3
cache_hits: 9
infrastructure_failures: 16
rubrics:
  eventSpine: failures: 12, judged: 12
  implementationQuality: failures: 24, judged: 24
  security: failures: 0, judged: 32
  testQuality: failures: 6, judged: 32
skip_reasons:
  disabled: 3


<!-- build-review-accepted-risk:start -->
## Accepted build-review risk

Accepted findings: 3

- Finding: `sha256:04d92ff198bc0487da97794f37532358af61c954dfaf9f2394c96f4e969c7137` — rubric: implementationQuality
- Finding: `sha256:76f3bfb788250eb54c7a46d61f7d8ae648730e9b9e06892f064e0f7791ed4a09` — rubric: implementationQuality
- Finding: `sha256:fd3e7cf47eee6b183bf8ee0d4095cf969d4a949224adcaa8658dc87a4493a034` — rubric: implementationQuality

Details are retained in the feature's local build-review disposition store.
<!-- build-review-accepted-risk:end -->