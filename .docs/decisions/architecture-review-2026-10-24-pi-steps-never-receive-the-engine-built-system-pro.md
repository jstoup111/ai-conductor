# Architecture Review: Pi steps never receive the engine-built system prompt
**Date:** 2026-10-24
**Inputs reviewed:** no PRD and no stories. This is the pre-stories lightweight review (Tier M,
technical track). Its inputs are:
- `.docs/track/pi-steps-never-receive-the-engine-built-system-pro.md`
- `.docs/complexity/pi-steps-never-receive-the-engine-built-system-pro.md`
- the approved diagram `.docs/architecture/pi-steps-never-receive-the-engine-built-system-pro.md`
- intake jstoup111/ai-conductor#3309

**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | Plain TypeScript in the existing engine and adapters, with no new dependency. Temp-file creation reuses the shape of Claude's `writeSystemPromptFile` (`claude-provider.ts`): a private directory, a 0600 file, and a dispose step. |
| Prerequisites | None. Pi 1.0.0's repeatable `--append-system-prompt` is already installed and verified. |
| Integration surface | Two modules in `execution/` (the `LLMProvider` contract and the three adapters) and one in `engine/` (`provider-runtime.ts`). Candidate telemetry classification is in `provider-execution.ts`. Everything is in-process. |
| Data implications | None persisted. The temp file is per invocation and removed afterwards. |
| Performance risk | One file write and one stat per Pi invocation that carries a system prompt. The guard is one property read per invoke. |
| Worktree isolation | No ports, services or shared files. The temp file uses a private, uniquely named directory, so concurrent worktrees cannot collide. |

**Verified facts behind the design (2026-10-24):**

- `retryReason` is prefixed inside `buildSystemPrompt` (`step-runners.ts`, `RETRY: ${retryReason}`), so it travels as `InvokeOptions.systemPrompt`, not as the user prompt. Confidence 98%, verified. This falsifies an assertion in `architecture-review-2026-10-23-build-review-remediate-context-grows-with-the-whol`, which is amended in place.
- Pi 1.0.0 behavior: `--append-system-prompt` is repeatable, each value is read as file contents when the path exists and as literal text otherwise, an unreadable file falls back to the literal path string with a warning, and values are joined with a blank line. Confidence 95%, verified in the installed package (`dist/cli/args.js`, `dist/core/resource-loader.js`, `dist/core/agent-session.js`).
- Pi recognizes a skill command only as the first token of stdin, so a stdin prefix is not viable. Confidence 95%, verified (`pi-provider.ts`, the `promptCommand` comment).
- `createProviderRuntimeSet` is the only production `registry.get<LLMProvider>` lookup, and every production `invoke` call site reaches an instance it produced. Confidence 92%, inferred from a read-only trace of 13 call sites and 7 `DefaultStepRunner` constructions. This is ADR assumption A1.
- Adapter methods live on the class prototype (`prepareSelfHostAuth`, `resolveSelfHostExecutable`, `readiness`, `readOnlyReviewObservedCommandReach`), and `conductor.ts` calls them with `.call(runtime.provider, …)`. The adapters use TS `private`, not `#private` fields. Confidence 90%, verified.
- `skippedCandidateSetupUnavailable` (`provider-execution.ts`) labels any skipped `providerUnavailable` result as `synchronous-spawn-permit`. Confidence 95%, verified.

## Alignment

- **`adr-2026-09-24-built-in-provider-catalog-and-boot-discovery` D1 and D2.** The capability is
  fail-closed, and its refusal names the provider, the missing capability and the recovery
  action. No provider id is written outside the catalog and the adapters; the guard reads only the
  declaration. Aligned.
- **`adr-2026-08-24-one-dispatch-member-on-the-provider-contract`.** `invoke` stays the only
  dispatch member. The new declaration is optional data, not a second dispatch member, and a
  plugin entrypoint still needs only `invoke` to load. Aligned.
- **`adr-2026-07-27-codex-never-resumes-a-harness-minted-session`.** That ADR added a declared,
  fail-closed provider capability; this follows the same precedent. Aligned.
- **`adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability` D1.** The admission
  gate owns availability and suppression refusals. A capability refusal is not an availability
  refusal (the native-schema and spawn-permit checks already sit outside the gate), so the guard
  does not route through the gate and does not cache the provider as unavailable. Aligned, under
  condition C2.
- **`architecture-review-2026-09-29-harness-skills-and-context-files-reach-pi-sessions` D1.** Pi's
  argv stays in `pi-provider.ts`. Aligned.
- **Pattern basis (local precedent).** `lifecycleCapability` and `nativeSchemaCapability` on
  `LLMProvider` are the precedent for this declaration. The traits to keep are an optional
  instance declaration, a fail-closed absent value, and a refusal that names the provider.
  Allowed variation: this check is enforced by a resolution-time wrapper rather than inside
  `executeProviderCandidates`, because the direct `this.provider.invoke` paths bypass that
  function. Rediscovery hints: `ProviderNativeSchemaCapability` in `execution/llm-provider.ts`,
  and `unsupportedNativeSchemaProviderResult` in `engine/provider-execution.ts`.
- **Security.** The temp file holds prompt text that can include plan and review content, so it is
  written 0600 in a private directory and always removed. That matches Claude's existing handling.
- **Diagram accuracy.** The approved diagram reflects this design.

## Wiring Surface

| New surface | Production caller (design-time) |
|---|---|
| `LLMProvider.systemPromptCapability` declaration | Read by the delivery guard. Declared by `ClaudeProvider`, `CodexProvider` and `PiProvider`, which are registered by `registerBuiltInLlmProviders`. |
| System-prompt delivery guard | Applied in `createProviderRuntimeSet` (`engine/provider-runtime.ts`), which the daemon (`daemon-cli.ts`), the CLI (`index.ts`), the executor child (`executor-child-runtime.ts`) and plan review (`engineer-cli.ts`) already call. |
| Pi temp-file delivery | Inside `PiProvider.invoke`, which every Pi dispatch reaches through the guard. |
| Telemetry classification for the refusal | `skippedCandidateSetupUnavailable` in `provider-execution.ts`, which already classifies skipped candidates. |

Overlap scan (advisory): `claude-provider.ts` is also touched by
`spec/daemon-log-flooded-with-raw-claude-stream-json-and`. This design makes Claude only declare
the capability, a one-line addition that does not touch delivery, so a conflict would be trivial.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A production invoke path receives an unwrapped provider (A1 wrong) | Technical | Low | Medium | Contract test asserts every runtime from `createProviderRuntimeSet` refuses an undeclared stub; the as-built reachability sweep re-traces callers |
| Wrapper drops a prototype method or breaks `this` | Technical | Medium | High | Proxy-based forwarding (condition C1); test that `prepareSelfHostAuth`, `readiness` and `resolveSelfHostExecutable` reach the adapter with the correct `this` |
| A third-party plugin provider stops receiving step dispatches | Integration | Low | Medium | Named refusal tells the operator exactly what to declare; plugin docs updated |
| A future Pi release changes `--append-system-prompt` resolution | Integration | Low | High | Pre-spawn readability check, plus a contract test pinned to the argv shape; a Pi upgrade that changes resolution fails the test |
| The temp file is left behind on a crash | Security | Low | Low | `finally` disposal, a private 0600 directory under the OS temp dir |

## ADRs Created

- `adr-2026-10-24-system-prompt-delivery-is-a-declared-provider-capability` (APPROVED by operator 2026-10-24; A1 approved).
- Amended: `architecture-review-2026-10-23-build-review-remediate-context-grows-with-the-whol`
  (an additive note on the falsified transport assertion).

## Conditions

- **C1.** The guard forwards every member except `invoke`, including prototype methods, with `this`
  bound to a target that keeps them working. A test covers `prepareSelfHostAuth`, `readiness`,
  `resolveSelfHostExecutable` and `readOnlyReviewObservedCommandReach` through the wrapper.
- **C2.** A guard refusal is classified under its own capability name in `provider_attempt`
  telemetry, never as `synchronous-spawn-permit`, and it does not mark the provider unavailable in
  daemon-scoped availability.
- **C3.** Pi never spawns with a system-prompt path it has not verified to be a readable regular
  file, and always disposes of the file.
- **C4.** Claude's and Codex's argv and stdin are unchanged when they are given a system prompt,
  proven by their existing tests passing without edits to their expected transport.
