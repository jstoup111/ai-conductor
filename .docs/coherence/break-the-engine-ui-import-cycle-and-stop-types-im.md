# Coherence: Enforce the documented source layer directions (#1017)

**Date:** 2026-10-12
**Tier:** M
**Track:** technical. The `fr` row class is omitted because there is no PRD. The stories carry the requirement layer.
**Outcome source:** jstoup111/ai-conductor#1017. The staged `.pipeline/intake-outcomes.md` has an empty `## Desired outcome` section, because the issue's outcomes sit under a `###` heading. So the outcome row class is not required and is omitted.

**ADR rows.** The current spec change set contains one ADR file, `adr-2026-10-12-enforced-source-layer-directions`, which has one `adr` row. Its seven decisions are mapped in the plan's `## Architecture Obligation Coverage` table. That table was judged decision by decision (§4f):
- **D1 and D6:** Tasks 14 and 15 assert the extended upward rule and the emptied allowlist.
- **D2:** Task 1 asserts the emitter relocation and the re-export.
- **D3:** Task 2 asserts entry-level terminal composition.
- **D4:** Tasks 3 to 9 assert that no `execution/` file imports `engine/`.
- **D5:** Tasks 10 to 13 assert that `types/` imports nothing outside itself. This includes the opaque `ProviderId` exception.
- **D7 (`no-change`):** genuine. D7 assigns the documentation refresh to the `maintain-documentation` SHIP step, so the plan owes no implementation for it.

**Criterion rows.** These are generated from the same source as the plan's Coverage Check. That table passed independent coverage judgement on every row: round 1 passed 23 of 32, round 2 passed 31 of 32 after revision, and round 3 passed the last two revised claims.

**Consistency (§4d).** Three rounds of independent contradiction judgement on the plan cleared every conflict raised:
- Task 13 against `adr-2026-09-24` D1, resolved with the opaque `ProviderId`.
- Task 11 against Task 12, resolved by narrowing Task 11.
- Task 2 against D3, resolved by rewording D3.
- Task 4's missing evidence path, resolved with a new import-path test case.

The coherence sweep was run by fresh subagents (§4d) in two rounds:
- Round 1 found that Tasks 2, 6 and 7 promised existing tests would pass "unchanged" while moving modules those tests import. Tasks 6 and 7 now keep downward re-exports, and Task 2 re-points its registration tests. The five affected coverage claims passed re-judgement.
- Round 2 returned no conflicts. The unconfirmed risks it listed were checked against the source: `cli-builtins` is imported only by `index.ts`, no `execution/` file imports `ui/`, and every `engine/` → `ui/` edge is removed by Tasks 1 and 2.

**Preserved behaviour.** No task adds a runtime side effect on a production path. Every production change is a relocation, a re-export, a type, or a required injected port that is passed the identical `ensureGitGuardForDispatch`. So Stories 2–4's "as before" and "unchanged" promises hold.

**Achievability (§4g).** Each criterion row names the mechanism that delivers it, together with its observable assertion:
- the relocated emitter and its existing tests;
- `registerTerminalBuiltins`;
- the moved modules and their existing tests;
- the `DispatchGitGuard` port with its `@ts-expect-error` check;
- the registry `satisfies` constraints;
- the extended #1988 ratchet extraction.

| Row class | Cited id | Counterpart id(s) | Verdict | Notes |
| --- | --- | --- | --- | --- |
| story | story-1 | task-14, task-15 | covered | Tasks whose Story line cites Story 1. |
| story | story-2 | task-1 | covered | Tasks whose Story line cites Story 2. |
| story | story-3 | task-2 | covered | Tasks whose Story line cites Story 3. |
| story | story-4 | task-3, task-4, task-5, task-6, task-7, task-8, task-9 | covered | Tasks whose Story line cites Story 4. |
| story | story-5 | task-10, task-11, task-12, task-13 | covered | Tasks whose Story line cites Story 5. |
| task | task-1 | story-2 | covered | Relocate the event emitter into engine |
| task | task-2 | story-3 | covered | Compose terminal UI at the entry level |
| task | task-3 | story-4 | covered | Move provider-setup-failure into execution |
| task | task-4 | story-4 | covered | Move isFeatureSlug into execution |
| task | task-5 | story-4 | covered | Move the real-exec guard into execution |
| task | task-6 | story-4 | covered | Move provider model-policy defaults into execution |
| task | task-7 | story-4 | covered | Move the build-review read-only capability into execution |
| task | task-8 | story-4 | covered | Move the scratch-schema writer into execution |
| task | task-9 | story-4 | covered | Invert the dispatch git guard into a required provider port |
| task | task-10 | story-5 | covered | Move provider port types into types |
| task | task-11 | story-5 | covered | Move engine-owned event and refusal types into types |
| task | task-12 | story-5 | covered | Declare the GitHub operation-name union in types and bind the registry to it |
| task | task-13 | story-5 | covered | Make provider ids opaque, and bind rubric ids and the event bus, in types |
| task | task-14 | story-1 | covered | Extend the ratchet's upward rule to every import form |
| task | task-15 | story-1 | covered | Close the ratchet's upward-edge allowlist |
| adr | adr-2026-10-12-enforced-source-layer-directions | story-1, story-2, story-3, story-4, story-5 | covered | D1 and D6 map to Story 1; D2 to Story 2; D3 to Story 3; D4 to Story 4; D5 to Story 5; D7 is no-change, delivered by the maintain-documentation SHIP step. Each Architecture Obligation Coverage row was judged to satisfy its decision. |
| criterion | Story 1 happy: Given the final `src/conductor/src/` tree, when the #1988 import-graph ratchet runs in the default test tier, then it passes and its allowlist contains no entry for an upward edge between layers. | task-14, task-15 | covered | "the ratchet passes on the real tree" | diff-local |
| criterion | Story 1 happy: Given a file that imports only from its own layer or a lower layer, including `ui/` importing `execution/` and an entry-point file importing another entry-point file, when the ratchet evaluates it, then no violation is reported for that file. | task-14 | covered | "an `engine/` import of `execution/`, an `engine/` import of `types/`, a same-layer import, a `ui/` import of `execution/`, and an entry-point import of another entry-point file each report no violation" | diff-local |
| criterion | Story 1 negative: Given a fixture in which an `engine/` file has a value import from `ui/`, when the ratchet evaluates it, then it reports a violation naming the importing file, its line number, and the `engine -> ui` edge. | task-14 | covered | "an `engine/` value import from `ui/` and a `types/` `import type` from `engine/` are each reported as an upward violation naming the importing file, its line number, and the layer edge" | diff-local |
| criterion | Story 1 negative: Given a fixture in which a `types/` file has an `import type` from `engine/`, when the ratchet evaluates it, then it reports the edge as an upward violation rather than exempting it for being type-only. | task-14 | covered | "an `engine/` value import from `ui/` and a `types/` `import type` from `engine/` are each reported as an upward violation" | diff-local |
| criterion | Story 1 negative: Given a fixture in which an `execution/` file uses `export ... from` on an `engine/` module, when the ratchet evaluates it, then it reports the re-export as an upward violation. | task-14 | covered | "an `execution/` `export ... from` an `engine/` module" | diff-local |
| criterion | Story 1 negative: Given a fixture in which an `engine/` file calls dynamic `import()` on a `ui/` module, when the ratchet evaluates it, then it reports the dynamic import as an upward violation. | task-14 | covered | "an `engine/` dynamic `import()` of a `ui/` module" | diff-local |
| criterion | Story 1 negative: Given a fixture in which a layer file imports an entry-point file such as `index.ts`, or a runtime file imports `tools/`, when the ratchet evaluates it, then it reports a violation. | task-14 | covered | "a layer file importing `index.ts` and a runtime file importing `tools/` are each reported as a violation" | diff-local |
| criterion | Story 1 negative: Given an allowlist entry for an upward edge that this feature removed, when the ratchet runs, then it fails because that allowlisted edge no longer exists, so the entry must be deleted. | task-15 | covered | "an allowlist entry for a removed upward edge fails the ratchet because that edge no longer exists" | diff-local |
| criterion | Story 2 happy: Given the relocated emitter, when engine code emits a `ConductorEvent` with registered sync and async handlers, then every handler receives the event and `emit` resolves only after the async handlers settle. | task-1 | covered | "`emit` awaits async handlers" | diff-local |
| criterion | Story 2 happy: Given a module that still imports `ConductorEventEmitter` from `ui/events.js`, when it constructs an emitter and passes it to engine code typed against the relocated class, then type checking passes and `instanceof` holds against both import paths. | task-1 | covered | "`instanceof` holds both ways between `ConductorEventEmitter` imported from `ui/events.js` and from `engine/conductor-event-emitter.js`" | diff-local |
| criterion | Story 2 negative: Given a registered handler that throws synchronously or rejects, when `emit` is called, then the error is swallowed and the remaining handlers still run, exactly as before the move. | task-1 | covered | "`emit` swallows sync throws and async rejections while still running the remaining handlers" | diff-local |
| criterion | Story 2 negative: Given a registered handler that rejects, when `emitOrThrow` is called, then the failure still propagates to the caller. | task-1 | covered | "`emitOrThrow` propagates a rejecting handler's failure" | diff-local |
| criterion | Story 2 negative: Given any `src/` file in `engine/`, `execution/`, or `types/`, when the layer-direction test runs, then no file below `ui/` imports the emitter through `ui/events.js`. | task-1, task-15 | covered | "no file under `src/conductor/src/engine/` imports a `ui/events` path" | diff-local |
| criterion | Story 3 happy: Given an interactive CLI run with renderer options, when built-ins are registered at start-up, then a terminal renderer is registered as `ui_renderer:terminal` and a terminal subscriber is started, as today. | task-2 | covered | "registration with renderer options registers `ui_renderer:terminal` and starts a terminal subscriber" | diff-local |
| criterion | Story 3 happy: Given daemon start-up, when built-ins are registered, then the daemon's terminal subscriber is started and stopped on the same lifecycle as before the change. | task-2 | covered | "the daemon boot path starts and stops its terminal subscriber on the same lifecycle" | diff-local |
| criterion | Story 3 happy: Given engine-side plugin registration, when it runs, then the built-in providers are registered as before. | task-2 | covered | "engine-side `registerBuiltins` still registers every built-in `llm_provider`" | diff-local |
| criterion | Story 3 negative: Given a registration call with no renderer options, when built-ins are registered, then no terminal renderer is registered, matching current behaviour. | task-2 | covered | "registration without renderer options registers no terminal renderer" | diff-local |
| criterion | Story 3 negative: Given a test that loads engine-side plugin registration, when its module graph is resolved, then no `ui/` module is part of that graph. | task-15 | covered | "no `engine/` module has a `ui/` module in its import closure" | diff-local |
| criterion | Story 4 happy: Given a provider dispatch for Claude, Codex, or Pi in a worktree, when the provider is constructed by the engine and invoked, then the git guard is installed for the dispatch exactly as before. | task-9 | covered | "the git guard is installed for the dispatch exactly as before when the engine-created adapter is invoked" | diff-local |
| criterion | Story 4 happy: Given a Codex or Pi self-host dispatch, when the provider is invoked, then the scratch schema is written and the Codex read-only producer root policy arguments are produced as before. | task-7, task-8 | covered | "the Codex read-only producer root policy arguments are produced as before" | diff-local |
| criterion | Story 4 happy: Given any file under `execution/`, when the layer-direction test runs, then it imports nothing from `engine/` or `ui/`. | task-15 | covered | "no `execution/` file imports `engine/` or `ui/`" | diff-local |
| criterion | Story 4 negative: Given `AI_CONDUCTOR_NO_REAL_EXEC` is set, when a code path reaches the real-exec guard from either the execution layer or the engine, then the same blocking error is thrown as before. | task-5 | covered | "both the engine `makeProductionGh` path and the execution-layer Pi self-host auth path throw the same blocking error" | diff-local |
| criterion | Story 4 negative: Given provider setup is unavailable, when a provider raises the setup-unavailable error, then engine-side classification still recognizes it, because a single error class is shared across layers. | task-3 | covered | "engine-side classification recognizes a `ProviderSetupUnavailableError` raised by an execution-layer provider" | diff-local |
| criterion | Story 4 negative: Given a self-host scratch sweep that emits cleanup events, when it runs after the scratch-schema writer has moved to the execution layer, then those events still reach the engine's event spine and the persisted event log. | task-8 | covered | "the sweep emits its cleanup `ConductorEvent` to the engine emitter and that the event persister writes it to the event log" | diff-local |
| criterion | Story 4 negative: Given a provider constructed without a required injected port, when type checking runs, then compilation fails rather than the provider silently skipping the guard. | task-9 | covered | "constructing any of the three providers without `dispatchGitGuard` is a compile error" | diff-local |
| criterion | Story 4 negative: Given a slug value, when `isFeatureSlug` is evaluated from the execution layer or the engine, then both return identical results for valid and invalid slugs. | task-4 | covered | "identical accept and reject results for valid and invalid slugs whether imported via `engine/worktree.js` or `execution/feature-slug.js`" | diff-local |
| criterion | Story 5 happy: Given the final tree, when the layer-direction test scans `types/`, then no file imports from `execution/`, `engine/`, or `ui/`, including type-only imports. | task-13, task-15 | covered | "No static or inline import in any `src/conductor/src/types/*.ts` file resolves outside `src/conductor/src/types/`" | diff-local |
| criterion | Story 5 happy: Given modules that formerly declared moved types, when they reference those types, then they import them from `types/` and type checking passes. | task-10, task-11 | covered | "`npm run typecheck` in `src/conductor` exits 0" | diff-local |
| criterion | Story 5 negative: Given a new operation added to the GitHub operation registry without a matching member in the `types/` operation-name union, when type checking runs, then it fails. | task-12 | covered | "a registry with an operation absent from the union" | diff-local |
| criterion | Story 5 negative: Given a member added to the `types/` operation-name union without a matching registry entry, when type checking runs, then it fails. | task-12 | covered | "a registry missing a union member are each compile errors" | diff-local |
| criterion | Story 5 negative: Given a build-review rubric id that differs between `types/` and its implementation source, when type checking runs, then it fails. | task-13 | covered | "a rubric descriptor record missing a `BuildReviewRubricId` or carrying an extra rubric id is a compile error" | diff-local |
| criterion | Story 5 negative: Given an existing serialized `ConductorEvent` payload, when it is persisted and read back after the move, then its shape is unchanged. | task-10, task-11 | covered | "a persisted `ConductorEvent` payload reads back with an unchanged shape" | diff-local |
