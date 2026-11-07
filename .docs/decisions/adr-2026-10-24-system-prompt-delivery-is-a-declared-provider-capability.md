# ADR: System-prompt delivery is a declared provider capability

**Date:** 2026-10-24
**Status:** APPROVED
**Deciders:** operator (jstoup111), composer DECIDE for #3309

## Context

`InvokeOptions.systemPrompt` (`execution/llm-provider.ts`) is part of the shared provider
contract, and `buildSystemPrompt` (`engine/step-runners.ts`) fills it on every step dispatch with
the step header, autonomous directives, revision guidance, tier context, and any `RETRY:` reason.
The build_review remediate judge sends its whole adjudication context as that `RETRY:` reason.

Claude delivers it through `--append-system-prompt-file`. Codex prepends it to stdin. The Pi
adapter (`execution/pi-provider.ts`) never reads the field, so every Pi-dispatched step runs
without it and nothing reports the loss (verified: `grep systemPrompt pi-provider.ts` is empty on
`791ce29818`).

Nothing in the contract makes a provider prove that it delivers the field. A provider can
implement `invoke`, which is the only required member (`adr-2026-08-24-one-dispatch-member-on-the-provider-contract`),
ignore `systemPrompt`, and look healthy.

Verified facts about Pi 1.0.0, read from the installed package source:

- `--append-system-prompt` may be repeated (`dist/cli/args.js`, which pushes each value onto an
  array).
- Each value goes through `resolvePromptInput` (`dist/core/resource-loader.js`). It reads the
  file's contents when `existsSync(value)`, and otherwise uses the value as literal text. If the
  file exists but cannot be read, Pi warns and falls back to the literal path string.
- The resolved values are joined with `"\n\n"` in argv order (`dist/core/agent-session.js`).
- Pi recognizes a skill command only as the first token of the first stdin line
  (`pi-provider.ts`, the `promptCommand` comment), so prefixing stdin would turn `/remediate` into
  plain text.

Every production `LLMProvider` instance, built-in or plugin, is obtained in exactly one place:
`registry.get<LLMProvider>('llm_provider', key)` in `createProviderRuntimeSet`
(`engine/provider-runtime.ts`). This is inferred from a trace of all thirteen production
`.invoke(` call sites and all seven `DefaultStepRunner` constructions. Confidence 92%.

## Options Considered

### Option A: Fix the Pi adapter only, plus a test convention
- **Pros:** smallest change; no dispatch-path code.
- **Cons:** the guarantee holds only for adapters the test happens to enumerate. A plugin or
  future provider can still drop the field silently, which is the failure this intake reports.

### Option B: Refuse inside `executeProviderCandidates`, next to the native-schema and spawn-permit checks
- **Pros:** sits beside existing per-candidate capability refusals.
- **Cons:** it does not cover the direct `this.provider.invoke` paths in `step-runners.ts` and
  `project-prelude.ts`. The native-schema check there is also skipped when
  `preparedCandidateOperation` is set. Coverage would depend on the path a dispatch happens to
  take.

### Option C: Wrap each resolved provider at `createProviderRuntimeSet` (chosen)
- **Pros:** every production invoke path receives the wrapped instance, so coverage is
  structural rather than per call site. It works the same way for built-in and plugin providers.
- **Cons:** a wrapper sits between the engine and the adapter, so it must be transparent to
  every other member and to `this` binding.

### Option D: Prepend the system prompt to Pi's stdin, as Codex does (filer hypothesis)
- **Rejected:** it breaks skill-command recognition on every Pi skill step. Passing literal text
  on argv instead fails with `E2BIG` above Linux's 128 KiB per-argument limit.

## Decision

1. **Delivery is a declared, fail-closed capability on the provider object.** `LLMProvider` gains
   an optional `systemPromptCapability` declaration, shaped like `lifecycleCapability` and
   `nativeSchemaCapability`. An absent declaration means the provider does not deliver
   `systemPrompt`. It lives on the provider object rather than in `plugin.yml` because
   `PluginRegistry` keeps only the instance and discards manifest `capabilities`. It is not
   duplicated as a catalog flag, because a second declaration for built-ins would be a parallel
   source of truth (`adr-2026-09-24-built-in-provider-catalog-and-boot-discovery` D1). That ADR's
   D2 fail-closed rule applies.
2. **One guard, applied where providers are resolved.** `createProviderRuntimeSet` wraps each
   resolved provider in a guard that intercepts `invoke` only. When `options.systemPrompt` is a
   non-empty string and the provider does not declare the capability, the guard returns without
   calling the adapter. Its result:
   - is not started and is marked as a skipped invocation (`providerInvocationSkipped`);
   - carries a reason that names the provider key, the missing `systemPromptCapability`, and the
     recovery action (declare and honor it);
   - is classified under its own capability name in candidate telemetry, never as
     `synchronous-spawn-permit`.

   An empty or absent `systemPrompt` passes through unchanged, matching how Claude and Codex
   already treat it.
3. **The guard is transparent.** It forwards every other member, prototype methods included, with
   `this` bound so that existing `.call(runtime.provider, …)` sites keep working. It is created
   fresh for each runtime set and never mutates or re-registers the registry instance, so building
   repeated sets never double-wraps, and non-extensible plugin module namespaces are not patched.
4. **Pi delivers through a private file.**
   - Pi writes `systemPrompt` to a per-invocation temp file with mode 0600 and passes it as a
     second `--append-system-prompt`, after HARNESS.md, so the harness rules stay first.
   - Before spawning, Pi verifies the path is a readable regular file. This closes Pi's fallback to
     treating an unreadable path as literal text. If the write or the check fails, Pi returns a
     named failure and does not spawn.
   - The file is removed after the run whether it succeeds, fails, or aborts.
   - Stdin carries only the prompt.
   - Pi declares the capability.
5. **Claude and Codex declare the capability; their delivery mechanisms are unchanged.**
6. **A cross-provider contract test holds the line.** For every entry in `BUILT_IN_PROVIDERS`, the
   test drives the adapter with a stub subprocess factory. It asserts that the adapter declares
   the capability and that the exact `systemPrompt` text, including text larger than 128 KiB,
   reaches that provider's transport.
7. **Out of scope:** paths that launch a provider binary without `LLMProvider.invoke` (the
   interactive host launch, monitor sessions, model and capability probes) never carry
   `InvokeOptions.systemPrompt`. This guard does not govern them.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | Every production `LLMProvider.invoke` call receives an instance resolved by `createProviderRuntimeSet` (traced across 13 call sites and 7 runner constructions) | inferred | 92% | yes | An unwrapped path could still drop the system prompt silently on an undeclared provider | APPROVED by operator 2026-10-24 |
| A2 | Pi 1.0.0 repeats `--append-system-prompt`, reads an existing path's contents, and joins values with a blank line (read in the installed package source) | verified | 95% | yes | Pi would receive the path string instead of the prompt | n/a (verified) |
| A3 | A Proxy keeps provider methods working, because adapters use TS `private`, not `#private` fields (no `#` fields in the three adapters) | verified | 90% | yes | Wrapped method calls would throw on private-field access | n/a (verified) |
| A4 | Failing closed on undeclared plugins breaks no plugin in current use (verified on this machine only, with no plugin providers installed; other installs unknown) | inferred | 80% | no | A third-party plugin stops receiving dispatches until it declares the capability | operator chose fail closed 2026-10-24 |

## Consequences

### Positive
- Every Pi step receives its engine-built system prompt, including the remediate adjudication
  context and RETRY reasons.
- A provider that cannot deliver a system prompt can no longer fail silently. It is refused by
  name before it starts.
- Prompt size never reaches argv, so prompts above 128 KiB reach Pi.

### Negative
- A third-party `llm_provider` plugin must add one declaration to keep receiving step dispatches.
- The engine now holds a wrapped instance rather than the registry's object. Any future identity
  comparison between providers would need to account for that.

### Follow-up Actions
- [ ] Add `systemPromptCapability` to `LLMProvider`, and declare it in the three built-in adapters.
- [ ] Implement the guard in `createProviderRuntimeSet`, with its own telemetry classification.
- [ ] Implement Pi file delivery with the pre-spawn readability check and disposal.
- [ ] Add the cross-provider contract test.
- [ ] Declare the capability on the reference plugin `plugins/recorder-provider`.
