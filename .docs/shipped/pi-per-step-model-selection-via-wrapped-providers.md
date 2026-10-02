---
slug: pi-per-step-model-selection-via-wrapped-providers
spec_hash: 6b6787e49fee1bb3cc1df3e4dffa5b3d1b75183690f61b5d9467e64fb41d0758
pr: https://github.com/jstoup111/ai-conductor/pull/2880
shipped: 2026-10-02
engine_version: 20261001T231952Z-4b73f5cb657b
findings:
  - gate: prd_audit
    grade: OVER_SCOPE
    criterion: S5.10
    summary: "src/conductor/src/engine/resolved-config.ts:350 applies escalateAttempt to every preferred candidate resolved without CLI overrides, regardless of provider; provider-execution.ts:544-545 forwards attempt/escalate for candidate 0 and group-core.ts:674/:746 supplies them; test/acceptance/per-step-provider-routing-927.acceptance.test.ts:364 now expects a claude/codex scalar retry at attempt 2 to run at effort `high` where base 1e154152f kept the original effort"
    accepted: true
    decision: accept
    rationale: "Operator accepts: retry escalation for preferred candidates is a bug fix, not a regression."
  - gate: architecture_review_as_built
    finding: AR-ASBUILT-1
    class: REMEDIABLE
    governing_clause: "adr-2026-09-24-built-in-provider-catalog-and-boot-discovery decision 13"
    outcome: remediated
    summary: "Verified at 99% confidence: createProviderRuntimeSet supports config-aware Pi policy resolution, but both production roots omit config (index.ts:1648; daemon-cli.ts:1255). The dispatcher consequently consumes Pi's empty catalog policy, so llm_providers.pi.model and its escalation/fallback orders do not reach production."
  - gate: architecture_review_as_built
    finding: AR-ASBUILT-2
    class: REMEDIABLE
    governing_clause: "adr-2026-07-03-reactive-model-fallback-ladder decision 7"
    outcome: remediated
    summary: "Verified at 99% confidence: the configured fallback-ladder integration is unwired. The production runtime is created without config, while provider-execution.ts:540 omits the new providerKey/config inputs and does not consume the resolver's returned modelFallbackLadder."
  - gate: architecture_review_as_built
    finding: AR-ASBUILT-3
    class: REMEDIABLE
    governing_clause: "adr-2026-09-24-built-in-provider-catalog-and-boot-discovery decision 13"
    outcome: remediated
    summary: "Verified at 99% confidence: collectProviderModelSelections disagrees with runtime provider semantics. It misses inherited step/by-tier models when run-level Pi is selected, but attributes a primary Claude model such as `opus` to every fallback candidate, causing valid `[claude, pi]` configurations to fail Pi syntax validation instead of using llm_providers.pi.model."
  - gate: architecture_review_as_built
    finding: AR-ASBUILT-4
    class: REMEDIABLE
    governing_clause: "Task 9"
    outcome: remediated
    summary: "Verified at 99% confidence: serial Conductor dispatch resolves a run-level Claude `defaults.model` against an explicitly Pi-routed step, then forwards it as `modelOverride`. Pi receives `opus` instead of `llm_providers.pi.model`, violating Story 4 and D13."
  - gate: architecture_review_as_built
    finding: AR-ASBUILT-5
    class: REMEDIABLE
    governing_clause: "adr-2026-09-24-built-in-provider-catalog-and-boot-discovery decision 13"
    outcome: remediated
    summary: "Verified at 98% confidence: the coverage-binding auxiliary selects Pi independently but derives its model and ladder from the run-level runner policy, so a Pi judge can receive a Claude model instead of Pi’s configured native default."
  - gate: architecture_review_as_built
    finding: AR-ASBUILT-6
    class: REMEDIABLE
    governing_clause: "adr-2026-07-03-reactive-model-fallback-ladder decision 4"
    outcome: remediated
    summary: "Verified at 99% confidence: provider-aware dispatch invokes the requested model before consulting the process dead-model cache. A model already marked unavailable is invoked again, contrary to D4’s pre-invoke substitution requirement."
  - gate: architecture_review_as_built
    finding: AR-ASBUILT-7
    class: REMEDIABLE
    governing_clause: "Task 11"
    outcome: remediated
    summary: "Verified at 98% confidence: validation-group retries pass `attempt` and `escalate`, but preferred-provider resolution never applies `escalateAttempt`. A preferred Pi group member therefore does not move to the configured mid model on attempt 3."
  - gate: architecture_review_as_built
    finding: AR-ASBUILT-8
    class: REMEDIABLE
    governing_clause: "Task 10"
    outcome: remediated
    summary: "Verified at 99% confidence: the changed `ResolvedFallbackProviderNativeConfig.modelFallbackLadder` return field has no production consumer. The live ladder is supplied separately by ProviderRuntime, leaving this changed primitive unreachable."
  - gate: architecture_review_as_built
    finding: AR-ASBUILT-12
    class: REMEDIABLE
    governing_clause: "adr-2026-07-03-reactive-model-fallback-ladder decision 8"
    outcome: remediated
    summary: "Verified at 99% confidence from current source: after a Pi model ladder exhausts, executeProviderCandidates omits resolvedModel, resolvedEffort, and actualProvider from its failure result (provider-execution.ts:1201-1225). The enclosing step_retry therefore lacks Pi’s full provider/model id and effort, violating observable-rung decision D8 and planned Task 12."
  - gate: architecture_review_as_built
    finding: AR-ASBUILT-13
    class: REMEDIABLE
    governing_clause: "adr-2026-09-24-built-in-provider-catalog-and-boot-discovery decision 13"
    outcome: remediated
    summary: "Verified at 99% confidence from current source: a rubric-only Pi selection is recognized as configured by collectProviderModelSelections, but installation and registered-provider validation inspect only run-level and steps.* selections (provider-selection.ts:60-130). If Pi is missing, boot skips the model probe and never raises the required not-installed error for this D13 configuration surface."
---

## Cost
input: 4326215
output: 492052
cache_read: 97625635
cache_creation: 2201641
cost_usd: 72.5875
dispatches: 72
retries: 3
halts: 8
unmetered: count: 0, duration_ms: 0
cost_unmetered: count: 0
providers:
  codex: input: 4325673, output: 264652, cache_read: 79843968, cache_creation: 0, cost_usd: 41.5643, dispatches: 37, cost_unmetered: 0
  claude: input: 542, output: 227400, cache_read: 17781667, cache_creation: 2201641, cost_usd: 31.0232, dispatches: 35, cost_unmetered: 0

## Time
state: partial
reason: open-executions:step:execution\u0000["timing-rollup","persisted-ledger","cc0fb7a3-3994-4871-bacb-2557612420e1","lifecycle-step","architecture_review_as_built"],step:execution\u0000["timing-rollup","persisted-ledger","ef535ad0-5270-497b-914d-8711f0a17efc","lifecycle-step","prd_audit"],step:execution\u0000["timing-rollup","persisted-ledger","fdce9808-85d8-40b0-8ad0-345b16ce4368","lifecycle-step","finish"]

## Build Review
laps_to_pass: 1
skipped: 0
cache_hits: 0
infrastructure_failures: 0
rubrics:
  eventSpine: failures: 0, judged: 6
  security: failures: 0, judged: 6
  testQuality: failures: 2, judged: 6
skip_reasons:
