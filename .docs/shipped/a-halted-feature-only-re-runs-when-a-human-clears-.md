---
slug: a-halted-feature-only-re-runs-when-a-human-clears-
spec_hash: 756f5a90b8eba9377d2f840d376cd16c540a9d2197bc342bc955193a231baabc
pr: https://github.com/jstoup111/ai-conductor/pull/2206
shipped: 2026-09-09
engine_version: 20260907T120758Z-4f8bdec36946
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "src/conductor/src/engine/cli-operator-authority.ts:28-79 (new) and build-review-cli.ts:11,165-174,205,390 — the pre-existing `build-review` operator command is refactored onto a new shared operator-authority module and now fails closed on an unreadable `build_review` gate, a production edit to a command no plan task lists"
    accepted: true
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.2
    summary: "src/conductor/src/engine/daemon-observe-cli.ts:473 — the pre-existing `PLAN GROWTH [slug]` status line now also renders for halted features, a change to an existing status section that no plan task names"
    accepted: true
    decision: accept
    rationale: "Plan-growth and kickback-budget visibility remains operationally useful while a feature is halted, and the additional status line is an acceptable user-visible widening. Same widening previously accepted as NC.3 before the criterion was renumbered."
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.3
    summary: "src/conductor/src/engine/closeout-tail.ts:10-20,111 — the pre-existing closeout tail poller gains an `isAlreadyProjected` dedup guard, a production edit to a file no plan task or remediation task names"
    accepted: true
  - gate: architecture_review_as_built
    finding: AB-1
    class: REMEDIABLE
    governing_clause: "adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class D4"
    outcome: remediated
    summary: "The external authorization event uses an unlocked check-then-append, omitting the carried-forward writer-lock requirement."
  - gate: architecture_review_as_built
    finding: AB-2
    class: REMEDIABLE
    governing_clause: "adr-2026-08-25-as-built-remediable-findings-bounded-build-route decision 7"
    outcome: remediated
    summary: "A malformed pending as-built remediation array is silently dropped and treated as empty."
  - gate: architecture_review_as_built
    finding: AB-3
    class: REMEDIABLE
    governing_clause: "Task rem-as-built-rem-adr0831-1"
    outcome: remediated
    summary: "The feature removed the only production caller of readKickbackLedgerResult, leaving the typed fail-closed boundary unreachable."
  - gate: architecture_review_as_built
    finding: AB-4
    class: REMEDIABLE
    governing_clause: "adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class D4"
    outcome: remediated
    summary: "A command-owned temporary park is released on every refusal or post-stage failure, before an adjustment is fully committed and observable."
  - gate: architecture_review_as_built
    finding: AB-5
    class: REMEDIABLE
    governing_clause: "Task 10"
    outcome: remediated
    summary: "A legacy gate entry with no history renders an empty adjustment array instead of reporting history unavailable."
  - gate: architecture_review_as_built
    finding: AB-6
    class: REMEDIABLE
    governing_clause: "adr-2026-08-31-kickback-ledger-read-fails-closed decision 2"
    outcome: remediated
    summary: "The suite retry reader couples malformed adjustment history to valid enforcement state instead of preserving the counter and marking only history unavailable."
  - gate: architecture_review_as_built
    finding: AB-7
    class: REMEDIABLE
    governing_clause: "Task 13"
    outcome: remediated
    summary: "The adjustment event's declared persistence/audit consumers are conditional on a later `build` step and are skipped by direct gate resume."
  - gate: architecture_review_as_built
    finding: AB-8
    class: REMEDIABLE
    governing_clause: "Task 17"
    outcome: remediated
    summary: "The kickback-budget `halt_cleared` event is emitted on a bus with no declared audit consumer attached."
  - gate: architecture_review_as_built
    finding: AB-9
    class: REMEDIABLE
    governing_clause: "adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic decision 1"
    outcome: remediated
    summary: "Resume cleanup omits `preserveDraft: true`, so clearing a halt can make the retained PR ready."
  - gate: architecture_review_as_built
    finding: AB-10
    class: REMEDIABLE
    governing_clause: "Task 18"
    outcome: remediated
    summary: "daemon status excludes the halted feature that owns the fresh adjustment, so the recovery-boundary budget is not shown."
  - gate: architecture_review_as_built
    finding: AB-11
    class: REMEDIABLE
    governing_clause: "Task 13"
    outcome: remediated
    summary: "Authorization and halt-clear producers are not connected to their declared feature persistence/audit consumers on the normal recovery routes."
  - gate: architecture_review_as_built
    finding: AB-12
    class: REMEDIABLE
    governing_clause: "adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class D2"
    outcome: remediated
    summary: "The CLI checks only that HALT exists and rechecks only generation during apply; live halt class, gate, consumed count, limit, and current values do not agree under the lease."
---

## Cost
input: 8299754
output: 1425118
cache_read: 294673614
cache_creation: 6595866
cost_usd: 279.8972
dispatches: 130
retries: 21
halts: 14
unmetered: count: 25, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 8298082, output: 671998, cache_read: 196785920, cache_creation: 0, cost_usd: 84.2796, dispatches: 61, cost_unmetered: 0
  claude: input: 1672, output: 753120, cache_read: 97887694, cache_creation: 6595866, cost_usd: 195.6176, dispatches: 47, cost_unmetered: 0

## Time
state: partial
reason: open-executions:parallel:prd_audit,step:finish

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 4, judged: 12
skip_reasons:
