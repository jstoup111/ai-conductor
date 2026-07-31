---
title: Model and effort resolution
parent: Reference
nav_order: 5
---

# Model and effort resolution

How the engine picks a model, a reasoning effort, a retry budget, and a review mode for every step, and
how those values stay in sync with the table in `HARNESS.md`. Source-ordered: engine steps follow
`StepName` declaration order, not alphabetical order.

## Precedence chain

Nine levels, highest wins. The first non-`undefined` value stops the search
(`src/conductor/src/engine/resolved-config.ts:164-176`, implemented at `:243-263`).

1. CLI override — `--model` only (see [CLI override](#cli-override)).
2. `steps.<name>.by_tier.<tier>`
3. `steps.<name>`
4. `phases.<PHASE>.by_tier.<tier>`
5. `phases.<PHASE>`
6. `defaults`
7. Provider policy `stepTierOverrides[step][tier]`
8. Provider policy `stepModels[step]` / `stepEfforts[step]`
9. Hard fallback — `FALLBACK_MODEL = 'sonnet'`, `FALLBACK_EFFORT = 'medium'`
   (`resolved-config.ts:89-92`)

Every config key named above is documented in [configuration](configuration.md).

Note the ordering consequence at levels 2 and 7: a *config* tier override outranks a flat config value,
but a *policy* tier override sits below every config source. Setting `defaults.model` therefore
suppresses the policy's `plan: L → fable` promotion.

## Which chain each field uses

Not every knob walks the full nine levels.

| Field | Chain | Fallback |
| --- | --- | --- |
| `model` | All nine levels | `sonnet` |
| `effort` | All nine levels; level 1 is an internal seam only | `medium` |
| `max_retries` | Levels 2-8, no CLI override (`resolved-config.ts:354-362`) | `DEFAULT_STEP_RETRIES[step]`, then `3` |
| `escalate` | `steps.<name>` → `phases.<PHASE>` → `defaults` → `DEFAULT_STEP_ESCALATE` (`resolved-config.ts:371-375`). No tier, no CLI | `true` |
| `review` | Not configurable at all — fixed per step in `DEFAULT_STEP_REVIEW` (`resolved-config.ts:366`) | `manual` |
| `skill`, `hooks`, `disabled` | `steps.<name>` only | built-in skill / none / `false` |

`validateEffortAndModelBag` explicitly excludes `review` from the settable knobs
(`src/conductor/src/engine/config.ts:1554-1556`) — review mode is a property of a step's skill contract,
not a tuning knob.

## Engine step defaults

26 steps appear in every policy record. Effort is **shared** between the two providers: both
`CLAUDE_MODEL_POLICY` and `CODEX_MODEL_POLICY` point at the same `STEP_EFFORTS` object
(`src/conductor/src/engine/provider-model-policy.ts:90-117, 141, 157`).

| Step | Claude model | Codex model | Effort | Retries | Review |
| --- | --- | --- | --- | --- | --- |
| `bootstrap` | sonnet | gpt-5.6-terra | low | 1 | auto |
| `memory` | haiku | gpt-5.6-luna | low | 1 | auto |
| `assess` | sonnet | gpt-5.6-terra | high | 3 | manual |
| `explore` | opus | gpt-5.6-sol | high | 3 | manual |
| `prd` | fable | gpt-5.6-sol | high | 3 | manual |
| `complexity` | sonnet | gpt-5.6-terra | low | 1 | auto |
| `stories` | sonnet | gpt-5.6-terra | medium | 3 | manual |
| `conflict_check` | opus | gpt-5.6-terra | medium | 3 | conditional |
| `plan` | opus | gpt-5.6-sol | high | 3 | manual |
| `coherence_check` | sonnet | gpt-5.6-terra | medium | 3 | conditional |
| `architecture_diagram` | sonnet | gpt-5.6-terra | medium | 3 | auto |
| `architecture_review` | fable | gpt-5.6-sol | high | 5 | conditional |
| `worktree` | haiku | gpt-5.6-luna | low | 1 | auto |
| `acceptance_specs` | opus | gpt-5.6-sol | medium | 3 | auto |
| `build` | sonnet | gpt-5.6-terra | medium | 3 | auto |
| `build_review` | fable | gpt-5.6-sol | high | 3 | conditional |
| `wiring_check` | sonnet | gpt-5.6-terra | low | 3 | auto |
| `test_suite` | sonnet | gpt-5.6-terra | low | 1 | auto |
| `manual_test` | sonnet | gpt-5.6-terra | medium | 3 | auto |
| `prd_audit` | fable | gpt-5.6-sol | high | 3 | conditional |
| `architecture_review_as_built` | fable | gpt-5.6-sol | high | 3 | conditional |
| `retro` | sonnet | gpt-5.6-terra | medium | 3 | manual |
| `rebase` | opus | gpt-5.6-terra | high | 1 | auto |
| `finish` | sonnet | gpt-5.6-terra | medium | 1 | auto |
| `remediate` | fable | gpt-5.6-sol | medium | 3 | auto |
| `attribution_verify` | opus | gpt-5.6-sol | high | 3 | auto |

Sources: `provider-model-policy.ts:32-59` (Claude models), `:61-88` (Codex models), `:90-117` (efforts),
`resolved-config.ts:24-56` (retries), `:58-85` (review modes).

Four of these rows — `bootstrap`, `assess`, `remediate`, and `attribution_verify` — are out-of-band
steps. They cannot be overridden under `steps:` at all; only `defaults` and `phases` reach them. See
[configuration](configuration.md).

`architecture_review` keeps 5 retries; every other deep step dropped to 3 when retries became
escalations. The floor is 3, not 2, because the model-bump rung lives at attempt 3
(`resolved-config.ts:26-32`).

### Review modes

| Mode | Meaning |
| --- | --- |
| `auto` | The step's output is accepted without an operator review pass |
| `manual` | The operator reviews before the run proceeds |
| `conditional` | Auto-approved **unless** the skill wrote `.pipeline/review-required-<step>` (`src/conductor/src/types/config.ts:14-21`) |

`wiring_check` and `test_suite` read `auto` because they produce deterministic evidence files with no
generative verdict to review. See [artifacts](artifacts.md).

## Tier overrides

Six steps carry policy-level tier overrides. `COMMON_TIER_OVERRIDES`
(`provider-model-policy.ts:119-137`) supplies five; each provider policy then adds its own `plan: L` and
`conflict_check: L` entries (`:142-149` for Claude, `:158-165` for Codex).

| Step | S | M | L (Claude) | L (Codex) |
| --- | --- | --- | --- | --- |
| `stories` | effort `low` | — | effort `high` | effort `high` |
| `explore` | effort `low` | — | — | — |
| `plan` | effort `medium`, `max_retries` 3 | — | effort `xhigh`, model `fable` | effort `xhigh`, model `gpt-5.6-sol` |
| `acceptance_specs` | — | — | effort `high` | effort `high` |
| `build` | `max_retries` 3 | — | effort `high` | effort `high` |
| `conflict_check` | — | — | model `fable` | model `gpt-5.6-sol` |

Every other step resolves identically across all three tiers. Which steps a tier *skips* is a separate
concern — see [steps](steps.md).

## Provider policies

| Property | `claude` | `codex` |
| --- | --- | --- |
| `effortOrder` | `low`, `medium`, `high`, `xhigh`, `max` | identical |
| `modelEscalationOrder` | `haiku`, `sonnet`, `opus`, `fable` | `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-5.6-sol` |
| `modelFallbackLadder` | `fable`, `opus`, `sonnet` | `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` |

Both policies are deep-frozen (`provider-model-policy.ts:22-30`) and registered in
`BUILT_IN_PROVIDER_MODEL_POLICIES` (`:171-176`). `resolveProviderModelPolicy(key, warn?)` returns the
Claude policy for any other key and emits
`Unknown provider "<key>": Claude-compatible model defaults are being used; add a provider model policy
for "<key>".` (`:182-194`). No cross-provider alias translation happens: a model name is only ever
interpreted inside its own provider's family.

Selecting a provider is covered in [multiprovider](../guides/multiprovider.md); the `llm_provider` key
itself is in [configuration](configuration.md).

`model_fallback_ladder` in config replaces the policy ladder wholesale:
`this.config?.model_fallback_ladder ?? this.modelPolicy.modelFallbackLadder`
(`src/conductor/src/engine/step-runners.ts:384`).

## Escalation on retry

`escalateAttempt(baseModel, baseEffort, attempt, escalate, policy)`
(`src/conductor/src/engine/escalation.ts:96-121`) is pure and takes a 1-based attempt number.

| Condition | Model | Effort |
| --- | --- | --- |
| `escalate === false`, or `attempt <= 1` | base | base |
| `attempt === 2` | base | one rung up `effortOrder` |
| `attempt >= 3` | `attempt - 2` tiers up `modelEscalationOrder` | held at the attempt-2 rung |

Both ladders clamp at the top, and a value not present in the order is returned unchanged
(`escalation.ts:44-54, 63-73`). The function never de-escalates and never throws. It also never consults
model availability — liveness is handled separately (`escalation.ts:14-17`).

Set `escalate: false` on a step, phase, or `defaults` to hold every retry at the base model and effort.

### Fallback attempts

When the primary provider is unavailable, `resolveFallbackProviderNativeStepConfig`
(`resolved-config.ts:309-335`) resolves entirely inside the fallback provider's native domain. Primary
config, CLI overrides, and configured ladders are deliberately absent from that input boundary — the
fallback attempt gets the fallback policy's own step model, step effort, tier overrides, and escalation.

### Provider specialization

When a step's own `llm_provider` differs from the inherited (first-configured) provider,
`resolvePreferredProviderNativeStepConfig` (`resolved-config.ts:276-302`) rebuilds a config containing
only that step's own entry. The step therefore keeps its authored native settings, its `by_tier`
overrides, CLI overrides, and the selected provider's policy defaults — but `phases.*` and `defaults.*`
model and effort values are dropped, because they were authored for the inherited provider's model family.

## CLI override

`--model <name>` overrides the model for **every** step and beats every other source. Registered at
`src/conductor/src/cli.ts:63`, plumbed through `cli.ts:353` → `src/conductor/src/index.ts:1007` →
`step-runners.ts:418` → `resolved-config.ts:244`. It is also passed down to the provider CLIs
(`src/conductor/src/execution/claude-provider.ts:668`,
`src/conductor/src/execution/codex-provider.ts:493`). Flag semantics live in [cli](cli.md).

There is no `--tier` flag; the tier comes from conductor state.

> **Known limitation.** `ResolveOptions.effortCliOverride` (`resolved-config.ts:132-133`) and
> `StepRunner.effortOverride` (`step-runners.ts:267-268`) are both documented as the CLI `--effort`
> override, and both sit at the top of the effort precedence chain — but `src/conductor/src/cli.ts`
> registers no `--effort` option. The seam is reachable only from in-process callers. To change effort,
> set `defaults.effort` or a per-step `effort` in config. Tracked in
> [#1027](https://github.com/jstoup111/ai-conductor/issues/1027).

## How effort reaches the model

Resolved effort is passed to the child process as the `CLAUDE_CODE_EFFORT_LEVEL` environment variable
(`src/conductor/src/execution/claude-provider.ts:688`). It is never read from the ambient environment.
That mechanism is used deliberately: it overrides both `settings.json` and skill frontmatter, and it
cascades to subagents. When neither an effort nor a self-host env overlay is present, `buildEnv` returns
`undefined` and the child inherits the parent environment unchanged. See
[environment](environment.md).

Valid levels are `low`, `medium`, `high`, `xhigh`, `max`. Not every model supports all five — per
`src/conductor/src/types/config.ts:7-9`, Opus 4.7 supports all five while Opus 4.6 and Sonnet 4.6 lack
`xhigh`.

## Interactive skills

The engine policies cover autonomous dispatch. Skills invoked interactively — through the Skill tool, or
dispatched by another skill rather than by the engine — are documented as 22 extra rows in
`EXTRA_MODEL_TABLE_ROWS` (`src/conductor/src/engine/model-table-metadata.ts:138-284`). All 22 carry
`executionPath: 'supported-host interactive'`: a Claude model/effort pin plus a fixed Codex
model/effort inheritance placeholder (`inherits model/effort from the Codex session or spawned-agent
configuration`), since interactive dispatch on the Codex host has no per-skill policy table to pin
against. Skill pins themselves remain Claude-scoped — see [Skill pins](#skill-pins) below.

| Skill or agent | Claude model | Codex model |
| --- | --- | --- |
| `verify-claims` | inherits caller | inherits Codex session/spawned-agent config |
| `domain-reviewer` | sonnet (<50-line diff), opus (≥50-line diff) | inherits Codex session/spawned-agent config |
| `evaluator` | sonnet (value objects, pure functions, config, infra) / opus (concurrency, state mutation, security, auth, finance) | inherits Codex session/spawned-agent config |
| `code-review` | opus | inherits Codex session/spawned-agent config |
| `debugging` | fable | inherits Codex session/spawned-agent config |
| `simplify` | sonnet | inherits Codex session/spawned-agent config |
| `engineer` | fable | inherits Codex session/spawned-agent config |
| `intake` | inherits caller | inherits Codex session/spawned-agent config |
| `conduct` | haiku | inherits Codex session/spawned-agent config |
| `pr` | sonnet | inherits Codex session/spawned-agent config |
| `tdd-red` | sonnet | inherits Codex session/spawned-agent config |
| `tdd-green` | sonnet | inherits Codex session/spawned-agent config |
| `cto-security` | opus | inherits Codex session/spawned-agent config |
| `cto-data-integrity` | opus | inherits Codex session/spawned-agent config |
| `cto-dependencies` | sonnet | inherits Codex session/spawned-agent config |
| `cto-architecture` | opus | inherits Codex session/spawned-agent config |
| `cto-duplication` | sonnet | inherits Codex session/spawned-agent config |
| `cto-testing` | sonnet | inherits Codex session/spawned-agent config |
| `cto-infrastructure` | sonnet | inherits Codex session/spawned-agent config |
| `cto-observability` | sonnet | inherits Codex session/spawned-agent config |
| `cto-devex` | sonnet | inherits Codex session/spawned-agent config |
| `cto-orchestrator` | opus | inherits Codex session/spawned-agent config |

`writing-system-tests` is deliberately absent from this list: it is the display name of the
`acceptance_specs` engine step, not a standalone row (`model-table-metadata.ts:106-110`). Adding it would
collide with the renamed engine row and trip `assertNoDuplicateRowNames`.

## Skill pins

A `SKILL.md` may pin `model:` in its frontmatter so an interactive session runs it on the intended model
regardless of the session's own model. Seven skills currently carry a pin: `assess` (sonnet),
`architecture-diagram` (sonnet), `prd-audit` (opus), `code-review` (opus), `debugging` (fable),
`engineer` (fable), and `simplify` (sonnet). Skill frontmatter fields are documented in
[skills](skills.md).

`classifyPinnedSkill` (`src/conductor/src/tools/generate-model-table.ts:144-167`) sorts every skill into
one of four classes:

| Class | Condition | Result |
| --- | --- | --- |
| `no-pin` | No `model:` line | Never an error |
| `mapped` | Skill name is a key in `SKILL_STEP_MAP` | Pin compared against the Claude policy model for that step |
| `exempt` | Skill name is in `PIN_EXEMPT_SKILLS` | Passes without comparison |
| `unmapped` | Pinned but in neither list | **Hard failure** |

`SKILL_STEP_MAP` (`model-table-metadata.ts:72-81`) has 8 entries:

| Skill directory | Engine step |
| --- | --- |
| `architecture-diagram` | `architecture_diagram` |
| `architecture-review` | `architecture_review` |
| `assess` | `assess` |
| `explore` | `explore` |
| `prd` | `prd` |
| `prd-audit` | `prd_audit` |
| `rebase` | `rebase` |
| `remediate` | `remediate` |

`PIN_EXEMPT_SKILLS` (`model-table-metadata.ts:87-92`) has 4 entries: `code-review`, `debugging`,
`engineer`, and `simplify`. Each runs standalone rather than as a numbered engine step, so there is no
policy value to compare a pin against.

## Resolving a skill's model end to end

Take `plan` on an L-tier feature, with `llm_provider: codex` and no other config:

1. **Find the step.** The skill `plan` maps to the engine step `plan`, phase `DECIDE`.
2. **Resolve the provider.** `llm_provider` is the string `codex`, so the policy is
   `CODEX_MODEL_POLICY`.
3. **Walk the chain.** No CLI `--model`. No `steps.plan.by_tier.L`, no `steps.plan`, no
   `phases.DECIDE.by_tier.L`, no `phases.DECIDE`, no `defaults.model`. Level 7 hits:
   `stepTierOverrides.plan.L` is `{ effort: 'xhigh', model: 'gpt-5.6-sol' }`.
4. **Result.** Model `gpt-5.6-sol`, effort `xhigh`.
5. **Retries and escalate.** `max_retries` falls through to `DEFAULT_STEP_RETRIES.plan` = 3; `escalate`
   falls through to `true`.
6. **Attempt 2** raises effort one rung — `xhigh` → `max`. **Attempt 3** bumps the model
   `attempt - 2 = 1` tier up `['gpt-5.6-luna','gpt-5.6-terra','gpt-5.6-sol']`; `gpt-5.6-sol` is already
   the top, so it clamps and stays.
7. **Dispatch.** The effort is exported as `CLAUDE_CODE_EFFORT_LEVEL=max` for the Claude path, or passed
   to the Codex CLI on the Codex path.

Change one thing — add `defaults: { model: sonnet }` — and step 3 stops at level 6 instead of 7, so the
step runs on `sonnet` (a Claude name, on a Codex provider) and the L-tier promotion never applies. Model
names are not enum-checked at any point.

## Keeping HARNESS.md in sync

The model-selection table in `HARNESS.md` is generated, not hand-written. Regenerate it with:

```bash
bin/generate-model-table
```

The wrapper runs `src/conductor/src/tools/generate-model-table.ts` directly from source via
`src/conductor/node_modules/.bin/tsx`, and never touches `src/conductor/dist/`. A missing `tsx` or a
missing tool file exits 2 with a hint to run `npm install` in `src/conductor/`.

| Mode | Flag | Behavior |
| --- | --- | --- |
| write | *(none)* | Splices the freshly rendered table between the markers and writes it back only if it differs |
| check | `--check` | Reports drift as a unified diff; makes no edit |
| pins | `--pins` | Prints `buildPinsJson()` — `{ "<skill>": { "expected": "<model>" } }` or `{ "exempt": true }` — to stdout |

Exit codes (`generate-model-table.ts:396-398`): `0` ok, `1` drift (check mode only), `2` environment or
marker error.

The region is delimited by `<!-- BEGIN GENERATED: model-selection-table -->` and
`<!-- END GENERATED: model-selection-table -->`, each alone on its line (`HARNESS.md:147` and `:198`). A
missing, duplicated, or out-of-order marker throws a `MarkerError` and leaves the document untouched
(`generate-model-table.ts:49-89`).

Table shape is seven columns —
`| Skill/Agent | Execution path | Claude model | Claude effort | Codex model | Codex effort | Why |` —
with engine rows first in `STEP_RATIONALE` key order and extra rows after: 26 + 22 = **48 data rows**.
`renderTieredField` groups the S/M/L tiers by identical resolved value, so a tier-invariant value renders
bare while a varying one renders as, for example, `sonnet (S/M), fable (L)`.

Display names default to `snake_case` → `kebab-case`, with five explicit overrides
(`generate-model-table.ts:230-236`):

| Step | Displayed as |
| --- | --- |
| `build` | `pipeline` |
| `worktree` | `worktree-manager` |
| `acceptance_specs` | `writing-system-tests` |
| `architecture_review_as_built` | `architecture-review --as-built` |
| `conflict_check` | `conflict-check` |

A name collision between an engine row and an extra row is a hard error, not a silent dedupe
(`assertNoDuplicateRowNames`, `generate-model-table.ts:187-202`).

### Drift is an integrity failure

`test/test_harness_integrity.sh` enforces both halves:

- **5a, content drift** (`:191-261`): runs `bin/generate-model-table --check`. Exit 0 passes; exit 1
  fails with remediation text; exit 2 or anything else fails as an environment error. A fixture sub-test
  additionally proves the provider labels are compared, not merely present.
- **5b, pin agreement** (`:265-328`): consumes `--pins` JSON, reads each `skills/*/SKILL.md`
  frontmatter's `model:` line, and compares. A skill with no pin is skipped; an exempt skill passes; a
  pinned skill absent from the `--pins` output fails as unmapped.

Both checks degrade to a **warning skip** rather than a failure when `src/conductor/node_modules` is
absent, and 5b also skips when `jq` is not installed. Do not read a green suite on a machine without
those as proof of no drift. The full suite is documented in
[validation](../contributing/validation.md).

## See also

- [configuration](configuration.md) — every `defaults`, `phases`, and `steps` key referenced above.
- [steps](steps.md) — step order, phase, tier-skip, and enforcement.
- [skills](skills.md) — the skill catalog and `SKILL.md` frontmatter fields.
- [multiprovider](../guides/multiprovider.md) — choosing between `claude` and `codex`.
