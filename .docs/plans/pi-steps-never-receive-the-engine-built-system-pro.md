# Implementation Plan: Pi steps receive the engine-built system prompt

**Date:** 2026-10-24
**Design:** [architecture review](../decisions/architecture-review-2026-10-24-pi-steps-never-receive-the-engine-built-system-pro.md); [ADR](../decisions/adr-2026-10-24-system-prompt-delivery-is-a-declared-provider-capability.md); [diagram](../architecture/pi-steps-never-receive-the-engine-built-system-pro.md)
**Stories:** .docs/stories/pi-steps-never-receive-the-engine-built-system-pro.md
**Conflict check:** Clean as of 2026-10-24 (one degrading overlap accepted)

## Summary

This plan delivers `InvokeOptions.systemPrompt` to Pi through a private temp file and adds a
declared, fail-closed system-prompt delivery capability. A guard applied in
`createProviderRuntimeSet` enforces the capability for every built-in and plugin provider. A
cross-provider contract suite proves that every built-in provider delivers the text. There are 15
tasks.

## Technical Approach

- **The contract gains one optional declaration and one result marker.** `src/conductor/src/execution/llm-provider.ts`:
  - adds `export interface ProviderSystemPromptCapability { readonly deliversSystemPrompt: true }`;
  - adds `systemPromptCapability?: ProviderSystemPromptCapability` to `LLMProvider`, next to
    `lifecycleCapability` and `nativeSchemaCapability`;
  - adds `systemPromptUndeliverable?: true` to `InvokeResult`, next to `nativeSchemaUnsupported`.

  A provider delivers only when `systemPromptCapability?.deliversSystemPrompt === true`. An absent
  declaration, or any other value, is a non-affirming declaration. Local pattern: the
  `nativeSchemaCapability` / `ProviderNativeSchemaCapability` pair. The traits are an optional
  instance field, a literal `true` member, and absent meaning unsupported.
- **The guard is a Proxy created in `createProviderRuntimeSet`** (`src/conductor/src/engine/provider-runtime.ts`).
  - New exported function `guardSystemPromptDelivery(key, provider)` returns
    `new Proxy(provider, handler)`.
  - The handler's `get` trap returns a guarded function only for `invoke`. Every other property is
    read with `Reflect.get(target, prop, target)`, and a function value is returned bound to
    `target`, so prototype methods and TS-`private` state keep working, including from
    `.call(runtime.provider, …)` sites.
  - The guarded `invoke` refuses when `typeof options.systemPrompt === 'string' && options.systemPrompt.length > 0`
    and the target does not affirm delivery. Otherwise it calls `target.invoke(options)` with the
    same options object.
  - The refusal returns `success: false`, `exitCode: 1`, `providerInvocationSkipped: true`,
    `executionDisposition: 'not-started'`, `systemPromptUndeliverable: true`, and output
    `Provider <key> cannot receive the engine system prompt: missing systemPromptCapability declaration. Recovery action: declare systemPromptCapability.deliversSystemPrompt and deliver InvokeOptions.systemPrompt to the model.`
    It sets neither `providerUnavailable` nor `providerUnavailableScope`.
  - `createProviderRuntimeSet` stores the Proxy as `runtime.provider` and never re-registers it, so
    the registry keeps the original instance. A Proxy over a frozen object or a module namespace is
    legal, because the handler defines only `get`.
- **Telemetry gets its own capability name.** `skippedCandidateSetupUnavailable`
  (`src/conductor/src/engine/provider-execution.ts`) gains a branch, evaluated before the
  `providerUnavailable` branch, that maps `systemPromptUndeliverable === true` to
  `capability: 'system-prompt-delivery'`. Its reason is the refusal output, and its recovery action
  is `Declare systemPromptCapability on the provider and deliver InvokeOptions.systemPrompt, then re-queue this feature.`
  `ProviderSetupUnavailable.capability` is an unconstrained string, so there is no closed set to
  extend. No availability store is written: that only happens for `providerUnavailable`.
- **Pi writes a private file and appends it** (`src/conductor/src/execution/pi-provider.ts`).
  - A module-local `writePiSystemPromptFile(text)` mirrors Claude's `writeSystemPromptFile`: it uses
    `mkdtemp` under `process.env.AI_CONDUCTOR_TEST_TMP_ROOT ?? tmpdir()` with prefix
    `ai-conductor-pi-system-prompt-`, writes `system-prompt.md` with mode `0o600` as UTF-8, and
    returns `{ path, dispose }`, where `dispose` is `rm(dir, { recursive: true, force: true })`.
  - Local pattern: Claude's writer. Keep the private directory, the `0600` mode, and the
    resolve-at-invocation temp root. It is not shared, so `claude-provider.ts` stays byte-identical
    apart from its declaration.
  - In `invoke`, after the args are built and before the existing "abort during preflight" check,
    a non-empty `systemPrompt` is written. Then `isFile(path, this.environment)` gates the spawn,
    and `--append-system-prompt <path>` is pushed immediately after the HARNESS.md pair.
  - A write rejection returns `success: false, exitCode: 1`, with output
    `<Pi display name> provider could not prepare the system prompt for delivery: <error message>`.
    A failed `isFile` returns output
    `<Pi display name> provider cannot deliver the system prompt: <path> is not a readable regular file`.
    Neither spawns.
  - Everything from the write to the return runs inside a `try { … } finally { await file?.dispose() }`,
    so the success, non-zero, abort, `ENOENT` and pre-spawn-abort returns all dispose.
  - `input: options.prompt` is unchanged.
  - `PiProvider` declares `readonly systemPromptCapability = { deliversSystemPrompt: true } as const`.
- **Claude, Codex and the reference recorder plugin declare the capability**, adding one field
  each. Their transport is unchanged.
- **The contract suite** is a new test file, `src/conductor/test/execution/system-prompt-delivery-contract.test.ts`.
  - It holds a table keyed by `BuiltInProviderId`. Each entry builds that adapter with a capturing
    subprocess stub and returns the captured `{ argv, stdin, files }`, where `files` are the
    contents read while the stub runs.
  - A checker `assertDeliversSystemPrompt(id, capture, text)` passes when the text equals stdin's
    leading segment or an appended or `--append-system-prompt-file` file's contents, and fails
    naming `id` otherwise. A fixture adapter that drops the field proves the checker fails.
  - A `satisfies Record<BuiltInProviderId, …>` type on the table makes a new catalog id a compile
    error until it has an entry.
- **Sequencing.** Task 1 lands the contract types. Tasks 2 to 7 build the guard and telemetry.
  Tasks 8 to 13 build Pi delivery. Task 14 adds the contract suite, after Pi delivers. Task 15
  updates the recorder plugin.

## Prerequisites

- None. Pi 1.0.0's repeatable, path-resolving `--append-system-prompt` is verified in the ADR.

## Tasks

### Task 1: Add the system-prompt capability declaration and refusal marker to the provider contract
**Story:** Story 6
**Type:** infrastructure

**Steps:**
1. Write a failing test in `src/conductor/test/execution/llm-provider-contract.test.ts`: `expectTypeOf<LLMProvider['systemPromptCapability']>()` equals `ProviderSystemPromptCapability | undefined`; `new ClaudeProvider().systemPromptCapability` and `new CodexProvider().systemPromptCapability` deep-equal `{ deliversSystemPrompt: true }`; `InvokeResult` accepts `systemPromptUndeliverable: true`.
2. Verify RED.
3. Implement: add `ProviderSystemPromptCapability`, `LLMProvider.systemPromptCapability?`, and `InvokeResult.systemPromptUndeliverable?: true` in `llm-provider.ts`. Declare `readonly systemPromptCapability = { deliversSystemPrompt: true } as const` on `ClaudeProvider` and `CodexProvider`, next to their `nativeSchemaCapability` fields. Change nothing else in either adapter.
4. Verify GREEN.
5. Commit: "feat(provider): declare system-prompt delivery capability".

**Done when:**
- [test] `llm-provider-contract.test.ts` asserts `LLMProvider['systemPromptCapability']` is typed `ProviderSystemPromptCapability | undefined` and `InvokeResult` accepts `systemPromptUndeliverable: true`.
- [test] The same test asserts `new ClaudeProvider().systemPromptCapability` and `new CodexProvider().systemPromptCapability` each deep-equal `{ deliversSystemPrompt: true }`.
- The diff to `claude-provider.ts` and `codex-provider.ts` adds only the `systemPromptCapability` field line to each class.

**Files likely touched:**
- `src/conductor/src/execution/llm-provider.ts` — capability type, contract member, result marker
- `src/conductor/src/execution/claude-provider.ts` — declaration
- `src/conductor/src/execution/codex-provider.ts` — declaration
- `src/conductor/test/execution/llm-provider-contract.test.ts` — tests

**Dependencies:** none

### Task 2: The runtime-set guard refuses an undeclared provider by name
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/provider-runtime.test.ts`. Register a plain-object stub plugin `recorder` (with `invoke: vi.fn()`, no declaration) in a `PluginRegistry`, call `markInitialized()`, then `createProviderRuntimeSet(registry)`. Invoke `set.get('recorder').provider.invoke({ prompt: '/x', systemPrompt: 'S' })`. Assert:
   - the stub's `invoke` has zero calls;
   - the result has `success: false`, `providerInvocationSkipped: true`, `executionDisposition: 'not-started'` and `systemPromptUndeliverable: true`, with `providerUnavailable` undefined;
   - the output contains `recorder`, `systemPromptCapability`, and `Recovery action: declare systemPromptCapability.deliversSystemPrompt and deliver InvokeOptions.systemPrompt`.
   Repeat with `systemPromptCapability: { deliversSystemPrompt: false }` and with `systemPromptCapability: {}`, and assert the same refusal.
2. Verify RED.
3. Implement `guardSystemPromptDelivery(key, provider)` in `src/conductor/src/engine/provider-runtime.ts` as described in Technical Approach. Apply it in `createProviderRuntimeSet` to the `registry.get<LLMProvider>` result before it is stored on the runtime. Copy `lifecycleCapability` and `nativeSchemaCapability` from the target as today.
4. Verify GREEN.
5. Commit: "feat(provider-runtime): refuse undeclared system-prompt delivery".

**Done when:**
- [test] Invoking an undeclared stub `recorder` through `createProviderRuntimeSet(...).get('recorder').provider` with `systemPrompt: 'S'` leaves the stub's `invoke` with zero calls and returns `success: false`, `providerInvocationSkipped: true`, `executionDisposition: 'not-started'`, `systemPromptUndeliverable: true`, with `providerUnavailable` undefined.
- [test] The refusal output contains the provider key `recorder`, the text `missing systemPromptCapability declaration`, and the recovery action `declare systemPromptCapability.deliversSystemPrompt and deliver InvokeOptions.systemPrompt`.
- [test] Stubs declaring `{ deliversSystemPrompt: false }` and `{}` are each refused with a result deep-equal to the undeclared stub's refusal, as asserted in `provider-runtime.test.ts`.

**Files likely touched:**
- `src/conductor/src/engine/provider-runtime.ts` — guard and its application
- `src/conductor/test/engine/provider-runtime.test.ts` — tests

**Dependencies:** Task 1

### Task 3: The guard passes declared and prompt-free dispatches through unchanged
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/provider-runtime.test.ts`:
   - a declared stub (`systemPromptCapability: { deliversSystemPrompt: true }`) invoked with `{ prompt: '/x', systemPrompt: 'S' }` receives that same options object (`toBe`), and the stub's result is returned;
   - an undeclared stub invoked with `{ prompt: '/x' }` receives the same options object;
   - an undeclared stub invoked with `{ prompt: '/x', systemPrompt: '' }` is called once.
2. Verify RED (the tests fail until the pass-through branch matches identity and empty-string semantics).
3. Implement: make sure the guarded `invoke` forwards the original options object, and treats only a non-empty string as present.
4. Verify GREEN.
5. Commit: "test(provider-runtime): system-prompt guard pass-through".

**Done when:**
- [test] A declared stub invoked through the runtime with `systemPrompt: 'S'` receives the identical options object (`toBe`), with `systemPrompt` `'S'`, and the runtime returns the stub's own result.
- [test] An undeclared stub invoked through the runtime with no `systemPrompt` receives the identical options object exactly once.
- [test] An undeclared stub invoked through the runtime with `systemPrompt: ''` is called exactly once and returns its own result.

**Files likely touched:**
- `src/conductor/src/engine/provider-runtime.ts` — pass-through semantics
- `src/conductor/test/engine/provider-runtime.test.ts` — tests

**Dependencies:** Task 2

### Task 4: The guard is transparent to prototype methods and declared fields
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/provider-runtime.test.ts` against a class-based stub with a TS-`private` field read by `prepareSelfHostAuth`, `resolveSelfHostExecutable`, `readiness`, and `readOnlyReviewObservedCommandReach`. Also cover real built-in instances registered in a `PluginRegistry` with stubbed environments and contexts: `ClaudeProvider` (`prepareSelfHostAuth`, `readOnlyReviewObservedCommandReach`), `CodexProvider` (`readiness`, `prepareSelfHostAuth`, `resolveSelfHostExecutable`), and `PiProvider` (`prepareSelfHostAuth`, `resolveSelfHostExecutable`). Call each one directly on `runtime.provider` and through `.call(runtime.provider, …)`, and compare against the same call on the unwrapped instance. A call that rejects under the stubbed context must reject with the same message. Assert:
   - each method, called directly and through `.call(runtime.provider, …)`, returns what the unwrapped instance returns;
   - `supportsSessionResume`, `lifecycleCapability`, `nativeSchemaCapability` and `systemPromptCapability` read from `runtime.provider` equal (`toBe`) the target's.
2. Verify RED.
3. Implement: in the Proxy `get` trap, read with `Reflect.get(target, prop, target)`, and return a function value bound to `target`, except for `invoke`, which returns the guarded function.
4. Verify GREEN.
5. Commit: "fix(provider-runtime): keep provider members transparent through the guard".

**Done when:**
- [test] For a class-based stub with private state, `prepareSelfHostAuth`, `resolveSelfHostExecutable`, `readiness`, and `readOnlyReviewObservedCommandReach` called on `runtime.provider`, directly and via `.call(runtime.provider, …)`, return values equal to the unwrapped stub's.
- [test] For built-ins resolved through `createProviderRuntimeSet`, Claude `prepareSelfHostAuth` and `readOnlyReviewObservedCommandReach`, Codex `readiness`, `prepareSelfHostAuth` and `resolveSelfHostExecutable`, and Pi `prepareSelfHostAuth` and `resolveSelfHostExecutable`, each called directly and via `.call(runtime.provider, …)`, resolve deep-equal to the unwrapped adapter's result or reject with the same message, never with a private-field access error.
- [test] `supportsSessionResume`, `lifecycleCapability`, `nativeSchemaCapability`, and `systemPromptCapability` read from `runtime.provider` are each `toBe` the target's value.

**Files likely touched:**
- `src/conductor/src/engine/provider-runtime.ts` — Proxy `get` trap
- `src/conductor/test/engine/provider-runtime.test.ts` — tests

**Dependencies:** Task 2

### Task 5: The guard tolerates frozen plugins and absent optional members
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/provider-runtime.test.ts`:
   - register `Object.freeze({ invoke: vi.fn(), label: 'frozen' })` and a module-namespace-shaped object (`Object.preventExtensions` with a `Symbol.toStringTag` of `Module`, an `invoke` spy, and `label: 'namespace'`). Assert `createProviderRuntimeSet` does not throw, `runtime.provider.label` reads `'frozen'` and `'namespace'` respectively, and invoking each `runtime.provider` with no `systemPrompt` calls its `invoke` spy once;
   - a plugin with no `readiness` gives `runtime.provider.readiness === undefined`.
2. Verify RED (or GREEN on first run. If the tests are already GREEN after Task 4, keep them as regression tests and record that in the commit body).
3. Implement any trap adjustment needed: no `set`/`defineProperty` traps; return `undefined` for absent members without binding.
4. Verify GREEN.
5. Commit: "test(provider-runtime): frozen and partial plugins through the guard".

**Done when:**
- [test] `createProviderRuntimeSet` over a registry holding a frozen plugin and a non-extensible namespace-shaped plugin returns without throwing, and `runtime.provider.label` reads `'frozen'` for the frozen one.
- [test] For the non-extensible namespace-shaped plugin, `runtime.provider.label` reads `'namespace'`, and invoking `runtime.provider` with no `systemPrompt` calls the plugin's `invoke` spy exactly once; the same invoke assertion holds for the frozen plugin.
- [test] For a plugin with no `readiness` member, `runtime.provider.readiness` is `undefined`, matching the unwrapped plugin.

**Files likely touched:**
- `src/conductor/src/engine/provider-runtime.ts` — trap adjustments if needed
- `src/conductor/test/engine/provider-runtime.test.ts` — tests

**Dependencies:** Task 4

### Task 6: Repeated runtime sets never double-wrap or mutate the registry
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/provider-runtime.test.ts`. Build two sets from one registry holding a declared stub. Invoke each set's provider once with `systemPrompt: 'S'`. Assert the stub's `invoke` was called exactly twice in total (once per dispatch), `registry.get('llm_provider', key)` is `toBe` the original stub, and neither set's provider is `toBe` the original.
2. Verify RED.
3. Implement: wrap per set, at `createProviderRuntimeSet`, never writing back to the registry.
4. Verify GREEN.
5. Commit: "test(provider-runtime): runtime sets wrap independently".

**Done when:**
- [test] Two `createProviderRuntimeSet` calls on one registry, each invoked once with a declared `systemPrompt`, produce exactly two calls to the adapter's `invoke`, one per dispatch.
- [test] After both sets exist, `registry.get('llm_provider', key)` is `toBe` the original registered instance.

**Files likely touched:**
- `src/conductor/src/engine/provider-runtime.ts` — per-set wrapping
- `src/conductor/test/engine/provider-runtime.test.ts` — tests

**Dependencies:** Task 2

### Task 7: A refused candidate is classified as system-prompt delivery and never marked unavailable
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/provider-execution.test.ts`. Drive `executeProviderCandidates` with runtimes from `createProviderRuntimeSet` over a registry holding an undeclared stub `recorder`, with an injected daemon-scoped provider availability store:
   - a dispatch with `systemPrompt: 'S'` records a `provider_attempt` with `invoked: false`, skip reason `setup-unavailable`, and setup capability `system-prompt-delivery`. Its setup capability is not `synchronous-spawn-permit`, and the stub's `invoke` has zero calls;
   - after that dispatch, the availability store's `suppress` has zero calls for `recorder`;
   - a second dispatch in the same run with no `systemPrompt` calls the stub's `invoke` once.
2. Verify RED.
3. Implement the `systemPromptUndeliverable` branch in `skippedCandidateSetupUnavailable` (`src/conductor/src/engine/provider-execution.ts`), evaluated before the `providerUnavailable` branch, as described in Technical Approach.
4. Verify GREEN.
5. Commit: "feat(provider-execution): classify system-prompt delivery refusals".

**Done when:**
- [test] A candidate dispatch with `systemPrompt: 'S'` to an undeclared `recorder` through `executeProviderCandidates` records `provider_attempt` with `invoked: false`, skip reason `setup-unavailable`, and setup capability `system-prompt-delivery`, never `synchronous-spawn-permit`.
- [test] After that refusal, the injected availability store's `suppress` has zero calls for `recorder`, and a later dispatch in the same run with no `systemPrompt` calls `recorder`'s `invoke` exactly once.
- `skippedCandidateSetupUnavailable` maps `systemPromptUndeliverable === true` to `capability: 'system-prompt-delivery'` in a branch that precedes the `providerUnavailable` branch.

**Files likely touched:**
- `src/conductor/src/engine/provider-execution.ts` — classification branch
- `src/conductor/test/engine/provider-execution.test.ts` — tests

**Dependencies:** Task 2

### Task 8: Pi appends the engine system prompt as a second file after HARNESS.md
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-provider.test.ts`, using the existing `PiSubprocessFactory` stub, which captures argv and options and reads appended files while it runs:
   - `systemPrompt: 'RETRY: fix the lint error\n[Conduct step 7/20]'` produces argv with `--append-system-prompt <HARNESS.md path>`, then `--append-system-prompt <p>` with HARNESS first, and the file at `<p>` reads exactly that text at spawn time;
   - prompt `/remediate` with a `systemPrompt` holding `RETRY: Adjudicate …\n{"currentFindings":[…]}` gives `input` exactly `/remediate`, and the file holds the full JSON text;
   - a `systemPrompt` beginning `/skill:remediate` leaves `input` equal to the dispatch prompt, and the text appears in the file and in no argv value or stdin.
   Add one integration test: register `PiProvider` (with stub factory and environment) as the built-in `pi` in a `PluginRegistry`, invoke `createProviderRuntimeSet(registry).get('pi').provider.invoke({ prompt: '/x', systemPrompt: 'S' })`, and assert that the stub was spawned and the appended file read `S`.
2. Verify RED.
3. Implement `writePiSystemPromptFile` and the append in `src/conductor/src/execution/pi-provider.ts` as described in Technical Approach. Follow Claude's `writeSystemPromptFile` traits: a private `mkdtemp` directory, a `0o600` UTF-8 file, the temp root resolved at invocation from `AI_CONDUCTOR_TEST_TMP_ROOT ?? tmpdir()`, and `dispose` removing the directory. Write it module-locally rather than importing it from `claude-provider.ts`. Declare `readonly systemPromptCapability = { deliversSystemPrompt: true } as const` on `PiProvider`. Leave `input: options.prompt` unchanged.
4. Verify GREEN.
5. Commit: "fix(pi): deliver the engine system prompt".

**Done when:**
- [test] For `systemPrompt` `RETRY: fix the lint error\n[Conduct step 7/20]`, the captured Pi argv contains `--append-system-prompt <HARNESS.md path>` at a lower index than a second `--append-system-prompt <p>`, and the file at `<p>`, read inside the stub, equals the `systemPrompt` exactly.
- [test] For prompt `/remediate` with an adjudication-context `systemPrompt`, the captured `input` is exactly `/remediate`, and the appended file contains the full adjudication context JSON.
- [test] For a `systemPrompt` beginning `/skill:remediate`, the captured `input` begins with the dispatch prompt, and the system-prompt text appears only in the appended file, not in stdin or any argv value.
- [test] A Pi dispatch with `systemPrompt: 'S'` through `createProviderRuntimeSet(registry).get('pi').provider` spawns Pi, and the appended file reads `S`, because `PiProvider` declares `systemPromptCapability`.

**Files likely touched:**
- `src/conductor/src/execution/pi-provider.ts` — file writer, append, declaration
- `src/conductor/test/execution/pi-provider.test.ts` — tests

**Dependencies:** Tasks 1, 2

### Task 9: Pi read-only review dispatches carry the system prompt with unchanged restrictions
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write a failing test in `src/conductor/test/execution/pi-provider.test.ts`. Invoke with `readOnlyReview: true` and `systemPrompt: 'S'`. Assert the second `--append-system-prompt <p>` follows HARNESS.md, `<p>` reads `S`, and the argv still contains `--no-extensions`, `--tools read,grep,find,ls,git_read` and `--conduct-git-read`, with the same values as for the same dispatch without a `systemPrompt`.
2. Verify RED.
3. Implement: make sure the append happens on the read-only path. It shares the arg builder, so this should need no further change.
4. Verify GREEN.
5. Commit: "test(pi): read-only review receives the system prompt".

**Done when:**
- [test] A Pi read-only review dispatch with `systemPrompt: 'S'` has a second `--append-system-prompt` after HARNESS.md whose file reads `S`.
- [test] The same dispatch's `--no-extensions`, `--tools`, and `--conduct-git-read` argv values are identical to the same read-only dispatch without a `systemPrompt`.

**Files likely touched:**
- `src/conductor/test/execution/pi-provider.test.ts` — test
- `src/conductor/src/execution/pi-provider.ts` — only if the read-only path needs the append

**Dependencies:** Task 8

### Task 10: Pi without a system prompt keeps a single append and writes no file
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-provider.test.ts`, with `AI_CONDUCTOR_TEST_TMP_ROOT` pointed at a fresh empty directory. For a dispatch with no `systemPrompt`, and again with `systemPrompt: ''`, assert:
   - the argv has exactly one `--append-system-prompt`, whose value is the HARNESS.md path;
   - the temp root contains no `ai-conductor-pi-system-prompt-*` entry after the call;
   - creation is never attempted: repeat each dispatch with `AI_CONDUCTOR_TEST_TMP_ROOT` set to a path whose parent is a regular file, so any `mkdtemp` would reject. Assert Pi is still spawned once, and the result is not the "could not prepare the system prompt" failure.
2. Verify RED (or GREEN after Task 8. If GREEN, keep it as a regression test and record that in the commit body).
3. Implement: write the file only when `systemPrompt` is a non-empty string.
4. Verify GREEN.
5. Commit: "test(pi): no system-prompt file without a system prompt".

**Done when:**
- [test] A Pi dispatch with no `systemPrompt` has exactly one `--append-system-prompt`, with value equal to the HARNESS.md path, and leaves no `ai-conductor-pi-system-prompt-*` entry in the temp root.
- [test] A Pi dispatch with `systemPrompt: ''` has exactly one `--append-system-prompt` and leaves no `ai-conductor-pi-system-prompt-*` entry in the temp root.
- [test] With the temp root set to a path where any `mkdtemp` rejects, Pi dispatches with no `systemPrompt` and with `systemPrompt: ''` each still spawn Pi exactly once and do not return the `could not prepare the system prompt for delivery` failure, proving no system-prompt file creation is attempted.

**Files likely touched:**
- `src/conductor/src/execution/pi-provider.ts` — non-empty guard
- `src/conductor/test/execution/pi-provider.test.ts` — tests

**Dependencies:** Task 8

### Task 11: Pi refuses to spawn when the system prompt cannot be prepared or verified
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-provider.test.ts`:
   - set `AI_CONDUCTOR_TEST_TMP_ROOT` to a path whose parent is a regular file, so `mkdtemp` rejects. Assert the stub factory was never called, and the result is `success: false`, with output containing the Pi display name and `could not prepare the system prompt for delivery`;
   - inject an environment whose `stat` reports the prepared path as not a regular file. Assert the stub was never called, and the result is `success: false`, with output containing the Pi display name, the prepared path, and `is not a readable regular file`.
2. Verify RED.
3. Implement the write-rejection and `isFile` checks before spawn, with the outputs given in Technical Approach.
4. Verify GREEN.
5. Commit: "fix(pi): refuse to spawn without a verified system-prompt file".

**Done when:**
- [test] When `mkdtemp` under the temp root rejects, Pi's subprocess factory has zero calls, and the result is `success: false`, with output naming the Pi display name and containing `could not prepare the system prompt for delivery`.
- [test] When `this.environment.stat` reports the prepared path as not a regular file, the factory has zero calls, and the result is `success: false`, with output naming the Pi display name, the prepared path, and `is not a readable regular file`.

**Files likely touched:**
- `src/conductor/src/execution/pi-provider.ts` — pre-spawn checks
- `src/conductor/test/execution/pi-provider.test.ts` — tests

**Dependencies:** Task 8

### Task 12: Large, multi-byte, and multi-line system prompts reach Pi through the file only
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-provider.test.ts`, with the stub reading the appended file as a `Buffer`:
   - a 300 KiB ASCII `systemPrompt` (307,200 bytes): no argv value contains it or any 64-byte slice of it, every argv value's `Buffer.byteLength` is below 131,072, and the file bytes equal `Buffer.from(text, 'utf8')`;
   - `'é → 🚀'` repeated: the file bytes equal its UTF-8 encoding;
   - exactly 131,072 bytes: the argv carries the file path and no argv value contains the text;
   - text with embedded `\n` lines: no argv entry equals any line of the text.
2. Verify RED (or GREEN after Task 8. If GREEN, keep it as a regression test and record that in the commit body).
3. Implement: none expected beyond Task 8's file transport. Write the file with `utf8` encoding.
4. Verify GREEN.
5. Commit: "test(pi): large and multi-byte system prompts".

**Done when:**
- [test] For a 307,200-byte `systemPrompt`, no Pi argv value contains the text, every argv value's `Buffer.byteLength` is below 131,072, and the appended file's bytes equal the text's UTF-8 bytes exactly.
- [test] For a `systemPrompt` of `é`, `→`, and `🚀` characters, the appended file's bytes equal `Buffer.from(text, 'utf8')`.
- [test] For a `systemPrompt` of exactly 131,072 bytes, the argv contains the appended file path, and no argv value contains the text.
- [test] For a multi-line `systemPrompt`, no Pi argv entry equals any of its lines.

**Files likely touched:**
- `src/conductor/test/execution/pi-provider.test.ts` — tests

**Dependencies:** Task 8

### Task 13: Pi's system-prompt file is private, per-invocation, and removed on every return path
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-provider.test.ts`, capturing the appended path `<p>` in the stub:
   - inside the stub, `stat(<p>).mode & 0o777` is `0o600`;
   - after `invoke` returns, `<p>` and `dirname(<p>)` do not exist, for each of: exit 0; exit 1; an `AbortController` aborted while the stub is pending (the aborted result is returned); and a stub resolving with `{ code: 'ENOENT' }`, the shape execa produces under `reject: false` (the provider-unavailable result is returned);
   - pre-spawn abort: abort the signal from inside `this.environment.stat` when it is called on `<p>`. Assert the factory has zero calls, and no `ai-conductor-pi-system-prompt-*` entry remains in the temp root;
   - two concurrent `invoke` calls with `systemPrompt` `A` and `B` capture different paths, and each file reads only its own text.
2. Verify RED.
3. Implement: wrap everything from the file write to every return in `try { … } finally { await systemPromptFile?.dispose() }`, keeping the existing pre-spawn abort check inside it.
4. Verify GREEN.
5. Commit: "fix(pi): always dispose the system-prompt file".

**Done when:**
- [test] While the Pi stub runs, the appended system-prompt file's mode is `0o600`.
- [test] After `invoke` returns from exit 0, exit 1, abort mid-run, and `ENOENT`, neither the appended file nor its private directory exists, and the abort and `ENOENT` cases return the aborted and provider-unavailable results respectively.
- [test] An abort raised after the file is written but before spawn leaves Pi's subprocess factory with zero calls, and no `ai-conductor-pi-system-prompt-*` entry in the temp root.
- [test] Two concurrent Pi dispatches with `systemPrompt` `A` and `B` append different paths, whose files read `A` and `B` respectively.

**Files likely touched:**
- `src/conductor/src/execution/pi-provider.ts` — `finally` disposal
- `src/conductor/test/execution/pi-provider.test.ts` — tests

**Dependencies:** Task 8

### Task 14: A cross-provider contract suite proves every built-in provider declares and delivers the system prompt
**Story:** Story 6
**Type:** happy-path

**Steps:**
1. Write `src/conductor/test/execution/system-prompt-delivery-contract.test.ts`:
   - a table typed `satisfies Record<BuiltInProviderId, DeliveryHarness>` with entries for `claude`, `codex` and `pi`. Each builds that adapter with a capturing subprocess stub and returns `{ argv, stdin, files }`, with `files` read while the stub runs;
   - `assertDeliversSystemPrompt(id, capture, text)`, which passes when `text` is stdin's leading segment or equals the contents of a file named by `--append-system-prompt` or `--append-system-prompt-file`, and throws an error containing `id` otherwise;
   - `runDeliveryContract(descriptor, harness)`, the one per-descriptor contract runner. It asserts `descriptor.createAdapter().systemPromptCapability` deep-equals `{ deliversSystemPrompt: true }`, runs a dispatch with `systemPrompt: 'S'` and one with a 307,200-byte `systemPrompt` through `assertDeliversSystemPrompt(descriptor.id, …)`, and asserts no argv value contains the 307,200-byte text;
   - one `it` per `BUILT_IN_PROVIDERS` entry that calls `runDeliveryContract(entry, harnesses[entry.id])`;
   - Claude: argv has `--append-system-prompt-file <p>`, and `<p>` reads exactly `S`. Codex: stdin equals `S\n\n<prompt>`. Pi: the second `--append-system-prompt` file reads `S`;
   - a fixture built-in descriptor with id `drops-system-prompt`, shaped like a `BUILT_IN_PROVIDERS` entry. Its `createAdapter` returns an adapter that declares `systemPromptCapability` but spawns with only the prompt. Assert `await expect(runDeliveryContract(fixture, fixtureHarness)).rejects.toThrow(/drops-system-prompt/)`.
2. Verify RED (the file fails until Task 8's Pi delivery and declaration exist).
3. Implement: no production change beyond Tasks 1 and 8. Do not edit `claude-provider*.test.ts` or `codex-provider*.test.ts`.
4. Verify GREEN, and run the existing Claude and Codex provider test files unmodified.
5. Commit: "test(provider): cross-provider system-prompt delivery contract".

**Done when:**
- [test] `system-prompt-delivery-contract.test.ts` iterates every `BUILT_IN_PROVIDERS` entry, and asserts each adapter's `systemPromptCapability` deep-equals `{ deliversSystemPrompt: true }` and its transport carries both `S` and a 307,200-byte `systemPrompt` in full, with no argv value containing the large text.
- [test] The suite asserts Claude's argv has `--append-system-prompt-file <p>` with `<p>` reading exactly `S`, Codex's stdin equals `S\n\n<prompt>`, and Pi's second appended file reads `S`.
- [test] `runDeliveryContract`, the same runner every built-in entry passes through, rejects for a fixture built-in descriptor with id `drops-system-prompt`, whose adapter declares the capability but leaves `systemPrompt` out of every transport, with an error naming the provider id `drops-system-prompt`.
- `git diff origin/main --stat` lists no change to any `src/conductor/test/execution/claude-provider*.test.ts` or `codex-provider*.test.ts` file, and those files pass under `npx vitest run`.

**Files likely touched:**
- `src/conductor/test/execution/system-prompt-delivery-contract.test.ts` — new suite

**Dependencies:** Tasks 1, 8

### Task 15: The reference recorder plugin declares system-prompt delivery
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write a failing test in `plugins/recorder-provider/tests/recorder-provider.test.ts`: the plugin instance's `systemPromptCapability` deep-equals `{ deliversSystemPrompt: true }`, and a recorded `invoke` with `systemPrompt: 'S'` writes a JSONL record whose `options.systemPrompt` is `'S'`.
2. Verify RED.
3. Implement: declare `readonly systemPromptCapability = { deliversSystemPrompt: true } as const` on the recorder provider class in `plugins/recorder-provider/index.ts`.
4. Verify GREEN, and run the plugin's existing tests unmodified.
5. Commit: "feat(recorder-provider): declare system-prompt delivery".

**Done when:**
- [test] `recorder-provider.test.ts` asserts the recorder instance's `systemPromptCapability` deep-equals `{ deliversSystemPrompt: true }`, and that an `invoke` with `systemPrompt: 'S'` records `options.systemPrompt` `'S'`.
- The recorder plugin's pre-existing tests pass with no edits to their assertions.

**Files likely touched:**
- `plugins/recorder-provider/index.ts` — declaration
- `plugins/recorder-provider/tests/recorder-provider.test.ts` — test

**Dependencies:** Task 1

## Task Dependency Graph

```
Task 1 ─┬─▶ Task 2 ─┬─▶ Task 3
        │           ├─▶ Task 4 ─▶ Task 5
        │           ├─▶ Task 6
        │           ├─▶ Task 7
        │           └─▶ Task 8 ─┬─▶ Task 9
        │                       ├─▶ Task 10
        │                       ├─▶ Task 11
        │                       ├─▶ Task 12
        │                       ├─▶ Task 13
        ├───────────────────────┴─▶ Task 14 (also needs Task 1)
        └─▶ Task 15
```

## Integration Points

- After Task 2: any provider resolved through `createProviderRuntimeSet` (daemon, CLI, executor child, plan review) refuses an undeclared provider.
- After Task 7: a refused candidate is visible in `provider_attempt` telemetry as `system-prompt-delivery`.
- After Task 8: a Pi dispatch through `createProviderRuntimeSet` delivers the system prompt end to end. Task 8 owns that integration proof.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a Pi dispatch whose `systemPrompt` is `RETRY: fix the lint error\n[Conduct step 7/20]`, when Pi is spawned, then the argv carries `--append-system-prompt <HARNESS.md path>` followed by a second `--append-system-prompt <path>`, and at spawn time the file at that second path contains exactly the `systemPrompt` text. | 8 | "the captured Pi argv contains `--append-system-prompt <HARNESS.md path>` at a lower index than a second `--append-system-prompt <p>`, and the file at `<p>`, read inside the stub, equals the `systemPrompt` exactly" | diff-local |
| Story 1 happy: Given a Pi dispatch whose prompt is `/remediate` and whose `systemPrompt` carries a remediate adjudication context JSON, when Pi is spawned, then stdin is exactly `/remediate`, and the second appended file contains the full adjudication context JSON. | 8 | "the captured `input` is exactly `/remediate`, and the appended file contains the full adjudication context JSON" | diff-local |
| Story 1 happy: Given a Pi dispatch carrying a `systemPrompt`, when Pi is spawned, then the HARNESS.md `--append-system-prompt` precedes the engine system-prompt `--append-system-prompt` in the argv. | 8 | "contains `--append-system-prompt <HARNESS.md path>` at a lower index than a second `--append-system-prompt <p>`" | diff-local |
| Story 1 happy: Given a Pi read-only review dispatch carrying a `systemPrompt`, when Pi is spawned, then the engine system prompt is appended the same way, and the read-only tool restriction flags are unchanged. | 9 | "has a second `--append-system-prompt` after HARNESS.md whose file reads `S`" | diff-local |
| Story 1 negative: Given a Pi dispatch with no `systemPrompt`, when Pi is spawned, then the argv carries exactly one `--append-system-prompt` (HARNESS.md) and no system-prompt file is created. | 10 | "A Pi dispatch with no `systemPrompt` has exactly one `--append-system-prompt`, with value equal to the HARNESS.md path, and leaves no `ai-conductor-pi-system-prompt-*` entry in the temp root" | diff-local |
| Story 1 negative: Given a Pi dispatch whose `systemPrompt` is the empty string, when Pi is spawned, then the argv carries exactly one `--append-system-prompt` and no system-prompt file is created. | 10 | "A Pi dispatch with `systemPrompt: ''` has exactly one `--append-system-prompt` and leaves no `ai-conductor-pi-system-prompt-*` entry in the temp root" | diff-local |
| Story 1 negative: Given the temp directory cannot be written (for example `mkdtemp` rejects with `EACCES`), when a Pi dispatch carrying a `systemPrompt` runs, then Pi is not spawned and the result is `success: false`, with output naming Pi and stating that the system prompt could not be prepared for delivery. | 11 | "When `mkdtemp` under the temp root rejects, Pi's subprocess factory has zero calls, and the result is `success: false`, with output naming the Pi display name and containing `could not prepare the system prompt for delivery`" | diff-local |
| Story 1 negative: Given the prepared system-prompt path is not a readable regular file at the pre-spawn check, when a Pi dispatch carrying a `systemPrompt` runs, then Pi is not spawned and the result is `success: false`, with output naming Pi and the unreadable system-prompt path. | 11 | "the factory has zero calls, and the result is `success: false`, with output naming the Pi display name, the prepared path, and `is not a readable regular file`" | diff-local |
| Story 1 negative: Given a `systemPrompt` whose text begins with `/skill:remediate`, when Pi is spawned, then stdin still begins with the dispatch prompt, and the system-prompt text appears only in the appended file. | 8 | "the captured `input` begins with the dispatch prompt, and the system-prompt text appears only in the appended file, not in stdin or any argv value" | diff-local |
| Story 2 happy: Given a Pi dispatch whose `systemPrompt` is 300 KiB, when Pi is spawned, then no argv value contains the system-prompt text, every argv value is shorter than 131,072 bytes, and the appended file's contents equal the 300 KiB text byte for byte. | 12 | "no Pi argv value contains the text, every argv value's `Buffer.byteLength` is below 131,072, and the appended file's bytes equal the text's UTF-8 bytes exactly" | diff-local |
| Story 2 happy: Given a `systemPrompt` containing multi-byte UTF-8 characters (for example `é`, `→`, emoji), when Pi is spawned, then the appended file contains those characters encoded as UTF-8, byte for byte. | 12 | "the appended file's bytes equal `Buffer.from(text, 'utf8')`" | diff-local |
| Story 2 negative: Given a `systemPrompt` of exactly 131,072 bytes, the per-argument limit, when Pi is spawned, then the spawn argv still carries only the file path, not the text. | 12 | "the argv contains the appended file path, and no argv value contains the text" | diff-local |
| Story 2 negative: Given a `systemPrompt` containing NUL-free text with embedded newlines, when Pi is spawned, then no line of the system prompt appears as a separate argv entry. | 12 | "no Pi argv entry equals any of its lines" | diff-local |
| Story 3 happy: Given a Pi dispatch carrying a `systemPrompt`, when Pi is spawned, then the file's mode is `0600`. | 13 | "While the Pi stub runs, the appended system-prompt file's mode is `0o600`" | diff-local |
| Story 3 happy: Given a Pi dispatch carrying a `systemPrompt` that exits 0, when `invoke` returns, then the file and its private directory no longer exist. | 13 | "After `invoke` returns from exit 0, exit 1, abort mid-run, and `ENOENT`, neither the appended file nor its private directory exists" | diff-local |
| Story 3 happy: Given two concurrent Pi dispatches carrying different `systemPrompt` values, when both are spawned, then each argv names a different file, and each file contains only its own dispatch's text. | 13 | "Two concurrent Pi dispatches with `systemPrompt` `A` and `B` append different paths, whose files read `A` and `B` respectively" | diff-local |
| Story 3 negative: Given a Pi dispatch carrying a `systemPrompt` that exits non-zero, when `invoke` returns, then the file and its directory no longer exist. | 13 | "After `invoke` returns from exit 0, exit 1, abort mid-run, and `ENOENT`, neither the appended file nor its private directory exists" | diff-local |
| Story 3 negative: Given a Pi dispatch carrying a `systemPrompt` that is aborted mid-run, when `invoke` returns its aborted result, then the file and its directory no longer exist. | 13 | "the abort and `ENOENT` cases return the aborted and provider-unavailable results respectively" | diff-local |
| Story 3 negative: Given a Pi dispatch carrying a `systemPrompt` whose spawn fails with `ENOENT`, when `invoke` returns its provider-unavailable result, then the file and its directory no longer exist. | 13 | "the abort and `ENOENT` cases return the aborted and provider-unavailable results respectively" | diff-local |
| Story 3 negative: Given a Pi dispatch carrying a `systemPrompt` that is aborted after the file is written but before spawn, when `invoke` returns, then Pi was never spawned, and the file and its directory no longer exist. | 13 | "An abort raised after the file is written but before spawn leaves Pi's subprocess factory with zero calls, and no `ai-conductor-pi-system-prompt-*` entry in the temp root" | diff-local |
| Story 4 happy: Given a plugin `llm_provider` named `recorder` that does not declare `systemPromptCapability`, when a dispatch carrying a non-empty `systemPrompt` is invoked through a runtime from `createProviderRuntimeSet`, then the plugin's own `invoke` is never called, and the result is `success: false` with `providerInvocationSkipped: true` and `executionDisposition: 'not-started'`. | 2 | "leaves the stub's `invoke` with zero calls and returns `success: false`, `providerInvocationSkipped: true`, `executionDisposition: 'not-started'`" | diff-local |
| Story 4 happy: Given the same refusal, when the result is read, then its output names the provider key `recorder`, the missing `systemPromptCapability` declaration, and the recovery action of declaring and honoring it. | 2 | "The refusal output contains the provider key `recorder`, the text `missing systemPromptCapability declaration`, and the recovery action `declare systemPromptCapability.deliversSystemPrompt and deliver InvokeOptions.systemPrompt`" | diff-local |
| Story 4 happy: Given a plugin `llm_provider` that declares `systemPromptCapability`, when a dispatch carrying a `systemPrompt` is invoked through the runtime, then the plugin's `invoke` receives the options, `systemPrompt` included, unchanged. | 3 | "A declared stub invoked through the runtime with `systemPrompt: 'S'` receives the identical options object (`toBe`), with `systemPrompt` `'S'`" | diff-local |
| Story 4 negative: Given a plugin that does not declare `systemPromptCapability`, when a dispatch with no `systemPrompt` is invoked through the runtime, then the plugin's `invoke` is called with the options unchanged. | 3 | "An undeclared stub invoked through the runtime with no `systemPrompt` receives the identical options object exactly once" | diff-local |
| Story 4 negative: Given a plugin that does not declare `systemPromptCapability`, when a dispatch whose `systemPrompt` is the empty string is invoked, then the plugin's `invoke` is called. | 3 | "An undeclared stub invoked through the runtime with `systemPrompt: ''` is called exactly once" | diff-local |
| Story 4 negative: Given a plugin whose declaration is present but does not affirm delivery, when a dispatch carrying a `systemPrompt` is invoked, then it is refused exactly as an undeclared plugin is. | 2 | "Stubs declaring `{ deliversSystemPrompt: false }` and `{}` are each refused with a result deep-equal to the undeclared stub's refusal" | diff-local |
| Story 4 negative: Given a refusal inside the provider candidate path, when the attempt is recorded, then its setup-unavailable capability is the system-prompt delivery capability, never `synchronous-spawn-permit`. | 7 | "records `provider_attempt` with `invoked: false`, skip reason `setup-unavailable`, and setup capability `system-prompt-delivery`, never `synchronous-spawn-permit`" | diff-local |
| Story 4 negative: Given a daemon run in which a dispatch carrying a `systemPrompt` was refused for an undeclared plugin, when a later dispatch in the same run carries no `systemPrompt` and selects that plugin, then the plugin's `invoke` is called, because the refusal did not record the provider as unavailable. | 7 | "After that refusal, the injected availability store's `suppress` has zero calls for `recorder`, and a later dispatch in the same run with no `systemPrompt` calls `recorder`'s `invoke` exactly once" | diff-local |
| Story 5 happy: Given a built-in provider resolved through `createProviderRuntimeSet`, when `prepareSelfHostAuth`, `resolveSelfHostExecutable`, `readiness`, or `readOnlyReviewObservedCommandReach` is called on `runtime.provider`, including through `.call(runtime.provider, …)`, then the adapter's method runs with access to its own private state, and returns what the unwrapped adapter returns. | 4 | "each called directly and via `.call(runtime.provider, …)`, resolve deep-equal to the unwrapped adapter's result or reject with the same message, never with a private-field access error" | diff-local |
| Story 5 happy: Given a resolved provider, when `supportsSessionResume`, `lifecycleCapability`, `nativeSchemaCapability`, or `systemPromptCapability` is read from `runtime.provider`, then the values equal the adapter's. | 4 | "`supportsSessionResume`, `lifecycleCapability`, `nativeSchemaCapability`, and `systemPromptCapability` read from `runtime.provider` are each `toBe` the target's value" | diff-local |
| Story 5 happy: Given `createProviderRuntimeSet` is called twice on the same registry, when either set's provider is invoked with a `systemPrompt` it declares, then the adapter's `invoke` is called exactly once per dispatch, and the registry still holds the original, unwrapped instance. | 6 | "produce exactly two calls to the adapter's `invoke`, one per dispatch" | diff-local |
| Story 5 negative: Given a plugin exported as a frozen or non-extensible module namespace, when `createProviderRuntimeSet` wraps it, then wrapping does not throw, and the plugin's members are reachable through `runtime.provider`. | 5 | "For the non-extensible namespace-shaped plugin, `runtime.provider.label` reads `'namespace'`, and invoking `runtime.provider` with no `systemPrompt` calls the plugin's `invoke` spy exactly once" | diff-local |
| Story 5 negative: Given a plugin that does not implement the optional `readiness` method, when `runtime.provider.readiness` is read, then it is `undefined`, exactly as on the unwrapped plugin. | 5 | "`runtime.provider.readiness` is `undefined`, matching the unwrapped plugin" | diff-local |
| Story 6 happy: Given every entry in `BUILT_IN_PROVIDERS`, when the contract suite runs, then each adapter declares `systemPromptCapability`. | 14 | "asserts each adapter's `systemPromptCapability` deep-equals `{ deliversSystemPrompt: true }`" | diff-local |
| Story 6 happy: Given Claude with a `systemPrompt`, when it is spawned, then the argv carries `--append-system-prompt-file <path>`, and that file contains the exact text, as before this change. | 14 | "Claude's argv has `--append-system-prompt-file <p>` with `<p>` reading exactly `S`" | diff-local |
| Story 6 happy: Given Codex with a `systemPrompt` and a prompt, when it is spawned, then stdin is `<systemPrompt>\n\n<prompt>`, as before this change. | 14 | "Codex's stdin equals `S\n\n<prompt>`" | diff-local |
| Story 6 happy: Given Pi with a `systemPrompt`, when it is spawned, then the text reaches Pi through the appended file (Story 1). | 14 | "Pi's second appended file reads `S`" | diff-local |
| Story 6 happy: Given each built-in provider and a 300 KiB `systemPrompt`, when the contract suite runs, then each provider's transport carries the full text, and no argv value contains it. | 14 | "its transport carries both `S` and a 307,200-byte `systemPrompt` in full, with no argv value containing the large text" | diff-local |
| Story 6 negative: Given a built-in descriptor whose adapter accepts `systemPrompt` but leaves it out of every transport, when the contract suite runs against it, then the suite fails, naming that provider id. | 14 | "rejects for a fixture built-in descriptor with id `drops-system-prompt`, whose adapter declares the capability but leaves `systemPrompt` out of every transport, with an error naming the provider id `drops-system-prompt`" | diff-local |
| Story 6 negative: Given the existing Claude and Codex transport tests, when this change lands, then they pass with no edits to their expected argv or stdin. | 14 | "lists no change to any `src/conductor/test/execution/claude-provider*.test.ts` or `codex-provider*.test.ts` file, and those files pass under `npx vitest run`" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-24-system-prompt-delivery-is-a-declared-provider-capability#D1 | task | task-1, task-2 | `llm-provider-contract.test.ts` asserts `LLMProvider['systemPromptCapability']` is typed |
| adr-2026-10-24-system-prompt-delivery-is-a-declared-provider-capability#D2 | task | task-2, task-7 | leaves the stub's `invoke` with zero calls and returns `success: false`, `providerInvocationSkipped: true`, `executionDisposition: 'not-started'`, `systemPromptUndeliverable: true` |
| adr-2026-10-24-system-prompt-delivery-is-a-declared-provider-capability#D3 | task | task-4, task-5, task-6 | return values equal to the unwrapped stub's |
| adr-2026-10-24-system-prompt-delivery-is-a-declared-provider-capability#D4 | task | task-8, task-11, task-13 | the file at `<p>`, read inside the stub, equals the `systemPrompt` exactly |
| adr-2026-10-24-system-prompt-delivery-is-a-declared-provider-capability#D5 | task | task-1, task-14 | The diff to `claude-provider.ts` and `codex-provider.ts` adds only the `systemPromptCapability` field line to each class. |
| adr-2026-10-24-system-prompt-delivery-is-a-declared-provider-capability#D6 | task | task-14 | rejects for a fixture built-in descriptor with id `drops-system-prompt` |
| adr-2026-10-24-system-prompt-delivery-is-a-declared-provider-capability#D7 | no-change | none | Direct binary launches (the interactive host launch, monitor sessions, model and capability probes) never call `LLMProvider.invoke` or carry `InvokeOptions.systemPrompt`; this feature leaves them untouched. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions; plan review sweeps this at Medium and Large tier

### Task rem-as-built-r1: pi-provider test (Task 11 suite): RED test where stat reports the prepared system-prompt path as a regular file but the injected readability check rejects; assert zero spawn-factory calls, success:false, output naming Pi, the path and 'is not a readable regular file', and the file disposed
**Gate:** as-built
**Rationale:** Verified (99%, observed): pi-provider.ts:564 gates the prepared system-prompt file with isFile(), which (:66-72) only calls stat().isFile() and never checks readability. ADR D4 says Pi must verify the path is a readable regular file before spawning. The architecture is unambiguous, so this is implementation drift routed to BUILD. Plan Task 11 ('Pi refuses to spawn when the system prompt cannot be prepared or verified') admits the repair. Its existing failure path already returns success:false, names the path and disposes of the file. Task 11's existing not-a-regular-file coverage is preserved. Sibling isFile() sites are found and excluded: HARNESS.md (:515), skills (:111) and package.json (:604) are outside D4 and Task 11.
**Governing clause:** adr-2026-10-24-system-prompt-delivery-is-a-declared-provider-capability decision 4
**Done when:**
- adr-2026-10-24-system-prompt-delivery-is-a-declared-provider-capability decision 4 is satisfied by this task.
- The repair for task rem-as-built-r1 is committed and its targeted tests pass.

### Task rem-as-built-r2: src/conductor/src/execution/pi-provider.ts: add an injectable readability check to PiEnvironment (default fs.promises.access with constants.R_OK) and require regular-file AND readable at the pre-spawn system-prompt check (:564)
**Gate:** as-built
**Rationale:** Verified (99%, observed): pi-provider.ts:564 gates the prepared system-prompt file with isFile(), which (:66-72) only calls stat().isFile() and never checks readability. ADR D4 says Pi must verify the path is a readable regular file before spawning. The architecture is unambiguous, so this is implementation drift routed to BUILD. Plan Task 11 ('Pi refuses to spawn when the system prompt cannot be prepared or verified') admits the repair. Its existing failure path already returns success:false, names the path and disposes of the file. Task 11's existing not-a-regular-file coverage is preserved. Sibling isFile() sites are found and excluded: HARNESS.md (:515), skills (:111) and package.json (:604) are outside D4 and Task 11.
**Governing clause:** adr-2026-10-24-system-prompt-delivery-is-a-declared-provider-capability decision 4
**Done when:**
- adr-2026-10-24-system-prompt-delivery-is-a-declared-provider-capability decision 4 is satisfied by this task.
- The repair for task rem-as-built-r2 is committed and its targeted tests pass.
