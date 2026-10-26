---
slug: break-the-engine-ui-import-cycle-and-stop-types-im
spec_hash: 4fa78d417b623567ff16fcb5f24eef02f7652f996f56f1178c6a08039e00d9ed
pr: https://github.com/jstoup111/ai-conductor/pull/3454
shipped: 2026-10-26
engine_version: 20261026T134330Z-de66138a044b
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: NC-1
    summary: "The plan moves these declarations into types/ but does not explicitly call for exposing them through the public types barrel. The addition is purely additive (types plus one const already exported from engine), follows naturally from relocating the declarations into types/, and removes nothing."
    accepted: false
    authority: engine
  - gate: architecture_review_as_built
    finding: "as-built:09c1cf0d-d0ce-4d16-9db4-78fc622eb44d:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-12-enforced-source-layer-directions decision 6"
    outcome: remediated
    summary: "Verified: three forbidden upward edges remain allowlisted: src/conductor/src/engine/daemon-command.ts:10 imports ../cli-defaults.js; src/conductor/src/engine/kickback-budget-cli.ts:5 imports ../cli.js; src/conductor/src/execution/provider-catalog.ts:13 imports engine/self-host/transcript-format.js. Their entries remain at src/conductor/test/structural/layer-allowlist.txt:52,77,238. D6 requires zero upward-edge entries. Resolve all three dependencies and remove their exemptions."
  - gate: architecture_review_as_built
    finding: "as-built:09c1cf0d-d0ce-4d16-9db4-78fc622eb44d:2"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-12-enforced-source-layer-directions decision 5"
    outcome: remediated
    summary: "Verified: shared types were copied into types/ while former modules retain independent declarations instead of importing them back. All duplicate sites: src/conductor/src/execution/llm-provider.ts:7,40,62,65,68,80,93,102,108; src/conductor/src/execution/managed-session-preparation.ts:9; src/conductor/src/engine/build-review-domain.ts:24,937; src/conductor/src/engine/github-operations.ts:70,311; src/conductor/src/engine/github-bot-auth-refusal.ts:2; src/conductor/src/engine/child-context.ts:4; src/conductor/src/engine/restack/restack-types.ts:4,7,10,19,21,33; src/conductor/src/engine/routing/route-types.ts:10,12,24; src/conductor/src/engine/engineer/land-spec.ts:148,200; src/conductor/src/engine/park-reconciliation.ts:79; src/conductor/src/engine/halt-marker.ts:52; src/conductor/src/engine/engineer/intake/sanitize-inbound.ts:18. Replace these declarations with imports/re-exports of their canonical types/ definitions."
  - gate: architecture_review_as_built
    finding: "as-built:09c1cf0d-d0ce-4d16-9db4-78fc622eb44d:3"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-12-enforced-source-layer-directions decision 5"
    outcome: remediated
    summary: "Verified: the real rubric descriptor catalog at src/conductor/src/engine/build-review-registry.ts:83 remains an array permitting missing rubric IDs. The factory at :71 casts its result to an exhaustive Record, and :145 constructs the live registry through that cast. This does not enforce D5's compile-time completeness requirement. Constrain the actual descriptor catalog to cover exactly BuildReviewRubricId."
  - gate: architecture_review_as_built
    finding: "as-built:09c1cf0d-d0ce-4d16-9db4-78fc622eb44d:4"
    class: REMEDIABLE
    governing_clause: "Task 13"
    outcome: remediated
    summary: "Verified: task 13 requires preserving the provider-literal check without new exemptions. src/conductor/test/engine/provider-id-literals.test.ts:25 adds two exempt modules and :96 skips them. These conceal new provider literals in src/conductor/src/execution/build-review-read-only-capability.ts:8,9,10,14,15,16 and src/conductor/src/execution/pi-self-host-auth.ts:64. Restore catalog-owned identities and remove both exemptions while retaining the approved dependency direction."
  - gate: architecture_review_as_built
    finding: "as-built:faa8da7e-a072-499b-a402-29f07b925713:1"
    class: REMEDIABLE
    governing_clause: "adr-2026-10-12-enforced-source-layer-directions decision 5"
    outcome: remediated
    summary: "Verified (99%): prior duplicate-type finding remains partially unresolved. AuthenticationReadinessState is independently declared at src/conductor/src/execution/llm-provider.ts:36 and src/conductor/src/types/provider.ts:8. Import/re-export the canonical types/ declaration instead."
  - gate: architecture_review_as_built
    finding: "as-built:faa8da7e-a072-499b-a402-29f07b925713:2"
    class: REMEDIABLE
    governing_clause: "Task rem-as-built-R13e"
    outcome: remediated
    summary: "Verified (99%): the required adapter display-name guard restoration remains incomplete. src/conductor/test/engine/provider-id-literals.test.ts:140 checks only foreignProviders; assertions at :345 and :371 still accept adapters' own display-name literals. Restore detection and both original assertions. The permitted leaf identity extraction resolves the former helper exemptions and is not itself a violation."
---

## Cost
input: 2944389
output: 282017
cache_read: 74493177
cache_creation: 2018285
cost_usd: 48.2605
dispatches: 39
retries: 9
halts: 2
unmetered: count: 2, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 2944199, output: 194402, cache_read: 60706816, cache_creation: 0, cost_usd: 27.6039, dispatches: 27, cost_unmetered: 0
  claude: input: 190, output: 87615, cache_read: 13786361, cache_creation: 2018285, cost_usd: 20.6566, dispatches: 12, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","79e56fcc-4a10-4d6b-8bd6-adda24622715","lifecycle-step","finish"]

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
