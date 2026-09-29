---
slug: pi-as-a-build-provider
spec_hash: 1bff4a4f54a945deb1a768dc4bc6e7946808f9b27e638dbb08cc744edd41ec9a
pr: https://github.com/jstoup111/ai-conductor/pull/2765
shipped: 2026-09-29
engine_version: 20260929T040448Z-0380da0011dc
findings:
  - gate: architecture_review_as_built
    finding: AB-5
    class: REMEDIABLE
    governing_clause: "adr-2026-09-24-built-in-provider-catalog-and-boot-discovery decision 1"
    outcome: remediated
    summary: "Verified (100%): catalog centralization is incomplete. provider-model-policy.ts retains a codex-keyed opt-in table, and self-host/environment-claim-audit.ts retains a claude/codex-keyed sandbox table. The structural guard checks string literals but misses identifier property keys."
  - gate: architecture_review_as_built
    finding: AB-6
    class: REMEDIABLE
    governing_clause: "adr-2026-08-12-live-provider-coverage-from-plugin-registry decision 1"
    outcome: remediated
    summary: "Verified (100%): the structural live-coverage test enumerates an external plugin id but does not require that plugin to have a descriptor and smoke leg. An uncovered external provider therefore passes the check."
  - gate: architecture_review_as_built
    finding: AB-7
    class: REMEDIABLE
    governing_clause: "Task 7"
    outcome: remediated
    summary: "Verified (100%): defaultCiFixProbe was materially converted to catalog-derived executable/version data but has no production caller. Repository-wide source inspection found only its declaration, comments, and tests, making it an unreachable rung."
  - gate: architecture_review_as_built
    finding: AB-8
    class: REMEDIABLE
    governing_clause: "adr-2026-09-24-built-in-provider-catalog-and-boot-discovery decision 8"
    outcome: remediated
    summary: "100% verified from current source: compose/engineer validates configured providers, but launchClaudeEngineer always spawns Claude. Installed Pi plus missing Claude can pass boot and fail only at spawn; external plugins are also not discovered for this fresh registry."
  - gate: architecture_review_as_built
    finding: AB-10
    class: REMEDIABLE
    governing_clause: "adr-2026-09-24-built-in-provider-catalog-and-boot-discovery decision 2"
    outcome: remediated
    summary: "100% verified from current source: catalog nativeSchema, writeFence, and supportsSessionResume flags are not authoritative. Consumers still use adapter/runtime properties or provider identity, so removing a descriptor flag would not fail closed."
  - gate: architecture_review_as_built
    finding: AB-11
    class: REMEDIABLE
    governing_clause: "adr-2026-09-10-portable-build-review-policy decision 5"
    outcome: remediated
    summary: "100% verified from current source: a Pi custom-policy candidate throws ProviderCapabilityUnsupportedError before setup-unavailable normalization. The exception escapes candidate execution, records no skipped attempt, and prevents fallback to the next capable provider."
  - gate: architecture_review_as_built
    finding: AB-12
    class: REMEDIABLE
    governing_clause: "adr-2026-09-24-built-in-provider-catalog-and-boot-discovery decision 3"
    outcome: remediated
    summary: "100% verified from current source: wireOtelVisualizer calls registerBuiltins without an installed-provider set, causing its production registry to register every catalog provider, including unavailable ones."
  - gate: architecture_review_as_built
    finding: AB-13
    class: REMEDIABLE
    governing_clause: "Task 3"
    outcome: remediated
    summary: "100% verified by repository-wide source search: deepFreezePolicy is exported from provider-model-policy-defaults.ts but has no caller, making it an unreachable rung."
  - gate: architecture_review_as_built
    finding: AB-15
    class: REMEDIABLE
    governing_clause: "Task rem-prd-audit-rem-s1-2-1"
    outcome: remediated
    summary: "Verified with 97% disposition confidence: provider-runtime.ts:9 materially changes validateSpawnPermit into a compatibility re-export, but its only consumer is provider-runtime.test.ts:18. Claude, Codex, and Pi import execution/spawn-permit.ts directly, so the exported provider-runtime rung has no production caller and fails the as-built reachability rule."
  - gate: architecture_review_as_built
    finding: AB-19
    class: REMEDIABLE
    governing_clause: "Task 3"
    outcome: remediated
    summary: "Verified 100% from current source: DEFAULT_STEP_MODELS, DEFAULT_STEP_EFFORT, and DEFAULT_STEP_TIER_OVERRIDES were materially changed to catalog-derived exports in resolved-config.ts:35-36,101, but repository-wide references are limited to their declarations, tests, and coherence-check prose. No production caller reaches these legacy aliases; production resolution instead reads the private DEFAULT_PROVIDER_MODEL_POLICY directly."
---

## Cost
input: 9523039
output: 952917
cache_read: 235746231
cache_creation: 3653181
cost_usd: 155.4419
dispatches: 109
retries: 12
halts: 17
unmetered: count: 3, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 9522233, output: 606455, cache_read: 207106560, cache_creation: 0, cost_usd: 98.7514, dispatches: 64, cost_unmetered: 0
  claude: input: 806, output: 346462, cache_read: 28639671, cache_creation: 3653181, cost_usd: 56.6904, dispatches: 45, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","5d629b06-837b-499a-b132-20ee925b74e6","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  security: failures: 0, judged: 9
  testQuality: failures: 1, judged: 9
skip_reasons:
