---
slug: conduct-ts-help-disagrees-with-behavior-in-six-pla
spec_hash: 8e800c3d8f91e908bf13601d5d98a23340953a55aca85f2a6fb07d10de041116
pr: https://github.com/jstoup111/ai-conductor/pull/3241
shipped: 2026-10-15
engine_version: 20261015T004522Z-65702d1bcf72
findings:
  - gate: architecture_review_as_built
    finding: "as-built:8f309e68-f7d2-44b1-b0f7-aaf84a2e4537:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-14-commander-program-is-the-cli-catalog decision 2"
    outcome: remediated
    summary: "Verified, 99% confidence: cli-pre-dispatch.ts:151 requires help to be last, and :153-156 requires exact registry-path equality. Arguments/options and declared descendants therefore bypass help handling. Examples include register /tmp --help, create demo --help, brain start/stop/status --help, shipment-evidence audit/reconcile --help, rate-card refresh/show, config init/read/write, and the memory/build-review parent paths. Some reach mutating handlers, including create and brain start. Resolve declared command paths independently of arguments and help-token position while preserving ownership exemptions."
  - gate: architecture_review_as_built
    finding: "as-built:8f309e68-f7d2-44b1-b0f7-aaf84a2e4537:2"
    class: REMEDIABLE
    governing_clause: "Task 1"
    outcome: remediated
    summary: "Verified, 99% confidence: src/conductor/src/cli-pre-dispatch.ts:116 exports diffDetectorSets with only test callers. Production-source and repository symbol searches found no production invocation. It is intentional test support, but its placement introduces an unreachable production export."
  - gate: architecture_review_as_built
    finding: "as-built:8f309e68-f7d2-44b1-b0f7-aaf84a2e4537:3"
    class: REMEDIABLE
    governing_clause: "Task 4"
    outcome: remediated
    summary: "Verified, 99% confidence: src/conductor/src/cli-pre-dispatch.ts:129 exports undeclaredRegistryCommands with only test callers. Production-source and repository symbol searches found no production invocation."
  - gate: architecture_review_as_built
    finding: "as-built:8f309e68-f7d2-44b1-b0f7-aaf84a2e4537:4"
    class: REMEDIABLE
    governing_clause: "Task 8"
    outcome: remediated
    summary: "Verified, 99% confidence: src/conductor/src/cli-defaults.ts:7 RUNTIME_FALLBACK_FLAGS and :22 defaultMismatches have only test consumers. Production-source and repository symbol searches found no production callers for either export."
  - gate: architecture_review_as_built
    finding: "as-built:7122e38d-dc42-49a7-a33f-6b025c0999a5:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-14-commander-program-is-the-cli-catalog decision 2"
    outcome: remediated
    summary: "Verified, 99% confidence: src/conductor/src/cli-pre-dispatch.ts:88-91 skips option names but interprets their values as subcommands. `shipment-evidence --event audit --pr https://github.com/o/r/pull/1 --help` incorrectly prints audit help; `--event reconcile` similarly prints reconcile help. Both name the parent check command with an event-file path, as confirmed by src/conductor/src/engine/shipment-evidence-cli.ts:83-93. This loop was introduced in remediation commit 894171677c, so the prior review could not inspect it. Distinguish option values from command-path tokens when selecting help."
---

## Cost
input: 1234772
output: 145625
cache_read: 22872872
cache_creation: 758326
cost_usd: 20.0166
dispatches: 27
retries: 2
halts: 0
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 1234632, output: 78346, cache_read: 18909184, cache_creation: 0, cost_usd: 11.8111, dispatches: 15, cost_unmetered: 0
  claude: input: 140, output: 67279, cache_read: 3963688, cache_creation: 758326, cost_usd: 8.2055, dispatches: 12, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","5af97bb6-100b-4463-a28d-f2a5bf04a07e","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 3
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 3
  security: failures: 0, judged: 3
  testQuality: failures: 0, judged: 3
skip_reasons:
  disabled: 3
