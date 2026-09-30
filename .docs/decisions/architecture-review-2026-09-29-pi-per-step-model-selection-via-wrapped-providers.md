# Architecture Review: Pi per-step model selection via wrapped providers

**Date:** 2026-09-29
**Stories reviewed:** none yet. This is a pre-stories lightweight review for a Tier M technical
track. Inputs: `.docs/track/pi-per-step-model-selection-via-wrapped-providers.md`, the approved
diagrams in `.docs/architecture/pi-per-step-model-selection-via-wrapped-providers.md`, and issue
jstoup111/ai-conductor#1885.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

The stack is compatible: TypeScript engine changes only, with no new package or external service.
Pi 0.84.3 is already a discovered built-in (adr-2026-09-24-built-in-provider-catalog-and-boot-discovery).

Verified claims:
- Pi CLI behavior (confidence 95%, verified locally against pi 0.84.3 on 2026-09-29):
  - `--provider X --model Y` and `--model X/Y` resolve identically. Both reported provider
    `cline`, model `google/does-not-exist-xyz`.
  - Model ids contain `/` and `:`, for example `cline/google/gemma-4-31b-it:free`. So the
    canonical id splits at the first `/` only.
  - `--thinking` accepts `off|minimal|low|medium|high|xhigh|max`, a superset of the harness
    `EffortLevel`.
  - An unknown provider exits 1 with `Unknown provider "…"`.
  - With an explicit provider, an unknown model id is not rejected by Pi. It reaches the upstream
    call and ends with exit 0 and `stopReason: "error"`. The boot `--list-models` probe is
    therefore the only guard against a mistyped id.
  - `--list-models` prints a whitespace table (`provider  model  context  max-out  thinking
    images`, 162 rows here). It is not filtered by authentication: `cline` is listed while
    unauthenticated.
- Seams exist (confidence 90%, verified by reading source):
  - Argv construction: `pi-provider.ts` `invoke`.
  - Per-step resolution: `resolved-config.ts` `resolveProviderNativeStepConfig`.
  - Per-provider runtime policy: `provider-runtime.ts` `createProviderRuntimeSet`, which builds a
    `ModelAvailability` per provider from its policy.
  - Escalation: `escalation.ts` `escalateAttempt`, which takes a policy argument.
  - Boot validation: `index.ts` provider-dispatching path → `validateProviderInstallation`.
  - Model table: `src/conductor/src/tools/generate-model-table.ts` `buildEngineRows` / `TABLE_HEADER`.
- The run-wide ladder is wrong for mixed-provider runs (confidence 90%, verified).
  `step-runners.ts` builds one `ModelAvailability` from `config.model_fallback_ladder ??
  runLevelPolicy.modelFallbackLadder`, and `attribution-lane.ts` does the same. A Pi step inside
  a Claude run would otherwise walk Claude aliases. This review fixes it with the
  `llm_providers.<id>` block (ladder ADR item 7).

Prerequisites: none. No migration. The new config key is additive, and `.ai-conductor/config.yml`
is not a `settings.json` schema surface.

Integration surface: config, resolution, runtime/escalation, the adapter, boot, and the table
generator. That is six modules in one container, all existing seams.

Worktree isolation: the probe is a read-only subprocess, and it adds no ports, databases, or shared
state.

## Alignment

- **Provider catalog (adr-2026-09-24, amended D12, D13).** The Pi-specific parsing (`provider/model`
  split, effort→thinking) lives in the Pi adapter module and a Pi-owned helper. That keeps D1's
  rule that no production file outside the catalog and the provider's own adapter names a
  provider id literal. The `llm_providers` map is keyed by catalog ids, not by a literal `pi`
  schema key. No capability flag is added, because none would have a consumer.
- **Ladder (adr-2026-07-03, amended items 7, 8).** Item 3's walk semantics, item 4's single
  pre-invoke consult, item 5's loud downgrade log and item 6's cache lifetime are reused unchanged.
  Only the ladder's source becomes per-provider.
- **Boot probe.** It follows adr-2026-09-05-gh-cli-version-floor-and-environment-gate's injectable,
  `assertRealExecAllowed`-guarded runner shape. It also follows catalog D8's
  provider-dispatching-entry-points-only scope, so CI subcommands and the default test suite never
  invoke a real Pi.
- **Event spine.** No new channel. The selection is observable through the existing
  `provider_attempt`, `step_retry` and `step_completed` `model`/`effort` fields (ladder item 8).
  Probe failures are startup errors, the same shape as D4's not-installed error.
- **State.** "Pi with no configured model" is unrepresentable after config load, because
  validation rejects it (D13). `FALLBACK_MODEL='sonnet'` can no longer reach a Pi dispatch.
- **Diagrams.** They were updated in this review: the capability flag was dropped, validation is
  syntax-only, and the `llm_providers` block was added. They match the amended ADRs.

## Wiring Surface

- Pi adapter argv (`--provider`, `--model`, `--thinking`) and its terminal `stopReason: "error"` check. Reached from the existing
  `provider-execution.ts` dispatch → `runtime.provider.invoke` for every Pi step.
- Pi model id parser/helper. Called by the Pi adapter, the config validator and the boot probe.
- Config keys `llm_providers.<id>.model_fallback_ladder` / `.model_escalation_order`:
  - The config loader validates them in `engine/config.ts` and registers them in
    `CONFIG_CONSUMER_KEY_SETS`.
  - `step-runners.ts` and `attribution-lane.ts` consume them, choosing the ladder per dispatched
    provider.
  - `provider-runtime.ts` / `escalation.ts` consume them for the escalation order.
- The Pi-step-requires-a-model validation rule. It runs in `engine/config.ts` at config load, on
  every entry point.
- The Pi model catalog probe. Invoked from the `index.ts` provider-dispatching boot path and the
  daemon boot path (`runDaemonMode`), right after `validateProviderInstallation`. It runs only
  when Pi is installed and configured.
- The generalized model-table generator. Reached from `bin/generate-model-table` and its
  `--check` mode, which already runs in the integrity suite.

The advisory overlap scan over these paths reported no overlap and no open blockers.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| `pi --list-models` output format changes, so the probe misparses and rejects valid config | Integration | Low | High | Parse by header column names, not position. An unparseable listing fails boot with a message quoting the header, never silently passes. Pin the parser to a fixture captured from 0.84.3. |
| A Pi model id containing `:` (for example `:free`) is read by Pi as a `:thinking` suffix | Integration | Low | Medium | The harness always passes `--thinking` explicitly, and ids are split only at the first `/`. BUILD tests the argv with a fixture id that contains `:free`. |
| Pi exit 0 with `stopReason: "error"` is treated as a successful empty step (the adapter never reads `stopReason`) | Integration | Medium | High | In scope (operator decision 2026-09-29). The adapter reads the terminal assistant message: `stopReason: "error"` becomes a failed invocation carrying `errorMessage`, never a success. Classifying it as auth or rate-limit stays with #2718, so until then it is an unclassified step failure (catalog D5). |
| The `--list-models` probe adds boot latency, since it may consult remote catalogs | Performance | Medium | Low | One call per boot, only when Pi is configured, with a bounded timeout. A timeout fails with a distinct message. |
| The widened N-column model table changes the ARCHITECTURE.md region layout | Technical | High | Low | Regenerate once in the same diff; `--check` stays the drift guard. Claude and Codex cell contents are unchanged. |

## ADRs Created

None. Two APPROVED ADRs were amended additively, with operator approval in this DECIDE session:
- adr-2026-09-24-built-in-provider-catalog-and-boot-discovery. The D6 model-policy sentence is
  superseded, and D12, D13 and D14 (exit-0 `stopReason: "error"` fails the invocation) are added.
- adr-2026-07-03-reactive-model-fallback-ladder. Items 7 and 8 are added: a per-provider ladder
  and escalation order, and observable Pi rungs.

## Conditions

1. The plan's `## Architecture Obligation Coverage` covers every decision of both amended ADRs:
   catalog D1–D14 and ladder 1–8. Decisions left unchanged are dispositioned `existing`.
2. The probe parser is fixture-driven, and a test proves the default suite never spawns a real `pi`
   (injected runner, `assertRealExecAllowed`).
3. The existing #1884 tests that assert "passes no `--model`" and "one rung with no model id" are
   replaced, not deleted without a replacement.
4. The Pi adapter treats a terminal `stopReason: "error"` as a failed invocation that carries Pi's `errorMessage`, with no auth, rate-limit or model-unavailable classification (#2718 owns that). A fixture test covers the exit-0 error stream captured on 2026-09-29.

## Conflict-check follow-up (2026-09-29, operator decisions)

- Pi as a fallback candidate: when pi is configured, `llm_providers.pi.model`, the escalation order
  and the fallback ladder are all required. `llm_providers.pi.model` is Pi's native default (D13).
- The top-level `model_fallback_ladder` keeps applying to every provider except Pi (ladder item 7),
  so #902's claude/codex ladder behavior is unchanged.
- Model table: engine rows show Pi model `config-required`; interactive-skill rows show Pi model and
  effort `n/a`. Both are explicit sentinels that the completeness gates accept.
- The `llm_providers` key is declared in the config-key consumer registry
  (adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal D4).
