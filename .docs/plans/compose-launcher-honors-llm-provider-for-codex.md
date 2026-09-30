# Implementation Plan: Compose launcher honors llm_provider for Codex

**Date:** 2026-09-28
**Stories:** .docs/stories/compose-launcher-honors-llm-provider-for-codex.md
**Conflict check:** Clean as of 2026-09-28

## Summary

Makes the bare `ai-conductor compose` launcher start the interactive host the configuration assigns to DECIDE: it resolves the `explore` step's provider and launches Codex with `$composer` instead of always spawning `claude`. Hosts without the new catalog capability, unknown providers, and missing executables are refused by name, and the nested-session guard covers every capable host. 8 tasks.

## Technical Approach

- **Catalog capability first (ADR D9).** `execution/provider-catalog.ts` gains `interactiveLaunch` in the `ProviderCapability` union, an owner entry `#1007`, and an optional descriptor field that carries the host's session markers and argv builder. Claude's argv builder absorbs today's `engineerLaunchArgs` permission-mode logic. Codex returns the prompt as its only argument. Pi declares nothing and is refused through `requireProviderCapability`. Provider id literals stay in the catalog, and #1884's provider-id-literals structural test keeps `engineer-cli.ts` clean.
- **Pure host selection (ADR D10).** A new `engine/compose-launch-host.ts` exports `resolveComposeLaunchHost({ providerFlag, config })`. Selection is the flag; otherwise the first entry of `normalizeProviderSelection(config.steps?.explore?.llm_provider ?? config.llm_provider)`, which is the step-pin-over-run-level read that dispatch already uses. It never falls back to a later ladder entry.
- **Launcher wiring (ADR D11).** The `launch` case of `dispatchEngineer` loads merged configuration for the launching directory, resolves and narrows the host, and spawns `resolveProviderExecutable(host)` with the descriptor argv through a new injectable `spawnHost`. When the directory has no project config file, user configuration alone applies, so compose still works outside a project. The launcher never runs boot discovery. A spawn ENOENT becomes a message built from the descriptor. The nested-session guard scans every capable descriptor's markers and runs before config load and the intake pre-poll.
- **Test seams.** New `dispatchEngineer` options `spawnHost`, `loadLaunchConfig`, and `env` put the process boundary behind mocks, per the repository's process-isolation rule. The existing `launchInteractive` and `insideClaudeSession` seams keep working for the current tests.
- **Sequencing.** Tasks 1–3 are independent. Task 4 wires them into the launcher and owns the cross-boundary integration proof through `dispatchEngineer`. Tasks 5–8 extend that launch path.

## Prerequisites

- #1884 (`pi-as-a-build-provider`) is merged to `main`: `execution/provider-catalog.ts`, `requireProviderCapability`, `resolveProviderExecutable`, `PROVIDER_CAPABILITY_OWNERS`, the descriptor `invocationPrefix`, and the provider-id-literals structural test all come from it. This spec PR merges only after it (architecture-review condition 1).

## Tasks

### Task 1: Catalog declares the interactiveLaunch capability for claude and codex
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing test: in `src/conductor/test/execution/provider-catalog.test.ts`, assert `interactiveLaunch` is a declared capability of claude and codex and unsupported for pi; assert `requireProviderCapability` for pi and `interactiveLaunch` throws `ProviderCapabilityUnsupportedError` naming pi, interactiveLaunch, and #1007; assert each descriptor's session markers and argv builder output.
2. Verify test fails (RED).
3. Implement: add `interactiveLaunch` to the `ProviderCapability` union and `PROVIDER_CAPABILITY_OWNERS` (`#1007`). Add an optional `interactiveLaunch` descriptor field `{ sessionMarkers: readonly string[]; argv(prompt: string, env: NodeJS.ProcessEnv): string[] }`. Claude declares markers `CLAUDECODE` and an argv builder that moves today's `engineerLaunchArgs` permission-mode logic (unset or `plan` becomes `default`) into the descriptor: `[--permission-mode, mode, prompt]`. Codex declares markers `CODEX_THREAD_ID`, `CODEX_SESSION_ID` and returns `[prompt]` with no sandbox, approval, or model flags. Pi declares neither the flag nor the field. Provider id literals stay inside the catalog (ADR D1).
4. Verify test passes (GREEN).
5. Commit with message: "feat(providers): declare the interactiveLaunch catalog capability"

**Done when:**
- a provider-catalog test asserts `supportsProviderCapability` reports `interactiveLaunch` declared for claude and codex and unsupported for pi
- a provider-catalog test asserts `requireProviderCapability` for pi and `interactiveLaunch` throws `ProviderCapabilityUnsupportedError` whose message names pi, interactiveLaunch, and #1007
- a provider-catalog test asserts the claude descriptor session markers equal `CLAUDECODE` only and the codex descriptor session markers equal `CODEX_THREAD_ID` and `CODEX_SESSION_ID`
- a provider-catalog test asserts the claude argv builder returns `--permission-mode`, `default`, and the prompt for an unset or `plan` permission mode, and the codex argv builder returns exactly one element, the prompt

**Files likely touched:**
- src/conductor/src/execution/provider-catalog.ts
- src/conductor/test/execution/provider-catalog.test.ts

**Dependencies:** none

### Task 2: Launch host selection resolves flag, explore-step provider, then default
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: in `src/conductor/test/engine/compose-launch-host.test.ts`, drive `resolveComposeLaunchHost({ providerFlag, config })` over the precedence fixtures listed in Done when.
2. Verify test fails (RED).
3. Implement: create `src/conductor/src/engine/compose-launch-host.ts` exporting `resolveComposeLaunchHost`. Selection is `providerFlag` when present; otherwise the first entry of `normalizeProviderSelection(config.steps?.explore?.llm_provider ?? config.llm_provider)`. That is the same step-pin-over-run-level read used by `conductor.ts` and `project-prelude.ts` (search `steps?.[step]?.llm_provider`), resolved through `engine/provider-selection.ts`. Only index 0 is ever returned: a human-driven session never falls back to a later ladder entry (ADR D10). A value that is not a catalog id (`isBuiltInProviderId`) throws an error worded like the existing unknown-provider message in `provider-selection.ts` (`names unknown provider`), with `--provider` or `llm_provider` as the path.
4. Verify test passes (GREEN).
5. Commit with message: "feat(compose): resolve the launch host from flag, explore step, or default"

**Done when:**
- a compose-launch-host test asserts `resolveComposeLaunchHost` returns claude when there is no flag and no `llm_provider` at run or `explore` step level
- a compose-launch-host test asserts `resolveComposeLaunchHost` returns codex for run-level codex with no `explore` pin, codex for run-level `[codex, claude]` with no `explore` pin, and claude for run-level `[codex, claude]` with an `explore` pin of claude
- a compose-launch-host test asserts `resolveComposeLaunchHost` returns the flag value claude when the configuration resolves codex for `explore`
- a compose-launch-host test asserts `resolveComposeLaunchHost` throws an error containing `names unknown provider` and `gemini` for a flag of gemini

**Files likely touched:**
- src/conductor/src/engine/compose-launch-host.ts
- src/conductor/test/engine/compose-launch-host.test.ts

**Dependencies:** none

### Task 3: Parse --provider on launch forms of compose and engineer
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: in `src/conductor/test/cli-engineer.test.ts`, assert `detectEngineerCommand` parses `--provider` on bare and `--idea` launch forms under both verbs, in either flag order, and that a valueless `--provider` produces a usage error at dispatch.
2. Verify test fails (RED).
3. Implement: in `parseEngineerCommand`, when `argv[3]` is `--provider` or `--idea`, parse both flags with `parseFlag` into `{ kind: 'launch', idea?, provider? }`. A present `--provider` with no value yields a launch-usage descriptor, which `dispatchEngineer` reports as `compose: --provider requires a provider id` with exit 1 before any config load or spawn. The positional free-text idea form is unchanged. Update `SUBCOMMAND_HELP`/usage text for `--provider`.
4. Verify test passes (GREEN).
5. Commit with message: "feat(compose): accept --provider on the launch forms"

**Done when:**
- a cli-engineer test asserts `detectEngineerCommand` parses both `compose --provider codex` and `engineer --provider codex` to a launch descriptor whose provider is codex
- a cli-engineer test asserts `compose --provider claude --idea` and `compose --idea ... --provider claude` both parse to a launch descriptor with provider claude and the idea text
- a dispatchEngineer test asserts `compose --provider` with no value exits non-zero, prints a usage error naming `--provider`, and records zero `spawnHost` calls

**Files likely touched:**
- src/conductor/src/engine/engineer-cli.ts
- src/conductor/test/cli-engineer.test.ts

**Dependencies:** none

### Task 4: Launcher spawns the selected host through the catalog
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: in `src/conductor/test/engine/engineer/engineer-cli-launch-host.test.ts`, drive `dispatchEngineer` with a launch descriptor and injected `spawnHost`, `loadLaunchConfig`, `env`, `prePoll`, and `confirmAnother` stubs; assert the spawned executable and argv per Done when.
2. Verify test fails (RED).
3. Implement: in the `launch` case of `dispatchEngineer`, replace the default `launchClaudeEngineer` with a provider-selected launch. Load the launching directory's configuration through a new `loadLaunchConfig` option defaulting to `loadMergedConfig(process.cwd())`, where a `missing` project config falls back to the user configuration alone (`userConfigPath`, honoring `HOME`). Resolve the host with `resolveComposeLaunchHost`, narrow it with `requireProviderCapability(host, 'interactiveLaunch')`, build the prompt from the descriptor `invocationPrefix` + `composer` + optional idea, and spawn `resolveProviderExecutable(host)` with the descriptor argv through a new injectable `spawnHost(executable, argv, cwd)` (default: `spawn` with `stdio: 'inherit'`). The injected `launchInteractive` test seam keeps precedence. `engineerLaunchArgs` is removed; its callers move to the descriptor. `engineer-cli.ts` names no provider id literal (ADR D1).
4. Verify test passes (GREEN).
5. Commit with message: "feat(compose): launch the host selected from configuration"

**Done when:**
- a dispatchEngineer launch test asserts bare compose spawns `claude` when the loaded config has no `llm_provider`, spawns `codex` for run-level codex, spawns `codex` for run-level `[codex, claude]` with no `explore` pin, and spawns `claude` for run-level `[codex, claude]` with an `explore` pin of claude
- a dispatchEngineer launch test using the default config loader over a temporary project with no `llm_provider` and a `HOME` whose user config sets codex asserts the spawned executable is `codex`
- a dispatchEngineer launch test asserts `compose --provider claude` spawns `claude` when the config resolves codex for `explore`, and `engineer --provider codex` with an idea spawns `codex` with the same executable and argv as `compose --provider codex` with that idea when the config resolves claude
- a dispatchEngineer launch test asserts the `spawnHost` argv is `--permission-mode default /composer` for claude with no idea, ends with `/composer add retries` for claude with that idea, is exactly `$composer add retries` for codex with that idea, and is exactly `$composer` for codex with no idea
- a dispatchEngineer launch test asserts `spawnHost` receives the absolute `CODEX_EXECUTABLE` path when it is set, and receives `claude` for claude when `CLAUDE_EXECUTABLE` is unset, and the provider-id-literals structural test passes with `engineer-cli.ts` and `compose-launch-host.ts` in scope

**Files likely touched:**
- src/conductor/src/engine/engineer-cli.ts
- src/conductor/test/engine/engineer/engineer-cli-launch-host.test.ts

**Dependencies:** 1, 2, 3

### Task 5: Launcher refuses pi, unknown providers, and broken config before spawning
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing test: in `src/conductor/test/engine/engineer/engineer-cli-launch-host.test.ts`, drive `dispatchEngineer` with a pi-selected config, a `--provider gemini` flag, a failing config loader, and `CONDUCT_ENGINEER_PERMISSION_MODE=plan`; assert exit codes, printed messages, and spawn calls per Done when.
2. Verify test fails (RED).
3. Implement: in the launch path, catch `ProviderCapabilityUnsupportedError` and the unknown-provider error from `resolveComposeLaunchHost`, and print their messages with exit 1. A `loadLaunchConfig` result with `ok: false`, other than the `missing` project file, prints the existing config error message with exit 1. None of these paths reaches `spawnHost`.
4. Verify test passes (GREEN).
5. Commit with message: "fix(compose): refuse unsupported or unknown launch hosts by name"

**Done when:**
- a dispatchEngineer test with run-level `llm_provider` pi asserts a non-zero exit, a printed message naming pi, interactiveLaunch, and #1007, and zero `spawnHost` calls
- a dispatchEngineer test with `--provider gemini` asserts a non-zero exit, a printed message containing `names unknown provider` and `gemini`, and zero `spawnHost` calls
- a dispatchEngineer test whose config loader returns a parse or validation error asserts a non-zero exit, that error message printed, and zero `spawnHost` calls
- a dispatchEngineer test with claude selected and `CONDUCT_ENGINEER_PERMISSION_MODE` set to plan asserts the `spawnHost` argv carries `--permission-mode` followed by `default`

**Files likely touched:**
- src/conductor/src/engine/engineer-cli.ts
- src/conductor/test/engine/engineer/engineer-cli-launch-host.test.ts

**Dependencies:** 4

### Task 6: Missing host executable fails with an actionable message and no fallback
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing test: in `src/conductor/test/engine/engineer/engineer-cli-launch-host.test.ts`, inject a `spawnHost` that rejects with an ENOENT error; mock `engine/provider-discovery.ts` with `vi.mock` so its discovery function is observable; assert the message, the exit code, the single spawn, and no discovery.
2. Verify test fails (RED).
3. Implement: replace the Claude-specific "could not launch an interactive Claude session" catch with a message built from the selected descriptor: provider id, `defaultExecutable`, `executableOverrideEnv`, and the in-session invocation `invocationPrefix` + `composer`. Exit 1 without trying another provider or ladder entry. The launch path never imports or calls provider discovery (ADR D11). The same catch applies on every loop iteration.
4. Verify test passes (GREEN).
5. Commit with message: "fix(compose): name the missing host executable and its override"

**Done when:**
- a dispatchEngineer test whose `spawnHost` rejects with ENOENT for codex asserts a non-zero exit and a printed message containing `codex`, the executable `codex`, `CODEX_EXECUTABLE`, and `$composer`
- a dispatchEngineer test asserts `spawnHost` was called exactly once and never with the claude executable, and the mocked provider discovery function and any version argv were never invoked
- a dispatchEngineer test with claude selected and a succeeding `spawnHost` asserts exactly one `spawnHost` call and that the mocked provider discovery function and any version argv were never invoked before it
- a two-iteration dispatchEngineer test whose second `spawnHost` call rejects with ENOENT asserts a non-zero exit, the same missing-executable message, and `confirmAnother` called exactly once

**Files likely touched:**
- src/conductor/src/engine/engineer-cli.ts
- src/conductor/test/engine/engineer/engineer-cli-launch-host.test.ts

**Dependencies:** 4

### Task 7: Nested-session guard covers every interactiveLaunch host
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing test: in `src/conductor/test/engine/engineer/engineer-cli-launch-host.test.ts`, drive `dispatchEngineer` with an injected `env` carrying each marker, plus `--provider claude` with a codex marker; stub `prePoll` and `gh` and assert no spawn, no pre-poll, and no issue call.
2. Verify test fails (RED).
3. Implement: replace the `CLAUDECODE`-only `insideClaudeSession` check with a scan of `sessionMarkers` across every `BUILT_IN_PROVIDERS` descriptor that declares `interactiveLaunch`, reading from a new injectable `env` option (default `process.env`). On a hit, print "You are already inside a <displayName> session — run <prefix>composer directly" using the detected host's descriptor, and return 0 before config load, `--provider` handling, the intake pre-poll, or spawn. Keep today's trait: the guard runs on the real launch path and never on the injected `launchInteractive` seam (search `insideClaudeSession` in `engineer-cli.ts`). The existing `insideClaudeSession` option maps to a `CLAUDECODE` marker for back-compat.
4. Verify test passes (GREEN).
5. Commit with message: "fix(compose): refuse to nest inside any interactive host session"

**Done when:**
- a dispatchEngineer test with `CLAUDECODE` set asserts exit 0, printed text naming `/composer`, zero `spawnHost` calls, zero `prePoll` calls, and no `issue` subcommand sent to the `gh` stub
- a dispatchEngineer test with only `CODEX_THREAD_ID` set asserts exit 0, printed text naming `$composer`, zero `spawnHost` calls, and zero `prePoll` calls
- a dispatchEngineer test with only `CODEX_SESSION_ID` set asserts exit 0, printed text naming `$composer`, zero `spawnHost` calls, and zero `prePoll` calls
- a dispatchEngineer test with `CODEX_THREAD_ID` set and `--provider claude` asserts exit 0, printed text naming `$composer`, and zero `spawnHost` calls
- a dispatchEngineer test with no session marker of any `interactiveLaunch` host set asserts exactly one `spawnHost` call for the selected host

**Files likely touched:**
- src/conductor/src/engine/engineer-cli.ts
- src/conductor/test/engine/engineer/engineer-cli-launch-host.test.ts

**Dependencies:** 4

### Task 8: Follow-on ideas relaunch on the host selected at start
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing test: in `src/conductor/test/engine/engineer/engineer-cli-launch-host.test.ts`, drive two loop iterations with codex selected and `--idea "add retries"`, with `confirmAnother` returning true then false; then drive a declined first iteration.
2. Verify test fails (RED).
3. Implement: resolve the host once, before the outer loop, and reuse its descriptor and executable for every iteration. The CLI idea stays one-shot (`pendingIdea` cleared after the first spawn), so later prompts are exactly `<prefix>composer`. Declining returns `lastCode` as today.
4. Verify test passes (GREEN).
5. Commit with message: "fix(compose): keep the selected host across follow-on ideas"

**Done when:**
- a two-iteration dispatchEngineer test with codex selected and an idea asserts both `spawnHost` calls use the codex executable, the first argv is exactly `$composer add retries`, and the second argv is exactly `$composer`
- a dispatchEngineer test with codex selected where `confirmAnother` returns false asserts exactly one `spawnHost` call and a dispatch exit code equal to the first session exit code

**Files likely touched:**
- src/conductor/src/engine/engineer-cli.ts
- src/conductor/test/engine/engineer/engineer-cli-launch-host.test.ts

**Dependencies:** 4

## Task Dependency Graph

```text
Task 1 (catalog) ──┐
Task 2 (select) ───┼──▶ Task 4 (wiring) ──▶ Task 5 (refusals)
Task 3 (flag) ─────┘                    ├──▶ Task 6 (missing executable)
                                        ├──▶ Task 7 (nested guard)
                                        └──▶ Task 8 (follow-on host)
```

## Integration Points

- After Task 4: bare `ai-conductor compose` in a codex-configured directory launches `codex` with `$composer`, reached through `detectEngineerCommand` → `dispatchEngineer`.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given no `--provider` flag and no `llm_provider` configured at user or project level, when the operator runs bare `ai-conductor compose`, then the catalog default provider claude is launched. | 4 | "a dispatchEngineer launch test asserts bare compose spawns `claude` when the loaded config has no `llm_provider`, spawns `codex` for run-level codex, spawns `codex` for run-level `[codex, claude]` with no `explore` pin, and spawns `claude` for run-level `[codex, claude]` with an `explore` pin of claude" | diff-local |
| Story 1 happy: Given the launching directory configures run-level `llm_provider: codex` with no `explore` step pin and no flag is passed, when the operator runs bare `ai-conductor compose`, then codex is launched. | 4 | "a dispatchEngineer launch test asserts bare compose spawns `claude` when the loaded config has no `llm_provider`, spawns `codex` for run-level codex, spawns `codex` for run-level `[codex, claude]` with no `explore` pin, and spawns `claude` for run-level `[codex, claude]` with an `explore` pin of claude" | diff-local |
| Story 1 happy: Given the launching directory configures run-level `llm_provider: [codex, claude]` and pins `steps.explore.llm_provider: claude`, when the operator runs bare `ai-conductor compose`, then claude is launched. | 4 | "a dispatchEngineer launch test asserts bare compose spawns `claude` when the loaded config has no `llm_provider`, spawns `codex` for run-level codex, spawns `codex` for run-level `[codex, claude]` with no `explore` pin, and spawns `claude` for run-level `[codex, claude]` with an `explore` pin of claude" | diff-local |
| Story 1 happy: Given the launching directory configures run-level `llm_provider: [codex, claude]` with no `explore` step pin, when the operator runs bare `ai-conductor compose`, then codex, the first entry, is launched. | 4 | "a dispatchEngineer launch test asserts bare compose spawns `claude` when the loaded config has no `llm_provider`, spawns `codex` for run-level codex, spawns `codex` for run-level `[codex, claude]` with no `explore` pin, and spawns `claude` for run-level `[codex, claude]` with an `explore` pin of claude" | diff-local |
| Story 1 happy: Given the user-level configuration sets `llm_provider: codex` and the project sets no `llm_provider`, when the operator runs bare `ai-conductor compose` in that project, then codex is launched. | 4 | "a dispatchEngineer launch test using the default config loader over a temporary project with no `llm_provider` and a `HOME` whose user config sets codex asserts the spawned executable is `codex`" | diff-local |
| Story 1 happy: Given the configuration resolves codex for `explore`, when the operator runs `ai-conductor compose --provider claude`, then claude is launched and the configured value is ignored. | 4 | "a dispatchEngineer launch test asserts `compose --provider claude` spawns `claude` when the config resolves codex for `explore`, and `engineer --provider codex` with an idea spawns `codex` with the same executable and argv as `compose --provider codex` with that idea when the config resolves claude" | diff-local |
| Story 1 happy: Given the configuration resolves claude for `explore`, when the operator runs the deprecated alias `ai-conductor engineer --provider codex`, then codex is launched exactly as under `compose`. | 4 | "a dispatchEngineer launch test asserts `compose --provider claude` spawns `claude` when the config resolves codex for `explore`, and `engineer --provider codex` with an idea spawns `codex` with the same executable and argv as `compose --provider codex` with that idea when the config resolves claude" | diff-local |
| Story 1 negative: Given the operator passes `--provider gemini`, which is not a catalog id, when the launcher resolves its host, then it exits non-zero with the existing unknown-provider error naming gemini and spawns nothing. | 5 | "a dispatchEngineer test with `--provider gemini` asserts a non-zero exit, a printed message containing `names unknown provider` and `gemini`, and zero `spawnHost` calls" | diff-local |
| Story 1 negative: Given the operator passes `--provider` with no value, when the launcher parses its arguments, then it exits non-zero with a usage error naming `--provider` and spawns nothing. | 3 | "a dispatchEngineer test asserts `compose --provider` with no value exits non-zero, prints a usage error naming `--provider`, and records zero `spawnHost` calls" | diff-local |
| Story 1 negative: Given the launching directory's configuration fails to load or validate, when the operator runs bare `ai-conductor compose` with no flag, then it exits non-zero with the existing configuration error and spawns nothing. | 5 | "a dispatchEngineer test whose config loader returns a parse or validation error asserts a non-zero exit, that error message printed, and zero `spawnHost` calls" | diff-local |
| Story 1 negative: Given the configuration resolves codex for `explore` and codex is missing while claude is installed, when the launcher resolves its host, then it does not fall back to claude or to any later ladder entry. | 6 | "a dispatchEngineer test asserts `spawnHost` was called exactly once and never with the claude executable, and the mocked provider discovery function and any version argv were never invoked" | diff-local |
| Story 2 happy: Given claude is selected and `CONDUCT_ENGINEER_PERMISSION_MODE` is unset, when the launcher spawns, then the argv is `--permission-mode default /composer`. | 4 | "a dispatchEngineer launch test asserts the `spawnHost` argv is `--permission-mode default /composer` for claude with no idea, ends with `/composer add retries` for claude with that idea, is exactly `$composer add retries` for codex with that idea, and is exactly `$composer` for codex with no idea" | diff-local |
| Story 2 happy: Given claude is selected and the operator passed `--idea "add retries"`, when the launcher spawns, then the final argv element is `/composer add retries`. | 4 | "a dispatchEngineer launch test asserts the `spawnHost` argv is `--permission-mode default /composer` for claude with no idea, ends with `/composer add retries` for claude with that idea, is exactly `$composer add retries` for codex with that idea, and is exactly `$composer` for codex with no idea" | diff-local |
| Story 2 happy: Given codex is selected and the operator passed `--idea "add retries"`, when the launcher spawns, then the argv is exactly one positional prompt `$composer add retries`, with no sandbox, approval, or model flags. | 4 | "a dispatchEngineer launch test asserts the `spawnHost` argv is `--permission-mode default /composer` for claude with no idea, ends with `/composer add retries` for claude with that idea, is exactly `$composer add retries` for codex with that idea, and is exactly `$composer` for codex with no idea" | diff-local |
| Story 2 happy: Given codex is selected and no idea is passed, when the launcher spawns, then the argv is exactly one positional prompt `$composer`. | 4 | "a dispatchEngineer launch test asserts the `spawnHost` argv is `--permission-mode default /composer` for claude with no idea, ends with `/composer add retries` for claude with that idea, is exactly `$composer add retries` for codex with that idea, and is exactly `$composer` for codex with no idea" | diff-local |
| Story 2 negative: Given `llm_provider: pi` is configured and pi does not declare `interactiveLaunch`, when the operator runs bare `ai-conductor compose`, then it exits non-zero with a message naming pi, `interactiveLaunch`, and #1007, and spawns nothing. | 5 | "a dispatchEngineer test with run-level `llm_provider` pi asserts a non-zero exit, a printed message naming pi, interactiveLaunch, and #1007, and zero `spawnHost` calls" | diff-local |
| Story 2 negative: Given claude is selected and `CONDUCT_ENGINEER_PERMISSION_MODE=plan`, when the launcher spawns, then the argv carries `--permission-mode default`, as it does today. | 5 | "a dispatchEngineer test with claude selected and `CONDUCT_ENGINEER_PERMISSION_MODE` set to plan asserts the `spawnHost` argv carries `--permission-mode` followed by `default`" | diff-local |
| Story 2 negative: Given production source outside the catalog and adapter modules, when the provider-id-literal structural test runs, then the compose launcher module contains no built-in provider id literal. | 4 | "a dispatchEngineer launch test asserts `spawnHost` receives the absolute `CODEX_EXECUTABLE` path when it is set, and receives `claude` for claude when `CLAUDE_EXECUTABLE` is unset, and the provider-id-literals structural test passes with `engineer-cli.ts` and `compose-launch-host.ts` in scope" | diff-local |
| Story 3 happy: Given codex is selected and `CODEX_EXECUTABLE` is set to an absolute path, when the launcher spawns, then that path is the spawned executable. | 4 | "a dispatchEngineer launch test asserts `spawnHost` receives the absolute `CODEX_EXECUTABLE` path when it is set, and receives `claude` for claude when `CLAUDE_EXECUTABLE` is unset, and the provider-id-literals structural test passes with `engineer-cli.ts` and `compose-launch-host.ts` in scope" | diff-local |
| Story 3 happy: Given claude is selected and `CLAUDE_EXECUTABLE` is unset, when the launcher spawns, then the executable is `claude` resolved from `PATH`. | 4 | "a dispatchEngineer launch test asserts `spawnHost` receives the absolute `CODEX_EXECUTABLE` path when it is set, and receives `claude` for claude when `CLAUDE_EXECUTABLE` is unset, and the provider-id-literals structural test passes with `engineer-cli.ts` and `compose-launch-host.ts` in scope" | diff-local |
| Story 3 negative: Given codex is selected and the spawn fails with ENOENT, when the launcher handles the failure, then it exits non-zero with a message naming codex, the executable `codex`, the override `CODEX_EXECUTABLE`, and the in-session alternative `$composer`. | 6 | "a dispatchEngineer test whose `spawnHost` rejects with ENOENT for codex asserts a non-zero exit and a printed message containing `codex`, the executable `codex`, `CODEX_EXECUTABLE`, and `$composer`" | diff-local |
| Story 3 negative: Given codex is selected and missing while claude is installed, when the spawn fails with ENOENT, then no claude session is spawned as a fallback. | 6 | "a dispatchEngineer test asserts `spawnHost` was called exactly once and never with the claude executable, and the mocked provider discovery function and any version argv were never invoked" | diff-local |
| Story 3 negative: Given any host is selected, when the launcher starts, then no provider version probe or boot discovery runs before the single spawn. | 6 | "a dispatchEngineer test with claude selected and a succeeding `spawnHost` asserts exactly one `spawnHost` call and that the mocked provider discovery function and any version argv were never invoked before it" | diff-local |
| Story 4 happy: Given `CLAUDECODE` is set in the environment, when the operator runs bare `ai-conductor compose`, then it prints that `/composer` should be run directly, exits 0, and spawns nothing. | 7 | "a dispatchEngineer test with `CLAUDECODE` set asserts exit 0, printed text naming `/composer`, zero `spawnHost` calls, zero `prePoll` calls, and no `issue` subcommand sent to the `gh` stub" | diff-local |
| Story 4 happy: Given `CODEX_THREAD_ID` is set in the environment, when the operator runs bare `ai-conductor compose`, then it prints that `$composer` should be run directly, exits 0, and spawns nothing. | 7 | "a dispatchEngineer test with only `CODEX_THREAD_ID` set asserts exit 0, printed text naming `$composer`, zero `spawnHost` calls, and zero `prePoll` calls" | diff-local |
| Story 4 happy: Given no session marker of any capable host is set, when the operator runs bare `ai-conductor compose`, then the selected host is launched. | 7 | "a dispatchEngineer test with no session marker of any `interactiveLaunch` host set asserts exactly one `spawnHost` call for the selected host" | diff-local |
| Story 4 negative: Given only `CODEX_SESSION_ID` is set, when the operator runs bare `ai-conductor compose`, then it still refuses to nest, names `$composer`, and spawns nothing. | 7 | "a dispatchEngineer test with only `CODEX_SESSION_ID` set asserts exit 0, printed text naming `$composer`, zero `spawnHost` calls, and zero `prePoll` calls" | diff-local |
| Story 4 negative: Given `CODEX_THREAD_ID` is set and `--provider claude` is passed, when the operator runs bare `ai-conductor compose`, then it refuses to nest because the operator is inside a codex session, and spawns nothing. | 7 | "a dispatchEngineer test with `CODEX_THREAD_ID` set and `--provider claude` asserts exit 0, printed text naming `$composer`, and zero `spawnHost` calls" | diff-local |
| Story 4 negative: Given a session marker is set, when the launcher refuses to nest, then the intake pre-poll does not run and no GitHub issue is fetched or enqueued. | 7 | "a dispatchEngineer test with `CLAUDECODE` set asserts exit 0, printed text naming `/composer`, zero `spawnHost` calls, zero `prePoll` calls, and no `issue` subcommand sent to the `gh` stub" | diff-local |
| Story 5 happy: Given codex was selected and the first session exits 0, when the operator accepts launching another idea, then the second spawn is codex with `$composer` and no CLI idea appended. | 8 | "a two-iteration dispatchEngineer test with codex selected and an idea asserts both `spawnHost` calls use the codex executable, the first argv is exactly `$composer add retries`, and the second argv is exactly `$composer`" | diff-local |
| Story 5 negative: Given codex was selected and the second spawn fails with ENOENT, when the launcher handles it, then it exits non-zero with the same missing-executable message and does not prompt for another idea. | 6 | "a two-iteration dispatchEngineer test whose second `spawnHost` call rejects with ENOENT asserts a non-zero exit, the same missing-executable message, and `confirmAnother` called exactly once" | diff-local |
| Story 5 negative: Given codex was selected and the operator declines another idea, when the first session exits, then no second spawn occurs and the launcher exits with the first session's exit code. | 8 | "a dispatchEngineer test with codex selected where `confirmAnother` returns false asserts exactly one `spawnHost` call and a dispatch exit code equal to the first session exit code" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D1 | task | task-4 | the provider-id-literals structural test passes with `engineer-cli.ts` and `compose-launch-host.ts` in scope |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D2 | task | task-1 | a provider-catalog test asserts `requireProviderCapability` for pi and `interactiveLaunch` throws `ProviderCapabilityUnsupportedError` whose message names pi, interactiveLaunch, and #1007 |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D3 | no-change | none | Boot-time discovery ordering is unchanged; the compose launcher does not run it (D11) |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D4 | no-change | none | The not-installed startup failure for configured providers is unchanged and is not raised by compose |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D5 | no-change | none | The Pi adapter dispatch contract is unchanged |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D6 | no-change | none | Pi capability declarations are unchanged; Pi does not gain `interactiveLaunch` |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D7 | no-change | none | Live-coverage registry keying is unchanged; no provider id is added |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D8 | no-change | none | The non-probing subcommand scope is unchanged and still includes `compose` |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D9 | task | task-1, task-4 | a provider-catalog test asserts the claude descriptor session markers equal `CLAUDECODE` only and the codex descriptor session markers equal `CODEX_THREAD_ID` and `CODEX_SESSION_ID` |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D10 | task | task-2, task-4 | a compose-launch-host test asserts `resolveComposeLaunchHost` returns codex for run-level codex with no `explore` pin, codex for run-level `[codex, claude]` with no `explore` pin, and claude for run-level `[codex, claude]` with an `explore` pin of claude |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D11 | task | task-6, task-7 | a dispatchEngineer test asserts `spawnHost` was called exactly once and never with the claude executable, and the mocked provider discovery function and any version argv were never invoked |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
