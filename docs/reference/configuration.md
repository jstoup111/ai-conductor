---
title: Configuration reference
parent: Reference
nav_order: 3
---

# Configuration reference

Every key the engine reads from `.ai-conductor/config.yml`, with its type, default, allowed values, the
code that consumes it, and what a bad value does. Sections follow the loader's own allow-list order
(`src/conductor/src/engine/config.ts:213-269`), not alphabetical order.

## File locations

| Role | Path | Constant |
| --- | --- | --- |
| Project config | `<project>/.ai-conductor/config.yml` | `PROJECT_CONFIG_DIR` / `PROJECT_CONFIG_FILE`, `src/conductor/src/engine/config.ts:94-95` |
| User config | `~/.ai-conductor/config.yml` | `src/conductor/src/engine/user-config.ts:13-19` |
| Project rate card | `<project>/.ai-conductor/rate-card.json` | `RATE_CARD_RELATIVE_PATH`, `src/conductor/src/execution/rate-card.ts` |
| Global rate card (fallback) | `~/.ai-conductor/rate-card.json` | `globalRateCardPath`, `src/conductor/src/execution/rate-card.ts` |
| Legacy project dir | `<project>/.harness/config.yml` | `LEGACY_PROJECT_CONFIG_DIR`, `config.ts:96` |
| Legacy user JSON seed | `~/.claude/ai-conductor.config.json` (flat camelCase) | One-time migration input; after a successful seed it is renamed to `ai-conductor.config.json.migrated` |

Both files use the same schema. Keep per-user state (`conductor:` and `markdown_viewer:`) in the
user file. Keep self-host settings such as `harness_self_host`, `owner_gate_cutover`, and
`auto_restart_on_stale_engine` in the harness checkout's project config, not in unrelated
projects.

`migrateLegacyProjectConfig()` renames `.harness/config.yml` to
`.ai-conductor/config.yml` on every `loadConfig()` call; it is idempotent, no-ops when the new path
already exists, and returns `false` silently on any failure without touching either file
(`config.ts:112-123`, called at `:132`).

`ai-conductor create <name>` writes a new repository's project config from
`templates/project-config.yml.template`. For an existing Git repository, run
`ai-conductor config init`; it writes the same template when the file is absent, reports success
without changing bytes when the file already exists, and refuses a non-Git directory. The missing-file
error names this command as its remedy. `bin/install` and `bin/migrate` continue to write only the
user file.

## Rate card (`.ai-conductor/rate-card.json`)

A committed, project-scoped JSON file of per-model token prices. It is durable state read by name,
not configuration: it has no keys in `config.yml`, no user-scoped counterpart, and no precedence
rules. Maintain it with `ai-conductor rate-card refresh` (see the CLI reference) and commit the result.
`.github/workflows/rate-card-refresh.yml` also runs that refresh daily and opens a bot pull
request on `automation/rate-card` when the published rates change, so the card does not rot
between manual refreshes. Review such a PR as a **cost change**: merging it alters every
subsequent `costUsd` computed for a codex dispatch. Already-recorded costs are unaffected —
a dispatch is priced at the rate in force when it ran and is never repriced retroactively,
which is why the card is committed rather than fetched live.

The card's `as_of` therefore tracks when the rates last **changed**, not when they were last
checked: a refresh that finds identical rates leaves the committed file untouched.

The **global card** at `~/.ai-conductor/rate-card.json` takes precedence, so every project prices
codex from one current source — not just projects that ran their own refresh. `bin/install` and
`bin/update` maintain it as a symlink to the harness checkout's committed card
(`sync_global_rate_card`, `bin/lib/harness-common.sh`) — the same idiom as skill installs — so a
merged rate-card bot PR updates every project at once with no re-install. A regular file already at
that path is treated as operator-owned and left alone. A committed project card applies only where
no global card exists (e.g. an environment that never ran `bin/install`).

It exists because providers disagree about reporting cost. Claude Code returns `total_cost_usd` on
every dispatch, so its `TokenUsage.costUsd` is provider truth. Codex returns token counts and no
money — so without a rate card every codex dispatch classifies as *cost-unmetered*, contributes $0,
and a mixed-provider feature reports all-provider token volume beside Claude-only dollars.

```json
{
  "as_of": "2026-08-24T23:13:15.091Z",
  "source": "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
  "models": {
    "gpt-5.6-terra": {
      "input_cost_per_token": 0.000002,
      "output_cost_per_token": 0.000012,
      "cache_read_input_token_cost": 2e-7
    }
  }
}
```

| Field | Meaning |
| --- | --- |
| `as_of` | ISO-8601 instant the card was last pruned from upstream. Rewritten by every successful `refresh` |
| `source` | Upstream catalog the rates were pruned from |
| `models.<id>` | Per-**token** prices, LiteLLM field names verbatim, so an entry is a literal subset of the upstream record |

Rules that govern how the card is used:

- **Priced at dispatch time.** The adapter computes `costUsd` from the card as the dispatch
  completes and sets it on the existing `TokenUsage`, which rides the existing `provider_attempt`
  event. Every downstream consumer — the cost rollup, the finish usage line, the shipped record,
  OTel — works unchanged. History is never re-priced: the rate in force when a dispatch ran is
  what its event carries, so a later refresh cannot drift an old feature's reported cost.
- **The formula.**
  `input × input_cost_per_token + cacheRead × (cache_read_input_token_cost ?? input_cost_per_token)
  + cacheCreation × input_cost_per_token + output × output_cost_per_token`.
  `TokenUsage.input` is fresh-only by contract (the codex adapter subtracts the cached share at
  parse time), so cached volume is never charged twice. `reasoningOutput` is **not** priced
  separately — providers already include it in `output`.
- **Fail closed.** A missing card, an unparseable card, a dispatch that pinned no model, or a model
  with no card entry leaves `costUsd` undefined and the dispatch cost-unmetered. Nothing invents a
  price.
- **Provenance is recorded.** `TokenUsage.costSource` is `provider` for a provider-reported figure
  and `rate-card` for a harness estimate. A provider-reported cost is never overwritten.
- **Cost-unmetered dispatches are visible.** The finish usage line names them explicitly
  (`N cost-unmetered (tokens counted, cost not)`), so a partial cost can never be read as a total.
- **The card is read once per process.** Rates change rarely (a merged bot PR); a daemon or CLI
  restart picks up the new card.

## Load order and precedence

`loadMergedConfig()` (`config.ts:1707-1734`) runs four steps in this order:

1. Read and YAML-parse the project file, then validate its explicit values with absent defaults
   deferred (`loadProjectConfig(..., false)`). Project-source errors and normalizations still occur
   before merge.
2. `readUserConfig()` — read `~/.ai-conductor/config.yml`. No schema validation runs on the user file at
   this stage (`user-config.ts:31-70`).
3. `mergeConfigs(user, project)` — deep merge with the explicit project values as the winner
   (`config.ts:1682-1703`).
4. `validateConfig(merged, root, { source: 'merged' })`.

Merge semantics (`deepMerge`, `config.ts:1687-1703`): plain objects merge key by key, recursively.
Scalars **and arrays** from the project config replace the user value outright — arrays never concatenate.

Validation normalizes a deep clone, never the caller-owned value. During step 1, defaults for absent
project values are not materialized, so a user-level value survives whenever the project omits that
key. Explicit project values remain authoritative, including their existing rejection, fallback,
clamping, and warning behavior. Step 4 materializes runtime defaults once for values absent from both
scopes. This applies uniformly to every defaulted key, including `attribution_audit_sample_pct`,
`auto_restart_on_stale_engine`, `engine_refresh_min_interval_seconds`, `build_review`, `ci_watch`,
`build_progress_halt`, `kickback_escalation`, `gate_code_validity`, and `retry_routing`.

> **Known limitation.** `loadMergedConfig`'s own docstring says "User-config parse errors become warnings,
> not hard failures" (`config.ts:1700-1705`), but the code returns a hard `parse_error`
> (`config.ts:1715-1724`). A malformed `~/.ai-conductor/config.yml` blocks every project on the machine.
> Tracked in [#1026](https://github.com/jstoup111/ai-conductor/issues/1026).

For how a *step's* `model`, `effort`, and `max_retries` resolve across config, provider policy, and CLI
overrides, see [models](models.md).

## Validation behavior

Validation is fail-closed at the top level: an unrecognized key is a hard load error, not a warning.

| Condition | Result |
| --- | --- |
| File absent | `{ type: 'missing' }`; the engine continues on defaults (`src/conductor/src/index.ts:714`), but the `test_suite` gate fails with `missing_config` |
| Unparseable YAML | `{ type: 'parse_error' }`; the message carries `YAML parse error at line N:` when js-yaml supplies a mark (`config.ts:149-162`) |
| Empty document / `null` | Valid — resolves to `{}` with no warnings (`config.ts:199-201`) |
| Root is not an object | `{ type: 'validation_error' }`, `Config must be an object` |
| Unknown top-level key | Hard error `Unknown top-level key: "<k>"` (`config.ts:270-274`) |
| `harness_version` mismatch | `{ type: 'version_mismatch' }` (only when `loadConfig` is passed a `harnessVersion`) |
| Malformed project config at run start | `process.exit(1)` |

Only eight sites ever emit a warning instead of an error: the `attribution_audit_sample_pct` clamp
(`:708`), `auto_restart_on_stale_engine` (`:778`), `engine_refresh_min_interval_seconds` (`:807`),
the deprecated `step_heartbeat_stall_minutes` compatibility normalizer (`:852-859`),
`provider_preparation_timeout_minutes` (`:875-878`), `teardown_timeout_seconds` at resolution,
and the `build_review` and `ci_watch` normalizers (`:52,898-927,929-961`).

## Key index

42 top-level keys are allow-listed (plus one retired, no-op key — `wiring`, see
[build_review](#build_review)). Everything else fails the load.

| Key | Type | Default | Section |
| --- | --- | --- | --- |
| `harness_version` | string | none | [harness_version](#harness_version) |
| `defaults` | object | none | [defaults](#defaults) |
| `phases` | object | none | [phases](#phases) |
| `steps` | object | none | [steps](#steps) |
| `complexity` | object | none | [complexity](#complexity) |
| `conductor` | object | none | [conductor](#conductor) |
| `markdown_viewer` | object | none | [markdown_viewer and mermaid_renderer](#markdown_viewer-and-mermaid_renderer) |
| `mermaid_renderer` | object | none | [markdown_viewer and mermaid_renderer](#markdown_viewer-and-mermaid_renderer) |
| `assess` | object | none | [assess](#assess) |
| `acceptance_spec_globs` | string[] | `[]` | [acceptance_spec_globs](#acceptance_spec_globs) |
| `test_suite` | object | none | [test_suite](#test_suite) |
| `llm_provider` | string \| string[] | `['claude']` | [llm_provider](#llm_provider) |
| `ui_renderer` | string | `terminal` | [ui_renderer](#ui_renderer) |
| `visualizers` | string[] | unset | [visualizers](#visualizers) |
| `memory_provider` | string | `local` | [memory_provider](#memory_provider) |
| `otel` | object | disabled | [otel](#otel) |
| `build_progress` | object | see section | [build_progress](#build_progress) |
| `provider_stream` | object | `{ min_interval_ms: 5000 }` | [provider_stream](#provider_stream) |
| `spec_owner` | string | none | [spec_owner](#spec_owner) |
| `owner_gate_cutover` | ISO-8601 string | `null` | [owner_gate_cutover](#owner_gate_cutover) |
| `attribution_audit_sample_pct` | number | `10` | [attribution telemetry](#attribution-telemetry) |
| `rebase_resolution_attempts` | number | `3` | [rebase_resolution_attempts](#rebase_resolution_attempts) |
| `validation_concurrency` | number | `4` | [validation_concurrency](#validation_concurrency) |
| `harness_self_host` | object | see section | [harness_self_host](#harness_self_host) |
| `model_fallback_ladder` | string[] | provider policy | [model_fallback_ladder](#model_fallback_ladder) |
| `auto_restart_on_stale_engine` | boolean | `false` | [auto_restart_on_stale_engine](#auto_restart_on_stale_engine) |
| `engine_refresh_min_interval_seconds` | number | `300` | [engine_refresh_min_interval_seconds](#engine_refresh_min_interval_seconds) |
| `codex_doctor_timeout_seconds` | number | `10` | [codex_doctor_timeout_seconds](#codex_doctor_timeout_seconds) |
| `mergeable_autoresolve` | object | disabled | [mergeable_autoresolve](#mergeable_autoresolve) |
| `conflict_check` | object | `{ adr_corpus: change_set }` | [conflict_check](#conflict_check) |
| `build_review` | object | `{ enabled: true }` | [build_review](#build_review) |
| `prd_audit` | object | see section | [prd_audit](#prd_audit) |
| `architecture_review_as_built` | object | see section | [architecture_review_as_built](#architecture_review_as_built) |
| `ci_watch` | object | `{ enabled: true }` | [ci_watch](#ci_watch) |
| `build_progress_halt` | object | see section | [build_progress_halt](#build_progress_halt) |
| `retry_routing` | object | `{ enabled: true }` | [retry_routing](#retry_routing) |
| `kickback_escalation` | object | `{ enabled: true }` | [kickback_escalation](#kickback_escalation) |
| `cumulative_kickback_bound` | object | `{ enabled: true }` | [cumulative_kickback_bound](#cumulative_kickback_bound) |
| `gate_code_validity` | object | `{ enabled: true }` | [gate_code_validity](#gate_code_validity) |
| `daemon_verbose` | boolean | `false` | [daemon_verbose](#daemon_verbose) |
| `reconcile_parked_auto_cleanup` | boolean | `true` | [reconcile_parked_auto_cleanup](#reconcile_parked_auto_cleanup) |
| `provider_preparation_timeout_minutes` | number | `5` | [provider_preparation_timeout_minutes](#provider_preparation_timeout_minutes) |
| `teardown_timeout_seconds` | number | `120` | [teardown_timeout_seconds](#teardown_timeout_seconds) |
| `dispatch_start_timeout_seconds` | number | `120` | [dispatch_start_timeout_seconds](#dispatch_start_timeout_seconds) |
| `step_heartbeat_stall_minutes` | number | deprecated no-op | [step_heartbeat_stall_minutes](#step_heartbeat_stall_minutes) |
| `stale_claim_window_hours` | number | `24` | [stale_claim_window_hours](#stale_claim_window_hours) |

## harness_version

Minimum harness version this config requires. Optional string. Checked only when `loadConfig` receives a
`harnessVersion` argument (`config.ts:167-177`). A mismatch returns `{ type: 'version_mismatch' }`.

`satisfiesVersion` (`config.ts:1730-1735`) matches exactly one grammar: `>=X.Y.Z` with three numeric
components.

> **Known limitation.** Any constraint string that does not match `/^>=(\d+\.\d+\.\d+)$/` returns `true`.
> `^1.2.0`, `~1.2`, `1.2.3`, `<2.0.0`, and `>=1.2` all pass unconditionally, so the check they were
> written to perform never happens. Tracked in
> [#1026](https://github.com/jstoup111/ai-conductor/issues/1026).

`templates/ai-conductor-config.yml.template:8` ships `harness_version: ">=0.99.0"`, satisfiable by the
repo's current pre-1.0 `VERSION`. (Formerly shipped an unsatisfiable `">=1.0.0"`; fixed in
[#1010](https://github.com/jstoup111/ai-conductor/issues/1010).)

## defaults

Baseline knobs applied to every step that does not override them. Validated by
`validateEffortAndModelBag` (`config.ts:1534-1569`); an unknown key inside the block is a hard error.

| Key | Type | Allowed values | Default | Effect |
| --- | --- | --- | --- | --- |
| `defaults.model` | string | any string — **not** enum-checked | provider policy per step | Overrides the policy model for every step |
| `defaults.effort` | string | `low`, `medium`, `high`, `xhigh`, `max` | provider policy per step | Sets `CLAUDE_CODE_EFFORT_LEVEL` for the dispatch |
| `defaults.max_retries` | number | any number, no range check | `DEFAULT_STEP_RETRIES[step]` | Attempt budget before a step fails |
| `defaults.escalate` | boolean | `true`, `false` | `true` | Whether retries climb the escalation ladder |

`defaults.max_retries` interacts with [`build_progress_halt.attempt_ceiling`](#build_progress_halt):
raising it above an **explicitly set** ceiling makes the config fail to load.

Tier overrides belong on a phase or step; `defaults.by_tier` is rejected.

## phases

Per-phase knobs, keyed by phase name. Valid keys are `SETUP`, `UNDERSTAND`, `DECIDE`, `BUILD`, `SHIP`
(uppercase, `VALID_PHASES` at `config.ts:42`). An unknown phase is a hard error
`Unknown phase: "<p>"` (`config.ts:293-295`).

Each phase accepts the same five keys as `defaults` (`config.ts:297`). Unlike `defaults`,
`phases.<PHASE>.by_tier` is read during resolution (`resolved-config.ts:237, 349`).

```yaml
phases:
  UNDERSTAND:
    effort: low
  DECIDE:
    by_tier:
      L:
        effort: xhigh
```

Note the vocabulary split: config `phases:` keys are uppercase, while a `SKILL.md` frontmatter `phase:`
field is lowercase. See [skills](skills.md).

## steps

Per-step overrides, keyed by step name. A key matching a built-in step name overrides that step; any
other key declares a custom step. `steps` must be an object, and each value must be an object
(`config.ts:303-330`).

"Built-in" here means a member of `ALL_STEPS` — the 21 sequential steps. The four out-of-band steps
(`bootstrap`, `assess`, `remediate`, `attribution_verify`) live in `OUT_OF_BAND_STEPS`
(`src/conductor/src/engine/steps.ts:304-345`) and are not part of that set. See [steps](steps.md).

> **Known limitation.** `builtInNames` is built from `ALL_STEPS` alone (`config.ts:311`), so a
> `steps:` entry for any of the four out-of-band steps is classified as a *custom* step and rejected for
> missing the custom-step fields. `steps: { bootstrap: { model: haiku } }` fails the load with
> `Custom step "bootstrap" requires 'after: <existing-step>'`, and the same happens for `assess`,
> `remediate`, and `attribution_verify`. Their model, effort, and retry values can only be changed
> through `defaults` or `phases`. (`templates/ai-conductor-config.yml.template` formerly shipped exactly
> this `steps: bootstrap: { model: haiku }` example, commented out, which broke the config if
> uncommented; the template now illustrates the `steps:` block with `explore`, a real `ALL_STEPS` entry.
> Fixed in [#1010](https://github.com/jstoup111/ai-conductor/issues/1010).)

### Per-step keys

16 keys are allow-listed (`knownStepKeys`, `config.ts`). An unknown key is a hard error
`Unknown key in steps.<name>: "<k>"`.

| Key | Type | Validation | Default | Consumer |
| --- | --- | --- | --- | --- |
| `llm_provider` | string \| string[] | Non-empty string, or a non-empty array of unique non-empty strings | inherits the first top-level entry | `src/conductor/src/engine/provider-selection.ts:11-20` |
| `model` | string | Must be a string; the value is not enum-checked | precedence chain | `resolved-config.ts:246` |
| `effort` | string | `low`\|`medium`\|`high`\|`xhigh`\|`max`, else hard error (`config.ts:365-367`) | precedence chain | `resolved-config.ts:257` |
| `max_retries` | number | Must be a number (`config.ts:372-374`) | `DEFAULT_STEP_RETRIES[step]` | `resolved-config.ts:356` |
| `disable` | boolean | Must be a boolean (`config.ts:375-377`); see [Disabling a step](#disabling-a-step) | `false` | `resolved-config.ts:386` |
| `escalate` | boolean | Must be a boolean (`config.ts:378-380`) | `true` | `resolved-config.ts:371` |
| `skill` | string | Must be a string path (`config.ts:384-386`); for custom steps the file must exist on disk (`config.ts:516-525`) | the built-in skill | `resolved-config.ts:381`, `src/conductor/src/engine/steps.ts:603` |
| `hooks` | object | Object with optional string `before` / `after` paths (`config.ts:398-408`) | none | `resolved-config.ts:382-385` |
| `by_tier` | object | See [by_tier](#by_tier) | none | `resolved-config.ts:236, 348` |
| `when` | string | Grammar-checked at load time; see [when](#when) | none | `src/conductor/src/engine/when-expression.ts:97-136` |
| `parallel` | array | See [parallel](#parallel) | none | `config.ts:422-466` |
| `after` | string | **Custom steps only** — a built-in step with `after` is a hard error (`config.ts:529-531`) | required for custom steps | `steps.ts:561` |
| `enforcement` | string | **Custom steps only** (`config.ts:532-534`); `structural`\|`advisory`\|`gating` | `advisory` | `steps.ts:599` |
| `completion_artifact` | string | **Custom steps only** (`config.ts:535-537`); 7 constraints below | none | `src/conductor/src/engine/artifacts.ts:3086-3135` |
| `gate` | boolean | **Custom steps only**; a built-in step is a hard error | inherits the `after` target | `steps.ts:605` |
| `kickback_target` | boolean | **Custom steps only**; a built-in step is a hard error | `false` | `steps.ts:606` |

`steps.<name>.hooks` takes two sub-keys, `before` and `after`, each a project-relative script path.

### by_tier

Tier-scoped overrides, validated by `validateByTier` (`config.ts:1571-1620`). Tier keys must be `S`,
`M`, or `L`; anything else is a hard error. Each tier object accepts exactly three keys — `model`,
`effort`, `max_retries` — and rejects the rest. `escalate` is deliberately not tier-scopable.

```yaml
steps:
  plan:
    by_tier:
      L:
        effort: xhigh
        max_retries: 5
```

Tier overrides sit above the flat `steps.<name>` values in the precedence chain. See
[models](models.md).

### when

A guard expression evaluated per run; when false the step is skipped and a `when_skip` event is emitted.
Syntax is validated at config-load time by `validateWhenSyntax`
(`src/conductor/src/engine/when-expression.ts:97-136`), which never evaluates the expression.

Supported forms, exhaustively:

| Form | Example |
| --- | --- |
| `tier in [<csv>]` | `tier in [M, L]` |
| `tier == <literal>` | `tier == L` |
| `phase == <literal>` | `phase == BUILD` |
| `${<key>} == <value>` | `${track} == product` |
| `A && B` | `tier == L && phase == DECIDE` |

There is no `||`, no `!=`, no `!`, and no parentheses. An empty string fails with
`when expression must not be empty`. Anything else fails with `unsupported when expression: "<expr>"`
plus the list of supported forms.

> **Known limitation.** `src/conductor/src/types/config.ts:157-162` documents `when` and `parallel` as
> mutually exclusive, but the validator enforces exclusivity only between `skill` and `parallel`
> (`config.ts:426-430`). Setting both `when` and `parallel` on one step loads without complaint.
> Tracked in [#1026](https://github.com/jstoup111/ai-conductor/issues/1026).

### parallel

Splits one step into named branches. `parallel` must be an array and is mutually exclusive with `skill`
(`config.ts:422-430`).

| Branch key | Type | Validation | Default |
| --- | --- | --- | --- |
| `name` | string | Non-empty and unique within the group; a duplicate is a hard error (`config.ts:447-451`) | required |
| `skill` | string | Must be a string | none |
| `model` | string | Must be a string | branch inherits the step's resolution |
| `effort` | string | `low`\|`medium`\|`high`\|`xhigh`\|`max` | branch inherits |
| `advisory` | boolean | Must be a boolean | `false` |

An unknown branch key is a hard error. With `advisory: false` a branch failure blocks the group; with
`advisory: true` the failure is logged and the group still succeeds
(`src/conductor/src/types/config.ts:51-56`).

Each branch writes a synthetic state key `<step_name>__<branch_name>` into
`.pipeline/conduct-state.json`, valued `done`, `skipped`, or `failed`
(`src/conductor/src/types/config.ts:166-170`). See [artifacts](artifacts.md).

Branch fan-out is bounded by [`validation_concurrency`](#validation_concurrency), clamped to the branch
count (`src/conductor/src/engine/conductor.ts:6357`).

### Disabling a step

`disable: true` is checked against the step's enforcement level (`config.ts:539-554`):

| Step kind | Disableable |
| --- | --- |
| Custom step | Yes, always |
| Built-in `advisory` | Yes |
| Built-in `gating` | Only when the step definition sets `configDisableAllowed: true` |
| Built-in `structural` | Never |

`manual_test` is the only built-in step with `configDisableAllowed: true`
(`src/conductor/src/engine/steps.ts:214`). Per-step enforcement values are listed in [steps](steps.md).

> **Known limitation.** The rejection message reads `Cannot disable <enforcement> step: "<name>". Only
> advisory steps may be disabled.` (`config.ts:550-552`), which understates the rule — `manual_test` is
> a gating step and is disableable. Tracked in
> [#1026](https://github.com/jstoup111/ai-conductor/issues/1026).

### Custom step registry contract

Any `steps.<name>` key that is not a built-in step name declares a custom step
(`src/conductor/src/engine/steps.ts:538, 549`). `buildStepRegistry` splices it into the sequence at
`indexOf(after) + 1` using an iterative fixed-point loop, so chains of custom steps resolve
(`steps.ts:578-620`). Siblings sharing an `after` target keep config-file order.

Six fields are custom-step-only:

| Field | Required | Effect |
| --- | --- | --- |
| `after` | Yes | Insertion point. Must resolve to a built-in step name or a sibling custom step declared in the same file; self-reference does not count. Otherwise: `Custom step "<n>" references unknown after target: "<t>"` (`config.ts:496-510`) |
| `skill` | Yes | Path to the `SKILL.md` to dispatch. Missing: `Custom step "<n>" requires 'skill: <path-to-SKILL.md>'`. The file must exist relative to the project root, else `Custom step "<n>" skill file not found: <path>` (`config.ts:511-525`) |
| `enforcement` | No | `structural`, `advisory`, or `gating`. Defaults to `advisory` (`steps.ts:563`) |
| `completion_artifact` | No | Path the step must write to be considered done; see below |
| `gate` | No | Boolean. Overrides loop-gate membership; when omitted, inherits the `after` target's membership |
| `kickback_target` | No | Boolean. Makes this step reopenable by a downstream kickback; defaults to `false` |

`disable`, `when`, `parallel`, `model`, `effort`, `max_retries`, `escalate`, `hooks`, `by_tier`, and
`llm_provider` use the same semantics as for built-in steps. Custom steps bypass the
`configDisableAllowed` check.

The derived `StepDefinition` (`steps.ts:595-609`) sets `label = name`, inherits `phase` from the `after`
target, sets `prerequisites = [after]`, `skippableForTiers = []`, `isCheckpoint = false`, and takes
`loopGate` from the target step. A custom step inserted after a loop-gate step therefore joins the
gate-driven tail loop.

`buildStepRegistry` also records each definition it inserts so the step resolves by name alone. Several
points on the dispatch path — the phase lookup, the gating check, skill resolution, the audit trail —
resolve a step by name with no registry in scope, and `getStepDefinition` consults the built-in table
first, then out-of-band steps, then recorded customs. A custom step can therefore never shadow a step
the engine defines itself, and a name no assembled config declared still throws
`Unknown step: <name>`, which the daemon turns into a `.pipeline/HALT`. A custom whose `after` target
never resolved is not recorded either, so a broken chain stays unresolvable rather than becoming
silently dispatchable.

Custom steps hold no slot in the static step index. Every ordering decision — remediation routing, the
earliest-target search, the dispatch loop — is relative to the resolved registry, so a custom step's
position derives entirely from its `after` target. See [steps](steps.md) for the built-in order.

`completion_artifact` carries seven constraints, each a hard error (`config.ts:471-494`):

1. Non-empty string.
2. Not absolute — `<field> must be repository-relative`.
3. Starts with `.pipeline/` — `<field> must be under .pipeline/`.
4. No `..` path segment — `<field> must not contain traversal segments`.
5. No glob characters `* ? [ ] { }` — `<field> must be an exact file path without glob syntax`.
6. Does not end with `/` — `<field> must name a file under .pipeline/`.
7. Equals its own `path.normalize()` form — `<field> must be normalized`.

At completion time the artifact is checked in this order: custom predicate, configured
`completion_artifact`, glob fallback (`artifacts.ts:3086-3135`). The artifact must be a regular file and
its `mtimeMs` must be at or above the attempt or session freshness floor; a stale file reports
`… is stale — <step> must rewrite it during this attempt`, and a missing floor reports that completion
`cannot be verified without an attempt or session freshness floor`.

This repo's own custom step is documented in [self-hosting](../guides/self-hosting.md).

## complexity

| Key | Type | Allowed | Default | Consumer |
| --- | --- | --- | --- | --- |

The block remains reserved; any key inside it is rejected.

For what does resolve a tier, see
[where the tier comes from](steps.md#where-the-tier-comes-from).

## conductor

The sole update-check configuration surface. `bin/install` and the update flow read and write the
user-level `conductor:` block in `~/.ai-conductor/config.yml`; it is validated by
`validateConductorBlock` (`config.ts:1133-1165`), and an unknown key inside the block is a hard
error. A project `.ai-conductor/config.yml` that contains `conductor` is rejected; move the block
to the user configuration so one repository cannot override another operator's update settings.

| Key | Type | Allowed | Written by |
| --- | --- | --- | --- |
| `conductor.update_channel` | string | `stable`, `tagged`, or `main` only; anything else is a hard error (`config.ts:1146-1153`) | `bin/install` and the update flow |
| `conductor.auto_check` | boolean | — | `bin/install` and the update flow |
| `conductor.current_version` | string | — | `bin/install` and the update flow (machine state) |
| `conductor.last_checked_at` | string | ISO-8601 UTC | `bin/install` and the update flow (machine state) |

For an existing installation, `~/.claude/ai-conductor.config.json` is a one-time seed, not a
second live configuration source. Before the first access to `conductor:`, its recognized values
are translated from camelCase and take precedence over any stale values already in the block. A
successful seed renames the file to `ai-conductor.config.json.migrated`, making later accesses a
no-op. A missing source is a no-op; malformed or non-object JSON is left in place so it can be
repaired and retried. Invalid or absent individual legacy fields are skipped, while valid fields
still seed the block before the source is renamed.

Because the seed is a migration convenience rather than a precondition, a seed that cannot complete
does not block a *read* of `conductor:`. The failure is reported on stderr and its source file is
kept for a later repair, but the read still proceeds and decides fail-closed on the schema-owned
block alone. A *write* stays fail-closed on the seed, so an explicit value can never be replayed
over by legacy JSON on a later run. Without this split, an unseedable `~/.claude` file disabled the
update check outright even with a perfectly readable `config.yml` — most visibly mid-update, where a
`ai-conductor` build old enough to predate `config set` failed the seed's write while `config read`
still worked.

Fresh installs default to `stable`, whose branch advances only after release CI publishes the matching
semver tag and GitHub Release. `tagged` retains semver tag checkout behavior, and `main` follows every
merge. Existing configured channels and version pins are preserved by installer updates.

## markdown_viewer and mermaid_renderer

Two blocks with identical shape, validated at `config.ts:1443-1485` and `:1486-1530`. Allow-list for
both: `preset`, `command`, `args`, `mode`. An unknown key is a hard error.

| Key | Type | Validation |
| --- | --- | --- |
| `.preset` | string | Type only. Names a catalog entry that pre-fills command, args, and mode |
| `.command` | string | Type only. May be `""` for the `html` and `none` mermaid presets |
| `.args` | string[] | All entries must be strings **and the array must contain the literal `{file}`**, else hard error. `{out}` is also substituted for mermaid |
| `.mode` | string | `inline`, `blocking`, or `external` |

Markdown viewer presets (`src/conductor/src/engine/md-viewer-presets.ts:15-84`):

| Preset | Command | Mode |
| --- | --- | --- |
| `glow` | `glow -p -w 80 {file}` | inline |
| `bat` | `bat --style=plain --paging=never {file}` | inline |
| `mdcat` | `mdcat {file}` | inline |
| `cat` | `cat {file}` | inline |
| `code` | `code --wait {file}` | blocking |
| `typora` | `typora --wait {file}` | blocking |
| `marktext` | `marktext {file}` | external |
| `nvim` | `nvim {file}` | blocking |
| `obsidian` | `obsidian {file}` | external |

Mermaid renderer presets (`src/conductor/src/engine/mermaid-renderer-presets.ts:22-54`):

| Preset | Command | Mode | Notes |
| --- | --- | --- | --- |
| `html` | `""` | external | Self-contained HTML in the default browser; no native dependencies |
| `mmdc-png` | `mmdc -i {file} -o {out}` | external | Needs Chromium |
| `mmdc-svg` | `mmdc -i {file} -o {out}` | external | Needs Chromium |
| `none` | `""` | external | Rendering disabled |

> **Known limitation.** `MarkdownViewerConfig` and `MermaidRendererConfig` declare `command`, `args`, and
> `mode` as required (`src/conductor/src/types/config.ts:217-219, 231-233`), but every validator check is
> guarded by `!== undefined` (`config.ts:1459-1484, 1502-1530`). A block containing only `preset` passes
> validation. Tracked in [#1026](https://github.com/jstoup111/ai-conductor/issues/1026).

## assess

Staleness thresholds for the codebase assessment. Validated by `validateAssessBlock`
(`config.ts:1095-1118`); an unknown key is a hard error.

| Key | Type | Validation | Default | Consumer |
| --- | --- | --- | --- | --- |
| `assess.stale_after_days` | number | Finite and `>= 0`, else hard error | `90` | `src/conductor/src/engine/project-prelude.ts:317` |
| `assess.stale_after_commits` | number | Finite and `>= 0`, else hard error | `500` | `project-prelude.ts:318` |

Either threshold being exceeded marks the assessment stale, which prompts before a re-run
(`src/conductor/src/types/config.ts:236-241`).

## acceptance_spec_globs

Extra globs the `acceptance_specs` step counts as completion evidence. Optional `string[]`, default `[]`.
Must be an array containing only strings (`config.ts:608-615`).

These globs are **added to**, never replace, the step's built-in `STEP_ARTIFACT_GLOBS` entry, and they
apply to `acceptance_specs` alone — `src/conductor/src/engine/artifacts.ts:211` returns them only for
that step name.

```yaml
acceptance_spec_globs:
  - "*/spec/**"
  - "*/__tests__/**"
```

The leading `*/` is the monorepo idiom for "any immediate subdirectory."

## test_suite

The project-owned aggregate verification command run by the pre-SHIP `test_suite` gate. Validated by
`validateTestSuiteBlock` (`config.ts:1191-1290`); an unknown key inside the block is a hard error.

| Key | Type | Required | Validation | Default |
| --- | --- | --- | --- | --- |
| `test_suite.command` | string | Yes, unless `test_suite.scoped_command` is configured | Non-empty after trim (`config.ts:1217-1221`) | — |
| `test_suite.scoped_command` | string | No | Non-empty after trim and must contain `{selectors}`. `ai-conductor scoped-run <selectors...>` replaces that placeholder with the selected tests; it never falls back to `command`. (`config.ts:1223-1236`) | none; scoped runs are unavailable |
| `test_suite.working_directory` | string | No | Must be relative and resolve inside the project root. Absolute paths, `..` escapes, and symlinks whose realpath escapes the root are hard errors. A non-ENOENT/ENOTDIR realpath error fails closed (`config.ts:1239-1262`). Applies to both the aggregate `command` and `scoped_command`; `ai-conductor scoped-run` rebases project-root-relative selectors onto it | project root |
| `test_suite.timeout_seconds` | number | No | Finite and `> 0` (`config.ts:1264-1274`) | 1800 s (`DEFAULT_FULL_SUITE_TIMEOUT_MS`, `src/conductor/src/engine/full-suite-executor.ts:7`) |
| `test_suite.inputs` | string[] | No | Array of strings (`config.ts:1276-1287`) | none |
| `test_suite.environment` | string[] | No | Array of strings | none |
| `test_suite.verification.mode` | `aggregate` \| `scoped` | No | `scoped` requires `test_suite.scoped_command`; unknown modes are rejected | `aggregate` |
| `test_suite.verification.drift_budget` | category → `none` \| positive integer \| `unlimited` | No | Only budgetable fingerprint categories are accepted; dependency, migration, environment, and project-config drift always re-runs | all categories `none` |

`environment` holds environment variable **names**, not values. Each value is HMAC'd into the full-suite
fingerprint (`src/conductor/src/engine/full-suite-fingerprint.ts:209-228`) so that changing it
invalidates cached verification with reason `environment_changed`, and each is redacted from verifier
output. See [environment](environment.md).

The block must configure at least one of `command` or `scoped_command`. `command` is still required for
the aggregate pre-SHIP gate. Omitting the block entirely is a gating failure at SHIP: the verifier returns
`{ status: 'FAILED', reason: 'missing_config' }` (`src/conductor/src/engine/full-suite-verifier.ts:717-724`)
and the run HALTs. The gate itself is described in [gates](../explanation/gates.md).

`verification.mode: scoped` derives selectors from the feature's changed test paths. A scoped PASS
includes its command template and resolved selector set in the fingerprint, so either change makes
the evidence stale. An empty scoped selection deliberately runs the aggregate command and records
that basis in evidence and the existing verification event. `drift_budget` is cumulative from the
attested PASS: a declared within-budget change preserves that PASS; every other mismatch re-runs the
aggregate or scoped command as configured.

## llm_provider

Which provider host runs each step. Optional `string` or `string[]`; absent resolves to `['claude']`
(`src/conductor/src/engine/provider-selection.ts:5-8`).

Validation (`config.ts:1690-1728`): a non-empty string, or a non-empty array of non-empty unique strings.
Duplicates are rejected. An unregistered provider name is not caught at load — it **throws** at run start
with a list of available providers (`provider-selection.ts:52-66`).

An array is a fallback ladder, not a set. The **first** entry is inherited by every step that does not
set its own `steps.<n>.llm_provider` (`provider-selection.ts:10-20`; `src/conductor/src/index.ts:1001`;
`src/conductor/src/daemon-cli.ts:808`). Built-in model policies exist for `claude` and `codex`; any other
registered provider warns and falls back to the Claude policy
(`src/conductor/src/engine/provider-model-policy.ts:178-190`).

Procedure and trade-offs are in [multiprovider](../guides/multiprovider.md); the per-provider model
tables are in [models](models.md).

## ui_renderer

Plugin name for the run UI. Optional string, default `terminal` (`src/conductor/src/index.ts:1020-1023`).

Not schema-validated — the key is allow-listed only. An unknown name makes `registry.get` **throw**
`PluginNotFoundError` (`src/conductor/src/engine/plugin-registry.ts:37-46`), which is the opposite of
`memory_provider`'s soft fallback.

## visualizers

Names of `kind: visualizer` plugins to start for this run. Optional array of strings, unset by
default (`src/conductor/src/types/config.ts:439`).

Schema-validated: a non-array value, or an array containing a non-string, fails `validateConfig`
with `visualizers must be an array of strings` / `visualizers must contain only strings`
(`src/conductor/src/engine/config.ts:788-795`).

Each name is resolved against the plugin registry by `selectVisualizers`
(`src/conductor/src/index.ts:236-274`). Resolution is soft, unlike `ui_renderer`:

| Input | Result |
| --- | --- |
| Unset or `[]` | No visualizer is selected from this key |
| A registered visualizer name | Its factory is invoked with the run's start context and the result is started |
| A name that is not registered | Warn once per name, naming the registered visualizers, and skip it |
| `otel` | Warn once and skip — see below |

Project-local plugins shadow global plugins of the same kind and name, so a project install of a
name wins over the global one (`src/conductor/src/engine/plugin-loader.ts:144-167`).

`otel` is **not** selected through this key. The OTel visualizer is a built-in configured by its own
[`otel`](#otel) block and is attempted independently of `visualizers` for interactive runs and for
each daemon-dispatched feature (`src/conductor/src/engine/otel/wire.ts`). Listing `otel` here warns
`visualizer "otel" is configured through the "otel:" block; remove it from "visualizers".` and is
otherwise ignored (`src/conductor/src/index.ts:243-248`).

## memory_provider

Plugin name for the memory store. Optional string, default `local`. Resolved by `resolveMemoryProvider`
(`config.ts:1818-1852`), called at `src/conductor/src/daemon-cli.ts:835`.

| Input | Result |
| --- | --- |
| Absent, empty, or non-string | `local`, no warning |
| A valid, installed provider name | That provider |
| A valid name that is not installed | `local` plus one warning per bad name per run (`config.ts:1841-1849`) |

Not schema-validated.

## otel

OpenTelemetry export. Allow-listed at the top level but **not validated by `validateConfig`** — all
handling lives in `resolveOtelConfig` (`src/conductor/src/engine/otel/otel-config.ts:26-70`), which never
throws. When enabled, it exports interactive runs and each daemon-dispatched feature independently;
the trace Resource identifies the feature, project, and durable dispatch run id. The metric Resource
keeps only feature-stable identity: `service.name`, `service.instance.id` (`<project>/<feature>`),
`conductor.feature`, `conductor.project`, and `conductor.branch`. Metric data points also carry
`project` and `feature`; neither a run id nor the engine version is attached to metric Resources, so
a new dispatch does not create a new metric series for the same feature.

The `conductor.step.duration` and `conductor.pipeline.closeout.duration` histograms use explicit
duration buckets through 30 minutes; quantiles saturate above that largest finite bucket boundary.

When a run opens a `conductor.run` root span, its terminal export carries
`conductor.run.outcome`: `complete` after `feature_complete`, `halted` after `loop_halt`, or
`terminated` when the visualizer force-closes without either terminal event. Halted roots also carry
`conductor.run.halt.reason` and, when supplied, `conductor.run.halt.step` and
`conductor.run.halt.class`. An in-progress root span is not exported until it reaches one of those
terminal paths.

The `conductor.run.outcomes` counter increments once when an opened root run reaches one of those
terminal paths. Its `outcome` attribute uses the same `complete`, `halted`, and `terminated` taxonomy,
so dashboards can chart terminal runs without deriving counts from trace-query metrics.

Step-level metrics include `conductor.step.cost`, a USD counter emitted only for a finite `costUsd`.
Its attributes are `step`, `model` when known, and `source` when known (`provider` or `rate-card`);
an absent, `NaN`, or infinite cost produces no cost point. `conductor.step.dispatches` adds one point
for every closed step with `step` and `metering` attributes. `metering` is `fully-metered`,
`cost-unmetered`, or `unmetered`, so the absence of a cost series is not ambiguous.

| Key | Type | Required | Allowed | Default |
| --- | --- | --- | --- | --- |
| `otel` | object | No | — | absent means `{ enabled: false }` |
| `otel.exporter` | string | Yes, when the block exists | `otlp`, `file` | — |
| `otel.endpoint` | string | Yes, when `exporter: otlp` | any URL | — |
| `otel.file` | string | No | any path | `<pipelineDir>/otel.jsonl` |
| `otel.protocol` | string | No | `http/protobuf`, `grpc` per the type | passed through unchecked; omitted when falsy |
| `otel.project_name` | string | No | any non-blank name | project root basename |

The failure mode is silent-disable-with-an-error-string, not a halt. An unknown exporter yields
`{ enabled: false, error: "Unknown otel exporter '<x>'. Valid options: otlp, file." }`; `otlp` without an
endpoint yields `{ enabled: false, error: "otel exporter='otlp' requires an 'endpoint' URL …" }`.

`otel.project_name` is trimmed before use. An absent, blank, or whitespace-only value falls back to
the basename of the absolute project root for metric data-point identity; it does not affect
`service.name` (`ai-conductor`) or the Resource `conductor.project` attribute. It is the project
half of `service.instance.id` as well.

> **Known limitation.** `otel.protocol` is passed through entirely unvalidated
> (`otel-config.ts:60`) even though the type restricts it to `'http/protobuf' | 'grpc'`
> (`src/conductor/src/types/config.ts:260`). A typo produces a misconfigured exporter, not an error.
> Tracked in [#1026](https://github.com/jstoup111/ai-conductor/issues/1026).

## build_progress

Intra-step progress-event cadence during a build. Validated by `validateBuildProgressBlock`
(`config.ts:1231-1288`), which rejects nonsense outright rather than coercing it. An unknown key inside
the block is a hard error.

| Key | Type | Validation | Default |
| --- | --- | --- | --- |
| `build_progress.poll_seconds` | number | Finite and `> 0` | `30` |
| `build_progress.quiet_minutes` | number | Finite and `> 0` | `15` |
| `build_progress.heartbeat_minutes` | number | Finite and `> 0` | `5` |
| `build_progress.enabled` | boolean | Boolean | `true` |

Cross-field rule (`config.ts:1274-1285`): `poll_seconds` must not exceed `quiet_minutes * 60`. Violating
it is a hard error naming both values — otherwise a step could be declared stalled before it was polled
once.

Consumed by `src/conductor/src/engine/build-progress-watcher.ts:206`; `.enabled` gates the build step's
watcher at `src/conductor/src/engine/conductor.ts:3712`.

## provider_stream

Cadence for live `provider_stream_progress` events on the conductor event spine. The engine attaches
the observer only to non-interactive dispatches that use a machine-readable envelope; an interactive
operator session emits no provider-stream observations.
`min_interval_ms` is a finite number; its default is `5000` milliseconds when the block is absent
or the configured value is zero or negative. It is a hard floor for change-driven emissions, not
the heartbeat cadence: unchanged observations re-emit every five minutes. Unknown keys and
non-finite values fail config loading.

| Key | Type | Validation | Default |
| --- | --- | --- | --- |
| `provider_stream.min_interval_ms` | number | Finite; zero and negative values select the default | `5000` ms |

## build_progress_halt

Whether a build that stops making progress halts or parks. Validated at `config.ts:1304-1346`; the
resolved block is written back into the config object (`config.ts:908`). An unknown key inside the block
is a hard error.

| Key | Type | Validation | Default |
| --- | --- | --- | --- |
| `build_progress_halt.enabled` | boolean | Boolean | `true` |
| `build_progress_halt.attempt_ceiling` | integer | Finite, positive integer, **and `>= resolvedMaxRetries`** (`config.ts:1335-1343`) | `30` |
| `build_progress_halt.dispatch_ceiling` | integer | Finite, positive integer | `20` |

`resolvedMaxRetries` is `defaults.max_retries` when numeric, otherwise `FALLBACK_RETRIES` (3)
(`config.ts:902-905`). Setting `defaults.max_retries: 40` alongside `attempt_ceiling: 30` fails the load
with `build_progress_halt.attempt_ceiling (30) must not be below the resolved max_retries (40)`.

> **Known limitation.** The floor check fires only when `attempt_ceiling` is explicitly set. When the
> `build_progress_halt` block is absent, or is present but omits `attempt_ceiling`,
> `validateBuildProgressHaltBlock` returns early (`config.ts:1310`) and the resolver installs the default
> 30 without rechecking (`config.ts:1348-1365`). A config with `defaults.max_retries: 40` and no
> `build_progress_halt` block loads clean and runs with a ceiling below its own retry budget — the exact
> state the check exists to prevent. Set `attempt_ceiling` explicitly whenever you raise
> `defaults.max_retries`. Tracked in [#1026](https://github.com/jstoup111/ai-conductor/issues/1026).

Consumed at `src/conductor/src/daemon-cli.ts:429, 462` and
`src/conductor/src/engine/conductor.ts:4298`. User-level values apply when the project omits this
block; see [Load order and precedence](#load-order-and-precedence).

## retry_routing

Kill-switch for classifying a retry as a rerun versus a route to another step. Validated at
`config.ts:1380-1396`; the resolved block is written back (`config.ts:941`).

| Key | Type | Validation | Default |
| --- | --- | --- | --- |
| `retry_routing.enabled` | boolean | Boolean, else hard error | `true` |

`enabled` is the only allowed key; an unknown key inside the block is a hard error. This is stricter than
`kickback_escalation`, which silently discards its block instead.

Consumed at `src/conductor/src/engine/conductor.ts:4149`.

## gate_code_validity

Kill-switch for reusing a previously passing gate verdict when its stamped code surface is unchanged,
even if the verdict artifact's modification time is stale.

| Key | Type | Validation | Default |
| --- | --- | --- | --- |
| `gate_code_validity.enabled` | boolean | Boolean, else hard error | `true` |

`enabled` is the only allowed key; a non-object block or an unknown inner key is a hard error. Setting
`enabled: false` restores pure modification-time freshness and prevents reuse through code stamps.

The resolved value is consumed by the `build_review`, `prd_audit`,
`architecture_review_as_built`, and `manual_test` completion predicates, by stale-review-artifact
sweeping, and by step-runner gate preservation.

## harness_self_host

Guardrails that apply when the build target is the harness checkout itself. Validated by
`validateSelfHostBlock` (`config.ts:972-1019`). An unknown key inside the block is a hard error —
deliberately, so a typo'd gate name surfaces instead of silently leaving that gate enabled.

Resolution is safe-by-default (`resolveSelfHostConfig`, `resolved-config.ts:550-575`): an absent block, or
any omitted field, yields auto-detection with every gate enabled.

| Key | Type | Allowed | Default | Effect |
| --- | --- | --- | --- | --- |
| `activation` | string | `auto`, `force_on`, `force_off` | `auto` | `auto` compares the build root's realpath against the harness root; `force_on` treats any repo as a self-build; `force_off` never self-hosts |
| `sandbox_build_env` | boolean | — | `true` | Runs the self-build under a throwaway `CLAUDE_CONFIG_DIR` |
| `live_containment` | boolean | — | `true` | Proves the live checkout is read-only to each self-host dispatch with `bwrap`. If `false`, skips containment and restores fail-closed live-boundary behavior. |
| `version_approval_gate` | boolean | — | `true` | Halts for operator VERSION-bump approval before `finish` |
| `release_artifact_gate` | boolean | — | `true` | Halts on an integrity, CHANGELOG, or migration-block failure |
| `version_freeze` | string | Non-empty after trim, else hard error (`config.ts:1056-1064`) | `null` | While it resolves to the repo `VERSION`, the approval gate self-satisfies. Blank or whitespace normalizes to `null`. Besides a pinned semver string, accepts the literal `"latest"` (tracks the resolved base branch's current `VERSION`) or `"branch:<name>"` (tracks an explicit branch's `VERSION`) — see [self-hosting.md](../guides/self-hosting.md#the-self-host-finish-gates) |
| `auth_park_timeout_minutes` | number | Must be a number, else hard error (`config.ts:1079-1084`) | `60` | OAuth park-and-poll timeout. `0` means an immediate credentials-specific halt |
| `build_auth.mode` | string | `daemon-token`, `api-key`; empty string rejected (`config.ts:1117-1131`) | `daemon-token` | Selects the self-build auth source |
| `build_auth.token_path` | string | Must be a string (`config.ts:1132-1137`) | `~/.ai-conductor/build-auth` | `~` is expanded; blank or whitespace falls back to the default |

A declared `version_freeze` never approves an actual bump: any `VERSION` other than the frozen value
still halts.

`auth_park_timeout_minutes` has a second contract in the resolver: a non-integer or negative value
silently falls back to 60 (`resolved-config.ts:554-558`) even though the validator only rejects
non-numbers.

`sandbox_build_env: false` does not merely relax the sandbox — it makes the self-build unrunnable, with
`{ success: false, permissionDenied: true, output: 'Required safety protection unavailable:
self-host-isolation' }` (`src/conductor/src/engine/conductor.ts:2049-2065`).

`live_containment: false` is a temporary compatibility opt-out, not an exclusion. The dispatch runs
without the `bwrap` read-only live-checkout proof, so any live-checkout drift again follows the
existing fail-closed boundary path and writes a HALT. See the [live-boundary runbook](../runbooks/stalled-or-stuck-feature.md#live-boundary-violation-self-host-only) for recovery.

Likewise, containment is not considered active when `bwrap` is unavailable or its probe fails. The
probe proves three things: the live checkout is read-only, the dispatched worktree is writable, and
the wrap still lets the provider create its own nested sandbox namespace. Only a full pass permits
live-checkout drift to be attributed to a concurrent operator; every unproven case remains
fail-closed.

The nesting assertion exists because providers sandbox themselves inside the wrap — codex's
`apply_patch` helper and Claude Code's sandboxed bash both spawn `bwrap`. On a host that refuses an
unprivileged user namespace to an already-namespaced process (for example Ubuntu with
`kernel.apparmor_restrict_unprivileged_userns=1`), that nested sandbox fails and the provider cannot
write a single file, so the dispatch burns its whole budget making no progress. Containment refuses
itself on such hosts with `containment unavailable: the wrap denies the provider its own nested
sandbox namespace` rather than wrapping a dispatch that cannot work.

The skill relink preflight is always on.

Operating this repo under these guardrails is covered in [self-hosting](../guides/self-hosting.md).

## model_fallback_ladder

Ordered list of models to try when the resolved model is unavailable. Optional `string[]`; must be an
array of non-empty strings, and an **empty array is legal** (`config.ts:737-746`).

Absent means the provider policy's own ladder is used:
`this.config?.model_fallback_ladder ?? this.modelPolicy.modelFallbackLadder`
(`src/conductor/src/engine/step-runners.ts:384`; also `attribution-lane.ts:367`). Policy defaults are
`['fable','opus','sonnet']` for Claude and `['gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna']` for Codex.
See [models](models.md).

## auto_restart_on_stale_engine

Whether an idle daemon respawns itself when `dist/` points at a newer engine than the one it is running.
Optional boolean, default `false` — written back into the config object (`config.ts:783-786`).

| Input | Result |
| --- | --- |
| Absent or `null` | `false`, no warning |
| Boolean | As given |
| Anything else | `false` plus one warning; never throws |

Armed only when the build is also classified self-host:
`(config?.auto_restart_on_stale_engine ?? false) && isSelfHost`
(`src/conductor/src/daemon-cli.ts:761`; also `:1799`). Read at daemon startup, so a change requires a
daemon restart.

User-level values apply when the project omits this key; see
[Load order and precedence](#load-order-and-precedence).

## engine_refresh_min_interval_seconds

Minimum seconds between engine-refresh (origin fetch) attempts. Optional number, default `300` — written
back (`config.ts:812-815`).

| Input | Result |
| --- | --- |
| Absent or `null` | `300`, no warning |
| Finite and `> 0` | As given |
| Non-numeric, non-finite, **zero**, or negative | `300` plus one warning; never throws |

Consumed at `src/conductor/src/daemon-cli.ts:1397, 1427` as `(… ?? 300) * 1000`. User-level values
apply when the project omits this key.

## codex_doctor_timeout_seconds

Maximum time, in seconds, to wait for the Codex readiness doctor command. Optional number, default `10`.
The value must be positive and finite after conversion to milliseconds; invalid values, including values
that overflow when multiplied by 1,000, fail configuration validation. The resolved value is passed to the
Codex provider as milliseconds.

## mergeable_autoresolve

Automatic conflict resolution on open PRs. Validated at `config.ts:1405-1443`; an unknown key inside the
block is a hard error.

| Key | Type | Validation | Default |
| --- | --- | --- | --- |
| `mergeable_autoresolve.enabled` | boolean | Boolean, else hard error | `false` |
| `mergeable_autoresolve.cooldownMinutes` | number | Finite **and non-negative**, else hard error | `60` |
| `mergeable_autoresolve.suiteCommand` | string | String, else hard error | unset |

Defaults are injected only when the block is present (`config.ts:817-829`); an absent block stays absent
and each consumer applies `?? false` / `?? 60` inline
(`src/conductor/src/daemon-cli.ts:1555, 1588, 1657-1659, 1747`). Both paths reach the same values.

Disabling it never halts — the sweep simply behaves as it did before the feature existed.

Draft PRs are never dispatched for auto-resolution. A CONFLICTING draft is logged as
`skipping resolve for <url> (draft PR)` and left alone; its `mergeable` label handling is
unchanged, and no attempt counter is burned.


## conflict_check

Sets the ADR corpus used by the DECIDE `conflict_check` step. The block accepts only
`adr_corpus`; any other nested key is a configuration error.

| Key | Type | Allowed values | Default |
| --- | --- | --- | --- |
| `conflict_check.adr_corpus` | string | `change_set`, `repo_wide` | `change_set` |

`change_set` compares stories with the approved ADRs in the current spec's change set. It does not
narrow that corpus or parse ADR supersession status. `repo_wide` first considers all approved ADRs,
then narrows them to subjects that overlap the current stories and records both the examined and
narrowed-out ADRs in the conflict report. At that scope only, an unambiguously fully superseded ADR
is excluded; partial or ambiguous supersession remains in scope.

## build_review

An opt-in judgement gate at the `build` → downstream seam. It no longer judges plan conformance,
outcome delivery, or mechanism soundness — those questions now belong to [`prd_audit`](#prd_audit) and
the as-built architecture review ([`architecture_review_as_built`](#architecture_review_as_built)). The
block is normalized in place; the resolved value is written back (`config.ts:1111-1177`).

| Key | Type | Default | Status |
| --- | --- | --- | --- |
| `build_review.enabled` | boolean | `true` | Works |
| `build_review.scopeContainmentEnforced` | boolean | `false` | Works |
| `build_review.maxParallel` | integer | `4` | Must be between 1 and 4 |
| `build_review.rubrics` | object | `testQuality` off | Closed canonical map: `testQuality` only. Every other id ever accepted — `scope`, `completeness`, `rootCause`, `causalIntegrity`, `tautology`, `wiring` — is retired: it warns and is silently ignored rather than rejecting the config |

Normalization contract:

| Input | Result |
| --- | --- |
| Absent or `null` | `{ enabled: true }`, no warning |
| Valid `enabled` and/or `scopeContainmentEnforced` keys | Preserved; omitted `enabled` defaults to `true` |
| Non-object | `{ enabled: true }` plus one warning |
| Unknown or invalid inner key | That key is omitted and warned by name; valid sibling keys are preserved |
| `perTaskFloor` (any value) | Retired and ignored; a `config_deprecated_key` event is emitted naming `build_review.perTaskFloor` |

Malformed input fails **open** to enabled by design — `config.ts` states the rule as never silently
opting a project out of the replacement authority.

`build_review` is a gating built-in with no `configDisableAllowed`
(`src/conductor/src/engine/steps.ts:158-161`), so `steps.build_review.disable: true` is a hard error. The
config key is the only off switch. When disabled, the step is marked `skipped` and a `config_skip` event
is emitted (`src/conductor/src/engine/conductor.ts:6259, 6270-6276`), resolved once per pass.

`testQuality` accepts `enabled`, `llm_provider`, `model`, `effort`, `model_fallback_ladder`,
`max_retries`, and `escalate`. It is off by default; a feature with no acceptance-criteria change has an
empty judged scope and the rubric passes without judging even when enabled. Any unknown or retired rubric
id under `build_review.rubrics` — `scope`, `completeness`, `rootCause`, `causalIntegrity`, `tautology`,
`wiring` — is accepted as a no-op with a one-time notice naming the retired setting; it never fails
configuration loading or halts a run
(`adr-2026-08-22-build-review-opt-in-rubric-container`).

`scopeContainmentEnforced` is resolved through the same block and read by the real
`ai-conductor scope-check` command. It defaults to `false`, so verified violations are reported while
the commit proceeds. Set it to `true` to make a verified violation return exit `2`; the generated
`commit-msg` hook converts that result to Git exit `1` and refuses the commit without changing the
working tree or index.

The `wiring` top-level config key (distinct from `build_review.rubrics.wiring`) is also accepted and
ignored, retained only so a pre-existing consumer config does not hard-fail on upgrade.

## prd_audit

Bounded remediation policy for the SHIP-phase `prd_audit` gate, which judges the shipped implementation
against the feature's stories' acceptance criteria (PRD functional requirements are context, not the
audit key, when a PRD exists). Runs on every feature, regardless of complexity tier or work track — the
step carries no tier or track skip. A feature whose stories have no acceptance criteria to grade
trivially passes.

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `prd_audit.max_remediation_laps` | positive integer | `1` | Caps the number of remediation laps a `prd_audit` FAIL can trigger for a feature |
| `prd_audit.max_appended_tasks` | positive integer | `5` | Fixed cap on tasks appended by a `prd_audit` remediation lap |
| `prd_audit.max_appended_ratio` | finite number in `(0, 1]` | `0.25` | Cap on appended tasks as a fraction of the authored task count |
| `prd_audit.halt_on_any_plan_gap` | boolean | `false` | When `true`, every `PLAN_GAP` finding halts for the operator, not only happy-path ones |

The effective append cap for a remediation lap is `min(max_appended_tasks, ceil(authored_count *
max_appended_ratio))`. `FIXABLE` findings beyond that cap, or a `FIXABLE` finding once
`max_remediation_laps` is exhausted, halt for the operator listing every finding instead of appending
tasks. A merged spec whose plan predates `prd_audit`'s remediation caps (pre-existing appended
remediation tasks) counts those tasks toward the authored baseline rather than the cap, so an old feature
does not retroactively exceed a cap it was never measured against.

## architecture_review_as_built

Per-check, per-tier policy for the as-built architecture review, which runs on every feature and issues
one of `APPROVED`, `PLAN_GAP`, or `BLOCKED`.

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `architecture_review_as_built.checks.<name>.tiers` | array of `S`\|`M`\|`L` | see below | Restricts the named check to the listed complexity tiers; an explicit list always overrides the artifact-presence default |
| `architecture_review_as_built.remediation.enabled` | boolean | `true` | Enables daemon-mode bounded remediation for an all-`REMEDIABLE` `BLOCKED` report; `false` keeps that report on the needs-human halt path |
| `architecture_review_as_built.max_remediation_laps` | positive integer | `1` | Caps as-built remediation laps for the feature; exhaustion halts before another plan append |

`<name>` is one of `reachability`, `planGap`, `adrCompliance`, `diagramDrift`. Without an explicit
`tiers` override:

| Check | Runs when |
| --- | --- |
| `reachability` | Every tier |
| `planGap` | Every tier |
| `adrCompliance` | Approved ADRs exist under `.docs/decisions/` |
| `diagramDrift` | Architecture diagrams exist |

`PLAN_GAP` means the code faithfully implements the approved design and the design itself is the limit.
The outcome is judged against the sealed story criteria under `.docs/stories/`, never against superseded
`.docs/intake/` capture: the gap is recorded in the verdict and the shipped record and ships when those
criteria are satisfied, and halts only when a sealed story criterion is unmet.

`remediation` accepts only the `enabled` boolean. `max_remediation_laps` must be an integer greater
than zero; unknown keys and invalid values are configuration errors.

## ci_watch

Post-merge CI watch and fix loop. Normalized in place; the resolved value is written back
(`config.ts:929-961`).

| Key | Type | Default | Status |
| --- | --- | --- | --- |
| `ci_watch.enabled` | boolean | `true` | Works (`src/conductor/src/daemon-cli.ts:1678`) |
| `ci_watch.cooldownMinutes` | finite non-negative number | `60` | Works |

Normalization contract:

| Input | Result |
| --- | --- |
| Absent or `null` | `{ enabled: true }`, no warning |
| Valid `enabled` and/or `cooldownMinutes` keys | Preserved; omitted `enabled` defaults to `true` |
| Non-object | `{ enabled: true }` plus one warning |
| Unknown or invalid inner key | That key is omitted and warned by name; valid sibling keys are preserved |

Eligibility failures return `{ eligible: false, reason }` and skip — they never halt
(`src/conductor/src/engine/ci-fix.ts:230-264`).

Remediation waits for terminal CI. A rollup counts as `failed` as soon as one check fails, even
while sibling checks are still queued or running, so the eligibility gate defers any PR that still
has a non-terminal check — reason `checks-not-terminal`
(`src/conductor/src/engine/ci-fix.ts#nonTerminalCheckNames`). A check is terminal once it reports a
conclusion (`SUCCESS`, `FAILURE`, `CANCELLED`, `TIMED_OUT`, `SKIPPED`, …); `QUEUED`, `IN_PROGRESS`,
`PENDING`, `WAITING`, `REQUESTED`, `EXPECTED`, and a missing conclusion are not. A deferral burns no
attempt — the next sweep tick re-reads the PR and dispatches once every check has finished. When the
PR state carries no check-rollup detail at all, the gate does not block.

Draft PRs are never dispatched to the CI fix loop. The sweep may still reconcile their `mergeable`
label, but logs `skipping ci-fix for <url> (draft PR)` instead of collecting them as candidates — a
draft PR belongs to an in-flight build, and fixing its CI would fight the running build. GitHub's
native checks remain the CI-status authority; the sweep never applies the redundant `ci-failed`
label and removes it when observed. Attempt counters are not burned for skipped drafts.

`cooldownMinutes` reaches the CI-fix cooldown calculation (`src/conductor/src/engine/ci-fix.ts:250`);
`0` is valid and disables the delay.

## kickback_escalation

Escalation when a kickback to `build` produces no change.

| Key | Type | Default |
| --- | --- | --- |
| `kickback_escalation.enabled` | boolean | `true` |

Contract (`src/conductor/src/engine/config.ts:934-957`): absent or `null` yields `{ enabled: true }`; a boolean is taken as given;
anything malformed — non-object, unknown inner key, or non-boolean `enabled` — is replaced with
`{ enabled: true }` with **no warning**. The resolved block is written back.

Consumed at `src/conductor/src/engine/conductor.ts:3362` (`?? true`). When enabled, the no-op
escalation guard compares the pre- and post-build tree hashes (and resolved-task counts) for the
kickback; an empty commit therefore does not count as progress. Setting `enabled: false` disables
that tree-hash witness and reverts to re-kicking until the cap. It does not disable the durable
per-gate cap, which still bounds unchanged cross-dispatch loops; the `planRemediation` guard is
also not gated by this flag (`src/conductor/src/types/config.ts:302-308`).

The flag applies to active build kickbacks only. A leftover configuration entry using the removed
step name is rejected as an ordinary unknown custom step (it lacks the required `after:` field).
See [`.pipeline/build-outcome.json`](artifacts.md#core-state).

## cumulative_kickback_bound

Kill-switch for the cumulative `build_review` convergence bound.

| Key | Type | Default |
| --- | --- | --- |
| `cumulative_kickback_bound.enabled` | boolean | `true` |

Contract (`src/conductor/src/engine/config.ts:1056-1079`), mirroring
[`kickback_escalation`](#kickback_escalation): absent or `null` yields `{ enabled: true }`; a
boolean is taken as given; anything malformed — non-object, unknown inner key, or non-boolean
`enabled` — is replaced with `{ enabled: true }` with **no warning**. A block carrying an unknown
sibling key is replaced wholesale, so a sibling `enabled: false` in that block is NOT honored.

The per-gate kickback counter resets whenever the tree moves, so a feature that changes the tree
every lap can re-earn a full budget indefinitely. The cumulative counter is incremented outside the
progress branch and is therefore tree-movement-proof: after
`MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW` laps (`kickback-ledger.ts:35`), `build_review` terminates in
an operator-visible `needs-human` halt naming the cumulative count instead of looping. A passing
`build_review` does not reset the counter. A rebase credits the convergence laps back only when it
actually invalidates `build_review`, and does so once for that invalidation; a rebase that preserves
the gate leaves the accumulated count intact. See
`adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence.md`.

Consumed at `src/conductor/src/engine/conductor.ts:3703` (`?? true`). Setting `enabled: false`
disables only the terminal halt; the counter is still maintained and still reported on the
`kickback` event's `cumulativeCount`, so the history stays observable.

## daemon_verbose

Re-surfaces gated-spec skip notices (no-PR, terminal-PR, no-Source-Ref) on the daemon log. Optional
boolean; a non-boolean is a hard error (`config.ts:597-599`). The `false` default is applied at the
wiring sites, not written back: `config?.daemon_verbose ?? false`
(`src/conductor/src/daemon-cli.ts:1037, 1111, 1191`).

## reconcile_parked_auto_cleanup

Whether the daemon's startup and idle-tick sweep automatically removes a merged, recorded parked
feature's worktree and branch and unparks it, versus only classifying and annotating it on the
dashboard. Optional boolean; a non-boolean is a hard error (`config.ts:607-609`). Absent config
resolves to `true` at validation time (unlike `daemon_verbose`, the default is written back into
`obj.reconcile_parked_auto_cleanup`, not just applied at the wiring site).

Set to `false` to require an explicit `ai-conductor daemon reconcile-parked <slug>` (or manual
cleanup) for every parked feature, even once it is merged and recorded — see
[park a feature before you touch its git state](../guides/running-the-daemon.md#park-a-feature-before-you-touch-its-git-state).

## provider_preparation_timeout_minutes

Active pre-spawn deadline, in minutes, for provider candidate resolution, session setup, and
self-host preparation. It is independent of heartbeat telemetry. Optional finite number; absent
resolves to `5`. A positive value enables the deadline; `0` or a negative value disables it. A
non-numeric or non-finite value is ignored with a validation warning, then resolves to the default.

When an active deadline expires, the supervisor revokes the preparing attempt before it can spawn a
provider and allows one replacement for that logical step. A second preparation timeout writes a
`needs-human` HALT. See the [stalled-feature runbook](../runbooks/stalled-or-stuck-feature.md#provider-preparation-exhausted)
for recovery.

## teardown_timeout_seconds

Maximum time, in seconds, for a project's optional `bin/teardown` hook before an authorized feature
worktree removal. Absent values resolve to `120`; a finite positive value, including a fractional
number, replaces that bound. For example:

```yaml
teardown_timeout_seconds: 120
```

This timeout is deliberately non-disableable. `0`, negative, non-numeric, non-finite, and `null`
values produce one warning at resolution and fall back to `120`, so a teardown hook always has a
finite bound. It does not share the auth timeout contract: `harness_self_host.auth_park_timeout_minutes:
0` requests an immediate authentication halt, while `teardown_timeout_seconds: 0` cannot opt out of
the bound.

The daemon passes this bound to post-ship reaping, `ai-conductor daemon reclaim-worktree <slug>`, and
parked-feature reconciliation. A missing `bin/teardown` is silent. A timeout, non-zero exit, or an
unrunnable script is logged and contained; removal continues once its normal safety proof has
authorized it. See [running the daemon](../guides/running-the-daemon.md#project-teardown-hook) for
the hook contract and [worktree recovery](../runbooks/worktree-and-evidence-recovery.md) for recovery.

## dispatch_start_timeout_seconds

Maximum time, in seconds, for a project's optional `bin/dispatch-start` hook at the start of every
daemon dispatch. Absent values resolve to `120`; a finite positive value, including a fractional
number, replaces that bound.

```yaml
dispatch_start_timeout_seconds: 120
```

This timeout is deliberately non-disableable. `0`, negative, non-numeric, non-finite, and `null`
values produce one warning at resolution and fall back to `120`. A missing hook is silent; a timeout,
non-zero exit, or unrunnable script is logged and contained, so the dispatch continues.

## step_heartbeat_stall_minutes

Deprecated accepted compatibility no-op. Finite legacy values, including `0` and negative values,
continue to load with a warning; non-numeric or non-finite values are ignored with a warning. The
key has no default behavior and is never read as
`provider_preparation_timeout_minutes`.

`.pipeline/step-heartbeat` remains activity telemetry for `daemon status`. Neither heartbeat
silence nor staleness terminates, retries, replaces, or completes a running provider, so this key
grants no termination or lifecycle authority.

## spec_owner

The daemon operator identity used by the owner gate. Optional string.

**This key may live only in `~/.ai-conductor/config.yml`.** On the `source: 'project'` path the key being
merely present — blank or not — is a hard rejection naming the file and the fix
(`config.ts:633-641`), because a committed `spec_owner` would leak one operator's identity to everyone
who pulls the repo. On the `source: 'merged'` path only the type is checked (`config.ts:642-644`).

Consumed at `src/conductor/src/engine/owner-gate/identity.ts:56`,
`owner-gate/machine-identity.ts:40`, and `engine/engineer/authoring.ts:603`. With no `spec_owner`,
identity resolves per machine via the `gh` login fallback.

## owner_gate_cutover

Grandfather instant for the owner gate. Optional ISO-8601 instant string.

Validation (`config.ts:652-662`): must be a string and `Date.parse` must succeed. A malformed date is
**rejected, never silently defaulted** — an un-owned spec must not be misclassified because of a
fat-fingered date. The error names the value and shows the expected form.

Absent resolves to `null` at the wiring site (`src/conductor/src/daemon-cli.ts:1229`), so un-owned
specs default-build. With a cutover, an un-owned spec whose plan first reached the default branch
strictly before it is labeled grandfathered; specs merged on or after it also default-build.

## Attribution telemetry

`attribution_audit_sample_pct` controls the percentage of attribution telemetry audit events sampled.
It is an optional number: validation requires a number, clamps values outside `[0,100]` with a warning,
and defaults an absent value to `10`. Attribution telemetry consumes the resolved value at
`src/conductor/src/engine/attribution-telemetry.ts`; a user-level value applies when the project omits
the key. See [Load order and precedence](#load-order-and-precedence).

The retired `attribution_enforcement_cutover` and `attribution_judge_cutover` keys are not valid
configuration keys. Remove either key before updating.

## rebase_resolution_attempts

Cap on assisted conflict-resolution attempts inside the `rebase` step. Optional number, default `3`
(`DEFAULT_REBASE_RESOLUTION_ATTEMPTS`, `resolved-config.ts:411`).

Not validated in `validateConfig` — it is allow-listed only, and all coercion happens in
`resolveRebaseResolutionAttempts` (`resolved-config.ts:424-433`):

| Input | Result |
| --- | --- |
| Absent or `null` | `3` |
| A finite number `>= 0` | Used as-is; **`0` disables auto-resolution and a conflict halts immediately** |
| Negative, non-finite, or non-number | `3`, silently |

Consumed at `src/conductor/src/engine/autoresolve.ts:214`,
`src/conductor/src/engine/conductor.ts:6548`, and `src/conductor/src/daemon-cli.ts:979, 1616`.

## validation_concurrency

Bounds the validation-phase fan-out. Optional number, default `4`
(`DEFAULT_VALIDATION_CONCURRENCY`, `config.ts:1998`).

The default is 4 rather than the built-in group's branch count (3) so the whole SHIP-tail group —
`manual_test`, `prd_audit`, `architecture_review_as_built` — dispatches in one wave instead of
leaving its third member queued behind the first two. Because the resolved width is always clamped
to the branch count, a narrower group never spawns idle slots. Lower it to serialize the fan-out
(for example on a constrained machine, or to make a run easier to follow); `1` degrades the group to
the serial path.

A non-number is a hard error (`config.ts:748-752`). Zero, negative, and `NaN` pass validation, but
`resolveValidationConcurrency` (`config.ts:2009-2021`) silently substitutes `4`.

Consumed at `src/conductor/src/engine/conductor.ts:1263`, then clamped to the branch count at `:6357`.

## stale_claim_window_hours

Controls how long a `claimed` engineer-intake ledger entry may remain unfinished before it is
treated as stranded. It governs claim-time auto-heal and the default window for
`ai-conductor compose requeue --stale`; `--older-than` overrides it for one invocation.

The default is `24` hours. Non-positive and non-numeric values fall back to that default.

## Full example

```yaml
harness_version: ">=0.99.0"

llm_provider: claude

defaults:
  effort: medium

phases:
  UNDERSTAND:
    effort: low

steps:
  plan:
    by_tier:
      L:
        effort: xhigh

test_suite:
  command: npm test
  scoped_command: npx vitest run {selectors}
  working_directory: .
  timeout_seconds: 1800
  environment:
    - CI
  verification:
    mode: aggregate
    drift_budget:
      source: 5
      tests: 10

markdown_viewer:
  preset: glow
  command: glow
  args: ["-p", "-w", "80", "{file}"]
  mode: inline
```

`templates/project-config.yml.template` is the project seed used by `ai-conductor create` and
`ai-conductor config init`. `templates/ai-conductor-config.yml.template` remains the user-level
reference. The remaining allow-listed keys are documented only here.

## See also

- [models](models.md) — how a step's model and effort resolve, and the full per-step tables.
- [steps](steps.md) — step names, order, phase, tier-skip, and enforcement values.
- [cli](cli.md) — every command and flag, including `--model`.
- [environment](environment.md) — every environment variable the harness reads or writes.
- [gates](../explanation/gates.md) — what a gate is and how fail-closed rules work.
