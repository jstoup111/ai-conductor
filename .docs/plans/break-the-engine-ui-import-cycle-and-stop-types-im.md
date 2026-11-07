# Implementation Plan: Enforce the documented source layer directions (#1017)

**Date:** 2026-10-12
**Design:** `.docs/decisions/adr-2026-10-12-enforced-source-layer-directions.md` (technical track, no PRD)
**Stories:** `.docs/stories/break-the-engine-ui-import-cycle-and-stop-types-im.md` (accepted stories)
**Conflict check:** Clean as of 2026-10-12

## Summary

This is roadmap slice 3 of `adr-2026-10-07-conductor-decomposition-target-architecture`. It removes
every upward import between the five layers of `src/conductor/src/` and closes the #1988
import-graph ratchet over them. There are 15 tasks.

## Technical Approach

- **Order.**
  1. Move the event emitter down first, as one task (architecture-review condition 2).
  2. Then move terminal composition up, out of `engine/`.
  3. Then resolve the `execution/` → `engine/` edges, by moving each dependency down or inverting it.
  4. Then make `types/` self-contained.
  5. Last, extend the ratchet to type-only edges, and verify that its allowlist holds no upward entry.
- **The ratchet.** The #1988 ratchet (`adr-2026-10-07` D5) is the only layering checker, and this
  plan builds no second one.
  - It is shrink-only: an allowlist entry whose edge no longer exists fails it. So **every move
    task deletes the ratchet allowlist entry for each upward edge it removes, in the same commit.**
  - Because of that, the type-only extension (Task 14) runs only after every type-only upward edge
    is gone.
  - #1988's allowlist file layout does not exist yet. Tasks refer to it by behaviour: "the allowlist
    entry for edge X". The implementer resolves the concrete path on their checkout.
- **Re-exports keep churn small.** Relocated symbols stay re-exported from their old modules
  wherever the re-export points downward, which is allowed:
  - `ui/events.ts` re-exports the emitter;
  - `engine/worktree.ts` re-exports `isFeatureSlug`;
  - `engine/tracker-client.ts` re-exports `assertRealExecAllowed`;
  - `engine/provider-model-policy-defaults.ts` and `engine/build-review-read-only-capability.ts` re-export their moved modules;
  - `execution/llm-provider.ts` re-exports the provider types that move to `types/`.

  Importers *below* the re-exporting layer are re-pointed. Importers above it are left alone.
- **How each `execution/` → `engine/` dependency is resolved** (ADR D4; architecture-review
  condition 1). Evidence is each dependency's import list on 2026-10-12.

  | Dependency | Its internal imports | Resolution | Task |
  | --- | --- | --- | --- |
  | `engine/provider-setup-failure.ts` | none | move module to `execution/` | 3 |
  | `isFeatureSlug` in `engine/worktree.ts` | the function is pure; the module imports `tracker-client.js` | move function to `execution/feature-slug.ts` | 4 |
  | `assertRealExecAllowed` in `engine/tracker-client.ts` | the function reads only `process.env`; the module has 16 imports | move function to `execution/real-exec-guard.ts` | 5 |
  | `engine/provider-model-policy-defaults.ts` | `types/` only | move module to `execution/` | 6 |
  | `engine/build-review-read-only-capability.ts` | `execution/` only | move module to `execution/` | 7 |
  | `writeScratchSchema` in `engine/self-host/provider-scratch.ts` | the function uses only `node:path` and `node:fs`; the module imports `provider-home`, `types/`, `ui/` | move function to `execution/scratch-schema.ts` | 8 |
  | `ensureGitGuardForDispatch` in `engine/git-guard.ts` | `git-hook-assets.ts`, which pulls in `protected-artifact-seal`, `canonical-launcher` and `git-option-spec` | invert into a required `DispatchGitGuard` port | 9 |

- **Git-guard port.**
  - `execution/llm-provider.ts` declares `DispatchGitGuard = (cwd: string | undefined) => Promise<string | null>`.
  - `ClaudeProvider`, `CodexProvider` and `PiProvider` take it as a **required** constructor
    option, and the `createAdapter` options in `execution/provider-catalog.ts` require it too.
  - Engine code that creates adapters passes `ensureGitGuardForDispatch`.
  - Test construction sites pass the same real function through one shared test fixture, so guard
    behaviour under test is unchanged.
- **`types/` ownership** (ADR D5).
  - Interface and alias types move into `types/`.
  - Registry-derived types become explicit unions in `types/`, with a two-way compile-time
    constraint: the registry `satisfies` a record keyed by the union.
  - Built-in provider ids are the exception. Because `adr-2026-09-24` D1 makes the catalog the only
    place they are written, `types/` declares an opaque branded `ProviderId`, and the catalog keeps
    `BuiltInProviderId` and converts into it.
  - Inline `import('…')` type references in `types/` are included.
  - `types/plugin.ts` types its emitter against a new `ConductorEventBus` interface in `types/`,
    which `ConductorEventEmitter` `implements`.
- **Documentation** (ADR D7) is delivered by this repository's `maintain-documentation` SHIP step.
  The plan has no documentation task.
- **Change class: refactor.** Pure relocation tasks are `Verify-only: yes`, and the existing suite
  is their oracle. Tasks that add a test or a compile-time constraint are not.

## Prerequisites

- **#1988 has merged**, providing the TypeScript-AST import-graph ratchet with its keyed,
  shrink-only allowlist. The spec lands with `--depends-on jstoup111/ai-conductor#1988`.

## Tasks

### Task 1: Relocate the event emitter into engine
**Story:** Story 2
**Type:** refactor

**Steps:**
1. Write a failing test in `src/conductor/test/engine/conductor-event-emitter.test.ts`. It constructs an emitter imported from `ui/events.js`, checks it is `instanceof` the class imported from `engine/conductor-event-emitter.js`, and checks the reverse direction too.
2. Verify that it fails (RED), because the engine module does not exist yet.
3. Implement:
   - Move `ConductorEventEmitter` and `EventHandler` verbatim from `src/conductor/src/ui/events.ts` to `src/conductor/src/engine/conductor-event-emitter.ts`.
   - Replace the body of `ui/events.ts` with `export { ConductorEventEmitter, type EventHandler } from '../engine/conductor-event-emitter.js';`.
   - Re-point every `src/conductor/src/engine/**` importer of `ui/events.js` to the new module. That is 54 files, including `engine/self-host/provider-scratch.ts`.
   - Leave test importers unchanged.
4. Delete the ratchet allowlist entry for every `engine -> ui/events` edge removed.
5. Verify GREEN, plus the existing emitter and persister tests.
6. Commit.

**Done when:**
- [test] the conductor-event-emitter test asserts `instanceof` holds both ways between `ConductorEventEmitter` imported from `ui/events.js` and from `engine/conductor-event-emitter.js`, and passes a `ui/events.js`-imported emitter to a function parameter typed with the engine `ConductorEventEmitter` while `npm run typecheck` in `src/conductor` exits 0.
- [test] the existing emitter tests pass unchanged, asserting that `emit` awaits async handlers, that `emit` swallows sync throws and async rejections while still running the remaining handlers, and that `emitOrThrow` propagates a rejecting handler's failure.
- `src/conductor/src/ui/events.ts` contains only the re-export, and no file under `src/conductor/src/engine/` imports a `ui/events` path.
- The ratchet passes after the deleted `engine -> ui/events` allowlist entries.

**Files likely touched:**
- `src/conductor/src/engine/conductor-event-emitter.ts` — new; the moved class.
- `src/conductor/src/ui/events.ts` — re-export only.
- `src/conductor/src/engine/**/*.ts` — importer path rewrites (54 files).
- `src/conductor/test/engine/conductor-event-emitter.test.ts` — new identity test.

**Dependencies:** none

### Task 2: Compose terminal UI at the entry level
**Story:** Story 3
**Type:** refactor

**Steps:**
1. Write a failing test in `src/conductor/test/terminal-builtins.test.ts`:
   - Calling `registerTerminalBuiltins` from `src/conductor/src/terminal-builtins.ts` with renderer options registers `ui_renderer:terminal` and returns a started `TerminalSubscriber`.
   - Calling it without renderer options registers no `ui_renderer`.
2. Verify that it fails (RED).
3. Implement:
   - Create the entry-level module `src/conductor/src/terminal-builtins.ts`. It holds the `TerminalRenderer` and `TerminalSubscriber` construction and registration currently in `engine/plugin-loader.ts` `registerBuiltins`.
   - Reduce `registerBuiltins` to provider registration.
   - Move `src/conductor/src/engine/cli-builtins.ts` to `src/conductor/src/cli-builtins.ts`, re-pointing its `index.ts` import.
   - Call the new composition from the existing `index.ts` CLI boot and `daemon-cli.ts` daemon boot. Keep `adr-2026-09-24` D3's ordering: discovery before built-in registration.
   - Keep the `UIRenderer` and `UISubscriber` contracts of `003-ui-renderer-plugin-point` unchanged.
4. Delete the ratchet allowlist entries for the removed `engine/plugin-loader -> ui/subscriber`, `engine/plugin-loader -> ui/terminal-renderer` and `engine/plugin-loader -> ui/types` edges, and any entry for an `engine/cli-builtins -> ui/*` edge.
5. Re-point any existing test that asserted terminal-renderer registration through `registerBuiltins`, such as `test/engine/plugin-loader.test.ts` and the plugin integration tests, to `registerTerminalBuiltins`, keeping its assertions. Verify GREEN, plus the existing plugin-loader, CLI-render and daemon-render tests.
6. Commit.

**Done when:**
- [test] the terminal-builtins test asserts that registration with renderer options registers `ui_renderer:terminal` and starts a terminal subscriber, and that registration without renderer options registers no terminal renderer.
- [test] the existing daemon-render and CLI-render tests pass with at most import-path or registration-entry updates and unchanged assertions, asserting that the daemon boot path starts and stops its terminal subscriber on the same lifecycle and that the CLI boot path renders through the registered terminal renderer.
- [test] the existing plugin-loader tests pass, asserting that engine-side `registerBuiltins` still registers every built-in `llm_provider`.
- `src/conductor/src/engine/plugin-loader.ts` imports nothing from `src/conductor/src/ui/`, and `engine/cli-builtins.ts` no longer exists under `engine/`.

**Files likely touched:**
- `src/conductor/src/terminal-builtins.ts` — new entry-level composition.
- `src/conductor/src/cli-builtins.ts` — moved from `engine/`.
- `src/conductor/src/engine/plugin-loader.ts` — provider-only registration.
- `src/conductor/src/index.ts`, `src/conductor/src/daemon-cli.ts` — call the new composition.
- `src/conductor/test/terminal-builtins.test.ts` — new.
- `src/conductor/test/engine/plugin-loader.test.ts`, `src/conductor/test/integration/plugin-end-to-end.test.ts`, `src/conductor/test/integration/plugin-defaults.test.ts` — terminal registration re-pointed to `registerTerminalBuiltins`.

**Dependencies:** Task 1

### Task 3: Move provider-setup-failure into execution
**Story:** Story 4
**Type:** refactor

**Steps:**
1. Move `src/conductor/src/engine/provider-setup-failure.ts` verbatim to `src/conductor/src/execution/provider-setup-failure.ts`. It has no internal imports.
2. Re-point every importer, in `execution/` and in `engine/`, to the one module. Keep a single error-class definition with no duplicate.
3. Delete the ratchet allowlist entries for the removed `execution -> engine/provider-setup-failure` edges, including the type edge from `execution/llm-provider.ts`.
4. Run the existing provider-setup and managed-session tests.
5. Commit.

**Done when:**
- [test] the existing provider-setup-failure tests pass, asserting that engine-side classification recognizes a `ProviderSetupUnavailableError` raised by an execution-layer provider through `isProviderSetupUnavailableError`.
- Exactly one definition of `ProviderSetupUnavailableError` exists in `src/conductor/src`, located in `execution/provider-setup-failure.ts`.

**Files likely touched:**
- `src/conductor/src/execution/provider-setup-failure.ts` — moved.
- `src/conductor/src/engine/provider-setup-failure.ts` — removed by the move.
- `src/conductor/src/execution/managed-session-preparation.ts`, `src/conductor/src/execution/pi-self-host-auth.ts`, `src/conductor/src/execution/llm-provider.ts`, `src/conductor/src/engine/self-host/provider-home.ts` — importer updates.
- `src/conductor/test/engine/provider-setup-failure.test.ts` — import path update, if present.

**Verify-only:** yes

**Dependencies:** Task 1

### Task 4: Move isFeatureSlug into execution
**Story:** Story 4
**Type:** refactor

**Steps:**
1. Add a failing case to the existing `isFeatureSlug` test file. It runs the same valid and invalid slug table through the function imported from `engine/worktree.js` and from `execution/feature-slug.js`, and asserts the results are identical. It is RED because the execution module does not exist yet.
2. Move the pure `isFeatureSlug` function from `src/conductor/src/engine/worktree.ts` to `src/conductor/src/execution/feature-slug.ts`.
3. Re-export it from `engine/worktree.ts`, so engine importers are unchanged.
4. Re-point `execution/managed-session-context.ts`, `execution/session-event-producer.ts` and `execution/daemon-session.ts`.
5. Delete their ratchet allowlist entries.
6. Verify GREEN, plus the existing worktree and session tests.
7. Commit.

**Done when:**
- [test] the `isFeatureSlug` import-path case asserts identical accept and reject results for valid and invalid slugs whether imported via `engine/worktree.js` or `execution/feature-slug.js`, and the pre-existing `isFeatureSlug` cases pass unchanged.
- No file under `src/conductor/src/execution/` imports `engine/worktree`.

**Files likely touched:**
- `src/conductor/src/execution/feature-slug.ts` — new.
- `src/conductor/src/engine/worktree.ts` — re-export.
- `src/conductor/src/execution/managed-session-context.ts`, `src/conductor/src/execution/session-event-producer.ts`, `src/conductor/src/execution/daemon-session.ts` — importer updates.
- `src/conductor/test/engine/worktree.test.ts` — the import-path case.

**Dependencies:** Task 1

### Task 5: Move the real-exec guard into execution
**Story:** Story 4
**Type:** refactor

**Steps:**
1. Move `assertRealExecAllowed` from `src/conductor/src/engine/tracker-client.ts` to `src/conductor/src/execution/real-exec-guard.ts`. The function reads only `process.env`.
2. Re-export it from `tracker-client.ts`.
3. Re-point `execution/pi-self-host-auth.ts` and delete its ratchet allowlist entry.
4. Run the existing `AI_CONDUCTOR_NO_REAL_EXEC` tests.
5. Commit.

**Done when:**
- [test] the existing real-exec guard tests pass unchanged, asserting that with `AI_CONDUCTOR_NO_REAL_EXEC` set, both the engine `makeProductionGh` path and the execution-layer Pi self-host auth path throw the same blocking error.
- No file under `src/conductor/src/execution/` imports `engine/tracker-client`.

**Files likely touched:**
- `src/conductor/src/execution/real-exec-guard.ts` — new.
- `src/conductor/src/engine/tracker-client.ts` — re-export.
- `src/conductor/src/execution/pi-self-host-auth.ts` — importer update.

**Verify-only:** yes

**Dependencies:** Task 1

### Task 6: Move provider model-policy defaults into execution
**Story:** Story 4
**Type:** refactor

**Steps:**
1. Move `src/conductor/src/engine/provider-model-policy-defaults.ts` to `src/conductor/src/execution/provider-model-policy-defaults.ts`. It imports only `types/`.
2. Keep `engine/provider-model-policy-defaults.ts` as a re-export of the moved module, which is a downward `engine -> execution` edge, so engine and test importers are unchanged. Re-point `execution/provider-catalog.ts`.
3. Delete the ratchet allowlist entry.
4. Run the existing provider-catalog and model-policy tests.
5. Commit.

**Done when:**
- [test] the existing provider-catalog and model-policy tests pass unchanged, asserting the same resolved default model and effort per provider.
- No file under `src/conductor/src/execution/` imports `engine/provider-model-policy-defaults`.

**Files likely touched:**
- `src/conductor/src/execution/provider-model-policy-defaults.ts` — moved.
- `src/conductor/src/engine/provider-model-policy-defaults.ts` — re-export only.
- `src/conductor/src/execution/provider-catalog.ts` — importer update.

**Verify-only:** yes

**Dependencies:** Task 1

### Task 7: Move the build-review read-only capability into execution
**Story:** Story 4
**Type:** refactor

**Steps:**
1. Move `src/conductor/src/engine/build-review-read-only-capability.ts` to `src/conductor/src/execution/build-review-read-only-capability.ts`. It imports only `execution/` and `node:` modules.
2. Keep `engine/build-review-read-only-capability.ts` as a re-export of the moved module, a downward `engine -> execution` edge, so engine and test importers are unchanged. Re-point `execution/codex-provider.ts`.
3. Delete the ratchet allowlist entry.
4. Run the existing read-only capability and Codex provider tests.
5. Commit.

**Done when:**
- [test] the existing build-review read-only capability tests pass unchanged, asserting that the Codex read-only producer root policy arguments are produced as before.
- No file under `src/conductor/src/execution/` imports `engine/build-review-read-only-capability`.

**Files likely touched:**
- `src/conductor/src/execution/build-review-read-only-capability.ts` — moved.
- `src/conductor/src/engine/build-review-read-only-capability.ts` — re-export only.
- `src/conductor/src/execution/codex-provider.ts` — importer update.

**Verify-only:** yes

**Dependencies:** Task 1

### Task 8: Move the scratch-schema writer into execution
**Story:** Story 4
**Type:** refactor

**Steps:**
1. Move `writeScratchSchema` from `src/conductor/src/engine/self-host/provider-scratch.ts` to `src/conductor/src/execution/scratch-schema.ts`. The function uses only `node:path` and `node:fs/promises`.
2. Re-export it from `provider-scratch.ts`.
3. Re-point `execution/codex-provider.ts` and `execution/pi-provider.ts`.
4. Delete their ratchet allowlist entries.
5. Run the existing provider-scratch and self-host provider tests. These include the scratch sweep tests that assert cleanup events reach the emitter.
6. Commit.

**Done when:**
- [test] the existing provider-scratch tests pass unchanged, asserting that `writeScratchSchema` writes the schema inside the acquired scratch home and rejects a home outside the worktree scratch root.
- [test] the existing Codex and Pi self-host dispatch tests pass unchanged, asserting that invoking the provider in a self-host dispatch writes the scratch schema into its scratch home.
- [test] the existing scratch sweep tests pass unchanged, asserting that the sweep emits its cleanup `ConductorEvent` to the engine emitter and that the event persister writes it to the event log.
- No file under `src/conductor/src/execution/` imports `engine/self-host/provider-scratch`.

**Files likely touched:**
- `src/conductor/src/execution/scratch-schema.ts` — new.
- `src/conductor/src/engine/self-host/provider-scratch.ts` — re-export.
- `src/conductor/src/execution/codex-provider.ts`, `src/conductor/src/execution/pi-provider.ts` — importer updates.

**Verify-only:** yes

**Dependencies:** Task 1

### Task 9: Invert the dispatch git guard into a required provider port
**Story:** Story 4
**Type:** refactor

**Steps:**
1. Write a failing type-level test in `src/conductor/test/execution/dispatch-git-guard-port.test.ts`:
   - `// @ts-expect-error` constructing each of `ClaudeProvider`, `CodexProvider` and `PiProvider` without `dispatchGitGuard`.
   - A runtime case: a provider built with a recording port calls it with the dispatch `cwd` on a non-review `invoke`.
2. Verify that it fails (RED).
3. Implement:
   - Declare `DispatchGitGuard` in `src/conductor/src/execution/llm-provider.ts`.
   - Make `dispatchGitGuard` a required constructor option on the three providers and on the `createAdapter` options in `execution/provider-catalog.ts`.
   - Replace the three direct `ensureGitGuardForDispatch` calls with the injected port. Keep the existing `reviewDispatch ? null :` condition.
   - Pass `ensureGitGuardForDispatch` wherever the engine calls `createAdapter`.
   - Add one shared test fixture that supplies the real `ensureGitGuardForDispatch`, and use it at every test construction site.
4. Delete the ratchet allowlist entries for the removed `execution -> engine/git-guard` edges.
5. Verify GREEN, plus the existing provider dispatch tests.
6. Commit.

**Done when:**
- [test] the dispatch-git-guard-port test asserts, via `@ts-expect-error`, that constructing any of the three providers without `dispatchGitGuard` is a compile error.
- [test] the dispatch-git-guard-port test asserts that a non-review `invoke` calls the injected port with the dispatch cwd, and that a review dispatch does not call it.
- [test] the existing Claude, Codex and Pi provider dispatch tests pass, asserting that the git guard is installed for the dispatch exactly as before when the engine-created adapter is invoked.
- No file under `src/conductor/src/execution/` imports `engine/git-guard`.

**Files likely touched:**
- `src/conductor/src/execution/llm-provider.ts` — `DispatchGitGuard` port type.
- `src/conductor/src/execution/claude-provider.ts`, `src/conductor/src/execution/codex-provider.ts`, `src/conductor/src/execution/pi-provider.ts` — the required port.
- `src/conductor/src/execution/provider-catalog.ts` — `createAdapter` options.
- `src/conductor/src/engine/plugin-loader.ts`, `src/conductor/src/engine/provider-discovery.ts` — supply the port.
- `src/conductor/test/execution/dispatch-git-guard-port.test.ts` — new.
- `src/conductor/test/fixtures/dispatch-git-guard.ts` — new shared fixture.
- `src/conductor/test/**/*provider*.test.ts` — construction sites use the fixture.

**Dependencies:** Tasks 2, 6, 7, 8

### Task 10: Move provider port types into types
**Story:** Story 5
**Type:** refactor

**Steps:**
1. Move `AuthenticationReadinessState`, `AuthenticationSource`, `CodexProbeFailureKind`, `CodexProbeParserRejection`, `ProviderExitFacts`, `ProviderStreamObservation` and `TokenUsage` from `execution/llm-provider.ts`, and `ObservedInterval` from `execution/observed-interval.ts`, into `src/conductor/src/types/provider.ts`.
2. Re-export them from their old modules.
3. Re-point `types/events.ts`.
4. Run typecheck and the existing event-persistence tests.
5. Commit.

**Done when:**
- `src/conductor/src/types/events.ts` imports none of these symbols from `src/conductor/src/execution/`, and `npm run typecheck` in `src/conductor` exits 0.
- [test] the existing event-persistence tests pass unchanged, asserting that a persisted `ConductorEvent` payload reads back with an unchanged shape.
- `execution/llm-provider.ts` and `execution/observed-interval.ts` declare none of the moved types and obtain each of them from `src/conductor/src/types/provider.ts`.

**Files likely touched:**
- `src/conductor/src/types/provider.ts` — new.
- `src/conductor/src/execution/llm-provider.ts`, `src/conductor/src/execution/observed-interval.ts` — re-exports.
- `src/conductor/src/types/events.ts` — imports from `types/`.

**Verify-only:** yes

**Dependencies:** Task 9

### Task 11: Move engine-owned event and refusal types into types
**Story:** Story 5
**Type:** refactor

**Steps:**
1. Move the following into `src/conductor/src/types/`, re-pointing each former module to import them back from `types/`:
   - `LandGateIdentifier` and `LandGateRejectionIdentifier`;
   - `RefusalReason` (park reconciliation);
   - `GithubOperationRefusalReason`, `GithubOperationTarget` and `GithubBotAuthRefusalReason`;
   - `BuildReviewInfrastructureFailureReason` and `BuildReviewJudgedResultRejection`;
   - `ChildId`;
   - the restack aliases `CommitSha`, `JournalState`, `RefName`, `RestackCause`, `RestackOpId` and `RestackRefusalReason`;
   - the inline-referenced `HaltDisposition` and `InboundNeutralization`.
2. Leave `GithubOperationName` (Task 12) and the provider-id references (Task 13) in place. Any other symbol found to be derived from a runtime value follows ADR D5's explicit-union rule.
3. Run typecheck and the existing event-persistence tests.
4. Commit.

**Done when:**
- Apart from the `GithubOperationName` import that Task 12 owns, no static or inline `import('…')` type reference in `src/conductor/src/types/events.ts` resolves to `src/conductor/src/engine/`, and `npm run typecheck` in `src/conductor` exits 0.
- [test] the existing event-persistence and event-sink exhaustiveness tests pass unchanged, asserting persisted `ConductorEvent` payload shapes are unchanged.
- Each former declaring module listed in Steps imports its moved types from `src/conductor/src/types/` and declares no duplicate of them.

**Files likely touched:**
- `src/conductor/src/types/events.ts` — local declarations or `types/` imports.
- `src/conductor/src/types/github.ts`, `src/conductor/src/types/restack.ts`, `src/conductor/src/types/build-review.ts` — new.
- `src/conductor/src/engine/engineer/land-spec.ts`, `src/conductor/src/engine/park-reconciliation.ts`, `src/conductor/src/engine/github-operations.ts`, `src/conductor/src/engine/github-bot-auth-refusal.ts`, `src/conductor/src/engine/build-review-domain.ts`, `src/conductor/src/engine/child-context.ts`, `src/conductor/src/engine/restack/restack-types.ts`, `src/conductor/src/engine/halt-marker.ts`, `src/conductor/src/engine/engineer/intake/sanitize-inbound.ts` — import moved types back.

**Verify-only:** yes

**Dependencies:** Task 10

### Task 12: Declare the GitHub operation-name union in types and bind the registry to it
**Story:** Story 5
**Type:** refactor

**Steps:**
1. Write a failing type-level test in `src/conductor/test/types/github-operation-name-binding.test.ts`. It uses `@ts-expect-error` fixtures for two cases:
   - a registry-shaped object with an operation missing from the union fails `satisfies Record<GithubOperationName, GithubOperationDefinition>`;
   - one missing a union member fails it too.
2. Verify that it fails (RED).
3. Implement:
   - Declare `GithubOperationName` as an explicit literal union in `src/conductor/src/types/github.ts`, listing the current registry keys.
   - Change `GITHUB_OPERATION_REGISTRY` in `engine/github-operations.ts` to `as const satisfies Readonly<Record<GithubOperationName, GithubOperationDefinition>>`.
   - Re-export the type from `github-operations.ts`.
   - Re-point `types/events.ts`.
4. Verify GREEN and run typecheck.
5. Commit.

**Done when:**
- [test] the github-operation-name-binding test asserts, via `@ts-expect-error`, that a registry with an operation absent from the union and a registry missing a union member are each compile errors.
- `GITHUB_OPERATION_REGISTRY` is declared `satisfies Readonly<Record<GithubOperationName, GithubOperationDefinition>>` with `GithubOperationName` imported from `types/`, and `npm run typecheck` in `src/conductor` exits 0.

**Files likely touched:**
- `src/conductor/src/types/github.ts` — the explicit union.
- `src/conductor/src/engine/github-operations.ts` — the constraint.
- `src/conductor/src/types/events.ts` — import from `types/`.
- `src/conductor/test/types/github-operation-name-binding.test.ts` — new.

**Dependencies:** Task 11

### Task 13: Make provider ids opaque, and bind rubric ids and the event bus, in types
**Story:** Story 5
**Type:** refactor

**Steps:**
1. Write a failing type-level test in `src/conductor/test/types/rubric-id-binding.test.ts`. Using `@ts-expect-error`, a rubric descriptor record that is missing a `BuildReviewRubricId`, or that carries an extra rubric id, fails `satisfies Record<BuildReviewRubricId, BuildReviewRubricDescriptor>`. The test also imports the runtime `BUILD_REVIEW_RUBRIC_IDS` from `types/config.js` and asserts that it equals the real registry's keys, so it fails at runtime until the tuple moves.
2. Verify that it fails (RED).
3. Implement:
   - Declare an opaque branded `ProviderId` in `types/provider.ts`, with no provider-id literal. Type the discovery event's `installed`/`missing[].id` fields and the readiness event's `provider` field in `types/events.ts` as `ProviderId`.
   - Add a `toProviderId(id: BuiltInProviderId): ProviderId` conversion in `execution/provider-catalog.ts`, and use it at the engine emit sites of those events. `BuiltInProviderId` stays derived from the catalog.
   - Move the pure `BUILD_REVIEW_RUBRIC_IDS` tuple into `types/config.ts`, re-exporting it from `engine/build-review-registry.ts`. Constrain the registry's rubric descriptor record with `satisfies Record<BuildReviewRubricId, BuildReviewRubricDescriptor>`, so a missing or extra rubric id fails type checking.
   - Declare a `ConductorEventBus` interface in `types/plugin.ts` with the emitter's public method signatures, and replace both inline `import('../ui/events.js')` references with it.
   - Make `ConductorEventEmitter` `implements ConductorEventBus`.
4. Verify GREEN and run typecheck.
5. Commit.

**Done when:**
- [test] the rubric-id-binding test asserts, via `@ts-expect-error`, that a rubric descriptor record missing a `BuildReviewRubricId` or carrying an extra rubric id is a compile error against `Record<BuildReviewRubricId, BuildReviewRubricDescriptor>`.
- [test] the existing built-in provider-id literal structural test from `adr-2026-09-24` passes unchanged with no new allowlist entry, and the discovery and readiness event tests pass, asserting that persisted provider ids are unchanged strings.
- `BUILD_REVIEW_RUBRIC_IDS` is defined in `src/conductor/src/types/config.ts`, the real rubric descriptor record in `engine/build-review-registry.ts` is declared `satisfies Record<BuildReviewRubricId, BuildReviewRubricDescriptor>` with `BuildReviewRubricId` imported from `types/`, and `types/plugin.ts` references `ConductorEventBus` with no `import('../ui/events.js')`.
- No static or inline import in any `src/conductor/src/types/*.ts` file resolves outside `src/conductor/src/types/`, and `npm run typecheck` in `src/conductor` exits 0.

**Files likely touched:**
- `src/conductor/src/types/provider.ts`, `src/conductor/src/types/config.ts`, `src/conductor/src/types/plugin.ts`, `src/conductor/src/types/events.ts` — owned declarations.
- `src/conductor/src/execution/provider-catalog.ts` — the catalog constraint.
- `src/conductor/src/engine/build-review-registry.ts` — re-export.
- `src/conductor/src/engine/conductor-event-emitter.ts` — `implements ConductorEventBus`.
- `src/conductor/test/types/rubric-id-binding.test.ts` — new.
- `src/conductor/src/engine/provider-discovery.ts` — emit through `toProviderId`.

**Dependencies:** Tasks 1, 12

### Task 14: Extend the ratchet's upward rule to every import form
**Story:** Story 1
**Type:** refactor

**Steps:**
1. Write failing fixture tests beside the #1988 ratchet's own tests. Each fixture is a synthetic source tree:
   - (a) an `engine/` value import from `ui/`;
   - (b) an `import type` from `types/` to `engine/`;
   - (c) an inline `import('…')` type reference from `types/` to `ui/`;
   - (d) an `export … from` in `execution/` from `engine/`;
   - (e) a dynamic `import()` in `engine/` of `ui/`;
   - (f) a layer file importing `index.ts`;
   - (g) a runtime file importing `tools/`.

   Each must be reported as an upward violation naming the file, its line and the edge, with every violation listed in one failure. Two further fixtures must pass: `ui/` importing `execution/`, and entry-to-entry.
2. Verify that (b) to (e) fail (RED) against the value-only rule.
3. Implement:
   - Where the ratchet does not already enforce them, add its entry-point rule (only an entry-point file may import another entry-point file) and its `tools/` rule (no runtime file imports `tools/`).
   - Extend the ratchet's edge extraction to include `ImportDeclaration` with `importKind` type, `ImportTypeNode`, `ExportDeclaration` with a module specifier, and `import()` call expressions.
   - Apply all of this to the upward-edge rule only, and leave D5's intra-layer value-cycle rule unchanged.
4. Verify GREEN, with the real tree passing.
5. Commit.

**Done when:**
- [test] the ratchet fixture tests assert that an `engine/` value import from `ui/` and a `types/` `import type` from `engine/` are each reported as an upward violation naming the importing file, its line number, and the layer edge such as `engine -> ui`.
- [test] the ratchet fixture tests assert that an `execution/` `export ... from` an `engine/` module, an `engine/` dynamic `import()` of a `ui/` module, and a `types/` inline `import('…')` type reference to `ui/` are each reported as an upward violation with file, line, and edge.
- [test] the ratchet fixture tests assert that a layer file importing `index.ts` and a runtime file importing `tools/` are each reported as a violation, and that a fixture with several upward edges lists every one in a single failure.
- [test] the ratchet fixture tests assert that an `engine/` import of `execution/`, an `engine/` import of `types/`, a same-layer import, a `ui/` import of `execution/`, and an entry-point import of another entry-point file each report no violation.
- The ratchet's intra-layer value-cycle rule is unchanged, and the ratchet passes on the real `src/conductor/src/` tree.

**Files likely touched:**
- The #1988 ratchet's checker module and its test file, at the paths #1988 created.

**Dependencies:** Tasks 2, 3, 4, 5, 9, 13

### Task 15: Close the ratchet's upward-edge allowlist
**Story:** Story 1
**Type:** refactor

**Steps:**
1. Write a failing ratchet test asserting that the allowlist contains zero entries whose edge points up the layer chain.
2. Verify it against the tree. It is RED if any upward entry survived Tasks 1–9.
3. Implement: delete any remaining upward-edge allowlist entry, and confirm that its edge is gone.
4. Run the ratchet's shrink-only check on a fixture with a stale entry for a removed edge.
5. Commit.

**Done when:**
- [test] a ratchet test asserts that the allowlist holds zero upward-edge entries, and the ratchet passes on the real tree, so no `engine/` module has a `ui/` module in its import closure, no `execution/` file imports `engine/` or `ui/`, and no `types/` file imports outside `types/`.
- [test] the ratchet's shrink-only test asserts that an allowlist entry for a removed upward edge fails the ratchet because that edge no longer exists.

**Files likely touched:**
- The #1988 ratchet's allowlist directory and its test file, at the paths #1988 created.

**Dependencies:** Task 14

## Task Dependency Graph

```
Task 1 ─▶ Tasks 2, 3, 4, 5, 6, 7, 8   (all depend on Task 1)
Tasks 2, 6, 7, 8 ─▶ Task 9 ─▶ Task 10 ─▶ Task 11 ─▶ Task 12 ─▶ Task 13
Tasks 2, 3, 4, 5, 9, 13 ─▶ Task 14 ─▶ Task 15
```

## Integration Points

- **After Task 1:** the engine runs on the relocated emitter, and every existing test still imports
  it through `ui/events.js`.
- **After Task 2:** CLI and daemon boot compose terminal output from the entry level.
- **After Task 9:** engine-created adapters carry the git-guard port through `createAdapter`.
- **After Task 15:** the ratchet holds the full chain.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the final `src/conductor/src/` tree, when the #1988 import-graph ratchet runs in the default test tier, then it passes and its allowlist contains no entry for an upward edge between layers. | 14, 15 | "the ratchet passes on the real tree" | diff-local |
| Story 1 happy: Given a file that imports only from its own layer or a lower layer, including `ui/` importing `execution/` and an entry-point file importing another entry-point file, when the ratchet evaluates it, then no violation is reported for that file. | 14 | "an `engine/` import of `execution/`, an `engine/` import of `types/`, a same-layer import, a `ui/` import of `execution/`, and an entry-point import of another entry-point file each report no violation" | diff-local |
| Story 1 negative: Given a fixture in which an `engine/` file has a value import from `ui/`, when the ratchet evaluates it, then it reports a violation naming the importing file, its line number, and the `engine -> ui` edge. | 14 | "an `engine/` value import from `ui/` and a `types/` `import type` from `engine/` are each reported as an upward violation naming the importing file, its line number, and the layer edge" | diff-local |
| Story 1 negative: Given a fixture in which a `types/` file has an `import type` from `engine/`, when the ratchet evaluates it, then it reports the edge as an upward violation rather than exempting it for being type-only. | 14 | "an `engine/` value import from `ui/` and a `types/` `import type` from `engine/` are each reported as an upward violation" | diff-local |
| Story 1 negative: Given a fixture in which an `execution/` file uses `export ... from` on an `engine/` module, when the ratchet evaluates it, then it reports the re-export as an upward violation. | 14 | "an `execution/` `export ... from` an `engine/` module" | diff-local |
| Story 1 negative: Given a fixture in which an `engine/` file calls dynamic `import()` on a `ui/` module, when the ratchet evaluates it, then it reports the dynamic import as an upward violation. | 14 | "an `engine/` dynamic `import()` of a `ui/` module" | diff-local |
| Story 1 negative: Given a fixture in which a layer file imports an entry-point file such as `index.ts`, or a runtime file imports `tools/`, when the ratchet evaluates it, then it reports a violation. | 14 | "a layer file importing `index.ts` and a runtime file importing `tools/` are each reported as a violation" | diff-local |
| Story 1 negative: Given an allowlist entry for an upward edge that this feature removed, when the ratchet runs, then it fails because that allowlisted edge no longer exists, so the entry must be deleted. | 15 | "an allowlist entry for a removed upward edge fails the ratchet because that edge no longer exists" | diff-local |
| Story 2 happy: Given the relocated emitter, when engine code emits a `ConductorEvent` with registered sync and async handlers, then every handler receives the event and `emit` resolves only after the async handlers settle. | 1 | "`emit` awaits async handlers" | diff-local |
| Story 2 happy: Given a module that still imports `ConductorEventEmitter` from `ui/events.js`, when it constructs an emitter and passes it to engine code typed against the relocated class, then type checking passes and `instanceof` holds against both import paths. | 1 | "`instanceof` holds both ways between `ConductorEventEmitter` imported from `ui/events.js` and from `engine/conductor-event-emitter.js`" | diff-local |
| Story 2 negative: Given a registered handler that throws synchronously or rejects, when `emit` is called, then the error is swallowed and the remaining handlers still run, exactly as before the move. | 1 | "`emit` swallows sync throws and async rejections while still running the remaining handlers" | diff-local |
| Story 2 negative: Given a registered handler that rejects, when `emitOrThrow` is called, then the failure still propagates to the caller. | 1 | "`emitOrThrow` propagates a rejecting handler's failure" | diff-local |
| Story 2 negative: Given any `src/` file in `engine/`, `execution/`, or `types/`, when the layer-direction test runs, then no file below `ui/` imports the emitter through `ui/events.js`. | 1, 15 | "no file under `src/conductor/src/engine/` imports a `ui/events` path" | diff-local |
| Story 3 happy: Given an interactive CLI run with renderer options, when built-ins are registered at start-up, then a terminal renderer is registered as `ui_renderer:terminal` and a terminal subscriber is started, as today. | 2 | "registration with renderer options registers `ui_renderer:terminal` and starts a terminal subscriber" | diff-local |
| Story 3 happy: Given daemon start-up, when built-ins are registered, then the daemon's terminal subscriber is started and stopped on the same lifecycle as before the change. | 2 | "the daemon boot path starts and stops its terminal subscriber on the same lifecycle" | diff-local |
| Story 3 happy: Given engine-side plugin registration, when it runs, then the built-in providers are registered as before. | 2 | "engine-side `registerBuiltins` still registers every built-in `llm_provider`" | diff-local |
| Story 3 negative: Given a registration call with no renderer options, when built-ins are registered, then no terminal renderer is registered, matching current behaviour. | 2 | "registration without renderer options registers no terminal renderer" | diff-local |
| Story 3 negative: Given a test that loads engine-side plugin registration, when its module graph is resolved, then no `ui/` module is part of that graph. | 15 | "no `engine/` module has a `ui/` module in its import closure" | diff-local |
| Story 4 happy: Given a provider dispatch for Claude, Codex, or Pi in a worktree, when the provider is constructed by the engine and invoked, then the git guard is installed for the dispatch exactly as before. | 9 | "the git guard is installed for the dispatch exactly as before when the engine-created adapter is invoked" | diff-local |
| Story 4 happy: Given a Codex or Pi self-host dispatch, when the provider is invoked, then the scratch schema is written and the Codex read-only producer root policy arguments are produced as before. | 7, 8 | "the Codex read-only producer root policy arguments are produced as before" | diff-local |
| Story 4 happy: Given any file under `execution/`, when the layer-direction test runs, then it imports nothing from `engine/` or `ui/`. | 15 | "no `execution/` file imports `engine/` or `ui/`" | diff-local |
| Story 4 negative: Given `AI_CONDUCTOR_NO_REAL_EXEC` is set, when a code path reaches the real-exec guard from either the execution layer or the engine, then the same blocking error is thrown as before. | 5 | "both the engine `makeProductionGh` path and the execution-layer Pi self-host auth path throw the same blocking error" | diff-local |
| Story 4 negative: Given provider setup is unavailable, when a provider raises the setup-unavailable error, then engine-side classification still recognizes it, because a single error class is shared across layers. | 3 | "engine-side classification recognizes a `ProviderSetupUnavailableError` raised by an execution-layer provider" | diff-local |
| Story 4 negative: Given a self-host scratch sweep that emits cleanup events, when it runs after the scratch-schema writer has moved to the execution layer, then those events still reach the engine's event spine and the persisted event log. | 8 | "the sweep emits its cleanup `ConductorEvent` to the engine emitter and that the event persister writes it to the event log" | diff-local |
| Story 4 negative: Given a provider constructed without a required injected port, when type checking runs, then compilation fails rather than the provider silently skipping the guard. | 9 | "constructing any of the three providers without `dispatchGitGuard` is a compile error" | diff-local |
| Story 4 negative: Given a slug value, when `isFeatureSlug` is evaluated from the execution layer or the engine, then both return identical results for valid and invalid slugs. | 4 | "identical accept and reject results for valid and invalid slugs whether imported via `engine/worktree.js` or `execution/feature-slug.js`" | diff-local |
| Story 5 happy: Given the final tree, when the layer-direction test scans `types/`, then no file imports from `execution/`, `engine/`, or `ui/`, including type-only imports. | 13, 15 | "No static or inline import in any `src/conductor/src/types/*.ts` file resolves outside `src/conductor/src/types/`" | diff-local |
| Story 5 happy: Given modules that formerly declared moved types, when they reference those types, then they import them from `types/` and type checking passes. | 10, 11 | "`npm run typecheck` in `src/conductor` exits 0" | diff-local |
| Story 5 negative: Given a new operation added to the GitHub operation registry without a matching member in the `types/` operation-name union, when type checking runs, then it fails. | 12 | "a registry with an operation absent from the union" | diff-local |
| Story 5 negative: Given a member added to the `types/` operation-name union without a matching registry entry, when type checking runs, then it fails. | 12 | "a registry missing a union member are each compile errors" | diff-local |
| Story 5 negative: Given a build-review rubric id that differs between `types/` and its implementation source, when type checking runs, then it fails. | 13 | "a rubric descriptor record missing a `BuildReviewRubricId` or carrying an extra rubric id is a compile error" | diff-local |
| Story 5 negative: Given an existing serialized `ConductorEvent` payload, when it is persisted and read back after the move, then its shape is unchanged. | 10, 11 | "a persisted `ConductorEvent` payload reads back with an unchanged shape" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-12-enforced-source-layer-directions#D1 | task | task-14 | an `engine/` dynamic `import()` of a `ui/` module |
| adr-2026-10-12-enforced-source-layer-directions#D2 | task | task-1 | `src/conductor/src/ui/events.ts` contains only the re-export |
| adr-2026-10-12-enforced-source-layer-directions#D3 | task | task-2 | `src/conductor/src/engine/plugin-loader.ts` imports nothing from `src/conductor/src/ui/` |
| adr-2026-10-12-enforced-source-layer-directions#D4 | task | task-3, task-4, task-5, task-6, task-7, task-8, task-9 | No file under `src/conductor/src/execution/` imports `engine/git-guard` |
| adr-2026-10-12-enforced-source-layer-directions#D5 | task | task-10, task-11, task-12, task-13 | No static or inline import in any `src/conductor/src/types/*.ts` file resolves outside `src/conductor/src/types/` |
| adr-2026-10-12-enforced-source-layer-directions#D6 | task | task-14, task-15 | a ratchet test asserts that the allowlist holds zero upward-edge entries |
| adr-2026-10-12-enforced-source-layer-directions#D7 | no-change | none | ADR D7 assigns the code-organization.md refresh to this repository's maintain-documentation SHIP step, which runs after rebase for every feature; plans carry no documentation tasks |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks, and no unbounded quality word is left open
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions

### Task rem-prd-audit-R15a: Remove engine/daemon-command.ts -> cli-defaults.ts and engine/kickback-budget-cli.ts -> cli.ts: move the shared defaults/helpers they consume into engine/ (or types/) and have the entry modules import them downward
**Gate:** prd-audit
**Rationale:** Verified (95%): layer-allowlist.txt:52,77,238,243 hold four edges that isForbiddenEdge classifies as upward. The ADR's D6 requires zero upward entries, and tools/ may import only engine/ and types/. Task 15 step 3 already admits removing every remaining upward edge plus its entry, and its RED test for zero upward entries is missing. This is conforming implementation and test work with no architecture decision open.
**Criterion:** S1.1
**Parent task:** 15
**Done when:**
- [test] S1.1 is satisfied by this task.
- The repair for task rem-prd-audit-R15a is committed and its targeted tests pass.

### Task rem-prd-audit-R15b: Route tools/generate-model-table.ts through an engine/ re-export of the provider catalog instead of importing execution/provider-catalog.ts directly
**Gate:** prd-audit
**Rationale:** Verified (95%): layer-allowlist.txt:52,77,238,243 hold four edges that isForbiddenEdge classifies as upward. The ADR's D6 requires zero upward entries, and tools/ may import only engine/ and types/. Task 15 step 3 already admits removing every remaining upward edge plus its entry, and its RED test for zero upward entries is missing. This is conforming implementation and test work with no architecture decision open.
**Criterion:** S1.1
**Parent task:** 15
**Done when:**
- [test] S1.1 is satisfied by this task.
- The repair for task rem-prd-audit-R15b is committed and its targeted tests pass.

### Task rem-prd-audit-R15c: Add a test in test/structural/layer-ratchet.test.ts that asserts zero upward-edge entries in layer-allowlist.txt, then delete the four upward entries
**Gate:** prd-audit
**Rationale:** Verified (95%): layer-allowlist.txt:52,77,238,243 hold four edges that isForbiddenEdge classifies as upward. The ADR's D6 requires zero upward entries, and tools/ may import only engine/ and types/. Task 15 step 3 already admits removing every remaining upward edge plus its entry, and its RED test for zero upward entries is missing. This is conforming implementation and test work with no architecture decision open.
**Criterion:** S1.1
**Parent task:** 15
**Done when:**
- [test] S1.1 is satisfied by this task.
- The repair for task rem-prd-audit-R15c is committed and its targeted tests pass.

### Task rem-prd-audit-R15d: Move the transcript-format helpers provider-catalog needs from engine/self-host/transcript-format.ts into execution/, keep an engine re-export, re-point execution/provider-catalog.ts, and delete its allowlist entry
**Gate:** prd-audit
**Rationale:** Verified: execution/provider-catalog.ts imports engine/self-host/transcript-format.js, which is an execution->engine upward edge. Moving the pure transcript-format helper into execution/ and leaving an engine re-export follows the same pattern Tasks 3–8 used. Task 15 admits removing the remaining edge.
**Criterion:** S4.3
**Parent task:** 15
**Done when:**
- [test] S4.3 is satisfied by this task.
- The repair for task rem-prd-audit-R15d is committed and its targeted tests pass.

### Task rem-as-built-R15e: Confirm the daemon-command, kickback-budget-cli and provider-catalog upward edges are gone and their allowlist entries are deleted (see R15a and R15d)
**Gate:** as-built
**Rationale:** These are the same three upward edges as S1.1 and S4.3. D6 is unambiguous, so this is conforming BUILD work under Task 15, covered by the R15a and R15d repairs.
**Governing clause:** adr-2026-10-12-enforced-source-layer-directions decision 6
**Done when:**
- adr-2026-10-12-enforced-source-layer-directions decision 6 is satisfied by this task.
- The repair for task rem-as-built-R15e is committed and its targeted tests pass.

### Task rem-prd-audit-R2a: Restore config-driven renderer selection in src/index.ts / src/terminal-builtins.ts so the CLI subscriber starts with registry.get<UIRenderer>('ui_renderer', config?.ui_renderer ?? 'terminal'), with a terminal-builtins/CLI-render test asserting a configured non-terminal ui_renderer is honoured
**Gate:** prd-audit
**Rationale:** Verified from the audit evidence: the CLI boot no longer selects its renderer through registry.get('ui_renderer', config.ui_renderer ?? 'terminal'), so the ui_renderer config key is silently ignored. That regresses behavior Task 2 must preserve: the 003 UIRenderer contracts stay unchanged and CLI rendering goes through the registered renderer. Task 2 admits the repair.
**Criterion:** S3.1
**Parent task:** 2
**Done when:**
- [test] S3.1 is satisfied by this task.
- The repair for task rem-prd-audit-R2a is committed and its targeted tests pass.

### Task rem-prd-audit-R2b: In src/daemon-cli.ts / src/terminal-builtins.ts restore the daemon boot so the global subscriber starts with only the daemon-log renderer at its original point after validateProviderInstallation, with the TerminalRenderer registered but not started, and add a daemon-render test asserting this
**Gate:** prd-audit
**Rationale:** Verified: the daemon originally started its subscriber with only [daemonLogRenderer]. Now registerTerminalBuiltins always unshifts a TerminalRenderer and starts it earlier, before validateProviderInstallation. That changes daemon output and lifecycle, which Task 2 says must stay unchanged. Task 2 admits the repair.
**Criterion:** S3.2
**Parent task:** 2
**Done when:**
- [test] S3.2 is satisfied by this task.
- The repair for task rem-prd-audit-R2b is committed and its targeted tests pass.

### Task rem-prd-audit-R11a: Replace duplicate declarations in engine/github-operations.ts, github-bot-auth-refusal.ts, build-review-domain.ts, child-context.ts, restack/restack-types.ts, routing/route-types.ts, park-reconciliation.ts, halt-marker.ts, engineer/land-spec.ts and engineer/intake/sanitize-inbound.ts with imports/re-exports from src/types/
**Gate:** prd-audit
**Rationale:** Verified: the moved types were copied into types/ but the original declarations were never removed. Task 11's done-when explicitly requires every former module to import them back with no duplicate, so this is mechanical BUILD work. llm-provider.ts and managed-session-preparation.ts carry the provider port types that Task 10 moved, and the same no-duplicate rule applies to them.
**Criterion:** S5.2
**Parent task:** 11
**Done when:**
- [test] S5.2 is satisfied by this task.
- The repair for task rem-prd-audit-R11a is committed and its targeted tests pass.

### Task rem-prd-audit-R11b: Replace the TokenUsage, ProviderStreamObservation, AuthenticationSource, ProviderExitFacts and CodexProbeFailure declarations in execution/llm-provider.ts, and the one in execution/managed-session-preparation.ts, with re-exports from src/types/, then run typecheck
**Gate:** prd-audit
**Rationale:** Verified: the moved types were copied into types/ but the original declarations were never removed. Task 11's done-when explicitly requires every former module to import them back with no duplicate, so this is mechanical BUILD work. llm-provider.ts and managed-session-preparation.ts carry the provider port types that Task 10 moved, and the same no-duplicate rule applies to them.
**Criterion:** S5.2
**Parent task:** 11
**Done when:**
- [test] S5.2 is satisfied by this task.
- The repair for task rem-prd-audit-R11b is committed and its targeted tests pass.

### Task rem-as-built-R11c: Verify no type moved to types/ is still independently declared at any listed engine/ or execution/ site (see R11a and R11b)
**Gate:** as-built
**Rationale:** This finding duplicates S5.2: same duplicate-declaration sites, and Task 11 already requires removing them. It is covered by repairs R11a and R11b.
**Governing clause:** adr-2026-10-12-enforced-source-layer-directions decision 5
**Done when:**
- adr-2026-10-12-enforced-source-layer-directions decision 5 is satisfied by this task.
- The repair for task rem-as-built-R11c is committed and its targeted tests pass.

### Task rem-prd-audit-R13a: Add test/types/rubric-id-binding.test.ts with @ts-expect-error fixtures for missing/extra rubric ids against Record<BuildReviewRubricId, BuildReviewRubricDescriptor>, plus a runtime check that BUILD_REVIEW_RUBRIC_IDS from types/config.js equals the registry keys
**Gate:** prd-audit
**Rationale:** Verified: build-review-registry.ts builds its descriptor record from an array and casts it to a Record, with no satisfies constraint. The test/types/rubric-id-binding.test.ts that Task 13 requires does not exist. Task 13 steps 1 and 3 admit both the RED test and the constraint.
**Criterion:** S5.5
**Parent task:** 13
**Done when:**
- [test] S5.5 is satisfied by this task.
- The repair for task rem-prd-audit-R13a is committed and its targeted tests pass.

### Task rem-prd-audit-R13b: Declare the real rubric descriptor record in engine/build-review-registry.ts as an object literal that satisfies Record<BuildReviewRubricId, BuildReviewRubricDescriptor>, import BuildReviewRubricId from types/, and remove the `as` cast
**Gate:** prd-audit
**Rationale:** Verified: build-review-registry.ts builds its descriptor record from an array and casts it to a Record, with no satisfies constraint. The test/types/rubric-id-binding.test.ts that Task 13 requires does not exist. Task 13 steps 1 and 3 admit both the RED test and the constraint.
**Criterion:** S5.5
**Parent task:** 13
**Done when:**
- [test] S5.5 is satisfied by this task.
- The repair for task rem-prd-audit-R13b is committed and its targeted tests pass.

### Task rem-as-built-R13c: Confirm the live registry at build-review-registry.ts is built from the satisfies-constrained record and no longer goes through an `as` cast (see R13b)
**Gate:** as-built
**Rationale:** Same defect as S5.5: the array catalog plus cast does not give compile-time completeness. Task 13 admits the repair, covered by R13a and R13b.
**Governing clause:** adr-2026-10-12-enforced-source-layer-directions decision 5
**Done when:**
- adr-2026-10-12-enforced-source-layer-directions decision 5 is satisfied by this task.
- The repair for task rem-as-built-R13c is committed and its targeted tests pass.

### Task rem-as-built-R13d: Remove the provider literals from execution/build-review-read-only-capability.ts and execution/pi-self-host-auth.ts by sourcing ids and display names from a leaf catalog-identity module (or as injected parameters) without reintroducing the catalog import cycle
**Gate:** as-built
**Rationale:** Verified from the diff: provider-id-literals.test.ts adds PROVIDER_LITERAL_CYCLE_BREAK_MODULES and also relaxes the adapter display-name assertion. Task 13 requires that test to pass unchanged with no new allowlist entry. The cycle can be broken without exemptions: the moved helpers can take provider identities from a leaf execution/ module that both the catalog and the helpers import, or receive them as parameters. The approved direction is kept, so no architecture decision is needed.
**Parent task:** 13
**Governing clause:** Task 13
**Done when:**
- Task 13 is satisfied by this task.
- The repair for task rem-as-built-R13d is committed and its targeted tests pass.

### Task rem-as-built-R13e: Revert test/engine/provider-id-literals.test.ts to its main-branch form: drop PROVIDER_LITERAL_CYCLE_BREAK_MODULES and restore the adapter display-name assertion, and confirm it passes
**Gate:** as-built
**Rationale:** Verified from the diff: provider-id-literals.test.ts adds PROVIDER_LITERAL_CYCLE_BREAK_MODULES and also relaxes the adapter display-name assertion. Task 13 requires that test to pass unchanged with no new allowlist entry. The cycle can be broken without exemptions: the moved helpers can take provider identities from a leaf execution/ module that both the catalog and the helpers import, or receive them as parameters. The approved direction is kept, so no architecture decision is needed.
**Parent task:** 13
**Governing clause:** Task 13
**Done when:**
- Task 13 is satisfied by this task.
- The repair for task rem-as-built-R13e is committed and its targeted tests pass.

### Task rem-prd-audit-rem-prd-audit-R10a: In src/conductor/src/execution/llm-provider.ts, replace the local AuthenticationReadinessState declaration with an import and re-export from src/types/provider.ts. Grep execution/ and engine/ for any other independent redeclaration of a provider.ts type, then run npm run typecheck
**Gate:** prd-audit
**Rationale:** Verified (99%, observed): src/conductor/src/execution/llm-provider.ts:36-40 still declares AuthenticationReadinessState, and src/conductor/src/types/provider.ts:8 declares it too. Task 10's done-when already requires llm-provider.ts to declare none of the moved types. This is implementation drift against approved architecture, so it is a one-site BUILD fix with no design decision needed.
**Criterion:** S5.2
**Parent task:** 10
**Done when:**
- [test] S5.2 is satisfied by this task.
- The repair for task rem-prd-audit-rem-prd-audit-R10a is committed and its targeted tests pass.

### Task rem-prd-audit-rem-prd-audit-R12a: Add src/conductor/test/types/github-operation-name-binding.test.ts, following rubric-id-binding.test.ts and compile-type-fixture.ts. Use @ts-expect-error to assert that a Record<GithubOperationName, GithubOperationDefinition> registry is a compile error when it has an operation absent from the types/ union, and when it is missing a union member. Also assert that GITHUB_OPERATION_REGISTRY's keys match the union, then run the test and typecheck
**Gate:** prd-audit
**Rationale:** Verified (99%, observed): test/types/ contains rubric-id-binding, plugin-kind and unrelated tests, but no github-operation-name-binding.test.ts. The registry-side satisfies binding is already in place. Task 12's [test] done-when requires @ts-expect-error proofs for an extra operation and a missing union member. This is a missing test inside an approved task, so it is BUILD work, modeled on the existing rubric-id-binding test and compile-type-fixture helper.
**Criterion:** S5.3
**Parent task:** 12
**Done when:**
- [test] S5.3 is satisfied by this task.
- The repair for task rem-prd-audit-rem-prd-audit-R12a is committed and its targeted tests pass.

### Task rem-as-built-rem-as-built-R13f: In src/conductor/test/engine/provider-id-literals.test.ts, restore main's adapter branch to check display names against BUILT_IN_PROVIDERS rather than foreignProviders. Restore the original 'reports a declared adapter display name embedded in user-facing text' and 'keeps an adapter's own provider id exempt but reports its display name' tests and expectations, and keep the catalogModules set
**Gate:** as-built
**Rationale:** Verified (99%, observed via git diff main): provider-id-literals.test.ts:140 was relaxed from BUILT_IN_PROVIDERS to foreignProviders. Two assertions were also inverted: 'reports a declared adapter display name embedded in user-facing text' and 'keeps an adapter's own provider id exempt but reports its display name'. R13e only partly reverted this. The repair restores main's adapter display-name detection and both original assertions. It keeps the permitted catalogModules set, which includes provider-catalog-identities.ts. Any adapter production literal this resurfaces, such as Pi or Codex display text, must source its display name from the catalog. Task 13's no-new-exemptions requirement covers that work, and it preserves completed Task 13 coverage.
**Parent task:** rem-as-built-R13e
**Governing clause:** Task rem-as-built-R13e
**Done when:**
- Task rem-as-built-R13e is satisfied by this task.
- The repair for task rem-as-built-rem-as-built-R13f is committed and its targeted tests pass.

### Task rem-as-built-rem-as-built-R13g: Fix every production finding the restored guard reports in execution/*-provider.ts adapters by deriving the adapter's display name from the provider catalog identity instead of a string literal. Then confirm provider-id-literals.test.ts passes with no new exemptions
**Gate:** as-built
**Rationale:** Verified (99%, observed via git diff main): provider-id-literals.test.ts:140 was relaxed from BUILT_IN_PROVIDERS to foreignProviders. Two assertions were also inverted: 'reports a declared adapter display name embedded in user-facing text' and 'keeps an adapter's own provider id exempt but reports its display name'. R13e only partly reverted this. The repair restores main's adapter display-name detection and both original assertions. It keeps the permitted catalogModules set, which includes provider-catalog-identities.ts. Any adapter production literal this resurfaces, such as Pi or Codex display text, must source its display name from the catalog. Task 13's no-new-exemptions requirement covers that work, and it preserves completed Task 13 coverage.
**Parent task:** rem-as-built-R13e
**Governing clause:** Task rem-as-built-R13e
**Done when:**
- Task rem-as-built-R13e is satisfied by this task.
- The repair for task rem-as-built-rem-as-built-R13g is committed and its targeted tests pass.
