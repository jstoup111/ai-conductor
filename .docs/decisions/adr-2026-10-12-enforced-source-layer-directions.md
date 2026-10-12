# ADR: Roadmap slice 3 empties the layer ratchet's upward edges and extends it to type-only edges

**Date:** 2026-10-12
**Status:** APPROVED
**Deciders:** operator (James Stoup)

<!-- Filename convention: adr-2026-10-12-enforced-source-layer-directions.md. Cite by filename stem. -->

## Context

`docs/contributing/code-organization.md` documents the intended layering of `src/conductor/src/`
as `types ← execution ← engine ← ui ← entry points`. It also records that this cannot be enforced,
because `engine/` and `ui/` import each other. Intake #1017 asks for the cycle to be broken, for
`types/` to stop importing implementation layers, and for a test that keeps the direction fixed.

Import grep on 2026-10-12 measured four upward edges:

- **`engine/` → `ui/`: 54 files.** Every one imports `ui/events.js` (`ConductorEventEmitter`, `EventHandler`).
  The only exceptions are `engine/plugin-loader.ts`, which imports `TerminalSubscriber`,
  `TerminalRenderer` and `UIEventHandler`, and `engine/cli-builtins.ts`, which imports
  `TerminalRendererOptions` as a type.
- **`execution/` → `engine/`: 10 files with 13 value imports.**
  - `isFeatureSlug`, from `worktree.ts`.
  - `ProviderSetupUnavailableError`, from `provider-setup-failure.ts`.
  - `assertRealExecAllowed`, from `tracker-client.ts`.
  - The defaults in `provider-model-policy-defaults.ts`.
  - `ensureGitGuardForDispatch`, from `git-guard.ts`.
  - `writeScratchSchema`, from `self-host/provider-scratch.ts`.
  - `buildCodexReadOnlyProducerRootPolicyArgs`, from `build-review-read-only-capability.ts`.
- **`types/` → `engine/` and `types/` → `execution/`: about 25 type-only symbols,** imported by
  `types/events.ts` and `types/config.ts`. Several are derived from implementation registries:
  - `BuiltInProviderId` is `(typeof BUILT_IN_PROVIDERS)[number]['id']`.
  - `GithubOperationName` is `keyof typeof GITHUB_OPERATION_REGISTRY`.
  - `BUILD_REVIEW_RUBRIC_IDS` is a const tuple.

`ui/events.ts` depends only on `types/`. The event-spine emitter is therefore a lower-layer
primitive that has been filed under `ui/`. `types/` already holds runtime values such as
`VALID_PLUGIN_KINDS` and the plugin error classes, so pure data in `types/` is an established
precedent. `typescript` 6.0.3 is already a dependency, and `test/structural/` already holds tests
that use the TypeScript compiler API.

`003-ui-renderer-plugin-point` (APPROVED) governs the `UIRenderer` and `UISubscriber` contracts.
This ADR does not change those contracts, only where modules live.

`adr-2026-10-07-conductor-decomposition-target-architecture` (APPROVED) governs import direction and
is reused here, not duplicated:
- **Its D5** fixes the layering `types ← execution ← engine ← ui ← entry` and enforces it with a
  TypeScript-AST import-graph check. That check fails on any new value-import cycle or new upward
  value edge, using a keyed, shrink-only allowlist of one file per allowed edge.
- **Its D7** orders the roadmap. Slice 2 (#1988) builds that ratchet. Slice 3 (#3042 together with
  #1017) breaks the engine↔execution SCC and relocates the event emitter, which tightens the
  ratchet.

This ADR is the design for slice 3. It depends on #1988's ratchet having merged. The ratchet counts
value edges only, but every `types/` violation listed above is type-only. So D5 alone cannot keep
`types/` clean once it has been fixed, and this ADR adds type-only edges to the ratchet's upward
rule.

## Options Considered

### Option A: Move code to make the documented chain true
- **Pros:** The documented architecture becomes accurate and enforceable, and no layer is added.
- **Cons:** About 400 test importers of `ui/events`, unless a re-export keeps them working. Helpers
  that carry engine dependencies cannot simply move.

### Option B: Add a `core/` foundation layer
- **Pros:** Shared primitives get an explicit home.
- **Cons:** It adds a sixth layer and a recurring "is this core?" judgement that tends to grow into
  a dumping ground.

### Option C: Allowlist ratchet over the current edges, with no fixes
- **Pros:** Small and fast.
- **Cons:** The cycle stays, which falls short of the operator-confirmed scope. It is also
  already #1988's job under `adr-2026-10-07-conductor-decomposition-target-architecture` D7.

### Option D: A separate no-allowlist structural test built by this feature
- **Pros:** No dependency on #1988.
- **Cons:** It competes with the D5 ratchet as a second enforcement mechanism for the same rule.
  It drops D5's intra-layer cycle detection and runs the D7 roadmap out of order. Rejected at
  conflict-check.

## Decision

Adopt **Option A**.

1. **No import of any kind points up the chain set by `adr-2026-10-07-conductor-decomposition-target-architecture` D5.**
   - The chain is D5's, unchanged. A file may import from its own layer or any layer below it.
   - For the upward-edge rule, type-only imports, `export … from` re-exports and dynamic
     `import()` all count as edges. D5's value-cycle rule inside a layer is unchanged.
   - `tools/` may import `engine/` and `types/`, and nothing at runtime imports `tools/`.
   - Only an entry-point file may import another entry-point file.

   *Why type-only imports count:* every `types/` violation is type-only, so a value-only ratchet
   cannot hold that outcome. A type edge also still couples compilation and comprehension, and it
   is how value cycles reappear when a symbol later changes from a type to a value.

2. **`ConductorEventEmitter` and `EventHandler` live in `engine/`.**
   - `ui/events.ts` stays as a re-export of the moved symbols. That is a permitted `ui → engine`
     edge, and it keeps test importers unchanged.
   - No `src/` file below `ui/` may import through that re-export.

   *Why `engine/` and not `types/`:* the emitter is runtime dispatch machinery. Layers below
   `engine/` that need to emit receive it through the port rule in decision 4.

3. **The engine never constructs UI.**
   - `TerminalRenderer` and `TerminalSubscriber` construction and registration move to
     entry-level composition, reached from the existing `index.ts` and `daemon-cli.ts` call sites.
   - Engine-side plugin registration registers only built-in providers. Entry-level composition
     registers the terminal renderer through the same plugin registry.
   - The `UIRenderer` and `UISubscriber` contracts of `003-ui-renderer-plugin-point` are unchanged.

4. **Each `execution/` → `engine/` edge is resolved by moving the dependency down or by inverting it.**
   - **Move down:** a dependency moves into `execution/`, or into `types/` if it is pure types or
     data, when its own transitive imports lie entirely in `execution/` and `types/`.
   - **Invert:** otherwise, `execution/` declares the narrow port it needs as an interface or
     callback, and the engine passes the implementation in when it constructs the provider.
   - A dependency that would have to bring engine domain logic down with it is always inverted,
     never moved. `git-guard.ts` is an example: through `git-hook-assets.ts` it pulls in
     `protected-artifact-seal`.
   - A component below `engine/` that emits events depends on a minimal event-sink interface
     declared in `types/`, not on `ConductorEventEmitter`.

5. **`types/` owns every symbol it exposes and imports nothing outside `types/`.**
   - A type that `types/` currently borrows moves into `types/`, and its old module imports it
     back from there.
   - A type derived from an implementation registry becomes an explicit literal union in `types/`.
     The registry is then constrained to cover exactly that union, so drift in either direction
     fails the type check (for example, `satisfies` a record keyed by the union).
   - Pure-data constants with no imports, such as `BUILD_REVIEW_RUBRIC_IDS`, may move into
     `types/` instead.
   - **Exception: a registry that another APPROVED ADR makes the sole place its literals are
     written.** Built-in provider ids are the case here, under
     `adr-2026-09-24-built-in-provider-catalog-and-boot-discovery` D1.
     - `types/` declares an opaque branded type instead, such as `ProviderId`, and writes no literal.
     - The registry keeps its derived narrow union, and supplies the conversion into the opaque type.
     - Contracts in `types/` that carry such an id lose literal narrowing, which is the accepted cost.
   - This covers inline `import('…')` type references, such as the `ConductorEventEmitter`
     references in `types/plugin.ts`. A contract in `types/` that needs the emitter types it
     against an event-bus interface declared in `types/`, and `ConductorEventEmitter` implements
     that interface.

6. **The #1988 import-graph ratchet enforces decision 1. This feature builds no second checker.**
   - This feature depends on #1988 having merged.
   - The ratchet's upward-edge rule is extended to type-only imports, re-exports and dynamic
     `import()`.
   - Every allowlist entry for an upward edge is deleted as that edge is removed. After this
     feature, no upward-edge entry remains.
   - D5's shrink-only property, which fails on an allowlisted edge that no longer exists, then
     keeps the layering permanent.
   - Allowlist entries for value edges inside an existing same-layer SCC are deleted only when a
     move in this feature removes their edge. Otherwise they stay for later slices.

7. **`docs/contributing/code-organization.md` describes the enforced rule, delivered by this repository's `maintain-documentation` SHIP step rather than a plan task.**
   - Its "Dependency direction" section states the chain as enforced and names the ratchet.
   - The "Known limitation" note and the stale edge counts are replaced.
   - The `execution/` "clean leaf" claim becomes accurate again.
   - Plans carry no documentation tasks, and that step owns human-facing documentation for every
     feature in this repository.

## Consequences

### Positive
- The engine can be loaded and unit-tested without the terminal UI, and providers without engine
  domain logic.
- An upward import fails CI at the point it is written, not when it is found in review.
- The documented layering and the code agree, and machinery keeps them in agreement.

### Negative
- A registry-derived union now has two textual sources, the `types/` union and the registry.
  The paired type constraint makes drift a compile error rather than a silent divergence.
- Provider constructors gain injected ports, which slightly widens their option surfaces.
- `ui/events.ts` remains as a re-export shim until a later cleanup removes it.

### Follow-up Actions
- [ ] Implement decisions 2 to 5 as behaviour-neutral moves, with the existing suite green throughout.
- [ ] Extend the #1988 ratchet and empty its upward-edge allowlist (decision 6).
- [ ] The `maintain-documentation` SHIP step refreshes `code-organization.md` (decision 7).
