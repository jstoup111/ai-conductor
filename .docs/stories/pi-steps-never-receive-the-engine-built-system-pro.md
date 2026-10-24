**Status:** Accepted

# Stories: Pi steps receive the engine-built system prompt (#3309)

Technical track. Sources: `.docs/track/pi-steps-never-receive-the-engine-built-system-pro.md`,
`.docs/decisions/adr-2026-10-24-system-prompt-delivery-is-a-declared-provider-capability.md`, and
`.docs/decisions/architecture-review-2026-10-24-pi-steps-never-receive-the-engine-built-system-pro.md`
(conditions C1 to C4).

## Story 1: A Pi dispatch receives the engine-built system prompt

**Requirement:** Track outcome 1 (Pi receives the same engine-built system-prompt content as Claude and Codex)

As the engine dispatching a step to Pi, I want Pi to receive `InvokeOptions.systemPrompt` in its
system prompt so that RETRY reasons, autonomous directives, and the remediate adjudication context
reach the model.

### Acceptance Criteria

#### Happy Path
- Given a Pi dispatch whose `systemPrompt` is `RETRY: fix the lint error\n[Conduct step 7/20]`, when Pi is spawned, then the argv carries `--append-system-prompt <HARNESS.md path>` followed by a second `--append-system-prompt <path>`, and at spawn time the file at that second path contains exactly the `systemPrompt` text.
- Given a Pi dispatch whose prompt is `/remediate` and whose `systemPrompt` carries a remediate adjudication context JSON, when Pi is spawned, then stdin is exactly `/remediate`, and the second appended file contains the full adjudication context JSON.
- Given a Pi dispatch carrying a `systemPrompt`, when Pi is spawned, then the HARNESS.md `--append-system-prompt` precedes the engine system-prompt `--append-system-prompt` in the argv.
- Given a Pi read-only review dispatch carrying a `systemPrompt`, when Pi is spawned, then the engine system prompt is appended the same way, and the read-only tool restriction flags are unchanged.

#### Negative Paths
- Given a Pi dispatch with no `systemPrompt`, when Pi is spawned, then the argv carries exactly one `--append-system-prompt` (HARNESS.md) and no system-prompt file is created.
- Given a Pi dispatch whose `systemPrompt` is the empty string, when Pi is spawned, then the argv carries exactly one `--append-system-prompt` and no system-prompt file is created.
- Given the temp directory cannot be written (for example `mkdtemp` rejects with `EACCES`), when a Pi dispatch carrying a `systemPrompt` runs, then Pi is not spawned and the result is `success: false`, with output naming Pi and stating that the system prompt could not be prepared for delivery.
- Given the prepared system-prompt path is not a readable regular file at the pre-spawn check, when a Pi dispatch carrying a `systemPrompt` runs, then Pi is not spawned and the result is `success: false`, with output naming Pi and the unreadable system-prompt path.
- Given a `systemPrompt` whose text begins with `/skill:remediate`, when Pi is spawned, then stdin still begins with the dispatch prompt, and the system-prompt text appears only in the appended file.

### Done When
- [ ] A Pi adapter test with a stub subprocess factory asserts the argv's two `--append-system-prompt` values in order, and that the second file's contents equal the supplied `systemPrompt`, read while the stub runs.
- [ ] A Pi adapter test asserts stdin equals the dispatch prompt exactly when a `systemPrompt` is supplied.
- [ ] Pi adapter tests assert no spawn and the named failure output for a temp-write failure and for a non-regular-file path.
- [ ] `PiProvider` declares `systemPromptCapability`.

## Story 2: A system prompt larger than 128 KiB reaches Pi

**Requirement:** Track outcome 2 (a system prompt larger than 128 KiB reaches Pi without `E2BIG`)

As the engine dispatching a large remediate adjudication context to Pi, I want the system prompt
delivered without putting its text in argv so that the spawn never fails on the per-argument size
limit.

### Acceptance Criteria

#### Happy Path
- Given a Pi dispatch whose `systemPrompt` is 300 KiB, when Pi is spawned, then no argv value contains the system-prompt text, every argv value is shorter than 131,072 bytes, and the appended file's contents equal the 300 KiB text byte for byte.
- Given a `systemPrompt` containing multi-byte UTF-8 characters (for example `é`, `→`, emoji), when Pi is spawned, then the appended file contains those characters encoded as UTF-8, byte for byte.

#### Negative Paths
- Given a `systemPrompt` of exactly 131,072 bytes, the per-argument limit, when Pi is spawned, then the spawn argv still carries only the file path, not the text.
- Given a `systemPrompt` containing NUL-free text with embedded newlines, when Pi is spawned, then no line of the system prompt appears as a separate argv entry.

### Done When
- [ ] A Pi adapter test supplies a 300 KiB `systemPrompt` and asserts no argv value contains the text, every argv value is under 131,072 bytes, and the file contents equal the input.
- [ ] A Pi adapter test round-trips a multi-byte UTF-8 `systemPrompt` through the file.

## Story 3: Pi's system-prompt file is private and always removed

**Requirement:** Track outcome 1 (delivery leaves no residue and does not expose prompt content)

As an operator, I want each Pi system-prompt file to be readable only by me and removed after
every invocation so that plan and review content does not accumulate in the temp directory.

### Acceptance Criteria

#### Happy Path
- Given a Pi dispatch carrying a `systemPrompt`, when Pi is spawned, then the file's mode is `0600`.
- Given a Pi dispatch carrying a `systemPrompt` that exits 0, when `invoke` returns, then the file and its private directory no longer exist.
- Given two concurrent Pi dispatches carrying different `systemPrompt` values, when both are spawned, then each argv names a different file, and each file contains only its own dispatch's text.

#### Negative Paths
- Given a Pi dispatch carrying a `systemPrompt` that exits non-zero, when `invoke` returns, then the file and its directory no longer exist.
- Given a Pi dispatch carrying a `systemPrompt` that is aborted mid-run, when `invoke` returns its aborted result, then the file and its directory no longer exist.
- Given a Pi dispatch carrying a `systemPrompt` whose spawn fails with `ENOENT`, when `invoke` returns its provider-unavailable result, then the file and its directory no longer exist.
- Given a Pi dispatch carrying a `systemPrompt` that is aborted after the file is written but before spawn, when `invoke` returns, then Pi was never spawned, and the file and its directory no longer exist.

### Done When
- [ ] Pi adapter tests assert the file is absent after success, non-zero exit, abort mid-run, abort before spawn, and `ENOENT`.
- [ ] A Pi adapter test asserts mode `0600` on the file while the stub runs.
- [ ] A Pi adapter test runs two invocations concurrently and asserts distinct paths and contents.

## Story 4: A provider that does not declare system-prompt delivery is refused by name

**Requirement:** Track outcome 3 (a provider that cannot deliver the system prompt fails the dispatch with a named, operator-readable reason)

As an operator, I want a dispatch that carries a system prompt to be refused before it starts when
the provider has not declared system-prompt delivery, so that no step silently runs without its
engine instructions.

### Acceptance Criteria

#### Happy Path
- Given a plugin `llm_provider` named `recorder` that does not declare `systemPromptCapability`, when a dispatch carrying a non-empty `systemPrompt` is invoked through a runtime from `createProviderRuntimeSet`, then the plugin's own `invoke` is never called, and the result is `success: false` with `providerInvocationSkipped: true` and `executionDisposition: 'not-started'`.
- Given the same refusal, when the result is read, then its output names the provider key `recorder`, the missing `systemPromptCapability` declaration, and the recovery action of declaring and honoring it.
- Given a plugin `llm_provider` that declares `systemPromptCapability`, when a dispatch carrying a `systemPrompt` is invoked through the runtime, then the plugin's `invoke` receives the options, `systemPrompt` included, unchanged.

#### Negative Paths
- Given a plugin that does not declare `systemPromptCapability`, when a dispatch with no `systemPrompt` is invoked through the runtime, then the plugin's `invoke` is called with the options unchanged.
- Given a plugin that does not declare `systemPromptCapability`, when a dispatch whose `systemPrompt` is the empty string is invoked, then the plugin's `invoke` is called.
- Given a plugin whose declaration is present but does not affirm delivery, when a dispatch carrying a `systemPrompt` is invoked, then it is refused exactly as an undeclared plugin is.
- Given a refusal inside the provider candidate path, when the attempt is recorded, then its setup-unavailable capability is the system-prompt delivery capability, never `synchronous-spawn-permit`.
- Given a daemon run in which a dispatch carrying a `systemPrompt` was refused for an undeclared plugin, when a later dispatch in the same run carries no `systemPrompt` and selects that plugin, then the plugin's `invoke` is called, because the refusal did not record the provider as unavailable.

### Done When
- [ ] A provider-runtime test registers an undeclared stub plugin, invokes it through `createProviderRuntimeSet` with a `systemPrompt`, and asserts zero calls to the stub's `invoke` and the named refusal fields.
- [ ] A provider-runtime test asserts pass-through for an absent or empty `systemPrompt` and for a declared plugin.
- [ ] A provider-execution test asserts the skipped candidate's setup-unavailable capability names system-prompt delivery.
- [ ] The reference plugin `plugins/recorder-provider` declares `systemPromptCapability`, and its existing tests pass.

## Story 5: The delivery guard is transparent to every other provider member

**Requirement:** Track outcome 4 (Claude and Codex delivery stays the same), and architecture condition C1

As the engine, I want the wrapped provider to behave exactly like the adapter for every member
other than a refused `invoke`, so that auth, self-host, readiness, and review paths keep working.

### Acceptance Criteria

#### Happy Path
- Given a built-in provider resolved through `createProviderRuntimeSet`, when `prepareSelfHostAuth`, `resolveSelfHostExecutable`, `readiness`, or `readOnlyReviewObservedCommandReach` is called on `runtime.provider`, including through `.call(runtime.provider, …)`, then the adapter's method runs with access to its own private state, and returns what the unwrapped adapter returns.
- Given a resolved provider, when `supportsSessionResume`, `lifecycleCapability`, `nativeSchemaCapability`, or `systemPromptCapability` is read from `runtime.provider`, then the values equal the adapter's.
- Given `createProviderRuntimeSet` is called twice on the same registry, when either set's provider is invoked with a `systemPrompt` it declares, then the adapter's `invoke` is called exactly once per dispatch, and the registry still holds the original, unwrapped instance.

#### Negative Paths
- Given a plugin exported as a frozen or non-extensible module namespace, when `createProviderRuntimeSet` wraps it, then wrapping does not throw, and the plugin's members are reachable through `runtime.provider`.
- Given a plugin that does not implement the optional `readiness` method, when `runtime.provider.readiness` is read, then it is `undefined`, exactly as on the unwrapped plugin.

### Done When
- [ ] A provider-runtime test calls each listed method through the wrapped provider with `.call(runtime.provider, …)` against a class-based stub with private state, and asserts the result.
- [ ] A provider-runtime test builds two runtime sets from one registry and asserts one adapter `invoke` per dispatch, and that the registry instance is unwrapped.
- [ ] A provider-runtime test wraps a frozen namespace-shaped plugin without throwing.

## Story 6: Every built-in provider declares and delivers the system prompt

**Requirement:** Track outcome 4 (Claude and Codex delivery stays the same), and a cross-provider regression guard

As a maintainer, I want one contract suite to prove that every built-in provider declares and
actually delivers `systemPrompt`, so that a new or changed adapter cannot silently drop it again.

### Acceptance Criteria

#### Happy Path
- Given every entry in `BUILT_IN_PROVIDERS`, when the contract suite runs, then each adapter declares `systemPromptCapability`.
- Given Claude with a `systemPrompt`, when it is spawned, then the argv carries `--append-system-prompt-file <path>`, and that file contains the exact text, as before this change.
- Given Codex with a `systemPrompt` and a prompt, when it is spawned, then stdin is `<systemPrompt>\n\n<prompt>`, as before this change.
- Given Pi with a `systemPrompt`, when it is spawned, then the text reaches Pi through the appended file (Story 1).
- Given each built-in provider and a 300 KiB `systemPrompt`, when the contract suite runs, then each provider's transport carries the full text, and no argv value contains it.

#### Negative Paths
- Given a built-in descriptor whose adapter accepts `systemPrompt` but leaves it out of every transport, when the contract suite runs against it, then the suite fails, naming that provider id.
- Given the existing Claude and Codex transport tests, when this change lands, then they pass with no edits to their expected argv or stdin.

### Done When
- [ ] One contract test file iterates `BUILT_IN_PROVIDERS` and asserts the declaration and text delivery for each provider, including the 300 KiB case.
- [ ] The suite contains a negative fixture adapter that drops `systemPrompt`, and asserts the suite's checker fails, naming it.
- [ ] Existing Claude and Codex provider tests pass unmodified.
