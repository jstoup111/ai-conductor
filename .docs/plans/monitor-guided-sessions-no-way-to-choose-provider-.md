# Implementation Plan: Monitor guided sessions — choose provider, model, and effort

**Date:** 2026-10-06
**Design:** .docs/specs/monitor-guided-sessions-no-way-to-choose-provider-.md
**Stories:** .docs/stories/monitor-guided-sessions-no-way-to-choose-provider-.md
**Conflict check:** Clean as of 2026-10-06

## Summary

Lets operators choose the provider, model, and effort for `conduct monitor` guided sessions. These
can be persisted per project in a top-level `monitor` config block or overridden per run with
`--provider/--model/--effort`. Every value is validated before launch, and the applied values are
printed. The provider catalog's `interactiveLaunch` descriptor becomes the single owner of
interactive argv, including model and effort, and the monitor seam's private launch table is
retired. 17 tasks in 4 slices.

## Technical Approach

- **Catalog contract (ADR `adr-2026-10-06-catalog-owned-interactive-model-and-effort` D1, D2).**
  In `src/conductor/src/execution/provider-catalog.ts`, `InteractiveLaunch.argv` changes from
  `(prompt, env)` to `(options: InteractiveLaunchArgvOptions)` with fields
  `{ prompt; permissionMode?; model?; effort? }`. `InteractiveLaunch` gains
  `acceptedEfforts: readonly EffortLevel[]`.
  - **Claude** renders `--permission-mode «mode»` (default `default`), then `--model «m»` and
    `--effort «e»` when present, then the prompt last.
  - **Codex** renders `--model «m»` and `--config model_reasoning_effort="«e»"` when present, then
    the prompt last. It ignores `permissionMode`.
  - Both declare `acceptedEfforts: ['low','medium','high','xhigh','max']`. Pi still declares no
    `interactiveLaunch`.
  - The descriptor no longer reads the environment. The composer call site in
    `src/conductor/src/engine/engineer-cli.ts` computes its permission mode from
    `CONDUCT_ENGINEER_PERMISSION_MODE` using today's rule (`plan` → `default`, unset → `default`,
    otherwise the value) and passes it in, so its argv is byte-for-byte unchanged.
- **Seam (ADR D3).** `src/conductor/src/execution/interactive-launch.ts` deletes its private
  `interactiveInvocations` table.
  - `InteractiveLaunchRequest` gains optional `model` and `effort`.
  - The seam resolves the descriptor with `findBuiltInProviderDescriptor` and the executable with
    `resolveProviderExecutable`, and builds argv with `permissionMode: 'default'`.
  - Spawn options stay `{ cwd, stdio: 'inherit' }`, with no `env` override.
  - A descriptor lacking `interactiveLaunch` reports
    `Interactive launch unavailable: provider «id» lacks capability interactiveLaunch (#1007).` and
    returns `unavailable`.
  - The terminal check and ENOENT handling are unchanged.
- **Config.** `src/conductor/src/types/config.ts` adds
  `MonitorConfig { llm_provider?: string; model?: string; effort?: EffortLevel }` as
  `HarnessConfig.monitor`. `src/conductor/src/engine/config.ts` adds `'monitor'` to
  `CONFIG_CONSUMER_KEY_SETS.top`, adds `monitor: ['llm_provider','model','effort']`, and validates
  the block:
  - `llm_provider` must be a string naming a `BUILT_IN_PROVIDERS` id. Otherwise the error is
    `monitor.llm_provider names unknown provider "«id»". Available catalog providers: …`, the same
    precedent as `llm_providers`.
  - `effort` must be in `VALID_EFFORTS`. Otherwise the error is
    `monitor.effort must be low|medium|high|xhigh|max`.
  - `model` must be a string.
  - An unknown nested key raises `Unknown key in monitor: "«key»"`.
  - `src/conductor/test/engine/config-consumer-registry.ts` gains the block's consumer, the
    monitor command.
- **Resolver (ADR D4, D5).** New pure module `src/conductor/src/engine/monitor/selection.ts`
  exports `resolveGuidedSessionSelection(input, deps)`. It returns
  `{ kind: 'refused'; message }` or
  `{ kind: 'selected'; provider; model; effort; sources: { provider; model; effort } }`, where each
  source is one of `'override' | 'config' | 'default'`.
  - **Provider:** override, then `monitor.llm_provider`, then
    `normalizeProviderSelection(config.llm_provider)[0]`, then the `DEFAULT_PROVIDER` already used
    by that normalizer. The source is `default` whenever the build selection supplied it.
  - **FR-6:** when the provider came from an override, the config's model and effort are skipped.
  - **Defaults:** `descriptor.modelPolicy.stepModels.explore` and
    `descriptor.modelPolicy.stepEfforts.explore` from the built-in catalog descriptor, never
    re-resolved through project `steps.explore`.
  - **Validation order:**
    1. Not built-in → `monitor: unregistered provider «id».`
    2. No `interactiveLaunch` → `monitor: provider «id» cannot open a guided session: missing
       capability interactiveLaunch (#1007).`
    3. Effort not in `acceptedEfforts` → `monitor: effort "«e»" is not accepted by provider «id».`
    4. Model shape (non-empty, no whitespace or control characters, no leading `-`) →
       `monitor: model "«m»" is not a valid model id for provider «id».`
    5. Descriptor declares `modelCatalog` → membership through the injected
       `deps.listCatalogModels(descriptor)`, refusing with
       `monitor: model "«m»" is not in provider «id»'s model catalog.`
  - `deps.findDescriptor` defaults to `findBuiltInProviderDescriptor`, so tests can inject a
    narrowed descriptor.
- **Monitor command.** In `src/conductor/src/engine/monitor-cli.ts`:
  - **Parsing:** `detectMonitorCommand` accepts `monitor «selector» [--provider v] [--model v]
    [--effort v]` in any order after the selector. A flag with no value, a repeated flag, or an
    unknown option returns `{ kind: 'guide' }`. `MonitorDispatch` `run` gains `overrides`.
    `MONITOR_USAGE` and the help-only declaration in `src/conductor/src/cli.ts` list the flags.
  - **Dispatch:** `dispatchMonitorCommand` replaces `resolveConfiguredProvider` with
    `loadMergedConfig` plus the resolver (dep `resolveSelection`).
    - A config load failure prints `monitor: unable to resolve provider: «error»`.
    - A refusal prints the message and returns 1 before `deriveQueueMembership`, the event spine,
      or any launch.
    - On success it prints `monitor: guided sessions use provider=«p» («src»), model=«m» («src»),
      effort=«e» («src»)` once, then runs the queue.
    - `launch` passes `{ provider, model, effort, halt }` to `openGuidedSession`.
- **Session.** `src/conductor/src/engine/monitor/session.ts` `GuidedSessionRequest` gains `model`
  and `effort`, and `openGuidedSession` forwards them in the launch request.
- **Local pattern context.** Monitor CLI tests already drive `dispatchMonitorCommand` with injected
  deps (`resolveProvider`, `openGuidedSession`, `deriveQueueMembership`, `print`, `printError`) in
  `src/conductor/test/engine/monitor-cli.test.ts`. New entry-level tests follow the same shape,
  injecting a `spawn` mock through the real `openGuidedSession` → `launchInteractiveSession` path
  (pass `isInteractiveTerminal: () => true`). This proves the real argv without spawning; search
  hint: `isInteractiveTerminal`.
  - Composer argv characterization follows `src/conductor/test/engine/compose-launch-host.test.ts`
    (search `--permission-mode default /composer`).
  - Config validation tests follow `src/conductor/test/config-validation.test.ts` (search
    `Unknown key in`).
  - Per CLAUDE.md "Test Process Isolation", every refusal test asserts the mocked process boundary
    was never called.
- **Release note for the PR (not a task):** the new `conduct monitor` flags touch the `bin/conduct
  CLI` surface. The PR carries a `## Migration` section (additive: no action) or a release waiver,
  per architecture-review condition 4.

## Prerequisites

- None. All touched modules exist on main.

## Slices

| Slice | Title | Tasks |
| --- | --- | --- |
| 1 | Catalog-owned interactive launch | 1, 2, 3, 4 |
| 2 | Guided-session configuration and resolver | 5, 6, 7, 8 |
| 3 | Monitor command wiring | 9, 10, 11, 12, 13 |
| 4 | Monitor refusals and launch output | 14, 15, 16, 17 |

## Tasks

### Task 1: Catalog interactiveLaunch renders model, effort, and explicit permission mode
**Story:** Story 2 (argv shape), Story 10 (shared definition)
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/execution/provider-catalog.test.ts`:
   - Claude `interactiveLaunch.argv({ prompt: 'P', permissionMode: 'default', model: 'sonnet', effort: 'medium' })` equals `['--permission-mode','default','--model','sonnet','--effort','medium','P']`.
   - Codex `argv({ prompt: 'P', model: 'gpt-5.6-terra', effort: 'xhigh' })` equals `['--model','gpt-5.6-terra','--config','model_reasoning_effort="xhigh"','P']`.
   - With no model or effort, Claude gives `['--permission-mode','default','P']` and Codex gives `['P']`.
   - Claude and Codex `acceptedEfforts` equal `['low','medium','high','xhigh','max']`.
   - Pi still has no `interactiveLaunch`.
2. Verify RED.
3. Implement `InteractiveLaunchArgvOptions` and the new `argv` signature and `acceptedEfforts` on `InteractiveLaunch`. Update the Claude and Codex descriptors. Claude defaults `permissionMode` to `default`. Remove the descriptor's environment read.
4. Verify GREEN.
5. Commit: "feat(catalog): interactive launch owns model and effort argv".

**Done when:**
- [test] provider-catalog test asserts the Claude descriptor `argv` returns exactly `--permission-mode default --model sonnet --effort medium P` in that order, with the prompt as the last element.
- [test] provider-catalog test asserts the Codex descriptor `argv` returns exactly `--model gpt-5.6-terra --config model_reasoning_effort="xhigh" P`, with the prompt as the last element.
- [test] provider-catalog test asserts that with no model or effort, Claude argv is `--permission-mode default P` and Codex argv is the single element `P`.
- [test] provider-catalog test asserts Claude and Codex `interactiveLaunch.acceptedEfforts` equal `low, medium, high, xhigh, max` and the Pi descriptor declares no `interactiveLaunch`.

**Files likely touched:**
- `src/conductor/src/execution/provider-catalog.ts` — argv options type, acceptedEfforts, descriptor argv
- `src/conductor/test/execution/provider-catalog.test.ts` — descriptor argv tests

**Dependencies:** none

### Task 2: Composer passes its permission mode explicitly; its argv is byte-for-byte unchanged
**Story:** Story 10 happy 1, happy 2
**Type:** refactor

**Steps:**
1. Write characterization tests in `src/conductor/test/engine/compose-launch-host.test.ts` (search `--permission-mode default /composer`):
   - Claude composer argv with `CONDUCT_ENGINEER_PERMISSION_MODE` unset is exactly `['--permission-mode','default','/composer']`.
   - With `plan`, it is the same `['--permission-mode','default','/composer']`.
   - With `acceptEdits`, it is `['--permission-mode','acceptEdits','/composer']`.
   - With idea `add retries`, Codex argv is exactly `['$composer add retries']`.
   These pass on current main and must stay green.
2. After Task 1 changes the descriptor signature, the composer call site fails to typecheck (RED).
3. Implement `composerPermissionMode(env)` in `src/conductor/src/engine/engineer-cli.ts` with today's rule (`plan` → `default`, unset → `default`, otherwise the value). Call `host.interactiveLaunch.argv({ prompt, permissionMode: composerPermissionMode(launchEnv) })` with no model or effort.
4. Verify GREEN.
5. Commit: "refactor(compose): pass permission mode to catalog interactive argv".

**Done when:**
- [test] compose-launch-host test asserts the composer's Claude argv is byte-identical (`toStrictEqual`) to `--permission-mode default /composer` with `CONDUCT_ENGINEER_PERMISSION_MODE` unset and with `plan`, and to `--permission-mode acceptEdits /composer` with `acceptEdits`.
- [test] compose-launch-host test asserts the composer's Codex argv is byte-identical (`toStrictEqual`) to the single positional prompt `$composer add retries`, with no model, effort, sandbox, or approval flag.
- `engineer-cli.ts` builds composer argv only through the catalog descriptor `argv` with an explicit `permissionMode` and passes no `model` or `effort`.

**Files likely touched:**
- `src/conductor/src/engine/engineer-cli.ts` — explicit permission mode at the composer call site
- `src/conductor/test/engine/compose-launch-host.test.ts` — composer argv characterization

**Dependencies:** Task 1

### Task 3: Monitor seam builds its invocation from the catalog descriptor
**Story:** Story 2 negatives 2–3, Story 10 happy 3, negatives 1–2
**Type:** refactor

**Steps:**
1. Write failing tests in `src/conductor/test/execution/interactive-launch.test.ts` with a mocked `spawn` and `isInteractiveTerminal: () => true`:
   - A Claude request with model `sonnet` and effort `medium` spawns the catalog-resolved Claude executable with argv `['--permission-mode','default','--model','sonnet','--effort','medium',prompt]`, and the prompt is the last argv element.
   - With `process.env.CONDUCT_ENGINEER_PERMISSION_MODE='acceptEdits'`, the argv still carries `--permission-mode default`.
   - The spawn options equal `{ cwd, stdio: 'inherit' }` exactly, with no `env` key, so effort is never delivered through `CLAUDE_CODE_EFFORT_LEVEL`.
   - Stubbing the Claude descriptor's `interactiveLaunch.argv` (via `vi.spyOn` on the catalog descriptor) to return a sentinel argv makes the seam spawn that sentinel argv.
2. Verify RED.
3. Implement: delete `interactiveInvocations` and add `model?`/`effort?` to `InteractiveLaunchRequest`. Resolve the descriptor and executable through the catalog and call `descriptor.interactiveLaunch.argv({ prompt, permissionMode: 'default', model, effort })`.
4. Verify GREEN.
5. Commit: "refactor(monitor): launch seam derives invocation from the provider catalog".

**Done when:**
- [test] interactive-launch test asserts `launchInteractiveSession` spawns argv `--permission-mode default --model sonnet --effort medium «prompt»` with the prompt as the final element and no option after it.
- [test] interactive-launch test asserts that with `CONDUCT_ENGINEER_PERMISSION_MODE=acceptEdits` set, the seam's Claude argv still contains `--permission-mode default`.
- [test] interactive-launch test asserts the spawn options passed to the mocked boundary strictly equal `{ cwd, stdio: 'inherit' }` (no `env` key), and the effort appears only as the `--effort` argument.
- [test] interactive-launch test asserts a stubbed catalog descriptor `argv` result is exactly what the seam spawns, proving the seam holds no separate per-provider launch table.

**Files likely touched:**
- `src/conductor/src/execution/interactive-launch.ts` — retire private table; derive from descriptor
- `src/conductor/test/execution/interactive-launch.test.ts` — seam argv and options tests

**Dependencies:** Task 1

### Task 4: Seam refuses a provider without interactive launch; ENOENT and no-terminal outcomes preserved
**Story:** Story 8 negative 3, Story 10 negative 3
**Type:** negative-path

**Steps:**
1. Write failing and characterization tests in `src/conductor/test/execution/interactive-launch.test.ts`:
   - A `pi` request reports `Interactive launch unavailable: provider pi lacks capability interactiveLaunch (#1007).`, returns `{ kind: 'unavailable', provider: 'pi' }`, and never calls the spawn mock.
   - A spawn mock rejecting with `ENOENT` for `claude` reports `Interactive launch unavailable for claude: ENOENT.` and returns `unavailable`.
   - With `isInteractiveTerminal: () => false`, the seam reports `Interactive launch unavailable: no attached interactive terminal.` and never calls spawn.
2. Verify RED for the Pi case.
3. Implement the capability check in the seam.
4. Verify GREEN.
5. Commit: "feat(monitor): seam refuses providers lacking interactiveLaunch".

**Done when:**
- [test] interactive-launch test asserts a `pi` request reports `Interactive launch unavailable: provider pi lacks capability interactiveLaunch (#1007).`, returns kind `unavailable`, and the spawn mock is never called.
- [test] interactive-launch test asserts an ENOENT spawn failure for `claude` reports `Interactive launch unavailable for claude: ENOENT.` and returns kind `unavailable`.
- [test] interactive-launch test asserts that with no attached interactive terminal the seam reports `Interactive launch unavailable: no attached interactive terminal.` and the spawn mock is never called.

**Files likely touched:**
- `src/conductor/src/execution/interactive-launch.ts` — capability refusal
- `src/conductor/test/execution/interactive-launch.test.ts` — refusal and preservation tests

**Dependencies:** Task 3

### Task 5: Top-level `monitor` config block with load-time validation
**Story:** Story 9
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/config-validation.test.ts` (search `Unknown key in`):
   - `monitor: { llm_provider: codex, model: gpt-5.6-terra, effort: low }` validates, and the loaded config exposes it.
   - `monitor.llm_provider: gemini` fails with a message containing `monitor.llm_provider` and `gemini`.
   - `monitor.effort: turbo` fails with `monitor.effort must be low|medium|high|xhigh|max`.
   - `monitor.modle: x` fails with `Unknown key in monitor: "modle"`.
   - `loadMergedConfig` (the loader both builds and the monitor use) returns `ok: false` with that same error for an invalid `monitor` block.
   - In `src/conductor/test/engine/config-consumer-registry.test.ts`, the registry-totality test fails until the consumer entry exists.
2. Verify RED.
3. Implement the `MonitorConfig` type, `'monitor'` in `CONFIG_CONSUMER_KEY_SETS.top`, `CONFIG_CONSUMER_KEY_SETS.monitor`, validator branch, and registry consumer entry.
4. Verify GREEN.
5. Commit: "feat(config): monitor guided-session provider/model/effort block".

**Done when:**
- [test] config-validation test asserts a valid `monitor` block (provider `codex`, model `gpt-5.6-terra`, effort `low`) loads successfully and the loaded config carries those three values.
- [test] config-validation test asserts `monitor.llm_provider: gemini` fails config loading with an error naming `monitor.llm_provider` and `gemini`, and `monitor.effort: turbo` fails with an error naming `monitor.effort` and listing the accepted values low, medium, high, xhigh, and max.
- [test] config-validation test asserts an unknown key `modle` inside `monitor` fails with `Unknown key in monitor: "modle"`, the same shape as other nested-block unknown keys.
- [test] config-validation test asserts `loadMergedConfig`, the shared loader every build path uses, returns `ok: false` with the `monitor.llm_provider` error, so a build loading that project reports the same configuration error.
- [test] config-consumer-registry test `is total over validator-accepted keys` passes with `monitor` and its three keys registered to the monitor command consumer.

**Files likely touched:**
- `src/conductor/src/types/config.ts` — MonitorConfig on HarnessConfig
- `src/conductor/src/engine/config.ts` — key sets and validation
- `src/conductor/test/engine/config-consumer-registry.ts` — consumer entry
- `src/conductor/test/config-validation.test.ts` — validation tests

**Dependencies:** none

### Task 6: Build-step provider resolution is unaffected by the monitor block
**Story:** Story 1 happy 2, negative 1
**Type:** happy-path

**Steps:**
1. Write regression tests in `src/conductor/test/engine/config.test.ts`: with `llm_provider: claude` and `monitor.llm_provider: codex`, and again without the `monitor` block, the existing step-provider resolution (search `resolveStepProviderSelection` or the resolver the build step uses) returns `claude` for `build`, and never `codex`.
2. Run it. Expect GREEN, since build resolution never reads the `monitor` block.
3. Commit with the test: "test(config): monitor provider never reaches build-step resolution".

**Done when:**
- [test] config test asserts that with run-level `llm_provider: claude` and `monitor.llm_provider: codex`, the build step's resolved provider selection is exactly `['claude']` and contains no `codex`.
- [test] config test asserts the build step's resolved provider selection for the same config without the `monitor` block is also exactly `['claude']`, so adding the `monitor` block changes no build-step resolution.

**Files likely touched:**
- `src/conductor/test/engine/config.test.ts` — regression test

**Verify-only:** yes

**Dependencies:** Task 5

### Task 7: Guided-session resolver: precedence, defaults, and value sources
**Story:** Story 1, Story 3, Story 4 (resolver layer)
**Type:** infrastructure

**Steps:**
1. Write failing tests in new `src/conductor/test/engine/monitor/selection.test.ts`:
   - Override beats config beats build-selection first entry, for each field.
   - A provider override drops config model and effort (FR-6).
   - Defaults are `opus`/`high` for Claude and `gpt-5.6-sol`/`high` for Codex, from the descriptor's `modelPolicy` `explore` entries.
   - A config carrying `steps.explore.model: sonnet` and `steps.explore.effort: low` still yields `opus`/`high`.
   - Each value carries source `override`, `config`, or `default`.
2. Verify RED.
3. Implement `resolveGuidedSessionSelection` in `src/conductor/src/engine/monitor/selection.ts`, with no validation yet.
4. Verify GREEN.
5. Commit: "feat(monitor): guided-session selection resolver".

**Done when:**
- [test] selection test asserts precedence override > `monitor` config > `llm_provider[0]` for provider, model, and effort, with each resolved value tagged `override`, `config`, or `default` accordingly.
- [test] selection test asserts a provider override `codex` over config `claude/opus/high` resolves model `gpt-5.6-sol` and effort `high`, each with source `default`.
- [test] selection test asserts defaults come from the built-in descriptor's `modelPolicy.stepModels.explore` and `stepEfforts.explore`, and a project `steps.explore` pin of `sonnet`/`low` does not change them.

**Files likely touched:**
- `src/conductor/src/engine/monitor/selection.ts` — new resolver
- `src/conductor/test/engine/monitor/selection.test.ts` — resolver tests

**Dependencies:** Tasks 1, 5

### Task 8: Resolver refusals: unregistered provider, missing capability, effort, model shape, model catalog
**Story:** Story 6, Story 7, Story 8 (resolver layer)
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/monitor/selection.test.ts`:
   - `gemini` gives `monitor: unregistered provider gemini.`
   - `pi` gives `monitor: provider pi cannot open a guided session: missing capability interactiveLaunch (#1007).`
   - Effort `turbo` gives `monitor: effort "turbo" is not accepted by provider claude.`
   - An injected descriptor whose `acceptedEfforts` omits `max`, with effort `max`, gives a refusal naming `max` and that provider.
   - Models `''`, `--dangerously-skip-permissions`, `opus high`, and `op\u0007us` each give `monitor: model "«m»" is not a valid model id for provider claude.`
   - `claude-fable-5-1` is accepted unchanged.
   - An injected descriptor declaring `modelCatalog`, with `listCatalogModels` returning `['a/b']` and model `x/y`, gives `monitor: model "x/y" is not in provider «id»'s model catalog.`
   - A descriptor without `modelCatalog` never calls `listCatalogModels`.
2. Verify RED.
3. Implement the validation order from Technical Approach.
4. Verify GREEN.
5. Commit: "feat(monitor): validate guided-session selection before launch".

**Done when:**
- [test] selection test asserts refusals `monitor: unregistered provider gemini.` and `monitor: provider pi cannot open a guided session: missing capability interactiveLaunch (#1007).`
- [test] selection test asserts effort `turbo` on Claude, and effort `max` on an injected descriptor whose `acceptedEfforts` omits `max`, each refuse with a message naming the effort value and the provider id.
- [test] selection test asserts models `''`, `--dangerously-skip-permissions`, `opus high`, and one containing a control character each refuse with a message naming the model value and provider, while `claude-fable-5-1` is selected unchanged.
- [test] selection test asserts a catalog-declaring injected descriptor refuses a model absent from `listCatalogModels` naming value and provider, and a descriptor without `modelCatalog` never invokes `listCatalogModels`.

**Files likely touched:**
- `src/conductor/src/engine/monitor/selection.ts` — validation
- `src/conductor/test/engine/monitor/selection.test.ts` — refusal tests

**Dependencies:** Task 7

### Task 9: Monitor parses per-run --provider/--model/--effort
**Story:** Story 3 negatives 2–3
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/monitor-cli.test.ts`:
   - `detectMonitorCommand(['node','x','monitor','all','--model','sonnet','--effort','low','--provider','codex'])` returns `{ kind: 'run', overrides: { provider: 'codex', model: 'sonnet', effort: 'low' } }`.
   - `monitor all --model` (flag is the last token, no value), `monitor all --verbose`, and a repeated `--model` each return `{ kind: 'guide' }`; `monitor all --model --dangerously-skip-permissions` parses `model: '--dangerously-skip-permissions'` (the token after a flag is always its value, so a dash-leading value reaches the resolver and is refused there by name).
   - `dispatchMonitorCommand({ kind: 'guide' })` prints `MONITOR_USAGE` (which now lists the three flags) and returns 1. The injected `resolveSelection`, `deriveQueueMembership`, and `openGuidedSession` mocks are never called.
2. Verify RED.
3. Implement parsing, the `overrides` field, and the usage text. Update the help-only `monitor` declaration in `src/conductor/src/cli.ts` to list the options.
4. Verify GREEN.
5. Commit: "feat(monitor): per-run provider/model/effort overrides".

**Done when:**
- [test] monitor-cli test asserts `detectMonitorCommand` parses `--provider`, `--model`, and `--effort` in any order after the selector into `overrides`.
- [test] monitor-cli test asserts a flag with no value (last token), a repeated flag, and an unknown option `--verbose` each parse to `{ kind: 'guide' }`, while `--model --dangerously-skip-permissions` parses the dash-leading token as the model value.
- [test] monitor-cli test asserts dispatching a `guide` command prints `MONITOR_USAGE` (containing `--provider`, `--model`, and `--effort`), returns exit code 1, and never invokes the selection, membership, or session mocks.

**Files likely touched:**
- `src/conductor/src/engine/monitor-cli.ts` — parsing, usage
- `src/conductor/src/cli.ts` — help-only declaration
- `src/conductor/test/engine/monitor-cli.test.ts` — parsing tests

**Dependencies:** none

### Task 10: Guided session forwards model and effort to the seam
**Story:** Story 2 (internal plumbing)
**Type:** infrastructure

**Steps:**
1. Write a failing test in `src/conductor/test/engine/monitor/session.test.ts` (search `openGuidedSession`): `openGuidedSession({ provider: 'claude', model: 'sonnet', effort: 'medium', halt }, { launch })` calls `launch` with `{ provider: 'claude', model: 'sonnet', effort: 'medium', cwd: «project»/.worktrees/«slug», openingPrompt }`.
2. Verify RED.
3. Add `model` and `effort` to `GuidedSessionRequest` and forward them.
4. Verify GREEN.
5. Commit: "feat(monitor): guided session carries model and effort".

**Done when:**
- [test] session test asserts `openGuidedSession` passes `model: 'sonnet'` and `effort: 'medium'` through unchanged in the launch request, alongside the existing provider, halted-worktree `cwd`, and opening prompt.
- [test] session test asserts that when `model` and `effort` are omitted from the request, the launch request carries neither key and its provider, `cwd`, and opening prompt equal the pre-change values.

**Files likely touched:**
- `src/conductor/src/engine/monitor/session.ts` — request fields
- `src/conductor/test/engine/monitor/session.test.ts` — forwarding test

**Dependencies:** Task 3

### Task 11: Monitor launches config-selected provider, model, and effort through the real seam
**Story:** Story 1 happy 1, happy 3, negative 3; Story 2 happy 1–3, negative 1
**Type:** happy-path

**Steps:**
1. Write failing entry-level tests in `src/conductor/test/engine/monitor-cli.test.ts`. Each calls `dispatchMonitorCommand` with a project config fixture through the real `loadMergedConfig`, a one-halt `deriveQueueMembership` mock, the real `openGuidedSession`, and the real `launchInteractiveSession` with a mocked spawn and `isInteractiveTerminal: () => true` (search `isInteractiveTerminal`). Assert on the spawned executable and argv:
   - Build `claude` with `monitor.llm_provider: codex` launches the Codex executable.
   - No monitor provider with build `[codex, claude]` launches Codex.
   - Build `pi` with `monitor.llm_provider: claude` launches Claude.
   - `claude/sonnet/medium` launches with argv `['--permission-mode','default','--model','sonnet','--effort','medium',prompt]`.
   - `codex/gpt-5.6-terra/xhigh` launches with `['--model','gpt-5.6-terra','--config','model_reasoning_effort="xhigh"',prompt]`.
   - Only `effort: low` on Claude launches with `--model opus --effort low`.
   - `monitor.model: gpt-5.6-terra` with build `codex` launches Codex with `--model gpt-5.6-terra`.
2. Verify RED.
3. Implement: replace `resolveConfiguredProvider` with `loadMergedConfig` plus `resolveGuidedSessionSelection` (dep `resolveSelection`). Wire `launch: (halt) => open({ provider, model, effort, halt })`. Keep the existing `findBuiltInProviderDescriptor` guard inside the resolver.
4. Verify GREEN.
5. Commit: "feat(monitor): launch guided sessions with the resolved selection".

**Done when:**
- [test] monitor-cli entry test asserts that with build `llm_provider: claude` and `monitor.llm_provider: codex`, the mocked spawn receives the Codex executable, and with no monitor provider and build `[codex, claude]` it receives the Codex executable.
- [test] monitor-cli entry test asserts that with build `llm_provider: pi` and `monitor.llm_provider: claude`, the mocked spawn receives the Claude executable with Claude argv, and no Pi executable or Pi argv is spawned.
- [test] monitor-cli entry test asserts config `claude/sonnet/medium` spawns argv exactly `--permission-mode default --model sonnet --effort medium «prompt»`, and config `codex/gpt-5.6-terra/xhigh` spawns exactly `--model gpt-5.6-terra --config model_reasoning_effort="xhigh" «prompt»`.
- [test] monitor-cli entry test asserts config `effort: low` alone on Claude spawns `--model opus --effort low`, and config `model: gpt-5.6-terra` with no monitor provider and build `codex` spawns Codex with `--model gpt-5.6-terra`.

**Files likely touched:**
- `src/conductor/src/engine/monitor-cli.ts` — resolver wiring
- `src/conductor/test/engine/monitor-cli.test.ts` — entry-level launch tests

**Dependencies:** Tasks 7, 10

### Task 12: Monitor launches harness-stated defaults when nothing is configured
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing entry-level tests in `src/conductor/test/engine/monitor-cli.test.ts` (same harness as Task 11):
   - No `monitor` block with build `claude` spawns `--model opus --effort high`.
   - With build `codex`, it spawns `--model gpt-5.6-sol` and `--config model_reasoning_effort="high"`.
   - Build `claude` with `steps.explore.model: sonnet` and `steps.explore.effort: low` still spawns `--model opus --effort high`.
   - The spawned argv always contains both a model and an effort argument.
2. Verify RED, or GREEN if Task 11's wiring already delivers it. Either way the tests land.
3. Implement any remaining gap.
4. Verify GREEN.
5. Commit: "test(monitor): harness-stated defaults reach the launched session".

**Done when:**
- [test] monitor-cli entry test asserts no `monitor` block with build `claude` spawns argv containing `--model opus --effort high`, and with build `codex` spawns `--model gpt-5.6-sol` and `--config model_reasoning_effort="high"`.
- [test] monitor-cli entry test asserts a project pinning `steps.explore` to `sonnet`/`low` still spawns `--model opus --effort high` for Claude.
- [test] monitor-cli entry test asserts every unconfigured launch's argv contains both a `--model` value and an effort argument, never omitting either.

**Files likely touched:**
- `src/conductor/src/engine/monitor-cli.ts` — default wiring gaps, if any
- `src/conductor/test/engine/monitor-cli.test.ts` — default launch tests

**Dependencies:** Task 11

### Task 13: Monitor applies per-run overrides for that run only
**Story:** Story 3 happy 1–3, negative 1
**Type:** happy-path

**Steps:**
1. Write failing entry-level tests in `src/conductor/test/engine/monitor-cli.test.ts` driving `detectMonitorCommand` output into `dispatchMonitorCommand`, with config `monitor: claude/opus/high`:
   - `--model sonnet` spawns `--model sonnet --effort high`.
   - `--provider codex` spawns Codex with `--model gpt-5.6-sol` and `model_reasoning_effort="high"`, and no `opus`.
   - `--provider codex --model gpt-5.6-terra` spawns `--model gpt-5.6-terra` and `model_reasoning_effort="high"`.
   - A second dispatch with no overrides spawns `--model opus --effort high`.
   - The project config file bytes are identical before and after the overridden run.
2. Verify RED.
3. Implement: thread `command.overrides` into the resolver input.
4. Verify GREEN.
5. Commit: "feat(monitor): per-run overrides reach the launched session".

**Done when:**
- [test] monitor-cli entry test asserts with config `claude/opus/high`, `--model sonnet` spawns Claude argv containing `--model sonnet --effort high`.
- [test] monitor-cli entry test asserts `--provider codex` alone spawns the Codex executable with `--model gpt-5.6-sol` and `model_reasoning_effort="high"`, and no argv element equals `opus`.
- [test] monitor-cli entry test asserts `--provider codex --model gpt-5.6-terra` spawns Codex with `--model gpt-5.6-terra` and `model_reasoning_effort="high"`.
- [test] monitor-cli entry test asserts a following no-override dispatch spawns `--model opus --effort high` and the project config file's bytes are unchanged by the overridden run.

**Files likely touched:**
- `src/conductor/src/engine/monitor-cli.ts` — overrides into resolver
- `src/conductor/test/engine/monitor-cli.test.ts` — override tests

**Dependencies:** Tasks 9, 11

### Task 14: Monitor refuses an unaccepted effort before queue derivation and spawn
**Story:** Story 6
**Type:** negative-path

**Steps:**
1. Write failing entry-level tests in `src/conductor/test/engine/monitor-cli.test.ts`:
   - Each of `low|medium|high|xhigh|max` via `--effort` on Claude and on Codex spawns with that effort.
   - `--effort turbo` prints `monitor: effort "turbo" is not accepted by provider claude.` and returns 1. The `deriveQueueMembership` mock and spawn mock are never called, and no deferral write or halt-marker change occurs (assert the injected `readDeferrals` and `snapshotHaltMarker` mocks are never called and a fixture halt marker's bytes are unchanged).
   - An injected `resolveSelection` dep built over a descriptor whose `acceptedEfforts` omits `max` refuses `--effort max` naming `max` and the provider, returns 1, and never spawns.
2. Verify RED.
3. Implement: return before `deriveQueueMembership` and before starting the event spine on refusal.
4. Verify GREEN.
5. Commit: "feat(monitor): refuse unaccepted effort before launch".

**Done when:**
- [test] monitor-cli entry test asserts each of `low`, `medium`, `high`, `xhigh`, and `max` is applied as the spawned effort argument for both Claude and Codex.
- [test] monitor-cli entry test asserts `--effort turbo` prints an error naming `turbo` and `claude`, returns exit code 1, and the spawn mock is never called.
- [test] monitor-cli entry test asserts that on the `turbo` refusal, the `deriveQueueMembership`, `readDeferrals`, and `snapshotHaltMarker` mocks are never called and a fixture halt marker's bytes and a fixture deferral record's bytes are unchanged.
- [test] monitor-cli entry test asserts a narrowed descriptor omitting `max` makes `--effort max` exit 1 with an error naming `max` and that provider, and the spawn mock is never called.

**Files likely touched:**
- `src/conductor/src/engine/monitor-cli.ts` — early refusal
- `src/conductor/test/engine/monitor-cli.test.ts` — effort refusal tests

**Dependencies:** Tasks 8, 11

### Task 15: Monitor refuses malformed or uncatalogued models before launch
**Story:** Story 7
**Type:** negative-path

**Steps:**
1. Write failing entry-level tests in `src/conductor/test/engine/monitor-cli.test.ts`:
   - `--model claude-fable-5-1` spawns argv containing `--model claude-fable-5-1`.
   - Config `monitor.model: ''` prints `monitor: model "" is not a valid model id for provider claude.` and returns 1 with no spawn.
   - `--model --dangerously-skip-permissions` (per-run) refuses naming the value and `claude`, and no spawn argv ever contains it.
   - `monitor.model: "opus high"` and a model with `\u0007` each refuse naming the value and provider, with no spawn.
   - An injected catalog-declaring descriptor rejects an absent model naming value and provider, with no spawn.
2. Verify RED.
3. Implement any wiring gap (validation lives in Task 8).
4. Verify GREEN.
5. Commit: "test(monitor): model refusals reach the command boundary".

**Done when:**
- [test] monitor-cli entry test asserts `--model claude-fable-5-1` is spawned unchanged as `--model claude-fable-5-1`.
- [test] monitor-cli entry test asserts an empty model, `--dangerously-skip-permissions`, `opus high`, and a control-character model each exit 1 with an error naming that model value and `claude`, and the spawn mock is never called.
- [test] monitor-cli entry test asserts a catalog-declaring injected descriptor refuses a model absent from its catalog with an error naming the value and provider, exits 1, and never spawns.

**Files likely touched:**
- `src/conductor/test/engine/monitor-cli.test.ts` — model refusal tests
- `src/conductor/src/engine/monitor-cli.ts` — wiring gaps, if any

**Dependencies:** Tasks 8, 11

### Task 16: Monitor refuses unknown, non-interactive, and unresolvable providers before launch
**Story:** Story 8 happy 1–2, negatives 1–2; Story 1 negative 2
**Type:** negative-path

**Steps:**
1. Write failing entry-level tests in `src/conductor/test/engine/monitor-cli.test.ts`:
   - `monitor.llm_provider: pi` prints `monitor: provider pi cannot open a guided session: missing capability interactiveLaunch (#1007).` and returns 1.
   - Build `llm_provider: pi` with no monitor provider prints that same message and not `unregistered provider`.
   - `--provider gemini` prints `monitor: unregistered provider gemini.` and returns 1.
   - An unloadable project config prints `monitor: unable to resolve provider: «load error»` and returns 1.
   - In every case the `deriveQueueMembership`, `readDeferrals`, and spawn mocks are never called, and a fixture halt marker's bytes are unchanged.
2. Verify RED.
3. Implement any wiring gap.
4. Verify GREEN.
5. Commit: "feat(monitor): clear provider refusals before launch".

**Done when:**
- [test] monitor-cli entry test asserts `monitor.llm_provider: pi`, and separately build `llm_provider: pi` with no monitor provider, each exit 1 printing `monitor: provider pi cannot open a guided session: missing capability interactiveLaunch (#1007).`, and the output never contains `unregistered provider`.
- [test] monitor-cli entry test asserts `--provider gemini` exits 1 printing `monitor: unregistered provider gemini.`
- [test] monitor-cli entry test asserts an unloadable config exits 1 printing `monitor: unable to resolve provider:` followed by the load error.
- [test] monitor-cli entry test asserts that for every refusal above the `deriveQueueMembership`, `readDeferrals`, and spawn mocks are never called and the fixture halt marker's bytes are unchanged.

**Files likely touched:**
- `src/conductor/src/engine/monitor-cli.ts` — refusal wiring
- `src/conductor/test/engine/monitor-cli.test.ts` — provider refusal tests

**Dependencies:** Tasks 4, 8, 11

### Task 17: Monitor prints the applied selection and its sources once, before the queue
**Story:** Story 5; Story 2 negative 1 (output part)
**Type:** happy-path

**Steps:**
1. Write failing entry-level tests in `src/conductor/test/engine/monitor-cli.test.ts` with a capturing `print`:
   - Config `effort: medium`, `--model sonnet`, and build `claude` print exactly `monitor: guided sessions use provider=claude (default), model=sonnet (override), effort=medium (config)` once, before the first spawn-mock call.
   - Nothing configured prints all three with `(default)`.
   - Config `monitor.model: gpt-5.6-terra` with build `codex` prints `model=gpt-5.6-terra (config)`.
   - An empty queue (membership mock returns `[]`) still prints the line exactly once before the queue runs.
   - A refusal (`--effort turbo`) prints no line beginning `monitor: guided sessions use`.
2. Verify RED.
3. Implement the print after a successful resolution and before `run(...)`.
4. Verify GREEN.
5. Commit: "feat(monitor): show applied guided-session selection".

**Done when:**
- [test] monitor-cli entry test asserts the printed line equals `monitor: guided sessions use provider=claude (default), model=sonnet (override), effort=medium (config)` and is printed before the first spawn-mock invocation.
- [test] monitor-cli entry test asserts an unconfigured run prints all three values tagged `(default)`, and `monitor.model: gpt-5.6-terra` with build `codex` prints `model=gpt-5.6-terra (config)`.
- [test] monitor-cli entry test asserts an empty queue still prints the applied-selection line exactly once, before the queue runs.
- [test] monitor-cli entry test asserts a refused run prints no line beginning `monitor: guided sessions use`.

**Files likely touched:**
- `src/conductor/src/engine/monitor-cli.ts` — applied-selection output
- `src/conductor/test/engine/monitor-cli.test.ts` — output tests

**Dependencies:** Task 11

## Task Dependency Graph

```
T1 ──┬─> T2
     ├─> T3 ──┬─> T4 ─────────────────────┐
     │        └─> T10 ──┐                 │
T5 ──┼─> T6             │                 │
     └─> T7 (T1,T5) ─┬──┴─> T11 ─┬─> T12  │
                     └─> T8 ─────┼─> T14  │
T9 ──────────────────────────────┼─> T13  │
                                 ├─> T15  │
                                 ├─> T16 <┘ (also T8)
                                 └─> T17
```

## Integration Points

- After Task 3: the monitor seam and composer share the catalog's interactive argv definition.
- After Task 11: `conduct monitor` launches the configured provider, model, and effort end to end through the real seam, with spawn mocked.
- After Tasks 14–16: every refusal fires at the command boundary before queue derivation.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-06-catalog-owned-interactive-model-and-effort#D1 | task | task-1, task-2 | provider-catalog test asserts the Claude descriptor `argv` returns exactly `--permission-mode default --model sonnet --effort medium P` in that order |
| adr-2026-10-06-catalog-owned-interactive-model-and-effort#D2 | task | task-1, task-14 | provider-catalog test asserts Claude and Codex `interactiveLaunch.acceptedEfforts` equal `low, medium, high, xhigh, max` |
| adr-2026-10-06-catalog-owned-interactive-model-and-effort#D3 | task | task-3, task-4 | proving the seam holds no separate per-provider launch table |
| adr-2026-10-06-catalog-owned-interactive-model-and-effort#D4 | task | task-7 | selection test asserts precedence override > `monitor` config > `llm_provider[0]` for provider, model, and effort |
| adr-2026-10-06-catalog-owned-interactive-model-and-effort#D5 | task | task-8 | selection test asserts models `''`, `--dangerously-skip-permissions`, `opus high`, and one containing a control character each refuse |

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a project whose build selection is `claude` and whose guided-session provider is `codex`, when the monitor opens a guided session, then the launched executable is the Codex executable. | 11 | "with build `llm_provider: claude` and `monitor.llm_provider: codex`, the mocked spawn receives the Codex executable" | diff-local |
| Story 1 happy: Given that same project, when its resolved configuration is read for a build step, then the build step's provider is still `claude`. | 6 | "the build step's resolved provider selection is exactly `['claude']`" | diff-local |
| Story 1 happy: Given a project with no guided-session provider and a build selection of `codex, claude`, when the monitor opens a guided session, then the launched executable is the Codex executable (the first entry of the build selection). | 11 | "with no monitor provider and build `[codex, claude]` it receives the Codex executable" | diff-local |
| Story 1 negative: Given a guided-session provider of `codex` and a build selection of `claude`, when a build step resolves its provider, then it resolves to `claude` and never to `codex`. | 6 | "contains no `codex`" | diff-local |
| Story 1 negative: Given a project whose build selection cannot be resolved because its configuration fails to load, and no guided-session provider is set, when the monitor starts, then it exits non-zero printing `monitor: unable to resolve provider: «load error»` and launches nothing. | 16 | "an unloadable config exits 1 printing `monitor: unable to resolve provider:` followed by the load error" | diff-local |
| Story 1 negative: Given a guided-session provider is set and the build selection's first provider is `pi`, when the monitor opens a guided session, then it uses the guided-session provider and the Pi build selection plays no part in the launch. | 11 | "no Pi executable or Pi argv is spawned" | diff-local |
| Story 2 happy: Given guided-session settings provider `claude`, model `sonnet`, effort `medium`, when the monitor opens a guided session, then the Claude invocation carries `--model sonnet` and `--effort medium`, and the opening prompt is the last argument. | 11 | "config `claude/sonnet/medium` spawns argv exactly `--permission-mode default --model sonnet --effort medium «prompt»`" | diff-local |
| Story 2 happy: Given guided-session settings provider `codex`, model `gpt-5.6-terra`, effort `xhigh`, when the monitor opens a guided session, then the Codex invocation carries `--model gpt-5.6-terra` and `--config model_reasoning_effort="xhigh"` before the opening prompt. | 11 | "config `codex/gpt-5.6-terra/xhigh` spawns exactly `--model gpt-5.6-terra --config model_reasoning_effort="xhigh" «prompt»`" | diff-local |
| Story 2 happy: Given only a guided-session effort of `low` is set, with no model, when the monitor opens a session on `claude`, then the invocation carries `--effort low` and the harness-default model for Claude. | 11 | "config `effort: low` alone on Claude spawns `--model opus --effort low`" | diff-local |
| Story 2 negative: Given a guided-session model is set but no guided-session provider, and the build selection's first provider is `codex`, when the monitor opens a session, then the configured model is applied to the Codex invocation and the launch output reports model source `config`. | 11, 17 | "config `model: gpt-5.6-terra` with no monitor provider and build `codex` spawns Codex with `--model gpt-5.6-terra`" | diff-local |
| Story 2 negative: Given the Claude invocation is built with a model and an effort, when its argument order is inspected, then `--permission-mode default` is still present and no option appears after the opening prompt. | 3 | "with the prompt as the final element and no option after it" | diff-local |
| Story 2 negative: Given a guided-session effort is set, when the session launches, then effort is not delivered through any environment variable and appears only as the provider's effort argument. | 3 | "the effort appears only as the `--effort` argument" | diff-local |
| Story 3 happy: Given guided-session settings `claude`/`opus`/`high`, when the monitor is run with a per-run model override `sonnet`, then the session launches Claude with `--model sonnet --effort high`. | 13 | "`--model sonnet` spawns Claude argv containing `--model sonnet --effort high`" | diff-local |
| Story 3 happy: Given guided-session settings `claude`/`opus`/`high`, when the monitor is run with a per-run provider override `codex` and no other overrides, then the session launches Codex with Codex's harness-default model `gpt-5.6-sol` and effort `high`, not `opus`. | 13 | "no argv element equals `opus`" | diff-local |
| Story 3 happy: Given a per-run provider override `codex` plus a per-run model override `gpt-5.6-terra`, when the session launches, then it uses Codex with `gpt-5.6-terra` and Codex's default effort `high`. | 13 | "`--provider codex --model gpt-5.6-terra` spawns Codex with `--model gpt-5.6-terra` and `model_reasoning_effort="high"`" | diff-local |
| Story 3 negative: Given a run with per-run overrides has finished, when the monitor is next run with no overrides, then the persisted guided-session settings apply again and project configuration is byte-for-byte unchanged. | 13 | "the project config file's bytes are unchanged by the overridden run" | diff-local |
| Story 3 negative: Given a per-run override flag is supplied with no value, when the monitor starts, then it exits non-zero printing the monitor usage and launches nothing. | 9 | "a flag with no value (last token), a repeated flag, and an unknown option `--verbose` each parse to `{ kind: 'guide' }`" | diff-local |
| Story 3 negative: Given an unrecognised monitor option is supplied, when the monitor starts, then it exits non-zero printing the monitor usage, as today. | 9 | "dispatching a `guide` command prints `MONITOR_USAGE`" | diff-local |
| Story 4 happy: Given a project with no guided-session settings and build selection `claude`, when the monitor opens a session, then Claude is launched with `--model opus --effort high` (Claude's built-in `explore` defaults). | 12 | "no `monitor` block with build `claude` spawns argv containing `--model opus --effort high`" | diff-local |
| Story 4 happy: Given no guided-session settings and build selection `codex`, when the monitor opens a session, then Codex is launched with `--model gpt-5.6-sol` and `model_reasoning_effort="high"`. | 12 | "with build `codex` spawns `--model gpt-5.6-sol` and `--config model_reasoning_effort="high"`" | diff-local |
| Story 4 negative: Given no guided-session settings and a project that pins its `explore` step to model `sonnet` / effort `low`, when the monitor opens a Claude session, then the defaults are still `opus`/`high` and the project's `explore` pin is not used. | 12 | "a project pinning `steps.explore` to `sonnet`/`low` still spawns `--model opus --effort high` for Claude" | diff-local |
| Story 4 negative: Given no guided-session settings, when the session launches, then the invocation never omits the model or effort arguments (a concrete value is always passed). | 12 | "never omitting either" | diff-local |
| Story 5 happy: Given a per-run model override `sonnet`, a configured effort `medium`, and no provider setting with build selection `claude`, when the monitor starts, then before any session launches it prints one line naming `provider=claude (default)`, `model=sonnet (override)`, `effort=medium (config)`. | 17 | "the printed line equals `monitor: guided sessions use provider=claude (default), model=sonnet (override), effort=medium (config)`" | diff-local |
| Story 5 happy: Given nothing configured, when the monitor starts, then the printed line reports all three values with source `default`. | 17 | "an unconfigured run prints all three values tagged `(default)`" | diff-local |
| Story 5 negative: Given the selection is refused (see Story 6–8), when the monitor exits, then no applied-selection line is printed. | 17 | "a refused run prints no line beginning `monitor: guided sessions use`" | diff-local |
| Story 5 negative: Given the monitor queue is empty, when the monitor starts, then the applied-selection line is still printed once, before the queue is offered, so the operator knows what a later session will use. | 17 | "an empty queue still prints the applied-selection line exactly once, before the queue runs" | diff-local |
| Story 6 happy: Given each of `low`, `medium`, `high`, `xhigh`, `max` as the per-run effort for `claude` and for `codex`, when the monitor resolves the selection, then each is accepted and applied. | 14 | "each of `low`, `medium`, `high`, `xhigh`, and `max` is applied as the spawned effort argument for both Claude and Codex" | diff-local |
| Story 6 happy: Given a provider whose declared accepted efforts exclude `max`, when the effort is `max`, then the monitor exits non-zero with an error naming effort `max` and that provider. | 14 | "a narrowed descriptor omitting `max` makes `--effort max` exit 1 with an error naming `max` and that provider" | diff-local |
| Story 6 negative: Given a per-run effort `turbo`, when the monitor starts, then it exits non-zero with an error naming `turbo` and the resolved provider, and the process boundary is never reached. | 14 | "`--effort turbo` prints an error naming `turbo` and `claude`, returns exit code 1, and the spawn mock is never called" | diff-local |
| Story 6 negative: Given an unaccepted effort, when the monitor exits, then no halt marker, deferral record, or queue state has changed. | 14 | "a fixture halt marker's bytes and a fixture deferral record's bytes are unchanged" | diff-local |
| Story 6 negative: Given an unaccepted effort and a non-empty halt queue, when the monitor exits, then queue membership was never derived (the refusal precedes queue processing). | 14 | "the `deriveQueueMembership`, `readDeferrals`, and `snapshotHaltMarker` mocks are never called" | diff-local |
| Story 7 happy: Given a per-run model `claude-fable-5-1` for `claude`, a model absent from every harness policy table, when the monitor starts, then it is accepted and passed through unchanged. | 15 | "`--model claude-fable-5-1` is spawned unchanged as `--model claude-fable-5-1`" | diff-local |
| Story 7 negative: Given a per-run model of empty string, when the monitor starts, then it exits non-zero with an error naming the empty model value and the provider, and launches nothing. | 15 | "an empty model, `--dangerously-skip-permissions`, `opus high`, and a control-character model each exit 1 with an error naming that model value and `claude`" | diff-local |
| Story 7 negative: Given a model `--dangerously-skip-permissions`, when the monitor starts, then it is rejected naming the value and provider, and it never appears in any launched argv. | 15 | "an empty model, `--dangerously-skip-permissions`, `opus high`, and a control-character model each exit 1 with an error naming that model value and `claude`, and the spawn mock is never called" | diff-local |
| Story 7 negative: Given a model containing whitespace (`opus high`) or a control character, when the monitor starts, then it is rejected naming the value and provider. | 15 | "an empty model, `--dangerously-skip-permissions`, `opus high`, and a control-character model each exit 1" | diff-local |
| Story 7 negative: Given a provider that declares an authoritative model catalog and a model absent from it, when the selection is resolved, then it is rejected naming the value and provider. | 8, 15 | "a catalog-declaring injected descriptor refuses a model absent from `listCatalogModels` naming value and provider" | diff-local |
| Story 8 happy: Given a guided-session provider `pi`, when the monitor starts, then it exits non-zero with a message naming provider `pi`, the missing interactive-launch capability, and #1007, and launches nothing. | 16 | "each exit 1 printing `monitor: provider pi cannot open a guided session: missing capability interactiveLaunch (#1007).`" | diff-local |
| Story 8 happy: Given a per-run provider `gemini`, when the monitor starts, then it exits non-zero with `monitor: unregistered provider gemini.` and launches nothing. | 16 | "`--provider gemini` exits 1 printing `monitor: unregistered provider gemini.`" | diff-local |
| Story 8 negative: Given a build selection whose first entry is `pi` and no guided-session provider, when the monitor starts, then it is refused with the Pi interactive-launch message, not the generic "unregistered provider" message. | 16 | "the output never contains `unregistered provider`" | diff-local |
| Story 8 negative: Given a Pi refusal, when the monitor exits, then queue membership was never derived and halt state is unchanged. | 16 | "the `deriveQueueMembership`, `readDeferrals`, and spawn mocks are never called and the fixture halt marker's bytes are unchanged" | diff-local |
| Story 8 negative: Given Claude is selected but its executable is not installed, when the session launches, then the existing "Interactive launch unavailable for claude: ENOENT." outcome is preserved. | 4 | "an ENOENT spawn failure for `claude` reports `Interactive launch unavailable for claude: ENOENT.` and returns kind `unavailable`" | diff-local |
| Story 9 happy: Given valid guided-session settings, when project configuration is loaded, then loading succeeds and the settings are available to the monitor. | 5 | "a valid `monitor` block (provider `codex`, model `gpt-5.6-terra`, effort `low`) loads successfully" | diff-local |
| Story 9 negative: Given a guided-session provider `gemini` in configuration, when configuration is loaded, then loading fails with an error naming the setting path and `gemini`. | 5 | "`monitor.llm_provider: gemini` fails config loading with an error naming `monitor.llm_provider` and `gemini`" | diff-local |
| Story 9 negative: Given a guided-session effort `turbo` in configuration, when configuration is loaded, then loading fails with an error naming the setting path and stating the accepted values low, medium, high, xhigh, and max. | 5 | "`monitor.effort: turbo` fails with an error naming `monitor.effort` and listing the accepted values low, medium, high, xhigh, and max" | diff-local |
| Story 9 negative: Given an unknown key inside the guided-session settings block, when configuration is loaded, then it is reported the same way other unknown configuration keys are. | 5 | "an unknown key `modle` inside `monitor` fails with `Unknown key in monitor: "modle"`" | diff-local |
| Story 9 negative: Given an invalid guided-session setting, when a build (not the monitor) loads configuration, then the same configuration error is reported, because the setting belongs to the project's configuration. | 5 | "so a build loading that project reports the same configuration error" | diff-local |
| Story 10 happy: Given the composer launches Claude with `CONDUCT_ENGINEER_PERMISSION_MODE` unset, `plan`, and `acceptEdits` respectively, when its argv is built, then it is byte-for-byte identical to the argv produced before this change. | 2 | "with `CONDUCT_ENGINEER_PERMISSION_MODE` unset and with `plan`, and to `--permission-mode acceptEdits /composer` with `acceptEdits`" | diff-local |
| Story 10 happy: Given the composer launches Codex, when its argv is built, then it is byte-for-byte identical to the argv produced before this change (a single positional prompt). | 2 | "the single positional prompt `$composer add retries`" | diff-local |
| Story 10 happy: Given the monitor launches Claude, when its argv is built, then it uses permission mode `default` regardless of `CONDUCT_ENGINEER_PERMISSION_MODE`. | 3 | "the seam's Claude argv still contains `--permission-mode default`" | diff-local |
| Story 10 negative: Given `CONDUCT_ENGINEER_PERMISSION_MODE=acceptEdits` is set in the operator's environment, when the monitor launches a guided session, then the monitor's Claude argv still carries `--permission-mode default`. | 3 | "with `CONDUCT_ENGINEER_PERMISSION_MODE=acceptEdits` set, the seam's Claude argv still contains `--permission-mode default`" | diff-local |
| Story 10 negative: Given a provider's interactive launch definition is changed, when both the monitor and composer argv are built, then both reflect it; the monitor holds no separate per-provider launch table. | 2, 3 | "proving the seam holds no separate per-provider launch table" | diff-local |
| Story 10 negative: Given a monitor session is launched with no attached interactive terminal, when the launch is attempted, then the existing "no attached interactive terminal" refusal still applies. | 4 | "with no attached interactive terminal the seam reports `Interactive launch unavailable: no attached interactive terminal.`" | diff-local |
