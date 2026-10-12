**Status:** Accepted

# Stories: Enforce the documented source layer directions (#1017)

Technical track. These stories are governed by `adr-2026-10-12-enforced-source-layer-directions` and
`architecture-review-2026-10-12-break-the-engine-ui-import-cycle-and-stop-types-im`. Layer order, lowest first:
`types`, `execution`, `engine`, `ui`, entry points. "Upward" means an import from a lower layer into
a higher one.

## Story 1: The layer ratchet rejects any upward import and allows no upward edge

**Requirement:** ADR D1, D6

As a contributor, I want the #1988 import-graph ratchet to reject an upward import of any kind, with no upward edge left on its allowlist, so that the documented layering cannot silently erode again.

### Acceptance Criteria

#### Happy Path
- Given the final `src/conductor/src/` tree, when the #1988 import-graph ratchet runs in the default test tier, then it passes and its allowlist contains no entry for an upward edge between layers.
- Given a file that imports only from its own layer or a lower layer, including `ui/` importing `execution/` and an entry-point file importing another entry-point file, when the ratchet evaluates it, then no violation is reported for that file.

#### Negative Paths
- Given a fixture in which an `engine/` file has a value import from `ui/`, when the ratchet evaluates it, then it reports a violation naming the importing file, its line number, and the `engine -> ui` edge.
- Given a fixture in which a `types/` file has an `import type` from `engine/`, when the ratchet evaluates it, then it reports the edge as an upward violation rather than exempting it for being type-only.
- Given a fixture in which an `execution/` file uses `export ... from` on an `engine/` module, when the ratchet evaluates it, then it reports the re-export as an upward violation.
- Given a fixture in which an `engine/` file calls dynamic `import()` on a `ui/` module, when the ratchet evaluates it, then it reports the dynamic import as an upward violation.
- Given a fixture in which a layer file imports an entry-point file such as `index.ts`, or a runtime file imports `tools/`, when the ratchet evaluates it, then it reports a violation.
- Given an allowlist entry for an upward edge that this feature removed, when the ratchet runs, then it fails because that allowlisted edge no longer exists, so the entry must be deleted.

### Done When
- [ ] The #1988 ratchet's upward-edge rule counts type-only imports, `export ... from` re-exports, and dynamic `import()`.
- [ ] Fixture tests prove that value, type-only, re-export, dynamic-import, entry-point, and `tools/` upward edges are each rejected, with `file:line` in the failure.
- [ ] The ratchet's allowlist holds no upward-edge entry on the final tree, and the ratchet passes.

## Story 2: The event emitter keeps its behaviour after leaving the UI layer

**Requirement:** ADR D2

As an engine maintainer, I want the event-spine emitter to live below the UI layer with unchanged dispatch semantics, so that engine code can emit events without depending on the terminal UI.

### Acceptance Criteria

#### Happy Path
- Given the relocated emitter, when engine code emits a `ConductorEvent` with registered sync and async handlers, then every handler receives the event and `emit` resolves only after the async handlers settle.
- Given a module that still imports `ConductorEventEmitter` from `ui/events.js`, when it constructs an emitter and passes it to engine code typed against the relocated class, then type checking passes and `instanceof` holds against both import paths.

#### Negative Paths
- Given a registered handler that throws synchronously or rejects, when `emit` is called, then the error is swallowed and the remaining handlers still run, exactly as before the move.
- Given a registered handler that rejects, when `emitOrThrow` is called, then the failure still propagates to the caller.
- Given any `src/` file in `engine/`, `execution/`, or `types/`, when the layer-direction test runs, then no file below `ui/` imports the emitter through `ui/events.js`.

### Done When
- [ ] `ConductorEventEmitter` and `EventHandler` are defined in an `engine/` module, and `ui/events.ts` only re-exports them.
- [ ] The existing emitter and event-persister tests pass with unchanged assertions.
- [ ] No `engine/` file imports from `ui/`.

## Story 3: Terminal output is composed outside the engine

**Requirement:** ADR D3

As an operator, I want CLI runs and the daemon to render terminal output exactly as before, while the engine itself constructs no UI, so that the engine loads and tests without the terminal renderer.

### Acceptance Criteria

#### Happy Path
- Given an interactive CLI run with renderer options, when built-ins are registered at start-up, then a terminal renderer is registered as `ui_renderer:terminal` and a terminal subscriber is started, as today.
- Given daemon start-up, when built-ins are registered, then the daemon's terminal subscriber is started and stopped on the same lifecycle as before the change.
- Given engine-side plugin registration, when it runs, then the built-in providers are registered as before.

#### Negative Paths
- Given a registration call with no renderer options, when built-ins are registered, then no terminal renderer is registered, matching current behaviour.
- Given a test that loads engine-side plugin registration, when its module graph is resolved, then no `ui/` module is part of that graph.

### Done When
- [ ] `engine/plugin-loader.ts` and `engine/cli-builtins.ts` import nothing from `ui/`.
- [ ] Terminal renderer and subscriber construction is reached from the existing `index.ts` and `daemon-cli.ts` start-up paths.
- [ ] Existing plugin-registration, CLI-render, and daemon-render tests pass.

## Story 4: Provider execution works without importing the engine

**Requirement:** ADR D4

As an engine maintainer, I want the execution layer's providers to run with the same guards and scratch handling while importing nothing from the engine, so that providers can be loaded and tested in isolation.

### Acceptance Criteria

#### Happy Path
- Given a provider dispatch for Claude, Codex, or Pi in a worktree, when the provider is constructed by the engine and invoked, then the git guard is installed for the dispatch exactly as before.
- Given a Codex or Pi self-host dispatch, when the provider is invoked, then the scratch schema is written and the Codex read-only producer root policy arguments are produced as before.
- Given any file under `execution/`, when the layer-direction test runs, then it imports nothing from `engine/` or `ui/`.

#### Negative Paths
- Given `AI_CONDUCTOR_NO_REAL_EXEC` is set, when a code path reaches the real-exec guard from either the execution layer or the engine, then the same blocking error is thrown as before.
- Given provider setup is unavailable, when a provider raises the setup-unavailable error, then engine-side classification still recognizes it, because a single error class is shared across layers.
- Given a self-host scratch sweep that emits cleanup events, when it runs after the scratch-schema writer has moved to the execution layer, then those events still reach the engine's event spine and the persisted event log.
- Given a provider constructed without a required injected port, when type checking runs, then compilation fails rather than the provider silently skipping the guard.
- Given a slug value, when `isFeatureSlug` is evaluated from the execution layer or the engine, then both return identical results for valid and invalid slugs.

### Done When
- [ ] No `execution/` file imports `engine/` or `ui/`.
- [ ] Each of the 7 former `execution/` → `engine/` dependencies is either relocated or supplied through an injected port, as recorded in the plan.
- [ ] Existing Claude, Codex, and Pi provider tests and the scratch, git-guard, and provider-setup tests pass.

## Story 5: The types layer is self-contained and stays consistent with its registries

**Requirement:** ADR D5

As a contributor, I want `types/` to declare every symbol it exposes, with registries constrained to match those declarations, so that the type layer depends on no implementation layer and cannot drift from it.

### Acceptance Criteria

#### Happy Path
- Given the final tree, when the layer-direction test scans `types/`, then no file imports from `execution/`, `engine/`, or `ui/`, including type-only imports.
- Given modules that formerly declared moved types, when they reference those types, then they import them from `types/` and type checking passes.

#### Negative Paths
- Given a new operation added to the GitHub operation registry without a matching member in the `types/` operation-name union, when type checking runs, then it fails.
- Given a member added to the `types/` operation-name union without a matching registry entry, when type checking runs, then it fails.
- Given a build-review rubric id that differs between `types/` and its implementation source, when type checking runs, then it fails.
- Given an existing serialized `ConductorEvent` payload, when it is persisted and read back after the move, then its shape is unchanged.

### Done When
- [ ] `types/events.ts` and `types/config.ts` import only from `types/`.
- [ ] Each registry-derived type held in `types/` has a compile-time constraint, failing in both directions, against its registry, while built-in provider ids appear in `types/` only as an opaque type with no literal.
- [ ] Typecheck and the existing event-persistence tests pass.
