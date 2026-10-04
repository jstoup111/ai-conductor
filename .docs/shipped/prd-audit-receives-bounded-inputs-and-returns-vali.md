---
slug: prd-audit-receives-bounded-inputs-and-returns-vali
spec_hash: aec5872c65791250cf870b00efb69478213d4cf8473183c96c3a22476c3da3f3
pr: https://github.com/jstoup111/ai-conductor/pull/2897
shipped: 2026-10-04
engine_version: 20261004T114847Z-0e5c5e599a67
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC.1
    summary: "src/conductor/src/engine/story-criteria.ts:190-200 — the general story-readability check behind the stories gate (artifacts.ts:3884) and engineer land (land-spec.ts:418) now requires every block to pass the strict sealed-criteria reader, which changes which stories files those DECIDE gates accept"
    accepted: true
    decision: accept
    rationale: "Operator accepts: one shared sealed-story readability contract for the stories gate, engineer land and the PRD audit projection is the intended consistency (AR-PLAN-1); a heading-less single-story file should be refused everywhere."
  - gate: architecture_review_as_built
    finding: AB-ADR-D3-INCOMPLETE-DIAGNOSTICS
    class: REMEDIABLE
    governing_clause: "adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity decision 3"
    outcome: remediated
    summary: "[97% verified] src/conductor/src/engine/conductor.ts:2887-2890 collapses structured-result-rejected into structured-result-missing, discarding rejected-entry diagnostics persisted by step-runners.ts:1261-1274; the later incomplete-verdict diagnostic branch is unreachable for that production outcome."
  - gate: architecture_review_as_built
    finding: AB-ADR-D2-CODE-STAMP
    class: REMEDIABLE
    governing_clause: "adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity decision 2"
    outcome: remediated
    summary: "[97% verified] step-runners.ts:1258-1287 permits successful persistence with codeStamp null; artifacts.ts:2585-2593 and 3251-3264 can then accept the matching-attempt verdict, while artifacts.ts:2563-2576 later backfills a completion-time HEAD and suppresses write failure. This does not prove the judgment against its settle-time reviewed commit."
  - gate: architecture_review_as_built
    finding: AB-ADR-D4-NO-OWNER-ORDINAL
    class: REMEDIABLE
    governing_clause: "adr-2026-08-24-over-scope-decision-block-and-durable-refusals decision 4"
    outcome: remediated
    summary: "[97% verified] prd-audit-verdict-store.ts:98-108 accepts arbitrary nonblank no-owner presentation ordinals without grammar or uniqueness checks. The typed adapter and widening classifier can consequently reinterpret a forged ordinal such as S1.1 as a stable criterion and inherit criterion-keyed operator authority."
  - gate: architecture_review_as_built
    finding: AB-REACHABILITY-LEGACY-WIDENING
    class: REMEDIABLE
    governing_clause: "Task 31"
    outcome: remediated
    summary: "[98% verified] accepted-widenings.ts:578 isNoOwnerCriterion is reachable only through the legacy decisionMatchesFinding/recordOverScopeDecisions and parseClearedOverScopeDecisions path, which has no production caller under src/conductor/src. Its only consumers are tests, leaving obsolete Markdown-era widening machinery in production."
  - gate: architecture_review_as_built
    finding: AB-ADR-D2-REVIEWED-HEAD-RACE
    class: REMEDIABLE
    governing_clause: "adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity decision 2"
    outcome: remediated
    summary: "[98% verified] The projection freezes the reviewed HEAD in prd-audit-projection.ts:367-379, but after provider review step-runners.ts:1252-1261 reads and persists the then-current HEAD without comparing it to the projected SHA. Concurrent HEAD movement can therefore stamp unreviewed code as reviewed. This also violates adr-2026-07-22-gate-evidence-code-validity-on-redispatch D1."
  - gate: architecture_review_as_built
    finding: AB-ADR-D2-CURRENT-ATTEMPT-SURFACE-HIT
    class: REMEDIABLE
    governing_clause: "adr-2026-07-22-gate-evidence-code-validity-on-redispatch decision 2"
    outcome: remediated
    summary: "[98% verified] prdAuditVerdictIdentity reports an invalid code stamp but marks it stale only when the attempt identity also differs (artifacts.ts:2560-2574). Consequently, the completion predicate at artifacts.ts:3201-3257 and classifyPrdAuditGaps at artifacts.ts:4231-4245 can consume a matching-attempt verdict after a gate-surface hit, unreachable anchor, or uncomputable delta. D2 requires those conditions to invalidate the verdict and rerun regardless of attempt identity."
  - gate: architecture_review_as_built
    finding: AB-ADR-D4-ROUTING-READERS-BYPASS-IDENTITY
    class: REMEDIABLE
    governing_clause: "adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity decision 4"
    outcome: remediated
    summary: "[97% verified] Direct typed-verdict consumers bypass the shared identity/validity helper: PLAN_GAP routing at conductor.ts:4149-4230, OVER_SCOPE reconciliation and routing at conductor.ts:4568-4649, the mixed-blocker reader at conductor.ts:4222-4230, and remediation admission at conductor.ts:4748-4769. Caller sequencing through a handshake does not satisfy D4's requirement that every halt/routing reader consult the same identity check, and later re-reads can consume evidence invalidated after that handshake."
  - gate: architecture_review_as_built
    finding: AB-ADR-D3-PRIOR-RESULT-HANDSHAKE
    class: REMEDIABLE
    governing_clause: "adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity decision 3"
    outcome: remediated
    summary: "[99% verified] D3 requires a terminal result persisted by THIS dispatch, and D7.2 says code-validity opt-out cannot disable typed attempt identity. In src/conductor/src/engine/artifacts.ts:2592-2613, the raw attempt mismatch is exposed as staleRunIdentity only when code validity returns rerun. A prior attempt therefore remains present when its stamp is preservable or when code validity is disabled. The post-dispatch handshake at src/conductor/src/engine/conductor.ts:2918-2950 can accept that earlier result; serial and validation-group paths then proceed at conductor.ts:11542-11552 and conductor.ts:8440-8453/8724-8739. The same shared misclassification reaches completion and gap classification at artifacts.ts:3260-3321 and artifacts.ts:4295-4306, plus PLAN_GAP routing, mixed-blocker inspection, widening reconciliation, OVER_SCOPE routing, and remediation admission at conductor.ts:4161-4169, 4268-4273, 4506-4516, 4620-4629, and 4811-4831. This defect was introduced while remediating the prior reader-centralization findings; those prior call-site bypasses are otherwise resolved."
---

## Cost
input: 13373395
output: 1380553
cache_read: 356969416
cache_creation: 3907712
cost_usd: 181.341
dispatches: 399
retries: 13
halts: 10
unmetered: count: 255, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 13372475, output: 1027998, cache_read: 326629504, cache_creation: 0, cost_usd: 121.4072, dispatches: 339, cost_unmetered: 0
  claude: input: 920, output: 352555, cache_read: 30339912, cache_creation: 3907712, cost_usd: 59.9338, dispatches: 60, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","6c50b058-93a7-4fe4-902f-421aa9d2df87","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 10
  security: failures: 0, judged: 10
  testQuality: failures: 1, judged: 10
skip_reasons:
