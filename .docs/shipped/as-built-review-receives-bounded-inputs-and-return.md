---
slug: as-built-review-receives-bounded-inputs-and-return
spec_hash: b007274820583fe9d1a975abac2e2147c913cc718d1dfbe7c5de8cdd5eabeba3
pr: https://github.com/jstoup111/ai-conductor/pull/2748
shipped: 2026-09-26
engine_version: 20260926T130155Z-4676e13f10c4
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.2
    summary: "src/conductor/src/engine/conductor.ts:3140 — the pre-finish fence skip for non-verifying conductors now depends on a finish-coordinator flag, not on daemon mode"
    accepted: true
  - gate: architecture_review_as_built
    finding: AB-1
    class: REMEDIABLE
    governing_clause: "adr-2026-08-25-as-built-remediable-findings-bounded-build-route D7"
    outcome: remediated
    summary: "Pending-finding ledger validation accepts malformed typed governing references instead of rejecting the ledger fail-closed."
  - gate: architecture_review_as_built
    finding: AB-2
    class: REMEDIABLE
    governing_clause: "Task 11"
    outcome: remediated
    summary: "A selected provider lacking native-schema capability is downgraded to retryable structured-result-missing when a later configured candidate is capable."
  - gate: architecture_review_as_built
    finding: AB-3
    class: REMEDIABLE
    governing_clause: "adr-2026-09-07-durable-prd-widening-decision-reconciliation D7"
    outcome: remediated
    summary: "Unreadable active-plan and governing-ADR inputs throw past the typed projection-fault result instead of entering the deterministic no-retry input-fault lane."
  - gate: architecture_review_as_built
    finding: AB-4
    class: REMEDIABLE
    governing_clause: "adr-2026-09-07-durable-prd-widening-decision-reconciliation D6"
    outcome: remediated
    summary: "Missing or invalid structured results bypass the diagram's mechanical-fault route and fall through ordinary retry and `needs-human` handling."
  - gate: architecture_review_as_built
    finding: AB-5
    class: REMEDIABLE
    governing_clause: "Task 18"
    outcome: remediated
    summary: "Validation-group routing still feeds the first artifact to the Markdown classifier at `src/conductor/src/engine/conductor.ts:8825-8834`, and group execution does not consume the deterministic `asBuiltFault` lane."
  - gate: architecture_review_as_built
    finding: AB-6
    class: REMEDIABLE
    governing_clause: "Task 19"
    outcome: remediated
    summary: "Recorded findings are written into Markdown at `src/conductor/src/engine/conductor.ts:2671-2688` rather than into the typed verdict, leaving the typed `recordedFindings` capability without a production writer."
  - gate: architecture_review_as_built
    finding: AB-7
    class: REMEDIABLE
    governing_clause: "Task 20"
    outcome: remediated
    summary: "Finish publication and shipment association still read and scrape the Markdown report at `src/conductor/src/engine/finish-publication-production.ts:317-323` and `src/conductor/src/engine/shipment-association.ts:198-223`."
  - gate: architecture_review_as_built
    finding: AB-8
    class: REMEDIABLE
    governing_clause: "Task 22"
    outcome: remediated
    summary: "Operator rewind clears only the gate-state artifact at `src/conductor/src/engine/rewind.ts:141-166`; it does not clear or rollback-restore the typed-verdict/report pair."
  - gate: architecture_review_as_built
    finding: AB-9
    class: REMEDIABLE
    governing_clause: "Task 23"
    outcome: remediated
    summary: "The legacy verdict-line module, Blocking Findings parser, governing-clause resolver, and production Markdown consumers remain at `src/conductor/src/engine/as-built-verdict-line.ts:1`, `src/conductor/src/engine/artifacts.ts:4593`, and `src/conductor/src/engine/conductor.ts:760`."
  - gate: architecture_review_as_built
    finding: AB-10
    class: REMEDIABLE
    governing_clause: "Task 24"
    outcome: remediated
    summary: "`test/check_as_built_markdown_authority.sh` is absent and the integrity suite has no wiring for it, so the derived-only Markdown boundary is not mechanically enforced."
  - gate: architecture_review_as_built
    finding: AB-11
    class: REMEDIABLE
    governing_clause: "Task 25"
    outcome: remediated
    summary: "The shipped §12 skill still contains bounded-read recipes, the report/table format, governing-clause grammar, mandatory overwrite, and marker instructions at `skills/architecture-review/SKILL.md:452-590`, contrary to the approved judgement-only boundary."
  - gate: architecture_review_as_built
    finding: AB-12
    class: REMEDIABLE
    governing_clause: "Task 26"
    outcome: remediated
    summary: "The §12 output-format audit is absent, and `src/conductor/test/skill-contracts.test.ts:11-16` still requires the retired `Verdict:` and `Outcome delivered:` prose."
---

## Cost
input: 7276933
output: 904339
cache_read: 195621917
cache_creation: 1786203
cost_usd: 135.2688
dispatches: 287
retries: 7
halts: 8
unmetered: count: 208, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 7276491, output: 646579, cache_read: 179876480, cache_creation: 0, cost_usd: 67.0182, dispatches: 266, cost_unmetered: 0
  claude: input: 442, output: 257760, cache_read: 15745437, cache_creation: 1786203, cost_usd: 68.2507, dispatches: 21, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","9ef82220-2f49-47aa-95f8-231b65084401","lifecycle-step","finish"]

## Build Review
laps_to_pass: 2
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 4
  testQuality: failures: 1, judged: 4
skip_reasons:
