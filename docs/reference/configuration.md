# Configuration reference

Every key the engine reads from `.ai-conductor/config.yml`, with its type, default, allowed values, the
code that consumes it, and what a bad value does. Sections follow the loader's own allow-list order
(`src/conductor/src/engine/config.ts:213-269`), not alphabetical order.

## File locations

| Role | Path | Constant |
| --- | --- | --- |
| Project config | `<project>/.ai-conductor/config.yml` | `PROJECT_CONFIG_DIR` / `PROJECT_CONFIG_FILE`, `src/conductor/src/engine/config.ts:94-95` |
| User config | `~/.ai-conductor/config.yml` | `src/conductor/src/engine/user-config.ts:13-19` |
| Legacy project dir | `<project>/.harness/config.yml` | `LEGACY_PROJECT_CONFIG_DIR`, `config.ts:96` |
| Legacy user JSON | `~/.claude/ai-conductor.config.json` (flat camelCase) | `user-config.ts:15,87-106` |

Both files use the same schema. Keep per-user state (`conductor:` and `markdown_viewer:`) in the
user file. Keep self-host settings such as `harness_self_host`, `owner_gate_cutover`, and
`auto_restart_on_stale_engine` in the harness checkout's project config, not in unrelated
projects.

`migrateLegacyProjectConfig()` renames `.harness/config.yml` to
`.ai-conductor/config.yml` on every `loadConfig()` call; it is idempotent, no-ops when the new path
already exists, and returns `false` silently on any failure without touching either file
(`config.ts:112-123`, called at `:132`).

`conduct-ts create <name>` writes a new repository's project config from
`templates/project-config.yml.template`. For an existing Git repository, run
`conduct-ts config init`; it writes the same template when the file is absent, reports success
without changing bytes when the file already exists, and refuses a non-Git directory. The missing-file
error names this command as its remedy. `bin/install` and `bin/migrate` continue to write only the
user file.

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
`build_progress_halt`, `kickback_escalation`, and `retry_routing`.

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

Only four sites ever emit a warning instead of an error: the `attribution_audit_sample_pct` clamp
(`:708`), `auto_restart_on_stale_engine` (`:778`), `engine_refresh_min_interval_seconds` (`:807`), and
the `build_review` normalizer (`:850,859,865`).

## Key index

36 top-level keys are allow-listed. Everything else fails the load.

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
| `memory_provider` | string | `local` | [memory_provider](#memory_provider) |
| `otel` | object | disabled | [otel](#otel) |
| `build_progress` | object | see section | [build_progress](#build_progress) |
| `spec_owner` | string | none | [spec_owner](#spec_owner) |
| `owner_gate_cutover` | ISO-8601 string | `null` | [owner_gate_cutover](#owner_gate_cutover) |
| `attribution_audit_sample_pct` | number | `10` | [attribution telemetry](#attribution-telemetry) |
| `rebase_resolution_attempts` | number | `3` | [rebase_resolution_attempts](#rebase_resolution_attempts) |
| `validation_concurrency` | number | `2` | [validation_concurrency](#validation_concurrency) |
| `harness_self_host` | object | see section | [harness_self_host](#harness_self_host) |
| `model_fallback_ladder` | string[] | provider policy | [model_fallback_ladder](#model_fallback_ladder) |
| `auto_restart_on_stale_engine` | boolean | `false` | [auto_restart_on_stale_engine](#auto_restart_on_stale_engine) |
| `engine_refresh_min_interval_seconds` | number | `300` | [engine_refresh_min_interval_seconds](#engine_refresh_min_interval_seconds) |
| `mergeable_autoresolve` | object | disabled | [mergeable_autoresolve](#mergeable_autoresolve) |
| `build_review` | object | `{ enabled: true }` | [build_review](#build_review) |
| `ci_watch` | object | `{ enabled: true }` | [ci_watch](#ci_watch) |
| `build_progress_halt` | object | see section | [build_progress_halt](#build_progress_halt) |
| `retry_routing` | object | `{ enabled: true }` | [retry_routing](#retry_routing) |
| `wiring` | object | none | [wiring](#wiring) |
| `kickback_escalation` | object | `{ enabled: true }` | [kickback_escalation](#kickback_escalation) |
| `daemon_verbose` | boolean | `false` | [daemon_verbose](#daemon_verbose) |
| `reconcile_parked_auto_cleanup` | boolean | `true` | [reconcile_parked_auto_cleanup](#reconcile_parked_auto_cleanup) |
| `step_heartbeat_stall_minutes` | number | `20` | [step_heartbeat_stall_minutes](#step_heartbeat_stall_minutes) |

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
| `defaults.by_tier` | object | keys `S`, `M`, `L`; each `{ model?, effort?, max_retries? }` | none | Accepted by the validator, never read |

`defaults.max_retries` interacts with [`build_progress_halt.attempt_ceiling`](#build_progress_halt):
raising it above an **explicitly set** ceiling makes the config fail to load.

> **Known limitation.** `defaults.by_tier` validates but has no consumer. `DefaultsConfig`
> (`src/conductor/src/types/config.ts:189-195`) does not declare the field, and
> `resolveProviderNativeStepConfig` reads `by_tier` only from `steps.*` and `phases.*`
> (`src/conductor/src/engine/resolved-config.ts:236-237, 348-349`). Put tier overrides on a phase or a
> step. Tracked in [#1025](https://github.com/jstoup111/ai-conductor/issues/1025).

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

"Built-in" here means a member of `ALL_STEPS` — the 22 sequential steps. The four out-of-band steps
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

15 keys are allow-listed (`knownStepKeys`, `config.ts:334-350`). An unknown key is a hard error
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
| `tdd` | object | Only valid on `steps.build`; see [steps.build.tdd](#stepsbuildtdd) | none | build agent |
| `after` | string | **Custom steps only** — a built-in step with `after` is a hard error (`config.ts:529-531`) | required for custom steps | `steps.ts:561` |
| `enforcement` | string | **Custom steps only** (`config.ts:532-534`); `structural`\|`advisory`\|`gating` | `advisory` | `steps.ts:599` |
| `completion_artifact` | string | **Custom steps only** (`config.ts:535-537`); 7 constraints below | none | `src/conductor/src/engine/artifacts.ts:3086-3135` |

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

### steps.build.tdd

Per-sub-phase model hints for the TDD loop inside the build step. Valid only on `steps.build` — anywhere
else is a hard error `steps.<name>.tdd is only valid for the build step` (`config.ts:387-389`).

```yaml
llm_provider: claude
steps:
  build:
    tdd:
      red:
        model: sonnet
      green:
        model: opus
```

Validated by `validateTddModelConfig` (`config.ts:47-92`):

- The block must be an object with only `red` and `green` keys.
- Each must be an object containing only a `model` key holding a non-empty string.
- The model must be a member of the resolved provider's `modelEscalationOrder` — `haiku`, `sonnet`,
  `opus`, `fable` for `claude`; `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-5.6-sol` for `codex`.
- The provider key comes from top-level `llm_provider` when it is a string, otherwise `claude`
  (`config.ts:394`). A top-level `llm_provider` **array** is a hard error:
  `steps.build.tdd requires llm_provider to be a string`.
- A provider outside `{claude, codex}` fails with `… has no native TDD model policy.`

The values are advisory: the build agent passes the model to its RED or GREEN child dispatch. No separate
conductor step is created (`src/conductor/src/types/config.ts:59-75`).

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

Six fields are available to a custom step:

| Field | Required | Effect |
| --- | --- | --- |
| `after` | Yes | Insertion point. Must resolve to a built-in step name or a sibling custom step declared in the same file; self-reference does not count. Otherwise: `Custom step "<n>" references unknown after target: "<t>"` (`config.ts:496-510`) |
| `skill` | Yes | Path to the `SKILL.md` to dispatch. Missing: `Custom step "<n>" requires 'skill: <path-to-SKILL.md>'`. The file must exist relative to the project root, else `Custom step "<n>" skill file not found: <path>` (`config.ts:511-525`) |
| `enforcement` | No | `structural`, `advisory`, or `gating`. Defaults to `advisory` (`steps.ts:563`) |
| `completion_artifact` | No | Path the step must write to be considered done; see below |
| `disable` | No | Boolean; custom steps bypass the `configDisableAllowed` check entirely |
| `when` / `parallel` / `model` / `effort` / `max_retries` / `escalate` / `hooks` / `by_tier` / `llm_provider` | No | Same semantics as for built-in steps |

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

> **Known limitation.** `steps.<custom>.gate` and `steps.<custom>.kickback_target` are declared with full
> semantics in `src/conductor/src/types/config.ts:134-146` and read by `buildStepRegistry`
> (`steps.ts:607-608`), but neither is in `knownStepKeys` (`config.ts:334-350`). Setting either fails
> the load with `Unknown key in steps.<n>: "gate"` / `"kickback_target"`. The legacy adapter
> `customStepEntries()` (`config.ts:1765-1785`) also drops both fields. A custom step's loop-gate
> membership can only be inherited from its `after` target, and it can never be a kickback target.
> Tracked in
> [#1025](https://github.com/jstoup111/ai-conductor/issues/1025).

This repo's own custom step is documented in [self-hosting](../guides/self-hosting.md).

## complexity

| Key | Type | Allowed | Default | Consumer |
| --- | --- | --- | --- | --- |
| `complexity.default_tier` | string | `S`, `M`, `L` (`config.ts:565`) | none | none |

> **Known limitation.** `complexity.default_tier` validates and is echoed back unchanged, but no engine
> code reads it — the only two references in the repo are the type declaration
> (`src/conductor/src/types/config.ts:409-411`) and the validator. Setting it does not preselect a tier.
> Tracked in [#1025](https://github.com/jstoup111/ai-conductor/issues/1025).

For what does resolve a tier, see
[where the tier comes from](steps.md#where-the-tier-comes-from).

## conductor

Update-channel state. Validated by `validateConductorBlock` (`config.ts:1059-1093`); an unknown key
inside the block is a hard error.

| Key | Type | Allowed | Written by |
| --- | --- | --- | --- |
| `conductor.update_channel` | string | `tagged` or `main` only; anything else is a hard error (`config.ts:1073-1082`) | `bin/install` |
| `conductor.auto_check` | boolean | — | `bin/install` |
| `conductor.current_version` | string | — | `bin/install` (machine state) |
| `conductor.last_checked_at` | string | ISO-8601 UTC | update check (machine state) |

Legacy `~/.claude/ai-conductor.config.json` is translated camelCase to snake_case at
`user-config.ts:87-106`; an unknown or unparseable legacy file returns `null` silently.

> **Known limitation.** `src/conductor/src/types/config.ts:198-201` states "Project configs should not
> override this block — it's per-user, not per-repo," but nothing enforces it. Unlike `spec_owner`, a
> `conductor` block in a project config loads and wins the merge. Tracked in
> [#1025](https://github.com/jstoup111/ai-conductor/issues/1025).

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
`validateTestSuiteBlock` (`config.ts:1120-1196`); an unknown key inside the block is a hard error.

| Key | Type | Required | Validation | Default |
| --- | --- | --- | --- | --- |
| `test_suite.command` | string | Yes, when the block exists | Non-empty after trim (`config.ts:1138-1143`) | — |
| `test_suite.working_directory` | string | No | Must be relative and resolve inside the project root. Absolute paths, `..` escapes, and symlinks whose realpath escapes the root are hard errors. A non-ENOENT/ENOTDIR realpath error fails closed (`config.ts:1145-1168`) | project root |
| `test_suite.timeout_seconds` | number | No | Finite and `> 0` (`config.ts:1170-1180`) | 1800 s (`DEFAULT_FULL_SUITE_TIMEOUT_MS`, `src/conductor/src/engine/full-suite-executor.ts:7`) |
| `test_suite.inputs` | string[] | No | Array of strings (`config.ts:1182-1193`) | none |
| `test_suite.environment` | string[] | No | Array of strings | none |

`environment` holds environment variable **names**, not values. Each value is HMAC'd into the full-suite
fingerprint (`src/conductor/src/engine/full-suite-fingerprint.ts:209-228`) so that changing it
invalidates cached verification with reason `environment_changed`, and each is redacted from verifier
output. See [environment](environment.md).

Omitting the block entirely is a gating failure at SHIP: the verifier returns
`{ status: 'FAILED', reason: 'missing_config' }` (`src/conductor/src/engine/full-suite-verifier.ts:717-724`)
and the run HALTs. The gate itself is described in [gates](../explanation/gates.md).

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
throws.

| Key | Type | Required | Allowed | Default |
| --- | --- | --- | --- | --- |
| `otel` | object | No | — | absent means `{ enabled: false }` |
| `otel.exporter` | string | Yes, when the block exists | `otlp`, `file` | — |
| `otel.endpoint` | string | Yes, when `exporter: otlp` | any URL | — |
| `otel.file` | string | No | any path | `<pipelineDir>/otel.jsonl` |
| `otel.protocol` | string | No | `http/protobuf`, `grpc` per the type | passed through unchecked; omitted when falsy |

The failure mode is silent-disable-with-an-error-string, not a halt. An unknown exporter yields
`{ enabled: false, error: "Unknown otel exporter '<x>'. Valid options: otlp, file." }`; `otlp` without an
endpoint yields `{ enabled: false, error: "otel exporter='otlp' requires an 'endpoint' URL …" }`.

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
`ci_watch` and `kickback_escalation`, which silently discard the block instead.

Consumed at `src/conductor/src/engine/conductor.ts:4149`.

## wiring

Roots for the wiring-reachability gate's Layer 2 import-graph walk.

| Key | Type | Validation | Default |
| --- | --- | --- | --- |
| `wiring` | object | Must be an object, else hard error | absent |
| `wiring.entry_points` | string[] | Array of non-empty strings, else hard error | absent |

> **Known limitation.** `wiring` carries no inner allow-list: keys other than `entry_points` pass
> validation silently (`config.ts:747-765`), so a typo such as `entrypoints` is accepted and Layer 2
> is skipped as if no roots were configured. This is looser than `retry_routing` and `conductor`,
> which reject an unknown key outright. Tracked in
> [#1026](https://github.com/jstoup111/ai-conductor/issues/1026).

Layer 2 applicability (`resolveLayer2Applicability`, `src/conductor/src/engine/wiring-probe.ts:671-704`):

| Condition | Result |
| --- | --- |
| No `tsconfig.json` and no `package.json` at the root | Not applicable; Layer 2 is off |
| TypeScript markers present but `entry_points` absent or empty | Skipped, recorded in `layer2.reason`; **no gap, no block** |
| A listed root does not exist on disk | `scope-undeterminable` gap on `(unscoped)`; **the gate blocks** |
| All roots exist | Layer 2 runs; unreachable new exports become `orphan-export` gaps |

```yaml
wiring:
  entry_points:
    - src/index.ts
```

## harness_self_host

Guardrails that apply when the build target is the harness checkout itself. Validated by
`validateSelfHostBlock` (`config.ts:972-1019`). An unknown key inside the block is a hard error —
deliberately, so a typo'd gate name surfaces instead of silently leaving that gate enabled.

Resolution is safe-by-default (`resolveSelfHostConfig`, `resolved-config.ts:550-575`): an absent block, or
any omitted field, yields auto-detection with every gate enabled.

| Key | Type | Allowed | Default | Effect |
| --- | --- | --- | --- | --- |
| `activation` | string | `auto`, `force_on`, `force_off` | `auto` | `auto` compares the build root's realpath against the harness root; `force_on` treats any repo as a self-build; `force_off` never self-hosts |
| `skill_relink_preflight` | boolean | — | `true` | Intended to gate the pre-dispatch `bin/install --update` relink |
| `sandbox_build_env` | boolean | — | `true` | Runs the self-build under a throwaway `CLAUDE_CONFIG_DIR` |
| `version_approval_gate` | boolean | — | `true` | Halts for operator VERSION-bump approval before `finish` |
| `release_artifact_gate` | boolean | — | `true` | Halts on an integrity, CHANGELOG, or migration-block failure |
| `version_freeze` | string | Non-empty after trim, else hard error (`config.ts:985-993`) | `null` | While it equals the repo `VERSION`, the approval gate self-satisfies. Blank or whitespace normalizes to `null` |
| `auth_park_timeout_minutes` | number | Must be a number, else hard error (`config.ts:1008-1013`) | `60` | OAuth park-and-poll timeout. `0` means an immediate credentials-specific halt |
| `build_auth.mode` | string | `daemon-token`, `api-key`; empty string rejected (`config.ts:1035-1049`) | `daemon-token` | Selects the self-build auth source |
| `build_auth.token_path` | string | Must be a string (`config.ts:1050-1055`) | `~/.ai-conductor/build-auth` | `~` is expanded; blank or whitespace falls back to the default |

A declared `version_freeze` never approves an actual bump: any `VERSION` other than the frozen value
still halts.

`auth_park_timeout_minutes` has a second contract in the resolver: a non-integer or negative value
silently falls back to 60 (`resolved-config.ts:554-558`) even though the validator only rejects
non-numbers.

`sandbox_build_env: false` does not merely relax the sandbox — it makes the self-build unrunnable, with
`{ success: false, permissionDenied: true, output: 'Required safety protection unavailable:
self-host-isolation' }` (`src/conductor/src/engine/conductor.ts:2049-2065`).

> **Known limitation.** `skill_relink_preflight` is resolved into `skillRelinkPreflight`
> (`resolved-config.ts:562`) but has no consumer outside `resolved-config.ts`. The relink runs
> unconditionally inside the self-host bundle (`src/conductor/src/daemon-cli.ts:1295`, called at
> `daemon-cli.ts:359` and `src/conductor/src/engine/daemon.ts:1159`). Setting it to `false` does not
> disable the relink — and that relink also re-merges `~/.claude/settings.json` permissions and hooks.
> Tracked in [#1025](https://github.com/jstoup111/ai-conductor/issues/1025).

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

> **Known limitation.** `resolveMergeableAutoresolve` (`resolved-config.ts:597-604`) exists but has no
> callers; the daemon reads the raw config directly. Nothing breaks, but the resolver is not the
> authority the name implies. Tracked in
> [#1025](https://github.com/jstoup111/ai-conductor/issues/1025).

## build_review

The judgement gate at the `build` → downstream seam. The block is normalized in place; the resolved value
is written back (`config.ts:837-872`).

| Key | Type | Default | Status |
| --- | --- | --- | --- |
| `build_review.enabled` | boolean | `true` | Works |
| `build_review.perTaskFloor` | boolean | `true` per the type | Unreachable from config |

Normalization contract:

| Input | Result |
| --- | --- |
| Absent or `null` | `{ enabled: true }`, no warning |
| `{ enabled: true }` or `{ enabled: false }` | As given, no warning |
| Non-object, unknown inner key, or non-boolean `enabled` | `{ enabled: true }` plus one warning |

Malformed input fails **open** to enabled by design — `config.ts:843-845` states the rule as never
silently opting a project out of the replacement authority.

`build_review` is a gating built-in with no `configDisableAllowed`
(`src/conductor/src/engine/steps.ts:158-161`), so `steps.build_review.disable: true` is a hard error. The
config key is the only off switch. When disabled, the step is marked `skipped` and a `config_skip` event
is emitted (`src/conductor/src/engine/conductor.ts:6259, 6270-6276`), resolved once per pass.

> **Known limitation.** Setting any key other than `enabled` inside `build_review` triggers the
> malformed path: the entire block is replaced with `{ enabled: true }`, so `perTaskFloor` is stripped
> **and your own `enabled` value is discarded** (`config.ts:848-854`). Input
> `{enabled: true, perTaskFloor: false}` yields `{enabled: true}` with the warning
> `build_review has invalid value …, falling back to enabled.` `perTaskFloor` is resolved
> (`resolved-config.ts:633-636`) and consumed (`step-runners.ts:1521-1552`) but can never be set. Its
> effect is telemetry only — it writes `.pipeline/per-task-floor.json` and prepends advisory lines, never
> changing a verdict. Tracked in [#1002](https://github.com/jstoup111/ai-conductor/issues/1002).

## ci_watch

Post-merge CI watch and fix loop. Normalized in place; the resolved value is written back
(`config.ts:874-898`).

| Key | Type | Default | Status |
| --- | --- | --- | --- |
| `ci_watch.enabled` | boolean | `true` | Works (`src/conductor/src/daemon-cli.ts:1678`) |
| `ci_watch.cooldownMinutes` | number | `60` per the type | Unreachable from config |

Normalization contract:

| Input | Result |
| --- | --- |
| Absent or `null` | `{ enabled: true }`, no warning |
| `{ enabled: true }` or `{ enabled: false }` | As given, no warning |
| Non-object, unknown inner key, or non-boolean `enabled` | `{ enabled: true }`, **no warning at all** |

Eligibility failures return `{ eligible: false, reason }` and skip — they never halt
(`src/conductor/src/engine/ci-fix.ts:230-264`).

Draft PRs are never dispatched to the CI fix loop. The sweep still labels them (`ci-failed`,
`mergeable`) but logs `skipping ci-fix for <url> (draft PR)` instead of collecting them as
candidates — a draft PR belongs to an in-flight build, and fixing its CI would fight the running
build. Attempt counters are not burned for skipped drafts.

> **Known limitation.** Setting `cooldownMinutes` — or any key besides `enabled` — replaces the whole
> block with `{ enabled: true }` **silently**, discarding your `enabled` value with no warning
> (`config.ts:880-898`). `src/conductor/src/engine/ci-fix.ts:250` reads
> `cfg?.ci_watch?.cooldownMinutes ?? 60` and can therefore only ever see `undefined`; the cooldown is
> permanently 60 minutes. Unlike `build_review`, this path emits nothing to tell you it happened.
> Tracked in [#1002](https://github.com/jstoup111/ai-conductor/issues/1002).

## kickback_escalation

Escalation when a kickback to `build` produces no change.

| Key | Type | Default |
| --- | --- | --- |
| `kickback_escalation.enabled` | boolean | `true` |

Contract (`src/conductor/src/engine/config.ts:934-957`): absent or `null` yields `{ enabled: true }`; a boolean is taken as given;
anything malformed — non-object, unknown inner key, or non-boolean `enabled` — is replaced with
`{ enabled: true }` with **no warning**. The resolved block is written back.

Consumed at `src/conductor/src/engine/conductor.ts:2438` (`?? true`). When enabled, the no-op
escalation guard compares the pre- and post-build tree hashes (and resolved-task counts) for the
kickback; an empty commit therefore does not count as progress. Setting `enabled: false` disables
that tree-hash witness and reverts to re-kicking until the cap. It does not disable the durable
per-gate cap, which still bounds unchanged cross-dispatch loops; the `planRemediation` guard is
also not gated by this flag (`src/conductor/src/types/config.ts:302-308`).

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

Set to `false` to require an explicit `conduct-ts daemon reconcile-parked <slug>` (or manual
cleanup) for every parked feature, even once it is merged and recorded — see
[park a feature before you touch its git state](../guides/running-the-daemon.md#park-a-feature-before-you-touch-its-git-state).

## step_heartbeat_stall_minutes

Stall threshold, in minutes, for a running step's `.pipeline/step-heartbeat` liveness signal (see
`docs/guides/running-the-daemon.md#step-heartbeat-and-the-stall-watchdog` and
`src/conductor/src/engine/step-heartbeat.ts`). While a step's provider dispatch is in flight, the
engine touches `.pipeline/step-heartbeat` on every observed Claude/Codex subprocess activity
boundary. If that heartbeat goes silent for longer than this many minutes (plus a small fixed grace
buffer), the stall watchdog kills the wedged subprocess and raises a `mechanical`-class HALT — the
same HALT class/machinery `fix/defer-live-boundary-halt-to-next-dispatch` (#1070) uses for
live-boundary violations — so the daemon's existing auto-requeue path picks it up unchanged.

Optional number; absent → `20`. Resolved by `resolveStepHeartbeatStallMinutes`
(`resolved-config.ts`), mirroring `auth_park_timeout_minutes`'s resolution rules: `0` or a negative
value is a deliberate opt-out (the heartbeat file is still written and surfaced by `daemon status`,
but the watchdog never kills anything); a non-numeric or non-finite value is a load-time validation
warning (`config.ts`) that falls back to the default.

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

Consumed at `src/conductor/src/engine/autoresolve.ts:208`,
`src/conductor/src/engine/conductor.ts:6548`, and `src/conductor/src/daemon-cli.ts:979, 1616`.

## validation_concurrency

Bounds the validation-phase fan-out. Optional number, default `2`
(`DEFAULT_VALIDATION_CONCURRENCY`, `config.ts:1899`).

A non-number is a hard error (`config.ts:720-724`). Zero, negative, and `NaN` pass validation, but
`resolveValidationConcurrency` (`config.ts:1891-1903`) silently substitutes `2`.

Consumed at `src/conductor/src/engine/conductor.ts:1263`, then clamped to the branch count at `:6357`.

## Keys the type declares but the loader rejects

These fields exist in `src/conductor/src/types/config.ts` with documented semantics and, in some cases,
live consumers — but they are absent from the loader's allow-lists, so writing them into a config file
fails the load.

| Key | Declared at | Rejected with |
| --- | --- | --- |
| `gate_code_validity` | `types/config.ts:322-325, 466-468` | `Unknown top-level key: "gate_code_validity"` |
| `auth_park_timeout_minutes` (top level) | `types/config.ts:546-553` | `Unknown top-level key: "auth_park_timeout_minutes"` |
| `steps.<custom>.gate` | `types/config.ts:134-140` | `Unknown key in steps.<n>: "gate"` |
| `steps.<custom>.kickback_target` | `types/config.ts:141-146` | `Unknown key in steps.<n>: "kickback_target"` |

> **Known limitation.** `gate_code_validity` is a fully wired kill-switch: `resolveGateCodeValidityConfig`
> (`config.ts:1911-1919`) is called from six sites — `src/conductor/src/engine/artifacts.ts:365, 1587,
> 1753, 1847, 1955` and `src/conductor/src/engine/step-runners.ts:1687` — and the absent block resolves
> to `{ enabled: true }`. Because the key is not in `knownTopLevelKeys` (`config.ts:213-269`), it can
> never be set from a config file, so the gate is permanently on. There is no workaround.
> Tracked in [#1001](https://github.com/jstoup111/ai-conductor/issues/1001).

> **Known limitation.** Top-level `auth_park_timeout_minutes` is declared and has a resolver,
> `resolveAuthParkTimeoutMinutes` (`resolved-config.ts:463-480`), which throws on non-numeric or
> non-finite input — and has no callers anywhere in `src/`. The key is also rejected at load. Use the
> nested [`harness_self_host.auth_park_timeout_minutes`](#harness_self_host) instead; note its bad-value
> contract differs, silently falling back to 60 rather than throwing. The two declarations also disagree
> on what `0` means: `types/config.ts:551` says it polls indefinitely, while `types/config.ts:374` and
> `resolved-config.ts:446-447` say it halts immediately. The nested key's behavior is the immediate halt.
> Tracked in [#1025](https://github.com/jstoup111/ai-conductor/issues/1025).

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
  working_directory: .
  timeout_seconds: 1800
  environment:
    - CI

wiring:
  entry_points:
    - src/index.ts

markdown_viewer:
  preset: glow
  command: glow
  args: ["-p", "-w", "80", "{file}"]
  mode: inline
```

`templates/project-config.yml.template` is the project seed used by `conduct-ts create` and
`conduct-ts config init`. `templates/ai-conductor-config.yml.template` remains the user-level
reference. The remaining allow-listed keys are documented only here.

## See also

- [models](models.md) — how a step's model and effort resolve, and the full per-step tables.
- [steps](steps.md) — step names, order, phase, tier-skip, and enforcement values.
- [cli](cli.md) — every command and flag, including `--model`.
- [environment](environment.md) — every environment variable the harness reads or writes.
- [gates](../explanation/gates.md) — what a gate is and how fail-closed rules work.
