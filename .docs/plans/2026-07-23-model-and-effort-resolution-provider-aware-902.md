# Implementation Plan: Provider-Aware Model and Effort Resolution

**Date:** 2026-07-23
**Issue:** `jstoup111/ai-conductor#902`
**Track / tier:** Technical / M
**Design:** `.docs/decisions/adr-2026-07-23-provider-policies-with-deeper-discovery-effort.md`
**Architecture review:** `.docs/decisions/architecture-review-2026-07-23-provider-model-policies.md`
**Stories:** `.docs/stories/model-and-effort-resolution-provider-aware-902.md`
**Conflict check:** Clean as of 2026-07-23

## Summary

Introduce an immutable built-in provider-policy boundary, resolve it once beside
provider selection, and thread it through all model/effort resolution,
retry-escalation, model-availability, and documentation paths. The plan contains
20 small TDD tasks and preserves opaque user overrides, the `LLMProvider`
interface, retry accounting, and the existing generated-document workflow.

## Technical Approach

- Add `engine/provider-model-policy.ts` as the sole owner of the explicit Claude
  and Codex per-step tables, tier overrides, effort order, model escalation
  order, and default fallback ladder. Both tables are exhaustive
  `Record<StepName, ...>` values; no Claude-to-Codex runtime alias translation
  exists.
- Resolve the policy once in `index.ts#main` and
  `daemon-cli.ts#runDaemonMode`, immediately beside the selected
  `llm_provider` key. Known keys are silent. An installed unknown key keeps its
  selected provider instance, receives the Claude compatibility policy, and
  emits one warning because the composition root performs one lookup and then
  threads the returned immutable value through all later resolutions.
- Make every production `resolveStepConfig` call explicit about policy. User
  precedence remains CLI → step tier → step → phase tier → phase → defaults →
  policy tier → policy base. Retry counts and review behavior remain
  provider-neutral in `resolved-config.ts`.
- Parameterize retry escalation with the selected policy's effort/model order.
  Parameterize each production `ModelAvailability` construction with the
  configured ladder when present, including an explicitly empty ladder, or the
  selected policy ladder otherwise.
- Carry the same policy through `Conductor`, `DefaultStepRunner`,
  `resolveGroupMembership`, and `dispatchAttributionVerifier`; the daemon's
  setup-fix, rebase, and CI-fix runners reuse the one policy resolved at daemon
  startup.
- Expand the generated table to
  `Skill/Agent | Execution path | Claude model | Claude effort | Codex model |
  Codex effort | Why`. Engine rows show both policies. Non-engine rows are
  visibly `Claude interactive`, leave Codex cells empty, and keep pin
  validation bound only to the Claude policy.
- Do not add a config key, persistence, provider-interface method, or public
  logical-tier abstraction.

## Prerequisites

- Accepted stories and clean conflict report listed above.
- Approved architecture review and effort amendment.
- Existing `src/conductor` dependencies installed for Vitest, typecheck, and
  the generated-table tool.

## Tasks

### Task 1: Define exhaustive immutable built-in policies

**Story:** Built-in providers HP-1, HP-2; generated documentation NP-3
**Type:** infrastructure + happy-path

**Steps:**
1. Write failing tests that enumerate all 24 `StepName` values, require an
   entry in both policies, and compare every base model/effort, tier override,
   effort order, escalation order, and fallback ladder with the accepted
   matrix.
2. Run the focused test and confirm RED because the policy module does not
   exist.
3. Implement `ProviderModelPolicy`, `CLAUDE_MODEL_POLICY`, and
   `CODEX_MODEL_POLICY` as immutable exhaustive values, including
   `explore.S: low`, normal `explore/prd: high`, and provider-native L-tier
   promotions.
4. Re-run the focused test and typecheck; confirm GREEN and compile-time
   exhaustiveness.
5. Commit with message: `feat(conductor): define built-in provider model policies`

**Files:** `src/conductor/src/engine/provider-model-policy.ts`, `src/conductor/test/engine/provider-model-policy.test.ts`

**Wired-into:** `src/conductor/src/engine/resolved-config.ts#resolveStepConfig`, `src/conductor/src/engine/escalation.ts#escalateAttempt`, `src/conductor/src/engine/step-runners.ts#DefaultStepRunner`, `src/conductor/src/engine/attribution-lane.ts#dispatchAttributionVerifier`, `src/conductor/src/tools/generate-model-table.ts#buildEngineRows`

**Dependencies:** none

### Task 2: Resolve known and compatibility policy keys

**Story:** Selected policy reaches every path HP-2, NP-2
**Type:** negative-path

**Steps:**
1. Write failing lookup tests: `claude` and `codex` return their exact built-in
   policies without warning; an arbitrary installed-provider key returns the
   exact Claude compatibility policy and produces the approved actionable
   warning text.
2. Confirm RED because no lookup exists.
3. Implement the pure built-in lookup with an injected warning sink. Keep
   warning cardinality at the composition root: one lookup before execution,
   then reuse the immutable result for every resolution.
4. Confirm GREEN, including an assertion that the lookup does not construct or
   replace an `LLMProvider`.
5. Commit with message: `feat(conductor): resolve provider policy compatibility keys`

**Files:** `src/conductor/src/engine/provider-model-policy.ts`, `src/conductor/test/engine/provider-model-policy.test.ts`

**Wired-into:** `src/conductor/src/index.ts#main`, `src/conductor/src/daemon-cli.ts#runDaemonMode`

**Dependencies:** Task 1

### Task 3: Make base step resolution policy-explicit

**Story:** Built-in providers HP-1; explicit overrides HP-1
**Type:** happy-path

**Steps:**
1. Convert the Claude resolver golden tests to pass an explicit policy and add
   an exhaustive no-config assertion for all 24 Claude model/effort rows.
2. Confirm RED after changing the tests to the new required resolver
   signature.
3. Move built-in model, effort, and tier defaults out of
   `resolved-config.ts`; make `resolveStepConfig` consume the supplied policy
   while leaving retries, review, hooks, disable, and escalation defaults
   provider-neutral.
4. Confirm GREEN for the exhaustive Claude matrix and existing resolution
   tests.
5. Commit with message: `refactor(conductor): resolve step defaults from provider policy`

**Files:** `src/conductor/src/engine/resolved-config.ts`, `src/conductor/test/engine/resolved-config.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 1

### Task 4: Lock the Codex base and tier matrices

**Story:** Built-in providers HP-1, HP-2, NP-1, NP-2
**Type:** happy-path + negative-path

**Steps:**
1. Add failing acceptance cases for the full Codex × step matrix and the
   provider × S/M/L tier-aware matrix.
2. Confirm RED on missing Codex resolution behavior.
3. Complete policy-backed tier resolution so L-tier `plan` and
   `conflict_check` select each provider's deepest model, S/M do not, and
   non-tier-aware steps remain invariant.
4. Confirm GREEN and assert every Codex default is Luna, Terra, or Sol; assert
   `explore.S: low`, normal `explore: high`, and every `prd: high`.
5. Commit with message: `test(conductor): lock provider step and tier matrices`

**Files:** `src/conductor/test/acceptance/provider-aware-model-resolution.acceptance.test.ts`, `src/conductor/src/engine/resolved-config.ts`, `src/conductor/test/engine/resolved-config.test.ts`, `src/conductor/test/acceptance/s-tier-pipeline-knobs.acceptance.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 3

### Task 5: Preserve override precedence and opaque model strings

**Story:** Explicit overrides HP-1, HP-2, NP-1, NP-2
**Type:** negative-path

**Steps:**
1. Add table-driven failing tests for every model and effort precedence
   boundary under both policies, plus `sonnet` under Codex and `gpt-5.6-sol`
   under Claude.
2. Confirm RED wherever policy placement or signature migration is incomplete.
3. Correct only the precedence chain so policy tier/base values remain the
   final two sources; do not add normalization, translation, or validation of
   explicit strings.
4. Confirm GREEN and re-run retry, review, hooks, disable, and escalation
   precedence tests.
5. Commit with message: `test(conductor): preserve provider-native override precedence`

**Files:** `src/conductor/src/engine/resolved-config.ts`, `src/conductor/test/engine/resolved-config.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Tasks 3, 4

### Task 6: Parameterize the pure retry ladder by policy

**Story:** Retry escalation HP-1, HP-2, NP-1, NP-2, NP-4
**Type:** happy-path + negative-path

**Steps:**
1. Replace global-order tests with failing provider × base-rung × attempt
   tables, including effort caps, model caps, disabled escalation, and
   off-order explicit models.
2. Confirm RED against the Claude-only imported orders.
3. Make `bumpEffort`, `bumpModel`, and `escalateAttempt` consume the selected
   policy orders while preserving their pure, attempt-indexed behavior.
4. Confirm GREEN for unchanged Claude results and Luna → Terra → Sol Codex
   results; assert `high → xhigh` on attempt 2 for normal `explore` and `prd`.
5. Commit with message: `feat(conductor): escalate retries within provider model orders`

**Files:** `src/conductor/src/engine/escalation.ts`, `src/conductor/test/engine/escalation.test.ts`, `src/conductor/test/acceptance/provider-aware-model-resolution.acceptance.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Tasks 1, 4

### Task 7: Thread policy through every conductor retry branch

**Story:** Retry escalation HP-3, NP-3; selected policy HP-1, NP-1
**Type:** integration + negative-path

**Steps:**
1. Add failing conductor acceptance cases proving Codex attempt values at the
   current-attempt dispatch and both next-attempt telemetry sites; include
   rate-limit, stale-session, and auth park re-runs that do not advance the
   rung or attempt count.
2. Confirm RED because conductor escalation still imports a global order.
3. Add the selected policy to conductor run context and pass it to all three
   `escalateAttempt` calls without changing retry accounting.
4. Confirm GREEN for the Codex cases and the full existing retry-as-escalation
   acceptance suite.
5. Commit with message: `feat(conductor): thread provider policy through retry loop`

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/acceptance/retry-as-escalation.acceptance.test.ts`, `src/conductor/test/engine/conductor.test.ts`

**Wired-into:** `src/conductor/src/index.ts#main`, `src/conductor/src/daemon-cli.ts#runDaemonMode`

**Dependencies:** Task 6

### Task 8: Supply provider-native default availability ladders

**Story:** Model fallback HP-1, HP-2, HP-3, NP-1, NP-2
**Type:** happy-path + negative-path

**Steps:**
1. Add failing invocation-sequence tests for every Codex fallback position,
   full Sol/Terra/Luna exhaustion, and the unchanged Claude
   Fable/Opus/Sonnet sequence.
2. Confirm RED because `ModelAvailability` still owns a Claude-only default.
3. Require callers to supply a ladder and select
   `config.model_fallback_ladder ?? policy.modelFallbackLadder` at each
   production construction site.
4. Confirm GREEN, including same-attempt walking and dead-rung skipping.
5. Commit with message: `feat(conductor): use provider-native availability ladders`

**Files:** `src/conductor/src/engine/model-availability.ts`, `src/conductor/test/engine/model-availability.test.ts`, `src/conductor/test/acceptance/model-availability-fallback-ladder.test.ts`

**Wired-into:** `src/conductor/src/engine/step-runners.ts#DefaultStepRunner`, `src/conductor/src/engine/attribution-lane.ts#dispatchAttributionVerifier`

**Dependencies:** Task 1

### Task 9: Preserve empty, off-ladder, and non-availability behavior

**Story:** Model fallback HP-4, NP-3, NP-4
**Type:** negative-path

**Steps:**
1. Add failing provider-table cases for an explicitly empty configured ladder,
   successful off-ladder models, off-ladder `modelUnavailable`, ordinary
   failure, rate limit, and auth failure.
2. Confirm RED on any path that substitutes the provider default for an
   explicit empty list or poisons the dead-model cache.
3. Preserve nullish-only precedence and the existing error classifiers; start
   an off-ladder unavailable model at the active ladder's first live entry.
4. Confirm GREEN and assert no fallback call increments the conductor retry
   attempt.
5. Commit with message: `test(conductor): preserve explicit and off-ladder fallback semantics`

**Files:** `src/conductor/src/engine/model-availability.ts`, `src/conductor/test/engine/model-availability.test.ts`, `src/conductor/test/acceptance/model-availability-fallback-ladder.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 8

### Task 10: Bind DefaultStepRunner to the selected policy

**Story:** Selected policy reaches every path HP-1, NP-1; model fallback HP-3
**Type:** integration

**Steps:**
1. Add failing runner tests that resolve and dispatch a Codex-only expected
   model/effort and prove configured-ladder precedence.
2. Confirm RED because the runner resolves global Claude defaults.
3. Add the policy dependency to `DefaultStepRunner`; use it in
   `resolvedConfigFor` and in the runner's shared `ModelAvailability`.
4. Confirm GREEN for normal, interactive, complexity, build-review, rebase,
   setup-fix, and CI-fix runner methods that share those collaborators.
5. Commit with message: `feat(conductor): bind default runner to provider policy`

**Files:** `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/engine/step-runners.test.ts`, `src/conductor/test/acceptance/model-availability-fallback-ladder.test.ts`, `src/conductor/test/engine/rebase-resolution-runner.test.ts`, `src/conductor/test/acceptance/setup-triage-dispatch.acceptance.test.ts`, `src/conductor/test/integration/ci-fix-resolver-autofix.test.ts`

**Wired-into:** `src/conductor/src/index.ts#main`, `src/conductor/src/daemon-cli.ts#runDaemonMode`

**Dependencies:** Tasks 3, 8

### Task 11: Bind attribution verification to the selected policy

**Story:** Selected policy reaches every path HP-1, NP-1; model fallback HP-1,
HP-2, HP-3
**Type:** integration

**Steps:**
1. Add failing attribution-lane tests that capture a Codex
   `attribution_verify` dispatch at Sol/high and walk the Codex ladder, plus a
   configured-ladder override.
2. Confirm RED because the verifier resolves and falls back through Claude
   globals.
3. Add policy to `VerifierDispatchOptions`, pass it from
   `DefaultStepRunner.dispatchVerifier`, and use it for both resolution and
   default availability.
4. Confirm GREEN for direct lane and production runner-to-lane wiring tests.
5. Commit with message: `feat(conductor): thread provider policy to attribution verifier`

**Files:** `src/conductor/src/engine/attribution-lane.ts`, `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/engine/attribution-lane.test.ts`, `src/conductor/test/engine/attribution-conductor-wiring.test.ts`

**Wired-into:** `src/conductor/src/engine/step-runners.ts#DefaultStepRunner.dispatchVerifier`

**Dependencies:** Tasks 8, 10

### Task 12: Bind conductor loop and grouped resolution to policy

**Story:** Selected policy reaches every path HP-1, NP-1
**Type:** integration

**Steps:**
1. Add failing tests for a Codex normal-loop resolution and
   `resolveGroupMembership` resolution with tier-aware members.
2. Confirm RED because both conductor resolver calls lack policy.
3. Store the selected policy in conductor context, pass it at the linear-loop
   call, and make the exported grouped resolver require an explicit policy.
4. Confirm GREEN and run the existing concurrent-group/resume/skip tests to
   prove membership behavior is otherwise unchanged.
5. Commit with message: `feat(conductor): resolve loop and group steps with provider policy`

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor.test.ts`, `src/conductor/test/acceptance/parallel-validation-phase-fan-out-manual-test-prd-.acceptance.test.ts`

**Wired-into:** `src/conductor/src/engine/conductor.ts#Conductor.run`

**Dependencies:** Tasks 3, 7

### Task 13: Wire policy lookup into inline execution

**Story:** Selected policy reaches every path HP-1, HP-2, NP-1, NP-2
**Type:** integration + negative-path

**Steps:**
1. Add a failing reachability test that reads the production inline
   composition and asserts the same selected key resolves both the provider
   instance and policy before runner/conductor construction.
2. Confirm RED because `index.ts#main` has no policy lookup or constructor
   wiring.
3. Name the selected provider key once, resolve its policy with
   `console.warn`, and pass that policy to both the runner and conductor.
4. Confirm GREEN for known Claude/Codex silence and unknown-key compatibility
   warning without replacing the provider instance.
5. Commit with message: `feat(conductor): wire provider policy into inline execution`

**Files:** `src/conductor/src/index.ts`, `src/conductor/test/integration/provider-model-policy-wiring.integration.test.ts`, `src/conductor/test/integration/plugin-defaults.test.ts`

**Wired-into:** `src/conductor/src/index.ts#main`

**Dependencies:** Tasks 2, 7, 10, 12

### Task 14: Wire one policy through daemon and auxiliary runners

**Story:** Selected policy reaches every path HP-1, HP-2, NP-1, NP-2
**Type:** integration + negative-path

**Steps:**
1. Add failing reachability assertions for daemon provider/policy lookup, the
   main conductor and runner, and all setup-fix, rebase, and CI-fix runner
   constructors.
2. Confirm RED because the daemon currently closes over only the provider
   instance.
3. Resolve policy once in `runDaemonMode` with the daemon log warning sink,
   then reuse the same immutable value at all six downstream construction
   sites.
4. Confirm GREEN and prove repeated step/fix resolutions do not trigger
   another lookup or warning.
5. Commit with message: `feat(conductor): wire provider policy through daemon runners`

**Files:** `src/conductor/src/daemon-cli.ts`, `src/conductor/test/integration/provider-model-policy-wiring.integration.test.ts`, `src/conductor/test/acceptance/setup-triage-dispatch.acceptance.test.ts`, `src/conductor/test/engine/rebase-resolution-wiring.test.ts`, `src/conductor/test/integration/ci-fix-resolver-autofix.test.ts`

**Wired-into:** `src/conductor/src/daemon-cli.ts#runDaemonMode`

**Dependencies:** Tasks 2, 7, 10, 12, 13

### Task 15: Prove the cross-path policy and warning contract

**Story:** Selected policy reaches every path HP-1, HP-2, NP-1, NP-2
**Type:** negative-path + acceptance

**Steps:**
1. Add a failing integration matrix for inline resolution, daemon-composed
   policy, grouped resolution, default runner, and attribution verification,
   all with Codex-only expected values.
2. Confirm RED if any path can resolve without its selected policy.
3. Complete only missing wiring exposed by the matrix; add a source
   reachability assertion that enumerates every production
   `resolveStepConfig` call and requires an explicit policy argument.
4. Confirm GREEN for one unknown-provider warning across repeated resolutions,
   zero warnings for known keys, Claude-compatible values, and identity-equal
   provider dispatch.
5. Commit with message: `test(conductor): prove provider policy reaches every execution path`

**Files:** `src/conductor/test/integration/provider-model-policy-wiring.integration.test.ts`, `src/conductor/test/acceptance/provider-aware-model-resolution.acceptance.test.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/step-runners.ts`, `src/conductor/src/engine/attribution-lane.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Tasks 11–14

### Task 16: Render provider-labelled engine rows

**Story:** Generated documentation HP-1, HP-3, NP-3
**Type:** happy-path + negative-path

**Steps:**
1. Add failing renderer tests for the seven-column table, all 24 engine rows,
   both provider model/effort values, and each S/M/L variation.
2. Confirm RED against the current single-provider row shape.
3. Read both policy tables directly, make tier rendering policy-parameterized,
   and render engine rows as `autonomous engine` with distinct Claude/Codex
   columns.
4. Confirm GREEN and assert a missing step/provider value fails
   completeness instead of rendering a partial row.
5. Commit with message: `feat(conductor): render provider-labelled engine model rows`

**Files:** `src/conductor/src/tools/generate-model-table.ts`, `src/conductor/test/generate-model-table.test.ts`, `src/conductor/test/model-table-metadata.test.ts`

**Wired-into:** `src/conductor/src/tools/generate-model-table.ts#renderModelTable`

**Dependencies:** Task 1

### Task 17: Label interactive rows and keep pins Claude-scoped

**Story:** Generated documentation HP-2, NP-2
**Type:** negative-path

**Steps:**
1. Add failing tests that every non-engine row is labelled
   `Claude interactive`, has no invented Codex value, and `--pins` reads only
   the Claude policy.
2. Confirm RED because extra rows and pin JSON are currently unlabeled and
   import global defaults.
3. Adapt extra-row rendering and `buildPinsJson` to the new row shape and
   Claude policy.
4. Confirm GREEN: a Codex-only difference does not fail pins, while a seeded
   Claude pin mismatch still fails and names the skill.
5. Commit with message: `feat(conductor): scope interactive model rows and pins to Claude`

**Files:** `src/conductor/src/tools/generate-model-table.ts`, `src/conductor/src/engine/model-table-metadata.ts`, `src/conductor/test/generate-model-table.test.ts`, `test/test_harness_integrity.sh`

**Wired-into:** `src/conductor/src/tools/generate-model-table.ts#buildPinsJson`

**Dependencies:** Task 16

### Task 18: Regenerate HARNESS and enforce provider drift

**Story:** Generated documentation HP-3, NP-1, NP-3
**Type:** negative-path + integration

**Steps:**
1. Extend generated-table acceptance fixtures so deletion/change of a provider
   label, model, effort, tier variant, or row makes `--check` return drift with
   a useful diff.
2. Confirm RED against the committed single-provider generated region.
3. Run `bin/generate-model-table`, update surrounding source-of-truth prose,
   and retain byte-identical content outside the generated markers except for
   the deliberate provider-source wording.
4. Confirm GREEN with generator unit/acceptance tests,
   `bin/generate-model-table --check`, and the full harness-integrity script.
5. Commit with message: `docs(harness): generate provider-aware model table`

**Files:** `HARNESS.md`, `src/conductor/test/acceptance/generate-model-table.acceptance.test.ts`, `src/conductor/test/generate-model-table.test.ts`, `test/test_harness_integrity.sh`

**Wired-into:** none (no new production surface)

**Dependencies:** Tasks 16, 17

### Task 19: Document provider policies and deeper discovery effort

**Story:** All stories; operational documentation
**Type:** infrastructure

**Steps:**
1. Update metadata tests to expect provider-neutral rationales and the approved
   `explore/prd: high` language.
2. Confirm RED against the stale medium-effort and universal-Claude prose.
3. Document built-in provider defaults, opaque overrides, provider-native
   escalation/fallback, unknown-provider compatibility, and the deferred
   plugin-policy contract; add the issue #902 changelog entry.
4. Confirm GREEN for metadata/generator tests and grep that no current
   autonomous-doc section describes medium `explore/prd` or a universal
   Claude-only ladder.
5. Commit with message: `docs: explain provider-aware model and effort resolution`

**Files:** `src/conductor/src/engine/model-table-metadata.ts`, `src/conductor/test/model-table-metadata.test.ts`, `docs/configuration.md`, `src/conductor/README.md`, `CHANGELOG.md`

**Wired-into:** none (no new production surface)

**Dependencies:** Tasks 15, 18

### Task 20: Run the full provider-policy verification sweep

**Story:** Every Done When condition
**Type:** integration

**Steps:**
1. Run focused provider-policy, resolver, escalation, availability, runner,
   conductor, attribution, generator, and wiring suites.
2. Run the complete `src/conductor` Vitest suite and typecheck.
3. Run `bin/generate-model-table --check` and
   `test/test_harness_integrity.sh`.
4. Run `git diff --check`, enumerate production resolver/availability/runner
   construction sites once more, and confirm every site carries policy.
5. If no straggler changes are needed, record a verify-only evidence commit;
   otherwise commit only the verification fix with message
   `test(conductor): complete provider policy verification`.

**Files:** none

**Wired-into:** none (no new production surface)

**Verify-only:** yes

**Dependencies:** Tasks 1–19

## Task Dependency Graph

```text
T1 ──┬──▶ T2 ────────────────────────────────┐
     ├──▶ T3 ──▶ T4 ──┬──▶ T5               │
     │                 └──▶ T6 ──▶ T7 ───────┤
     ├──▶ T8 ──▶ T9                          │
     │        └──▶ T10 ──▶ T11               │
     │                    │                   │
     │        T3,T7 ──▶ T12                  │
     │                    │                   │
     │        T2,T7,T10,T12 ──▶ T13 ──▶ T14 │
     │                              T11–T14 ──▶ T15
     │
     └──▶ T16 ──▶ T17 ──▶ T18

T15,T18 ──▶ T19
T1–T19 ──▶ T20
```

The graph is acyclic. Tasks 3–7, 8–11, and 16–18 form independently testable
lanes after Task 1; composition-root work waits until the engine collaborators
are policy-aware.

## Integration Points

- After Task 5: both built-in base/tier tables and override precedence are
  executable through the pure resolver.
- After Task 7: retry escalation is provider-native in the real conductor
  attempt loop.
- After Task 11: every direct runner and attribution invocation can resolve and
  fall back within the selected provider family.
- After Task 15: inline, daemon, group, runner, and attribution paths share one
  selected policy, including unknown-provider compatibility.
- After Task 18: committed generated documentation and integrity checks encode
  both policies and the Claude-only interactive path.
- After Task 20: implementation, docs, type safety, and full regression suite
  are ready for as-built architecture review.

## Advisory Overlap Scan

The required exact-file-union scan ran with source reference
`jstoup111/ai-conductor#902`. It reported broad seam overlap with historical
unmerged `spec/*` branches across the conductor's shared engine, tests, and
documentation files. It reported no open blocker, indeterminate dependency, or
degraded blocker sweep. This matches the architecture review's early scan:
implementation should rebase immediately before BUILD and keep the policy
module/table tasks isolated, but no competing dependency blocks this plan.

## Coverage Mapping

| Story / criterion | Tasks |
|---|---|
| Built-in providers HP-1 | 1, 3, 4 |
| Built-in providers HP-2 | 1, 4 |
| Built-in providers NP-1 | 4 |
| Built-in providers NP-2 | 4 |
| Built-in providers Done When | 1, 4, 6, 20 |
| Explicit overrides HP-1 / NP-1 | 3, 5 |
| Explicit overrides HP-2 / NP-2 | 5 |
| Explicit overrides Done When | 5, 20 |
| Selected policy HP-1 / NP-1 | 7, 10–15 |
| Selected policy HP-2 / NP-2 | 2, 13–15 |
| Selected policy Done When | 13–15, 20 |
| Retry escalation HP-1 | 6, 7 |
| Retry escalation HP-2 | 6, 7 |
| Retry escalation HP-3 / NP-3 | 7 |
| Retry escalation NP-1 / NP-2 / NP-4 | 6 |
| Retry escalation Done When | 6, 7, 20 |
| Model fallback HP-1 / HP-2 | 8, 10, 11 |
| Model fallback HP-3 | 8–11 |
| Model fallback HP-4 | 9 |
| Model fallback NP-1 / NP-2 | 8 |
| Model fallback NP-3 / NP-4 | 9 |
| Model fallback Done When | 8–11, 20 |
| Generated docs HP-1 | 16, 18 |
| Generated docs HP-2 / NP-2 | 17 |
| Generated docs HP-3 | 16, 18 |
| Generated docs NP-1 | 18 |
| Generated docs NP-3 | 1, 16, 18 |
| Generated docs Done When | 16–18, 20 |

## Verification

- [x] Stories exist and contain paired happy/negative paths.
- [x] Conflict-check passed with no blocking or degrading conflicts.
- [x] Verify-claims verdict is CLEAR.
- [x] Every acceptance criterion maps to at least one task.
- [x] Negative paths have explicit tasks.
- [x] Task count is 20, within the normal 1–20 range.
- [x] Tasks are scoped as 2–5 minute RED/GREEN/commit units.
- [x] Every task declares dependencies; the graph is acyclic.
- [x] New production surfaces carry architecture-review-derived
      `Wired-into:` declarations.
- [x] Advisory exact-file overlap scan completed.
- [x] Plan-update architecture diagram rendered successfully.
- [x] Post-plan architecture review approved before implementation.
