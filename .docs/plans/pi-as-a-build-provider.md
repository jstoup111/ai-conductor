# Implementation Plan: Pi as a build provider

**Date:** 2026-09-24
**Design:** .docs/decisions/architecture-review-2026-09-24-pi-as-a-build-provider.md
**Stories:** .docs/stories/pi-as-a-build-provider.md
**Conflict check:** Clean as of 2026-09-24

## Summary

Replaces every hardcoded claude/codex site with one built-in provider catalog, adds boot-time installation discovery that registers only installed providers and fails fast on a configured-but-missing one, and adds Pi as a third built-in adapter. 22 tasks.

## Technical Approach

- **Catalog first.** `execution/provider-catalog.ts` holds a readonly descriptor table. Every other module reads ids, executables, env namespaces, homes, model policy, and capability flags from it. `BuiltInProviderId` is derived from the table. Provider-specific consumers take `ProviderWith<cap>` types via `requireProviderCapability`, which refuses by name (ADR D1, D2).
- **Refactor in three capability slices, then a mechanical lock.** Build-review, self-host, and the remaining runtime and contract sites move independently (Tasks 5 to 7). Task 8 then adds a TypeScript-parser structural test that fails on any provider id literal outside the catalog and adapter modules. That test is what makes "no hardcoded providers" durable.
- **Discovery and fail-fast at dispatching entry points only.** `engine/provider-discovery.ts` resolves each executable and runs its version argv through an injected runner. The default runner is guarded by `assertRealExecAllowed`, following the gh version floor precedent (search `probeGhVersion`). Registration takes the installed set. `validateProviderInstallation` runs before `validateRegisteredProviderSelections`, so a missing catalog id gets the distinct not-installed error (ADR D3, D4, D8). Non-dispatching subcommands never probe, which keeps CI subcommands such as `rate-card refresh` working on bare runners.
- **Pi adapter follows the codex adapter pattern.** The codex adapter is the precedent (search `parseCodexJsonl` and its failure-classification order in `codex-provider.ts`). Traits to preserve: one subprocess per invoke; line-wise JSONL parsing that skips non-JSON lines; ENOENT or exit 127 mapped to run-scope unavailable; anchored regexes with auth checked before model availability. Allowed variation: Pi event names and stderr texts. No auth or rate-limit signature is anchored in this feature (ADR D5 keeps unconfirmed signatures unclassified); a follow-up intake owns them.
- **Sequencing.** Catalog, then consumers, then the lock. Discovery runs in parallel with the refactor. Pi builds on the catalog. Boot wiring comes last, once validation and discovery exist.

## Prerequisites

- None. No BUILD step or default-suite test invokes a real Pi; the Pi live smoke leg is opt-in and credential-gated like the claude and codex legs. Pi auth and rate-limit classification is deferred to a follow-up intake.

## Tasks

### Task 1: Built-in provider catalog with derived id type and executable resolution
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing test: in `src/conductor/test/execution/provider-catalog.test.ts`, assert `BUILT_IN_PROVIDERS` ids equal claude, codex; `DEFAULT_PROVIDER` is claude; `resolveProviderExecutable` returns `CLAUDE_EXECUTABLE` when set and `claude` otherwise, and `CODEX_EXECUTABLE` or `codex` for codex.
2. Verify test fails (RED) — the module does not exist.
3. Implement: create `execution/provider-catalog.ts` exporting the readonly `BUILT_IN_PROVIDERS` descriptor table (id, adapter factory, default executable, override env var, version argv, env-prefix namespace, home variable and default home, model policy, capability flags), `BuiltInProviderId` derived from the table ids, `DEFAULT_PROVIDER`, `ProviderWith<cap>`, and `resolveProviderExecutable`. Claude and codex descriptors declare exactly the capabilities they exercise today; the claude descriptor gains the `CLAUDE_EXECUTABLE` override. Capability flags absent from a descriptor read as unsupported.
4. Verify test passes (GREEN).
5. Commit with message: "feat(providers): add the built-in provider catalog"

**Done when:**
- `execution/provider-catalog.ts` exports `BUILT_IN_PROVIDERS`, `BuiltInProviderId`, `DEFAULT_PROVIDER`, and `ProviderWith`, and `BuiltInProviderId` is derived from the table ids rather than written as a literal union
- a test asserts `resolveProviderExecutable` returns the `CLAUDE_EXECUTABLE` value when it is set to an absolute path and `claude` when it is unset
- a test asserts, for each of readiness, selfHost, readOnlyReview, reviewPolicyCatalog, supportsSessionResume, costSelfReporting, writeFence, and nativeSchema, a descriptor omitting that flag is reported unsupported by the catalog capability query

**Files likely touched:**
- src/conductor/src/execution/provider-catalog.ts — new catalog module
- src/conductor/test/execution/provider-catalog.test.ts — catalog tests

**Dependencies:** none

### Task 2: Capability refusal helper names provider, capability, and owner
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing test: in `src/conductor/test/execution/provider-catalog.test.ts`, assert `requireProviderCapability` throws for a descriptor lacking `selfHost` with a message containing the provider id, `selfHost`, and the owning intake reference, and returns a narrowed provider when the flag is declared.
2. Verify test fails (RED).
3. Implement: add `requireProviderCapability(id, capability)` to `execution/provider-catalog.ts`, returning `ProviderWith<cap>` or throwing `ProviderCapabilityUnsupportedError`; each capability maps to its owning intake (#1887 selfHost, #1886 readOnlyReview, #1888 reviewPolicyCatalog, #1889 costSelfReporting) in the catalog.
4. Verify test passes (GREEN).
5. Commit with message: "feat(providers): refuse unsupported provider capabilities by name"

**Done when:**
- `requireProviderCapability` throws `ProviderCapabilityUnsupportedError` whose message contains the provider id, the capability name, and the owning intake reference when the descriptor lacks the flag
- `requireProviderCapability` returns the provider narrowed to `ProviderWith<cap>` when the descriptor declares the flag

**Files likely touched:**
- src/conductor/src/execution/provider-catalog.ts — refusal helper
- src/conductor/test/execution/provider-catalog.test.ts — refusal tests

**Dependencies:** 1

### Task 3: Registration, model policy, and default provider come from the catalog
**Story:** 1
**Type:** refactor

**Steps:**
1. Write failing test: in `src/conductor/test/engine/plugin-loader.test.ts`, assert `registerBuiltins` given an installed set of every catalog id registers exactly the catalog ids as `llm_provider` plugins, and that `normalizeProviderSelection` of an absent key returns `[DEFAULT_PROVIDER]`.
2. Verify test fails (RED) — registration is hand-written per provider.
3. Implement: `registerBuiltins` and `registerCliBuiltins` iterate `BUILT_IN_PROVIDERS` filtered by an `installed` id set argument and call each descriptor factory; `BUILT_IN_PROVIDER_MODEL_POLICIES`, `hasBuiltInProviderModelPolicy`, `COST_SELF_REPORTING_PROVIDERS`, and the `provider-selection.ts` / `resolved-config.ts` / `step-runners.ts` claude defaults read the catalog.
4. Verify test passes (GREEN) and the existing claude and codex provider suites pass with their assertions unchanged.
5. Commit with message: "refactor(providers): register built-ins from the catalog"

**Done when:**
- a test asserts `registerBuiltins` given every catalog id as installed registers exactly the `BUILT_IN_PROVIDERS` ids as `llm_provider` plugins and no other built-in
- `provider-model-policy.ts` builds `BUILT_IN_PROVIDER_MODEL_POLICIES` and `COST_SELF_REPORTING_PROVIDERS` from descriptor fields, and the existing claude and codex model-policy tests pass with unchanged assertions
- a test asserts `normalizeProviderSelection` of an absent key returns `[DEFAULT_PROVIDER]`

**Files likely touched:**
- src/conductor/src/engine/plugin-loader.ts — catalog-driven registration
- src/conductor/src/engine/cli-builtins.ts — catalog-driven registration
- src/conductor/src/engine/provider-model-policy.ts — policies from descriptors
- src/conductor/src/engine/provider-selection.ts — default from catalog
- src/conductor/src/engine/resolved-config.ts — default from catalog
- src/conductor/test/engine/plugin-loader.test.ts — registration test

**Dependencies:** 1

### Task 4: Executable, env namespace, and invocation prefix come from descriptors
**Story:** 1
**Type:** refactor

**Steps:**
1. Write failing test: in `src/conductor/test/execution/child-environment.test.ts`, assert `REVIEW_PROVIDER_PREFIXES` equals the per-descriptor env-prefix namespaces; in `src/conductor/test/execution/claude-provider-spawn.test.ts`, assert a claude invoke with `CLAUDE_EXECUTABLE` set spawns that path.
2. Verify test fails (RED).
3. Implement: `child-environment.ts` derives its prefix map from the catalog; `codex-provider.ts`, `claude-provider.ts`, `step-runners.ts` (`reviewLaunchCommand`), `engineer-cli.ts`, and `self-host/token-liveness.ts` obtain executables through `resolveProviderExecutable`; `skill-invocation.ts` reads the invocation prefix from the descriptor.
4. Verify test passes (GREEN); the existing claude and codex argv and env tests pass unchanged.
5. Commit with message: "refactor(providers): resolve executables and env namespaces from descriptors"

**Done when:**
- a test asserts a claude invoke with `CLAUDE_EXECUTABLE` set to an absolute path spawns that path as the subprocess executable
- (Withdrawn 2026-09-28, as-built AB-4, operator decision: no pre-refactor review prefix map or production consumer ever existed, so `REVIEW_PROVIDER_PREFIXES` is dead code; Task 23 removes it.)
- the existing claude and codex argv, environment-prefix, and provider-home tests pass with unchanged assertions

**Files likely touched:**
- src/conductor/src/execution/child-environment.ts — prefixes from catalog
- src/conductor/src/execution/claude-provider.ts — executable via catalog
- src/conductor/src/execution/codex-provider.ts — executable via catalog
- src/conductor/src/engine/step-runners.ts — launch command via catalog
- src/conductor/src/engine/skill-invocation.ts — prefix via descriptor
- src/conductor/src/engine/engineer-cli.ts — executable via catalog
- src/conductor/src/engine/self-host/token-liveness.ts — executable via catalog
- src/conductor/test/execution/child-environment.test.ts — prefix test
- src/conductor/test/execution/claude-provider-spawn.test.ts — override test

**Dependencies:** 1

### Task 5: Build-review read-only review and policy paths narrow by capability
**Story:** 2
**Type:** refactor

**Steps:**
1. Write failing test: in `src/conductor/test/engine/build-review-policy-catalog.test.ts`, assert the review-policy catalog factory given provider pi throws `ProviderCapabilityUnsupportedError` naming provider `pi` and `reviewPolicyCatalog` and never calls the claude or codex discovery stubs.
2. Verify test fails (RED) — the factory throws a generic unsupported-provider error.
3. Implement: replace the `claude | codex` unions and branches in `build-review-policy-contract.ts`, `build-review-policy-resolver.ts`, the build-review paths of `step-runners.ts`, and the custom-policy read-only review admission check in `provider-execution.ts` with `ProviderWith<readOnlyReview>` / `ProviderWith<reviewPolicyCatalog>` obtained through `requireProviderCapability`, dispatching to the descriptor-registered discovery function.
4. Verify test passes (GREEN); existing build-review tests for claude and codex pass unchanged.
5. Commit with message: "refactor(build-review): narrow provider paths by capability"

**Done when:**
- a test asserts the review-policy catalog factory given provider pi throws `ProviderCapabilityUnsupportedError` naming provider `pi` and `reviewPolicyCatalog`, and that neither the claude nor the codex policy discovery stub was called
- build-review read-only review and policy modules accept `ProviderWith` capability types, and the existing claude and codex build-review tests pass with unchanged assertions
- the claude and codex catalog descriptors declare `readOnlyReview` and the pi descriptor does not, and the claude and codex adapter tests assert the engine's read-only review option maps to that provider's native read-only mode (ADR D2/D6 amendment by #2735)
- the custom-policy read-only review admission check refuses a candidate whose provider lacks `readOnlyReview` or whose read-only review mode is unavailable, without invoking it, as asserted by the provider-execution read-only admission tests
- no build_review launch path composes bubblewrap review containment: `src/conductor/src/engine/build-review-containment.ts` does not exist and no `build-review*` module under `src/conductor/src/engine` references `bwrap` (retired by adr-2026-09-10-portable-build-review-policy D5.1)

**Files likely touched:**
- src/conductor/src/engine/provider-execution.ts — read-only review admission via capability
- src/conductor/src/engine/build-review-policy-contract.ts — capability types
- src/conductor/src/engine/build-review-policy-resolver.ts — capability types
- src/conductor/src/engine/step-runners.ts — build-review dispatch via capability
- src/conductor/test/engine/build-review-policy-catalog.test.ts — refusal test

**Dependencies:** 2, 4

### Task 6: Self-host paths narrow by capability
**Story:** 2
**Type:** refactor

**Steps:**
1. Write failing test: in `src/conductor/test/engine/self-host/provider-home.test.ts`, assert preparing a self-host provider home for pi throws `ProviderCapabilityUnsupportedError` naming provider `pi`, `selfHost`, and `#1887` before any subprocess spawn stub is called.
2. Verify test fails (RED).
3. Implement: `SelfHostProviderId` becomes `ProviderWith<selfHost>`; `provider-home.ts`, `live-boundary.ts` volatile-state tables, `sandbox-build-env.ts`, `smoke-capability.ts`, and the self-host build-candidate preparation in `conductor.ts` read descriptor fields and obtain the provider through `requireProviderCapability`.
4. Verify test passes (GREEN); existing self-host tests pass unchanged.
5. Commit with message: "refactor(self-host): narrow provider paths by capability"

**Done when:**
- a test asserts preparing a self-host provider home for pi throws `ProviderCapabilityUnsupportedError` naming provider `pi`, `selfHost`, and `#1887`, and that the subprocess spawn stub was never called
- the existing self-host provider-home, live-boundary, and sandbox tests for claude and codex pass with unchanged assertions

**Files likely touched:**
- src/conductor/src/engine/self-host/provider-home.ts — capability types
- src/conductor/src/engine/self-host/live-boundary.ts — descriptor tables
- src/conductor/src/engine/self-host/sandbox-build-env.ts — descriptor fields
- src/conductor/src/engine/smoke-capability.ts — capability types
- src/conductor/src/engine/conductor.ts — self-host candidate prep via capability
- src/conductor/test/engine/self-host/provider-home.test.ts — refusal test

**Dependencies:** 2, 4

### Task 7: Remaining provider literals move to capabilities or descriptors
**Story:** 2
**Type:** refactor

**Steps:**
1. Write failing test: in `src/conductor/test/engine/provider-runtime.test.ts`, assert `readinessFor` returns undefined for a built-in runtime whose descriptor lacks `readiness`, and returns the thunk for codex.
2. Verify test fails (RED) — `builtIn` is derived from the model-policy map.
3. Implement: `provider-runtime.ts` derives `builtIn` and readiness eligibility from the catalog `readiness` capability; `llm-provider.ts` and `types/events.ts` provider literals become `BuiltInProviderId` or a capability type; `provider-execution.ts` native-schema scratch branch reads `nativeSchema`; `provider-diagnostics.ts`, `conductor.ts` auth handling and display names, `ci-fix.ts`, and `model-table-metadata.ts` read descriptor fields.
4. Verify test passes (GREEN).
5. Commit with message: "refactor(providers): derive runtime readiness and literals from the catalog"

**Done when:**
- a test asserts `readinessFor` returns undefined for a built-in runtime whose descriptor does not declare `readiness` and returns the readiness thunk for codex
- `provider-execution.ts` selects the native-schema scratch path from the `nativeSchema` capability, and the existing codex native-schema test passes with unchanged assertions

**Files likely touched:**
- src/conductor/src/engine/provider-runtime.ts — readiness via capability
- src/conductor/src/execution/llm-provider.ts — derived types
- src/conductor/src/types/events.ts — derived types
- src/conductor/src/engine/provider-execution.ts — nativeSchema capability
- src/conductor/src/execution/provider-diagnostics.ts — descriptor fields
- src/conductor/src/engine/conductor.ts — auth and display via descriptor
- src/conductor/src/engine/ci-fix.ts — executable via catalog
- src/conductor/src/engine/model-table-metadata.ts — descriptor fields
- src/conductor/test/engine/provider-runtime.test.ts — readiness test

**Dependencies:** 2, 4

### Task 8: Structural test bans provider id literals outside the catalog
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing test: `src/conductor/test/engine/provider-id-literals.test.ts` scans `src/conductor/src/**/*.ts` (excluding `execution/provider-catalog.ts` and each descriptor-declared adapter module) with the TypeScript parser for string-literal nodes equal to a `BUILT_IN_PROVIDERS` id and fails listing `file:line` for each; a fixture file containing `'codex'` proves it fails.
2. Verify test fails (RED) against the fixture.
3. Implement: remove any remaining literals the scan reports by routing them through the catalog; display strings come from the descriptor `displayName` field.
4. Verify test passes (GREEN) on production source.
5. Commit with message: "test(providers): ban built-in provider id literals outside the catalog"

**Done when:**
- `provider-id-literals.test.ts` parses production source with the TypeScript compiler API and fails listing file and line for every string-literal node equal to a catalog id outside the catalog and adapter modules
- a test asserts the scan reports a fixture file containing a codex id literal and reports zero findings on production source
- a test asserts a provider display string written literally in a fixture is reported, and production display strings come from the descriptor `displayName` field

**Files likely touched:**
- src/conductor/test/engine/provider-id-literals.test.ts — structural test
- src/conductor/src/execution/provider-catalog.ts — displayName field

**Dependencies:** 3, 5, 6, 7

### Task 9: Provider discovery probes installed executables
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: in `src/conductor/test/engine/provider-discovery.test.ts`, with an injected runner, assert `discoverInstalledProviders` reports claude and codex installed and pi missing with reason not-found when the resolver finds only the first two, and that a set override env var is the probed path.
2. Verify test fails (RED).
3. Implement: `engine/provider-discovery.ts` exports `discoverInstalledProviders({ env, runner, timeoutMs })`: resolves each descriptor executable (override env var, else PATH), runs its version argv through the injected runner concurrently, and returns `{ installed, missing: [{ id, reason }] }` with reason in the closed set not-found, not-executable, version-failed, timeout. The default runner calls `assertRealExecAllowed` before spawning (pattern: `probeGhVersion`).
4. Verify test passes (GREEN).
5. Commit with message: "feat(providers): discover installed provider executables"

**Done when:**
- a test asserts `discoverInstalledProviders` reports claude and codex installed and pi missing with reason `not-found` when only the claude and codex executables resolve and their version probes exit 0
- a test asserts that when a descriptor override env var is set, the injected runner receives the override path instead of the PATH lookup result
- a test asserts that when `CLAUDE_EXECUTABLE` names a path that does not exist, claude is reported missing with reason `not-found` and `validateProviderInstallation` then raises `ProviderNotInstalledError` for claude

**Files likely touched:**
- src/conductor/src/engine/provider-discovery.ts — new discovery module
- src/conductor/test/engine/provider-discovery.test.ts — discovery tests

**Dependencies:** 1

### Task 10: Discovery classifies each missing reason and guards real exec
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing test: in `src/conductor/test/engine/provider-discovery.test.ts`, assert reasons version-failed (probe exits 1), not-executable (EACCES), timeout (runner never resolves; discovery returns within timeout plus 100ms), and that calling without an injected runner under the test exec guard throws the guard error without spawning.
2. Verify test fails (RED).
3. Implement: map runner outcomes to the closed reason set in `provider-discovery.ts` with an exhaustive switch and a per-probe timeout race.
4. Verify test passes (GREEN).
5. Commit with message: "feat(providers): classify discovery failures"

**Done when:**
- a test asserts a version probe exiting 1 yields reason `version-failed` and an EACCES spawn error yields reason `not-executable`
- a test asserts a probe that never exits yields reason `timeout` and `discoverInstalledProviders` resolves within the timeout plus 100ms
- a test asserts calling `discoverInstalledProviders` without an injected runner while real exec is forbidden throws the `assertRealExecAllowed` error and spawns nothing

**Files likely touched:**
- src/conductor/src/engine/provider-discovery.ts — reason mapping
- src/conductor/test/engine/provider-discovery.test.ts — reason tests

**Dependencies:** 9

### Task 11: Discovery emits one event on the spine
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: in `src/conductor/test/engine/provider-discovery.test.ts`, assert a `provider_discovery` event with installed ids and missing ids with reasons is emitted exactly once through `ConductorEventEmitter` and persisted by `EventPersister` to `.pipeline/events.jsonl`.
2. Verify test fails (RED).
3. Implement: add the `provider_discovery` variant to the `ConductorEvent` union in `types/events.ts` and emit it from the boot helper that calls discovery.
4. Verify test passes (GREEN).
5. Commit with message: "feat(events): record provider discovery"

**Done when:**
- a test asserts exactly one `provider_discovery` event carrying the installed ids and each missing id with its reason is persisted to `.pipeline/events.jsonl` per boot
- the `provider_discovery` variant is a member of the `ConductorEvent` union in `types/events.ts`, and a test asserts `EventPersister` writes it and reads it back with the same installed and missing fields

**Files likely touched:**
- src/conductor/src/types/events.ts — new event variant
- src/conductor/src/engine/provider-discovery.ts — emit
- src/conductor/test/engine/provider-discovery.test.ts — event test

**Dependencies:** 9

### Task 12: Startup validation raises not-installed before unknown-provider
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing test: in `src/conductor/test/engine/provider-selection.test.ts`, assert `validateProviderInstallation` throws `ProviderNotInstalledError` for run-level pi, for `steps.build.llm_provider` codex, and for pi as a ladder entry, each message containing the provider id, the config path, and the discovery reason; assert a non-catalog unregistered name still throws the unknown-provider error; assert the unknown-provider available list contains installed ids only.
2. Verify test fails (RED).
3. Implement: add `validateProviderInstallation(config, discovery)` in `provider-selection.ts`, run before `validateRegisteredProviderSelections`, walking run-level, per-step, and every ladder entry.
4. Verify test passes (GREEN).
5. Commit with message: "feat(providers): fail startup on configured but uninstalled providers"

**Done when:**
- a test asserts `validateProviderInstallation` throws `ProviderNotInstalledError` for run-level pi, for `steps.build.llm_provider` codex, and for pi as a fallback-ladder entry, each message containing the provider id, the config path, and the discovery reason
- a test asserts a catalog id that is not installed raises `ProviderNotInstalledError` and not the unknown-provider error, and the unknown-provider available-names list contains installed ids only
- a test asserts a name that is neither a catalog id nor a registered plugin raises the existing unknown-provider error whose wording differs from `ProviderNotInstalledError`
- a test asserts `validateProviderInstallation` returns without error when every configured provider is installed

**Files likely touched:**
- src/conductor/src/engine/provider-selection.ts — installation validation
- src/conductor/test/engine/provider-selection.test.ts — validation tests

**Dependencies:** 9

### Task 13: Daemon and dispatching CLI boot run discovery and fail fast
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing test: in `src/conductor/test/engine/daemon-provider-boot.test.ts`, drive `runDaemonMode` with an injected discovery reporting pi missing and config `llm_provider: pi`, and assert non-zero exit, the not-installed message, and that the claim, worktree-create, and dispatch stubs were never called; with every provider installed assert boot proceeds and registers only installed ids. Repeat the missing case for the CLI `conduct run` path.
2. Verify test fails (RED).
3. Implement: `daemon-cli.ts` `runDaemonMode` and the provider-dispatching command paths in `index.ts` call discovery, emit the event, pass the installed set to `registerBuiltins` / `registerCliBuiltins`, and call `validateProviderInstallation` before `validateRegisteredProviderSelections`. Non-dispatching subcommands do not call discovery.
4. Verify test passes (GREEN).
5. Commit with message: "feat(daemon): discover providers at boot and fail fast"

**Done when:**
- a test asserts `runDaemonMode` with run-level pi configured and discovery reporting pi missing exits non-zero with the not-installed message naming pi, its config path, and the discovery reason, and never calls the claim, worktree-create, or dispatch stubs
- a test asserts `runDaemonMode` with every configured provider installed continues boot, raises no provider error, and registers only the installed ids
- a test asserts the CLI `conduct run` path with the same missing provider fails with the same not-installed error before any step dispatch stub is called
- a test asserts the CLI and daemon entry points given the same injected environment produce the same installed set
- a test asserts `runDaemonMode` with only claude and codex discovered registers claude and codex as `llm_provider` plugins and does not register pi

**Files likely touched:**
- src/conductor/src/daemon-cli.ts — boot wiring
- src/conductor/src/index.ts — CLI boot wiring
- src/conductor/test/engine/daemon-provider-boot.test.ts — boot integration tests

**Dependencies:** 3, 10, 11, 12

### Task 14: Non-dispatching subcommands skip discovery
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing test: in `src/conductor/test/engine/daemon-provider-boot.test.ts`, with discovery stubbed to report every provider missing, run the `rate-card refresh`, `overlap-scan`, and `render-diagrams` subcommand handlers and assert they complete and the discovery stub was never called.
2. Verify test fails (RED) if discovery is wired globally.
3. Implement: confine the discovery call in `index.ts` to the provider-dispatching command set declared next to the command table.
4. Verify test passes (GREEN).
5. Commit with message: "fix(cli): keep provider discovery off non-dispatching subcommands"

**Done when:**
- a test asserts the `rate-card refresh`, `overlap-scan`, and `render-diagrams` subcommands complete with no provider executable resolvable on PATH and the discovery stub never called
- the provider-dispatching command set is declared once beside the command table in `index.ts`, and a test asserts it contains the `conduct run` path and excludes `rate-card`, `overlap-scan`, and `render-diagrams`

**Files likely touched:**
- src/conductor/src/index.ts — dispatching command set
- src/conductor/test/engine/daemon-provider-boot.test.ts — subcommand test

**Dependencies:** 13

### Task 15: Pi descriptor and adapter spawn a fresh headless session
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing test: in `src/conductor/test/execution/pi-provider.test.ts`, with a fake subprocess factory, assert invoke spawns the resolved pi executable with `-p --no-session --mode json` and the prompt on stdin, passes no `--model`, and that a second invoke (retry) also carries `--no-session`.
2. Verify test fails (RED).
3. Implement: `execution/pi-provider.ts` `PiProvider` implementing only `invoke`, `supportsSessionResume = false`, and `lifecycleCapability.synchronousSpawnPermit`; add the pi descriptor to `BUILT_IN_PROVIDERS` with version argv `--version`, override env `PI_EXECUTABLE`, a single-rung model policy that passes no `--model`, and no selfHost, readOnlyReview, reviewPolicyCatalog, writeFence, nativeSchema, costSelfReporting, or readiness capability.
4. Verify test passes (GREEN).
5. Commit with message: "feat(providers): add the Pi adapter"

**Done when:**
- a test asserts `PiProvider.invoke` spawns the resolved pi executable with `-p --no-session --mode json`, writes the prompt to stdin, and passes no `--model` argument
- a test asserts a second invoke for a retried step also carries `--no-session`, and `PiProvider.supportsSessionResume` is false
- the pi descriptor declares no selfHost, readOnlyReview, reviewPolicyCatalog, writeFence, nativeSchema, costSelfReporting, or readiness capability, and a test asserts an ordinary build step with pi raises no capability refusal
- a test asserts `PiProvider` exposes only the `invoke` dispatch member and declares `lifecycleCapability.synchronousSpawnPermit` true
- a test asserts the pi descriptor model policy has exactly one rung and that rung carries no model id

**Files likely touched:**
- src/conductor/src/execution/pi-provider.ts — new adapter
- src/conductor/src/execution/provider-catalog.ts — pi descriptor
- src/conductor/test/execution/pi-provider.test.ts — adapter tests
- src/conductor/test/fixtures/pi/ — schema-built fake Pi streams

**Dependencies:** 1, 4

### Task 16: Pi JSONL stream parsing
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing test: in `src/conductor/test/execution/pi-provider.test.ts`, feed fixture streams constructed from the documented Pi `--mode json` event schema: a stream ending in a terminal assistant message with cumulative usage yields output equal to that message, attached usage, and cost state cost-unmetered; a stream with a malformed line still yields the terminal message; a stream with no terminal message and exit 0 yields a step failure naming the missing terminal message.
2. Verify test fails (RED).
3. Implement: parse stdout line by line in `pi-provider.ts`, skipping lines that fail `JSON.parse` (pattern: codex `parseCodexJsonl` keeps parsing past non-JSON diagnostics), tracking the last terminal assistant message and cumulative `usage`.
4. Verify test passes (GREEN).
5. Commit with message: "feat(providers): parse the Pi JSONL stream"

**Done when:**
- a test asserts a fixture stream ending in a terminal assistant message with exit 0 yields an invoke result whose output equals that message and whose step reaches a normal verdict
- a test asserts cumulative usage from the stream is attached to the invoke result and its cost state is `cost-unmetered`
- a test asserts a stream containing a malformed line still yields the terminal message as output, the malformed line being ignored
- a test asserts a stream with no terminal assistant message and exit 0 yields a step failure whose reason names the missing terminal message

**Files likely touched:**
- src/conductor/src/execution/pi-provider.ts — stream parser
- src/conductor/test/execution/pi-provider.test.ts — parser tests
- src/conductor/test/fixtures/pi/ — schema-built streams

**Dependencies:** 15

### Task 17: Pi abort terminates the subprocess
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing test: in `src/conductor/test/execution/pi-provider.test.ts`, abort the signal while the fake Pi subprocess is running and assert the subprocess receives a kill and the result is an aborted step, not a success.
2. Verify test fails (RED).
3. Implement: wire the invoke abort signal to the subprocess kill in `pi-provider.ts`, matching the codex adapter abort path.
4. Verify test passes (GREEN).
5. Commit with message: "feat(providers): abort running Pi invocations"

**Done when:**
- a test asserts aborting the invoke signal while Pi runs kills the fake subprocess and the invoke result is an aborted step rather than a success
- a test asserts the aborted invoke result sets no provider failure signal, so an abort never advances the fallback ladder

**Files likely touched:**
- src/conductor/src/execution/pi-provider.ts — abort wiring
- src/conductor/test/execution/pi-provider.test.ts — abort test

**Dependencies:** 15

### Task 18: Pi failure classification
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing test: in `src/conductor/test/execution/pi-provider.test.ts`, assert ENOENT and exit 127 yield `providerUnavailable` with scope run; stderr `Error: Model "x" not found. Use --list-models to see available models.` with exit 1 yields `modelUnavailable`; unmatched non-zero exit yields a step failure with no provider signal; and auth or rate-limit style stderr sets neither `authFailure` nor `rateLimited`.
2. Verify test fails (RED).
3. Implement: classifier in `pi-provider.ts` ordered like the codex adapter (unavailable, auth, rate limit, model). Anchor no auth-failure or rate-limit regex (deferred to a follow-up intake); such output stays an unclassified step failure. No test or BUILD step invokes a real Pi.
4. Verify test passes (GREEN).
5. Commit with message: "feat(providers): classify Pi failures"

**Done when:**
- a test asserts ENOENT and exit 127 each yield `providerUnavailable` with `providerUnavailableScope` run
- a test asserts stderr `Error: Model "x" not found. Use --list-models to see available models.` with exit 1 yields `modelUnavailable`
- a test asserts a non-zero exit whose stderr matches no anchored signature yields a step failure with no provider signal set
- `pi-provider.ts` anchors no auth-failure or rate-limit regex, and a test asserts Pi auth-failure and rate-limit style stderr with a non-zero exit yields a step failure with neither `authFailure` nor `rateLimited` set

**Files likely touched:**
- src/conductor/src/execution/pi-provider.ts — classifier
- src/conductor/test/execution/pi-provider.test.ts — classification tests

**Dependencies:** 16

### Task 19: Pi participates in the candidate-fallback ladder
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing test: in `src/conductor/test/engine/provider-execution-pi-fallback.test.ts`, parameterized over pi and codex as the first rung returning run-scope `providerUnavailable`, assert identical advance to the claude fake; and assert run-level and per-step `llm_provider: pi` each reach a normal verdict through the fake Pi.
2. Verify test fails (RED).
3. Implement: no new mechanism expected; fix any id-branching the test exposes in `provider-execution.ts`.
4. Verify test passes (GREEN).
5. Commit with message: "test(providers): Pi advances the fallback ladder"

**Done when:**
- a test parameterized over pi and codex as the first rung asserts a run-scope `providerUnavailable` result causes identical advance to the claude fake and the step completes on claude
- a test asserts config `steps.build.llm_provider: pi` and run-level `llm_provider: pi` each dispatch to the fake Pi and the step reaches a normal verdict
- the existing claude and codex candidate-fallback tests pass with unchanged assertions

**Files likely touched:**
- src/conductor/test/engine/provider-execution-pi-fallback.test.ts — fallback test
- src/conductor/src/engine/provider-execution.ts — only if the test exposes id branching

**Dependencies:** 18

### Task 20: Live coverage enumerates catalog plus plugins with a Pi smoke leg
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing test: update the live-coverage structural test to iterate `BUILT_IN_PROVIDERS` ids together with registered external plugin ids and assert each has a `live-e2e-providers.ts` entry and a smoke leg; assert it runs with discovery reporting no provider installed.
2. Verify test fails (RED) — pi has no entry or leg.
3. Implement: key `live-e2e-providers.ts` by catalog ids and add the pi entry; add `test/engine/daemon-e2e-live-pi.smoke.test.ts` that runs a trivial Pi step when Pi credentials are present and live tests are opted in, and skips with a named reason when they are absent.
4. Verify test passes (GREEN).
5. Commit with message: "test(live): cover Pi in the live provider tier"

**Done when:**
- the live-coverage structural test iterates `BUILT_IN_PROVIDERS` together with registered external plugin ids and a test asserts a registered fixture plugin is enumerated
- a test asserts the live-coverage structural test requires the pi entry and smoke leg while discovery reports no provider installed
- `live-e2e-providers.ts` is keyed by catalog ids, contains a pi entry, and `daemon-e2e-live-pi.smoke.test.ts` runs a trivial Pi step through the real Pi CLI when credentials are present and live tests are opted in, and asserts that step completes
- a test asserts the Pi smoke leg skips with a named reason when Pi credentials are absent and makes no real Pi call

**Files likely touched:**
- src/conductor/src/engine/live-e2e-providers.ts — catalog-keyed with pi
- src/conductor/test/engine/daemon-e2e-live-pi.smoke.test.ts — Pi live leg
- src/conductor/test/engine/live-provider-coverage.test.ts — structural test

**Dependencies:** 15

### Task 21: Boot discovery ordering, per-scope exits, and existing boot tests
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing test: in `src/conductor/test/engine/daemon-provider-boot.test.ts`, assert `runDaemonMode` exits non-zero with the not-installed error for a missing `steps.build.llm_provider` codex and for a pi-then-claude ladder with pi missing; assert in both `runDaemonMode` and the CLI boot that discovery runs before `registerBuiltins` / `registerCliBuiltins` and exactly one `provider_discovery` event is persisted.
2. Verify test fails (RED).
3. Implement: give existing `runDaemonMode` and CLI boot tests an injected all-installed discovery runner through the shared boot test helper; adjust event-sequence assertions only for the added `provider_discovery` event.
4. Verify test passes (GREEN).
5. Commit with message: "test(daemon): pin provider discovery ordering at boot"

**Done when:**
- a test asserts `runDaemonMode` exits non-zero with the not-installed error naming the config path for a missing `steps.build.llm_provider` codex and for a pi-then-claude ladder whose pi entry is missing
- a test asserts in both `runDaemonMode` and the CLI boot path that discovery runs before `registerBuiltins` or `registerCliBuiltins` and exactly one `provider_discovery` event is persisted
- existing `runDaemonMode` and CLI boot tests pass with an injected all-installed discovery runner and their event-sequence assertions change only by the added `provider_discovery` event

**Files likely touched:**
- src/conductor/test/engine/daemon-provider-boot.test.ts — ordering and scope tests
- src/conductor/test/engine/boot-test-helpers.ts — injected discovery runner

**Dependencies:** 13

### Task 22: Pi smoke leg runs over the shared live run body without self-host
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing test: in `src/conductor/test/engine/live-e2e-shared-body.test.ts`, assert `daemon-e2e-live-pi.smoke.test.ts` supplies only its descriptor to `defineLiveE2EProviderSmoke`, and assert a descriptor without `selfHostExecutable` drives the shared run body with no self-host wrapper while the claude and codex descriptors still receive it.
2. Verify test fails (RED) — the Pi leg invokes `PiProvider` directly and the run body requires a self-host executable.
3. Implement: make `selfHostExecutable` optional on the live descriptor and apply the self-host wrapper in `test/fixtures/live-e2e-run-body.ts` only when it is present; rewrite `daemon-e2e-live-pi.smoke.test.ts` as a thin file that calls `defineLiveE2EProviderSmoke` with the pi descriptor. Pi still refuses the `selfHost` capability (Task 6); self-host Pi stays with #1887.
4. Verify test passes (GREEN).
5. Commit with message: "test(live): run the Pi smoke leg over the shared run body"

**Done when:**
- `daemon-e2e-live-pi.smoke.test.ts` supplies only its descriptor to `defineLiveE2EProviderSmoke`, the same shared run body the claude and codex legs use, and imports no provider adapter directly
- a test asserts a live descriptor without `selfHostExecutable` drives the shared seed, provision, preflight, meter, `runDaemon`, assert sequence with no self-host wrapper, while the claude and codex descriptors still receive the self-host wrapper
- a test asserts preparing a self-host provider home for pi still throws `ProviderCapabilityUnsupportedError` naming `#1887` after this change

**Files likely touched:**
- src/conductor/test/fixtures/live-e2e-run-body.ts — self-host wrapper conditional on descriptor
- src/conductor/test/fixtures/live-e2e-providers.ts — optional self-host executable
- src/conductor/test/engine/daemon-e2e-live-pi.smoke.test.ts — thin shared-body leg
- src/conductor/test/engine/live-e2e-shared-body.test.ts — structural assertion

**Dependencies:** 20

### Task 23: Remove the unconsumed REVIEW_PROVIDER_PREFIXES export
**Story:** 1
**Type:** refactor

**Steps:**
1. Confirm with a repository search that `REVIEW_PROVIDER_PREFIXES` has no reader under `src/conductor/src`.
2. Remove the export from `src/conductor/src/execution/child-environment.ts` and its assertion and import from `src/conductor/test/execution/child-environment.test.ts`.
3. Verify the child-environment tests pass and the TypeScript build succeeds.
4. Commit with message: "refactor(providers): remove the unconsumed REVIEW_PROVIDER_PREFIXES export"

**Done when:**
- a repository search for `REVIEW_PROVIDER_PREFIXES` under `src/conductor` returns no match
- the child-environment tests pass and `tsc --noEmit` succeeds

**Files likely touched:**
- src/conductor/src/execution/child-environment.ts — remove dead export
- src/conductor/test/execution/child-environment.test.ts — remove its assertion

**Dependencies:** 4

## Task Dependency Graph

```text
Task 1 <- none
Task 2 <- 1
Task 3 <- 1
Task 4 <- 1
Task 5 <- 2, 4
Task 6 <- 2, 4
Task 7 <- 2, 4
Task 8 <- 3, 5, 6, 7
Task 9 <- 1
Task 10 <- 9
Task 11 <- 9
Task 12 <- 9
Task 13 <- 3, 10, 11, 12
Task 14 <- 13
Task 15 <- 1, 4
Task 16 <- 15
Task 17 <- 15
Task 18 <- 16
Task 19 <- 18
Task 20 <- 15
Task 21 <- 13
Task 22 <- 20
```

## Integration Points

- After Task 7: claude and codex run entirely through the catalog, with behavior unchanged.
- After Task 13: daemon and `conduct run` boot with discovery; a configured-but-missing provider stops boot.
- After Task 19: `llm_provider: [pi, claude]` dispatches through Pi and falls back to claude.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the catalog declares claude, codex, and pi, when the engine boots with all three installed, then the registered llm_provider ids are exactly the catalog ids. | 3 | "a test asserts `registerBuiltins` given every catalog id as installed registers exactly the `BUILT_IN_PROVIDERS` ids as `llm_provider` plugins and no other built-in" | diff-local |
| Story 1 happy: Given an existing claude or codex configuration, when a step dispatches after the refactor, then the argv, environment prefixes, provider home, model ladder, and fallback behavior equal the pre-refactor behavior. | 4, 3, 19 | "the existing claude and codex argv, environment-prefix, and provider-home tests pass with unchanged assertions" | diff-local |
| Story 1 happy: Given `CLAUDE_EXECUTABLE` is set to an absolute path, when a claude step dispatches, then that path is the spawned executable. | 4 | "a test asserts a claude invoke with `CLAUDE_EXECUTABLE` set to an absolute path spawns that path as the subprocess executable" | diff-local |
| Story 1 negative: Given a production source file outside the catalog and the provider's own adapter module, when it contains a built-in provider id literal, then the structural test fails naming the file and line. | 8 | "`provider-id-literals.test.ts` parses production source with the TypeScript compiler API and fails listing file and line for every string-literal node equal to a catalog id outside the catalog and adapter modules" | diff-local |
| Story 1 negative: Given a user-facing display string that names a provider, when the structural test runs, then it passes only if the string is supplied by the catalog descriptor rather than written literally. | 8 | "a test asserts a provider display string written literally in a fixture is reported, and production display strings come from the descriptor `displayName` field" | diff-local |
| Story 1 negative: Given `CLAUDE_EXECUTABLE` names a path that does not exist, when the engine boots with claude configured, then startup fails with the not-installed error for claude naming reason not-found. | 9 | "a test asserts that when `CLAUDE_EXECUTABLE` names a path that does not exist, claude is reported missing with reason `not-found` and `validateProviderInstallation` then raises `ProviderNotInstalledError` for claude" | diff-local |
| Story 2 happy: Given claude and codex declare their current capabilities, when self-host, build-review read-only review, and review-policy catalog paths run for them, then behavior is unchanged. | 5, 6 | "build-review read-only review and policy modules accept `ProviderWith` capability types, and the existing claude and codex build-review tests pass with unchanged assertions" | diff-local |
| Story 2 happy: Given pi is selected for an ordinary build step, when the step dispatches, then no capability refusal occurs. | 15 | "the pi descriptor declares no selfHost, readOnlyReview, reviewPolicyCatalog, writeFence, nativeSchema, costSelfReporting, or readiness capability, and a test asserts an ordinary build step with pi raises no capability refusal" | diff-local |
| Story 2 negative: Given pi is selected for a path that requires the selfHost capability, when that path is reached, then it fails before spawning with an error naming provider pi, capability selfHost, and the owning intake. | 6 | "a test asserts preparing a self-host provider home for pi throws `ProviderCapabilityUnsupportedError` naming provider `pi`, `selfHost`, and `#1887`, and that the subprocess spawn stub was never called" | diff-local |
| Story 2 negative: Given pi is selected for build-review with a custom review policy, when the review-policy catalog path is reached, then it fails naming capability reviewPolicyCatalog instead of falling into the codex or claude branch. | 5 | "a test asserts the review-policy catalog factory given provider pi throws `ProviderCapabilityUnsupportedError` naming provider `pi` and `reviewPolicyCatalog`, and that neither the claude nor the codex policy discovery stub was called" | diff-local |
| Story 2 negative: Given a descriptor omits a capability flag, when any consumer queries it, then the capability is treated as unsupported. | 1 | "a test asserts, for each of readiness, selfHost, readOnlyReview, reviewPolicyCatalog, supportsSessionResume, costSelfReporting, writeFence, and nativeSchema, a descriptor omitting that flag is reported unsupported by the catalog capability query" | diff-local |
| Story 3 happy: Given claude and codex executables resolve and their version probes exit 0 and pi is absent, when the daemon boots, then claude and codex are registered and pi is not. | 13, 9 | "a test asserts `runDaemonMode` with only claude and codex discovered registers claude and codex as `llm_provider` plugins and does not register pi" | diff-local |
| Story 3 happy: Given a provider executable override env var is set, when discovery runs, then the override path is probed instead of the PATH lookup. | 9 | "a test asserts that when a descriptor override env var is set, the injected runner receives the override path instead of the PATH lookup result" | diff-local |
| Story 3 happy: Given discovery completes, when the event log is read, then one provider-discovery event lists the installed ids and each missing id with its reason. | 11 | "a test asserts exactly one `provider_discovery` event carrying the installed ids and each missing id with its reason is persisted to `.pipeline/events.jsonl` per boot" | diff-local |
| Story 3 happy: Given the CLI entry point boots, when discovery runs, then it produces the same installed set as the daemon for the same environment. | 13 | "a test asserts the CLI and daemon entry points given the same injected environment produce the same installed set" | diff-local |
| Story 3 negative: Given an executable resolves but its version probe exits non-zero, when discovery runs, then that provider is missing with reason version-failed. | 10 | "a test asserts a version probe exiting 1 yields reason `version-failed` and an EACCES spawn error yields reason `not-executable`" | diff-local |
| Story 3 negative: Given an executable resolves but is not executable, when discovery runs, then that provider is missing with reason not-executable. | 10 | "a test asserts a version probe exiting 1 yields reason `version-failed` and an EACCES spawn error yields reason `not-executable`" | diff-local |
| Story 3 negative: Given a version probe does not exit within the probe timeout, when discovery runs, then that provider is missing with reason timeout and boot is not delayed beyond the timeout. | 10 | "a test asserts a probe that never exits yields reason `timeout` and `discoverInstalledProviders` resolves within the timeout plus 100ms" | diff-local |
| Story 3 negative: Given the test environment forbids real exec, when discovery runs without an injected runner, then it throws the real-exec guard error rather than spawning. | 10 | "a test asserts calling `discoverInstalledProviders` without an injected runner while real exec is forbidden throws the `assertRealExecAllowed` error and spawns nothing" | diff-local |
| Story 4 happy: Given every provider named in config is installed, when the daemon boots, then startup continues and no provider error is raised. | 12, 13 | "a test asserts `validateProviderInstallation` returns without error when every configured provider is installed" | diff-local |
| Story 4 negative: Given run-level `llm_provider: pi` and pi is not installed, when the daemon boots, then it exits non-zero with an error naming provider pi, the config path, and the discovery reason. | 13, 12 | "a test asserts `runDaemonMode` with run-level pi configured and discovery reporting pi missing exits non-zero with the not-installed message naming pi, its config path, and the discovery reason, and never calls the claim, worktree-create, or dispatch stubs" | diff-local |
| Story 4 negative: Given `steps.build.llm_provider` names codex and codex is not installed, when the daemon boots, then the error names the step config path. | 21, 12 | "a test asserts `runDaemonMode` exits non-zero with the not-installed error naming the config path for a missing `steps.build.llm_provider` codex and for a pi-then-claude ladder whose pi entry is missing" | diff-local |
| Story 4 negative: Given a fallback ladder of pi then claude and only claude is installed, when the daemon boots, then startup fails naming pi rather than silently dropping it from the ladder. | 21, 12 | "a test asserts `runDaemonMode` exits non-zero with the not-installed error naming the config path for a missing `steps.build.llm_provider` codex and for a pi-then-claude ladder whose pi entry is missing" | diff-local |
| Story 4 negative: Given config names an id that is neither a catalog id nor a registered plugin, when the daemon boots, then the existing unknown-provider error is raised, worded differently from the not-installed error. | 12 | "a test asserts a name that is neither a catalog id nor a registered plugin raises the existing unknown-provider error whose wording differs from `ProviderNotInstalledError`" | diff-local |
| Story 4 negative: Given config names catalog id pi and pi is not installed, when startup validation runs, then the not-installed error is raised and the unknown-provider error is not, and any available-names list shows installed providers only. | 12 | "a test asserts a catalog id that is not installed raises `ProviderNotInstalledError` and not the unknown-provider error, and the unknown-provider available-names list contains installed ids only" | diff-local |
| Story 4 negative: Given no provider CLI is installed on the machine, when a subcommand that never dispatches a provider runs (for example rate-card refresh or overlap-scan), then it neither probes provider executables nor fails for a missing provider. | 14 | "a test asserts the `rate-card refresh`, `overlap-scan`, and `render-diagrams` subcommands complete with no provider executable resolvable on PATH and the discovery stub never called" | diff-local |
| Story 4 negative: Given the CLI entry point with the same missing provider, when a conduct run starts, then it fails with the same not-installed error before any step dispatches. | 13 | "a test asserts the CLI `conduct run` path with the same missing provider fails with the same not-installed error before any step dispatch stub is called" | diff-local |
| Story 5 happy: Given pi is installed and selected for a step, when the step dispatches, then Pi is spawned with print mode, no session, and JSON mode, with the prompt on stdin. | 15 | "a test asserts `PiProvider.invoke` spawns the resolved pi executable with `-p --no-session --mode json`, writes the prompt to stdin, and passes no `--model` argument" | diff-local |
| Story 5 happy: Given Pi emits a JSONL stream ending in a terminal assistant message and exits 0, when the adapter parses it, then the invoke result carries that message as output and the step reaches its normal verdict. | 16, 19 | "a test asserts a fixture stream ending in a terminal assistant message with exit 0 yields an invoke result whose output equals that message and whose step reaches a normal verdict" | diff-local |
| Story 5 happy: Given Pi reports cumulative usage in the stream, when the invoke result is built, then the usage is attached and the cost is recorded as cost-unmetered. | 16 | "a test asserts cumulative usage from the stream is attached to the invoke result and its cost state is `cost-unmetered`" | diff-local |
| Story 5 happy: Given a step retries after a failure, when Pi is invoked again, then the retry also runs with no session and never resumes a prior one. | 15 | "a test asserts a second invoke for a retried step also carries `--no-session`, and `PiProvider.supportsSessionResume` is false" | diff-local |
| Story 5 negative: Given Pi exits 0 but the stream contains no terminal assistant message, when the adapter parses it, then the invoke result is a step failure naming the missing terminal message. | 16 | "a test asserts a stream with no terminal assistant message and exit 0 yields a step failure whose reason names the missing terminal message" | diff-local |
| Story 5 negative: Given a JSONL line is malformed, when the adapter parses the stream, then that line is ignored and the result is still derived from the valid terminal message if present. | 16 | "a test asserts a stream containing a malformed line still yields the terminal message as output, the malformed line being ignored" | diff-local |
| Story 5 negative: Given Pi is running, when its invoke's abort signal fires, then the Pi subprocess is terminated and the result is an aborted step, not a success (codex parity; no production caller aborts a running ordinary step for any provider today, operator decision 2026-09-28 on as-built AB-9). | 17 | "a test asserts aborting the invoke signal while Pi runs kills the fake subprocess and the invoke result is an aborted step rather than a success" | diff-local |
| Story 6 happy: Given a ladder of pi then claude, when Pi fails with a run-scope unavailable signal, then the run advances to claude exactly as it would from codex. | 19 | "a test parameterized over pi and codex as the first rung asserts a run-scope `providerUnavailable` result causes identical advance to the claude fake and the step completes on claude" | diff-local |
| Story 6 happy: Given Pi reports its unknown-model error on stderr and exits 1, when the adapter classifies it, then the result carries the model-unavailable signal. | 18 | "a test asserts stderr `Error: Model "x" not found. Use --list-models to see available models.` with exit 1 yields `modelUnavailable`" | diff-local |
| Story 6 negative: Given the Pi executable disappears after boot, when a step spawns Pi, then ENOENT or exit 127 maps to provider-unavailable with run scope. | 18 | "a test asserts ENOENT and exit 127 each yield `providerUnavailable` with `providerUnavailableScope` run" | diff-local |
| Story 6 negative: Given Pi exits non-zero with stderr matching no confirmed signature, when the adapter classifies it, then the result is an ordinary step failure with no provider signal set. | 18 | "a test asserts a non-zero exit whose stderr matches no anchored signature yields a step failure with no provider signal set" | diff-local |
| Story 6 negative: Given Pi exits non-zero with auth-failure or rate-limit output, when the adapter classifies it, then the result is an ordinary step failure with no auth-failure or rate-limited signal set, because no Pi auth or rate-limit signature is anchored in this feature. | 18 | "`pi-provider.ts` anchors no auth-failure or rate-limit regex, and a test asserts Pi auth-failure and rate-limit style stderr with a non-zero exit yields a step failure with neither `authFailure` nor `rateLimited` set" | diff-local |
| Story 7 happy: Given the catalog includes pi, when the live-coverage structural test runs, then it finds a Pi descriptor entry and a Pi live smoke leg. | 20 | "`live-e2e-providers.ts` is keyed by catalog ids, contains a pi entry, and `daemon-e2e-live-pi.smoke.test.ts` runs a trivial Pi step through the real Pi CLI when credentials are present and live tests are opted in, and asserts that step completes" | diff-local |
| Story 7 happy: Given an external `llm_provider` plugin is registered, when the live-coverage structural test runs, then that plugin is enumerated alongside the catalog ids. | 20 | "the live-coverage structural test iterates `BUILT_IN_PROVIDERS` together with registered external plugin ids and a test asserts a registered fixture plugin is enumerated" | diff-local |
| Story 7 happy: Given Pi credentials are present and live tests are opted in, when the Pi smoke leg runs, then a trivial Pi step completes through the real CLI. | 20 | "`live-e2e-providers.ts` is keyed by catalog ids, contains a pi entry, and `daemon-e2e-live-pi.smoke.test.ts` runs a trivial Pi step through the real Pi CLI when credentials are present and live tests are opted in, and asserts that step completes" | diff-local |
| Story 7 negative: Given a test machine without Pi installed, when the live-coverage structural test runs, then it still requires the Pi entry because it enumerates the catalog plus registered plugins, not discovered providers. | 20 | "a test asserts the live-coverage structural test requires the pi entry and smoke leg while discovery reports no provider installed" | diff-local |
| Story 7 negative: Given Pi credentials are absent, when the live smoke suite runs, then the Pi leg is skipped with a named reason and the default suite makes no real Pi call. | 20 | "a test asserts the Pi smoke leg skips with a named reason when Pi credentials are absent and makes no real Pi call" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D1 | task | task-1, task-8 | `provider-id-literals.test.ts` parses production source with the TypeScript compiler API and fails listing file and line for every string-literal node equal to a catalog id outside the catalog and adapter modules |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D2 | task | task-1, task-2, task-5, task-6, task-7 | a test asserts, for each of readiness, selfHost, readOnlyReview, reviewPolicyCatalog, supportsSessionResume, costSelfReporting, writeFence, and nativeSchema, a descriptor omitting that flag is reported unsupported by the catalog capability query |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D3 | task | task-9, task-10, task-11, task-21 | a test asserts in both `runDaemonMode` and the CLI boot path that discovery runs before `registerBuiltins` or `registerCliBuiltins` and exactly one `provider_discovery` event is persisted |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D4 | task | task-12, task-13, task-21 | a test asserts `runDaemonMode` with run-level pi configured and discovery reporting pi missing exits non-zero with the not-installed message naming pi, its config path, and the discovery reason, and never calls the claim, worktree-create, or dispatch stubs |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D5 | task | task-15, task-16, task-18 | a test asserts `PiProvider` exposes only the `invoke` dispatch member and declares `lifecycleCapability.synchronousSpawnPermit` true |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D6 | task | task-15, task-16 | a test asserts the pi descriptor model policy has exactly one rung and that rung carries no model id |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D7 | task | task-20 | the live-coverage structural test iterates `BUILT_IN_PROVIDERS` together with registered external plugin ids and a test asserts a registered fixture plugin is enumerated |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D8 | task | task-12, task-14 | a test asserts the `rate-card refresh`, `overlap-scan`, and `render-diagrams` subcommands complete with no provider executable resolvable on PATH and the discovery stub never called |
| adr-2026-08-12-live-provider-coverage-from-plugin-registry#D1 | task | task-20 | a test asserts the live-coverage structural test requires the pi entry and smoke leg while discovery reports no provider installed |
| adr-2026-07-20-ci-fix-startup-preflight-and-error-classification#D1 | no-change | none | This feature adds no ci-fix startup preflight or veto; the 2026-09-11 amendment already removed the Claude-only veto, and boot discovery is provider-neutral and catalog-driven under the new ADR D3. |
| adr-2026-07-20-ci-fix-startup-preflight-and-error-classification#D2 | existing | none | Spawn failures are already classified at the adapter boundary that feeds the resolver: `execution/codex-provider.ts` and `execution/claude-provider.ts` map ENOENT or exit 127 to `providerUnavailable` with run scope and a classified reason. |
| adr-2026-07-20-ci-fix-startup-preflight-and-error-classification#D3 | task | task-12, task-13, task-19 | a test asserts `validateProviderInstallation` throws `ProviderNotInstalledError` for run-level pi, for `steps.build.llm_provider` codex, and for pi as a fallback-ladder entry, each message containing the provider id, the config path, and the discovery reason |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic

### Task rem-prd-audit-rem-s1-2-1: test/execution/claude-provider.test.ts and test/execution/codex-provider.test.ts: point the vi.mock seams at ../../src/execution/spawn-permit.js (validateSpawnPermit) and ../../src/execution/fresh-session.js (enforceFreshSessionOptions), then restore the assertions exactly as they were at merge-base 581eec5e6: expect(mockEnforceFreshSessionOptions).toHaveBeenCalledTimes(1) and toHaveBeenCalledWith(..., 'claude'/'codex'), expect(mockValidateSpawnPermit).toHaveBeenCalledWith(spawnPermit), the exact --session-id value assertion (not arrayContaining(['--session-id'])), and the original '...exactly once for a %s dispatch' test title. Preserves Task 4 Done-when and Story 1 criterion S1.2 coverage. Do not change production code.
**Gate:** prd-audit
**Rationale:** The diff removes 5 expect() lines from each of test/execution/claude-provider.test.ts and codex-provider.test.ts (spawn-permit, exactly-once fresh-session, and exact --session-id value assertions), which breaches Story 1 Done-When and Task 4's 'pass with unchanged assertions' bullet. Production still calls both guards (claude-provider.ts:588,665; codex-provider.ts:299,447) via the moved modules src/execution/spawn-permit.ts and src/execution/fresh-session.ts, so only the test mocks need retargeting. Sweep: the other changed claude tests (claude-provider-json-result, -token-usage, -spawn) remove no expect() lines, so they are excluded.
**Criterion:** S1.2
**Parent task:** 4
**Done when:**
- S1.2 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-s1-2-1 is complete.

### Task rem-prd-audit-rem-s5-7-1: test/engine/provider-execution*.test.ts (the existing candidate-execution suite): add a test that drives the candidate executor with a registered fake Pi runtime whose subprocess never exits, aborts the executor's abortSignal mid-invoke, and asserts that the adapter's invoke options carried that same signal, that the fake subprocess received kill(), and that the result is the aborted, not successful, outcome with no provider failure signal, so the fallback ladder does not advance. Also update test/execution/pi-provider.test.ts:146 to pass abortSignal as a typed InvokeOptions field instead of a cast, keeping its kill and no-signal assertions (Task 17 Done-when coverage) unchanged.
**Gate:** prd-audit
**Rationale:** pi-provider.ts:111 reads abortSignal through a local PiInvokeOptions cast. InvokeOptions (llm-provider.ts:287) has no abort field, and the candidate-options merge in provider-execution.ts:817-833 never passes the executor's abortSignal (:735, :925-942) to the adapter. As a result the lifecycle abort that Story 5 criterion S5.7 and Task 17 require never reaches Pi in production. The contract and caller wiring is task rem-ab1-1 under AB-1. This task adds the production-boundary proof that AB-1's resolution asks Task 17 to supply. It also keeps the existing pi-provider.test.ts:135 kill test, rewritten without the cast.
**Criterion:** S5.7
**Parent task:** 17
**Done when:**
- S5.7 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-s5-7-1 is complete.

### Task rem-as-built-rem-ab5-1: src/conductor/src/execution/provider-catalog.ts + src/conductor/src/engine/provider-model-policy.ts:21 + src/conductor/src/engine/self-host/environment-claim-audit.ts:86-93: add descriptor fields optInModelIds (codex ['gpt-6-astra'], claude and pi []) and osSandbox (claude false, codex true, pi false); derive the opt-in model table and PROVIDER_OS_SANDBOX from BUILT_IN_PROVIDERS and delete both hand-keyed tables in the same change so the catalog is the single source. Existing model-policy and environment-claim-audit tests keep their assertions unchanged (Task 3 and Task 6 Done-when).
**Gate:** as-built
**Rationale:** Conforming drift under approved ADR decision 1 (catalog is the single provider authority); no architectural decision needed. provider-model-policy.ts:21 deepFreezePolicy({ codex: ['gpt-6-astra'] }) and self-host/environment-claim-audit.ts:86-93 PROVIDER_OS_SANDBOX { claude: false, codex: true } are hand-keyed provider tables. Admitted by Task 3 (model policy from descriptor fields) and Task 6 (self-host paths read descriptor fields). Sibling sweep: the id-literal guard gap that lets these pass is handled under S1.4 (Task 8), ordered after this task so the extended scan finds clean production source. Task 3 and Task 6 Done-when coverage (claude/codex model-policy and self-host tests with unchanged assertions) must survive.
**Governing clause:** adr-2026-09-24-built-in-provider-catalog-and-boot-discovery decision 1
**Done when:**
- adr-2026-09-24-built-in-provider-catalog-and-boot-discovery decision 1 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab5-1 is complete.

### Task rem-prd-audit-rem-s1-4-1: src/conductor/test/engine/provider-id-literals.test.ts:48: extend the scan beyond ts.isStringLiteral to identifier and computed property-name nodes (object literal keys, interface and type-literal members) whose text equals a BUILT_IN_PROVIDERS id; add a fixture test asserting const t = { codex: true } is reported with file:line; keep the existing string-literal and codex-fixture assertions unchanged (Task 8 Done-when) and assert zero findings on production source after rem-ab5-1.
**Gate:** prd-audit
**Rationale:** provider-id-literals.test.ts:48 visits only ts.isStringLiteral nodes, so provider-keyed tables written with bare identifier keys (provider-model-policy.ts:21, environment-claim-audit.ts:89,92) evade the Story 1 guard by syntax alone. Task 8 owns the scan; the table moves themselves are tasked under AB-5 (rem-ab5-1), which must land first. Task 8 Done-when string-literal and fixture assertions must survive unchanged.
**Criterion:** S1.4
**Parent task:** 8
**Done when:**
- S1.4 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-s1-4-1 is complete.

### Task rem-prd-audit-rem-s1-5-1: src/conductor/test/engine/provider-id-literals.test.ts:39-48: keep the adapter-module exemption for catalog id literals only; in declared adapter modules report any string literal or template span containing that adapter's own descriptor displayName as a whole word, with file:line; add a fixture test proving an adapter-module fixture with 'Pi invocation aborted.' is reported, keeping existing Task 8 fixture assertions unchanged. Then replace the literal display names at src/conductor/src/execution/pi-provider.ts:41,113,159 (and any claude-provider.ts / codex-provider.ts literals the extended scan reports) with the descriptor displayName, keeping message text byte-identical so existing adapter tests pass with unchanged assertions.
**Gate:** prd-audit
**Rationale:** provider-id-literals.test.ts:40 returns no findings for descriptor-declared adapter modules before the display check, and :48 matches only exact displayName strings, so pi-provider.ts:41 'Pi invocation aborted.', :113 and :159 hard-code the display name, against Task 8's Done-when that production display strings come from descriptor displayName. Admitted by Task 8. Found and excluded: word-bounded provider names inside longer prose strings in non-adapter modules (for example provider-model-policy.ts 'Claude-compatible model defaults'); Task 8 scopes enforcement to display-string literals, so sweeping them would widen the diff beyond plan admission. Task 8's existing fixture assertions must survive.
**Criterion:** S1.5
**Parent task:** 8
**Done when:**
- S1.5 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-s1-5-1 is complete.

### Task rem-prd-audit-rem-s7-3-1: src/conductor/src/execution/pi-provider.ts:60-95 (parsePiJsonl): count each assistant message_end event as one turn and set tokenUsage.numTurns to that count (creating tokenUsage with input/output 0 when a turn completes without a usage-bearing event), and also read usage carried on assistant message_end, not only message_update; in src/conductor/test/execution/pi-provider.test.ts add assertions that a stream with two assistant message_end events yields numTurns 2 and that usage on message_end is attached, keeping the existing Task 16 usage, cost-unmetered, malformed-line, and no-terminal-message assertions unchanged.
**Gate:** prd-audit
**Rationale:** The Pi smoke leg ends in assertSuccessfulCredentialedRun (test/fixtures/live-e2e-run-body.ts:509), which requires meter.totalTurns > 0 (:208), but parsePiJsonl (src/execution/pi-provider.ts:60-95) builds tokenUsage without numTurns, unlike codex-provider.ts:171-184; a credentialed Pi run therefore cannot pass. Admitted by Task 16 (Pi JSONL parsing attaches usage) and Task 22 (Pi leg over the shared run body). Task 16's existing usage and cost-unmetered assertions must survive.
**Criterion:** S7.3
**Parent task:** 22
**Done when:**
- S7.3 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-s7-3-1 is complete.

### Task rem-as-built-rem-ab6-1: src/conductor/test/structural/live-provider-coverage.test.ts (and the coverage helper behind providersRequiringLiveCoverage): make the coverage check fail naming the id for every enumerated provider, built-in or registered external plugin, that lacks a live-e2e-providers.ts descriptor or a smoke leg; add a test registering 'fixture-live-provider' with no descriptor or leg and asserting the check reports it; keep the existing enumeration test at :87 and the pi entry/leg requirement unchanged (Task 20 Done-when).
**Gate:** as-built
**Rationale:** Conforming drift under approved adr-2026-08-12-live-provider-coverage-from-plugin-registry decision 1: test/structural/live-provider-coverage.test.ts:87 only asserts a registered external plugin is enumerated, never that each enumerated id has a live descriptor and smoke leg, so an uncovered plugin passes. Admitted by Task 20 (structural test iterates catalog plus plugins and requires entry and smoke leg). Task 20's existing enumeration and pi-entry assertions must survive.
**Governing clause:** adr-2026-08-12-live-provider-coverage-from-plugin-registry decision 1
**Done when:**
- adr-2026-08-12-live-provider-coverage-from-plugin-registry decision 1 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab6-1 is complete.

### Task rem-as-built-rem-ab7-1: src/conductor/src/engine/ci-fix.ts: delete the dead defaultCiFixProbe, any preflight helper and result type only it uses, and imports left unused; remove the stale ci-fix startup preflight comment in src/conductor/src/daemon-cli.ts; drop the orphaned defaultCiFixProbe mock keys from src/conductor/test/daemon-otel-wiring.test.ts, test/engine/daemon-mode-feature-log.integration.test.ts, test/acceptance/no-daemon-level-metrics-queue-depth-halts-and-gate.acceptance.test.ts, test/acceptance/export-failure-visible-without-changing-run.acceptance.test.ts, test/acceptance/daemon-otel-parity.acceptance.test.ts, test/engine/daemon-cli-config-resolution.test.ts, and test/engine/daemon-state-refusal-event.test.ts, and delete any preflight-only test cases while keeping ci-fix resolver error-classification tests unchanged. Coverage preserved by the Task 12/13 boot not-installed tests.
**Gate:** as-built
**Rationale:** defaultCiFixProbe (src/engine/ci-fix.ts) has no production caller: daemon-cli.ts keeps only a stale CF-5/CF-6 comment, and the only other references are test mocks. It was already unwired at merge-base; the ci-fix startup-preflight ADR's #2153 amendment forbids the Claude-only startup veto and its #1884 amendment moves installation checks to catalog boot discovery (delivered by Tasks 12-13), so removal conforms and production-wiring would reinstate a forbidden veto. Admitted by Task 7, which lists ci-fix.ts. Coverage survives via the Task 12/13 boot not-installed tests and unchanged ci-fix resolver classification tests. Orphan sweep: every test file that mocks defaultCiFixProbe is named in the task.
**Parent task:** 7
**Governing clause:** Task 7
**Done when:**
- Task 7 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab7-1 is complete.

### Task rem-as-built-rem-ab8-1: src/conductor/src/index.ts:490 (CLI_PROVIDER_DISPATCHING_COMMANDS) + src/conductor/src/engine/engineer-cli.ts (launchClaudeEngineer and its compose/engineer wiring): add the compose/engineer interactive launch to the provider-dispatching command set and run the same discoverInstalledProviders -> provider_discovery event -> validateProviderInstallation sequence before spawning, failing with the same not-installed error; in src/conductor/test/engine/daemon-provider-boot.test.ts add a test that with discovery reporting claude missing the compose/engineer entry exits non-zero naming claude and never calls the spawn stub, keeping the Task 14 set-membership and non-dispatching-skip assertions unchanged.
**Gate:** as-built
**Rationale:** Conforming drift under approved ADR decision 8: the bare compose/engineer launch (engineer-cli.ts launchClaudeEngineer) spawns the Claude executable directly with no discovery, installed-only registration, or not-installed validation, and CLI_PROVIDER_DISPATCHING_COMMANDS (index.ts:490) lists only inline and daemon. Admitted by Task 13 (dispatching CLI boot runs discovery and fails fast) and Task 14 (dispatching command set declared beside the command table). Task 14 Done-when coverage (rate-card, overlap-scan, render-diagrams excluded and skip discovery) must survive.
**Governing clause:** adr-2026-09-24-built-in-provider-catalog-and-boot-discovery decision 8
**Done when:**
- adr-2026-09-24-built-in-provider-catalog-and-boot-discovery decision 8 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab8-1 is complete.
