---
slug: step-applicability-is-fixed-repo-wide-decide-canno
spec_hash: b8b2075d4f6869f648a17b27d3a1c5b09750473f1a21207f1ed338dbd722a6e4
pr: https://github.com/jstoup111/ai-conductor/pull/2992
shipped: 2026-10-06
engine_version: 20261006T095922Z-fd83edec5ce4
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "No story or task asks to change backlog eligibility when the batch prefetch fails. The change makes a prefetch failure stop hiding the whole backlog. That is a fail-safe behavior change outside the applicability scope, and operators see it only as features dispatching instead of vanishing."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-2
    summary: "Task 8 requires the marker to be read at the claim-pinned base ref. Pinning the entire eligibility scan and work-order base to scan-time SHA, plus a new hard-fail on resolution, goes beyond the marker read. It serves FR-7's base-only authority and does not alter step selection, so it falls within intent."
    accepted: false
    authority: engine
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-3
    summary: "The added counter is bounded (event/step/cause/priorStatus labels only, tested) and directly serves Story 9's telemetry export, so the behavior is within intent. However, the protected-plan edit has no reseal rationale in the supplied evidence. Its only justification is the note's own 'operator-approved' claim."
    accepted: false
    authority: engine
  - gate: architecture_review_as_built
    finding: AB-A5
    class: REMEDIABLE
    governing_clause: "adr-2026-10-03-per-feature-step-applicability decision 3"
    outcome: remediated
    summary: "Verified 96%: dispatch consumes persisted declarations without consulting isFeatureDeclarable or featureInapplicableAllowed. The approved diagram's direct metadata-to-selector defense and D3's dispatch-level prohibition are absent."
  - gate: architecture_review_as_built
    finding: AB-R1
    class: REMEDIABLE
    governing_clause: "Task 8"
    outcome: remediated
    summary: "Verified 100%: discovery creates declarations, marker hash, and ignored cause, but WorkOrder and both conversions omit them (work-order.ts:17-29; daemon-cli.ts:293-302,1816-1835). deriveDaemonBaseState therefore receives absent fields, seeds [], and clears the hash/cause, making normal daemon applicability behavior unreachable."
  - gate: architecture_review_as_built
    finding: AB-R2
    class: REMEDIABLE
    governing_clause: "Task 8"
    outcome: remediated
    summary: "Verified 100%: the production gitTreeSource converts .docs tree/blob failures into an empty map or null (daemon-backlog.ts:84-95,137-145), so discoverBacklog's applicability read-failure catch and required diagnostic (daemon-backlog.ts:1177-1184) are unreachable outside the injected test seam."
  - gate: architecture_review_as_built
    finding: AB-R3
    class: REMEDIABLE
    governing_clause: "Task 15"
    outcome: remediated
    summary: "Verified 99%: scanInheritedState and renderDashboard support inapplicable lines, but conduct daemon status runs daemon-observe-cli.ts:630-676 and never invokes that renderer or consumes the inapplicable field."
  - gate: architecture_review_as_built
    finding: AB-A1
    class: REMEDIABLE
    governing_clause: "adr-2026-10-03-per-feature-step-applicability decision 5"
    outcome: remediated
    summary: "Verified 100%: marker bytes/hash and decider attribution are still derived from mutable baseBranch during discovery (daemon-backlog.ts:742-744,1177-1205), then copied into a work order whose baseSha is resolved later (daemon-cli.ts:1819-1840). Neither applicability surface is read or verified at the claim-pinned SHA required by D5."
  - gate: architecture_review_as_built
    finding: AB-A2
    class: REMEDIABLE
    governing_clause: "adr-2026-10-03-per-feature-step-applicability decision 7"
    outcome: remediated
    summary: "Verified 99%: done/skipped steps continue at conductor.ts:7732-7782 and preserved stale steps continue at 7791-7815 before the refusal emitter at 7926-7934. Normal resume also begins after completed work, so required late-refusal events are bypassed."
  - gate: architecture_review_as_built
    finding: AB-A3
    class: REMEDIABLE
    governing_clause: "adr-2026-10-03-per-feature-step-applicability decision 8"
    outcome: remediated
    summary: "Verified 99%: applicability is honored at conductor.ts:7883-7924 before config disable is evaluated at 8047-8052. A declared, config-disabled manual_test is therefore relabeled inapplicable instead of preserving existing config-skip behavior."
  - gate: architecture_review_as_built
    finding: AB-A4
    class: REMEDIABLE
    governing_clause: "adr-2026-10-03-per-feature-step-applicability decision 4"
    outcome: remediated
    summary: "Verified 99%: validateApplicability rejects a disabled capability only when at least one declaration parsed. Empty or prose-only markers therefore pass land while the repository toggle is off."
  - gate: architecture_review_as_built
    finding: AB-A6
    class: REMEDIABLE
    governing_clause: "adr-2026-10-03-per-feature-step-applicability decision 4"
    outcome: remediated
    summary: "Verified 98%: land validates only the single applicability file selected by pickIdeaFile. Applicability is omitted from exhaustive family validation, while git add .docs stages every marker, allowing an unvalidated sibling marker to land."
  - gate: architecture_review_as_built
    finding: AB-A7
    class: REMEDIABLE
    governing_clause: "adr-2026-10-03-per-feature-step-applicability decision 1"
    outcome: remediated
    summary: "Verified 98%: backlog discovery implements the approved guarded undated-stem fallback, but dispatch tamper/interactive detection reads only .docs/applicability/<slug>.md. Undated worktree markers can evade branch-only or interactive reporting."
  - gate: architecture_review_as_built
    finding: AB-A8
    class: REMEDIABLE
    governing_clause: "adr-2026-10-03-per-feature-step-applicability decision 1"
    outcome: remediated
    summary: "Verified 96%: parseApplicability accepts ASCII ' - ' in addition to the ADR-authorized em-dash declaration grammar; the approved ADR was not amended or superseded."
  - gate: architecture_review_as_built
    finding: AB-A10
    class: REMEDIABLE
    governing_clause: "adr-2026-10-03-per-feature-step-applicability decision 8"
    outcome: remediated
    summary: "Verified 99%: live halted features violate D8's requirement that daemon status show the durable applicability record per feature. The halted-state branch reads conduct state but does not project feature_inapplicable into HaltedEntry (daemon-dashboard.ts:36,623-639); projection exists only for InProgressEntry (daemon-dashboard.ts:699-703), and renderInapplicableSection iterates only state.inProgress (daemon-observe-cli.ts:627-636). Thus a feature that honors an inapplicable step and later halts loses that distinction from conduct daemon status. This residual was introduced by the prior AB-R3 remediation, so it was not visible in the earlier lap."
---

## Cost
input: 3885215
output: 466500
cache_read: 74052709
cache_creation: 2247132
cost_usd: 59.4066
dispatches: 82
retries: 7
halts: 8
unmetered: count: 1, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 3884825, output: 233966, cache_read: 56602624, cache_creation: 0, cost_usd: 31.7573, dispatches: 55, cost_unmetered: 0
  claude: input: 390, output: 232534, cache_read: 17450085, cache_creation: 2247132, cost_usd: 27.6493, dispatches: 27, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","1523f244-684f-4306-8867-c3a9c13be472","lifecycle-step","finish"],step:execution\u0000["timing-rollup","persisted-ledger","4221b05c-7d62-4db6-b908-8c60b42ef705","lifecycle-step","architecture_review_as_built"],step:execution\u0000["timing-rollup","persisted-ledger","cc14640d-ee7d-4400-b15d-94e94965e8d3","lifecycle-step","prd_audit"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 5
  security: failures: 0, judged: 5
  testQuality: failures: 0, judged: 5
skip_reasons:
