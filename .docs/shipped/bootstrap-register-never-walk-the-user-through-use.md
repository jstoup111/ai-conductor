---
slug: bootstrap-register-never-walk-the-user-through-use
spec_hash: eee871b982c47149da35d884ba7435f7daedd8fa596c827b7834bff26d14fd0f
pr: https://github.com/jstoup111/ai-conductor/pull/2575
shipped: 2026-09-19
engine_version: 20260919T112422Z-8d60f5660031
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "test/test_lint_shell_enumeration.sh:111 — commit a4e7a44a8 captures the drift guard's stderr and adds two assertions that its rejection message names the \"syntax-check section\""
    accepted: true
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.2
    summary: "src/conductor/test/acceptance/non-daemon-projects-inherit-self-host-config-inste.acceptance.test.ts:101 — a foreign feature's forbidden-seed-key guard changed from substring matching to a non-comment top-level-key regex"
    accepted: true
  - gate: architecture_review_as_built
    finding: AB-1
    class: REMEDIABLE
    governing_clause: "adr-2026-08-28-test-suite-drift-budget-and-verification-mode D9"
    outcome: remediated
    summary: "The operator-approved effective-settings qualification rewrote D9's prior approved text instead of preserving it in an additive amendment note."
  - gate: architecture_review_as_built
    finding: AB-2
    class: REMEDIABLE
    governing_clause: "adr-2026-08-28-test-suite-drift-budget-and-verification-mode D8"
    outcome: remediated
    summary: "The managed bootstrap runtime rejects the `config init` command through which D8 requires the skill to record project answers."
  - gate: architecture_review_as_built
    finding: AB-3
    class: REMEDIABLE
    governing_clause: "Task 13"
    outcome: remediated
    summary: "The managed bootstrap runtime rejects the `config read` and `config set spec_owner` commands required for operator identity."
  - gate: architecture_review_as_built
    finding: AB-4
    class: REMEDIABLE
    governing_clause: "Task 15"
    outcome: remediated
    summary: "The managed bootstrap runtime rejects the `config read` and `config init` commands required to report and preserve existing project settings on re-run."
  - gate: architecture_review_as_built
    finding: AB-5
    class: REMEDIABLE
    governing_clause: "Task 18"
    outcome: remediated
    summary: "The project template retains generic placeholder explanations and lacks the authored explanations and section references Task 18 requires."
---

## Cost
input: 2836525
output: 691879
cache_read: 84938583
cache_creation: 3280506
cost_usd: 113.9088
dispatches: 57
retries: 4
halts: 8
unmetered: count: 1, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2835661, output: 269454, cache_read: 44022016, cache_creation: 0, cost_usd: 24.9614, dispatches: 32, cost_unmetered: 0
  claude: input: 864, output: 422425, cache_read: 40916567, cache_creation: 3280506, cost_usd: 88.9474, dispatches: 25, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","a6ef82d0-3153-42c9-b225-d008603acb08","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 3
cache_hits: 0
infrastructure_failures: 0
rubrics:
  testQuality: failures: 1, judged: 8
skip_reasons:
  disabled: 3
