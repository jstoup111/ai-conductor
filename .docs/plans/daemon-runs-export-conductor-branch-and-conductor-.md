# Implementation Plan: Daemon OTel branch and engine identity

**Date:** 2026-08-29
**Design:** [technical track](../track/daemon-runs-export-conductor-branch-and-conductor-.md)
**Stories:** [accepted stories](../stories/daemon-runs-export-conductor-branch-and-conductor-.md)
**Conflict check:** Skipped — Tier S

## Summary

Tighten the existing OTel wiring boundary so branch and engine-version resolution results are mandatory and diagnostically explicit, then supply the daemon's feature branch and executing engine version. Three scoped TDD tasks cover resource semantics, supported-caller enforcement, and daemon attribution.

## Technical Approach

- Keep the shared plugin-facing visualizer context optional for non-OTel plugins, but define a stricter OTel start-context shape whose `branch` and `engineVersion` properties are required and may explicitly contain `undefined` to mean resolution was attempted but failed.
- Normalize each scoped identity property by property presence before value fallback: own property plus a non-empty string is the resolved value, own property with `undefined` is `unresolved`, and absent property is `not-supplied`. Retain the OTel never-blocks-a-run contract.
- Preserve signal scoping: branch remains feature-stable on metric and trace Resources; engine version remains trace-only so daemon refreshes cannot add metric-series cardinality.
- Feed the daemon boundary from `FeatureWorktree.branch` rather than resolving the primary checkout, and derive engine identity from the executing module with the existing never-throwing resolver. Keep the current event emitter, Resource schema, and exporter lifecycle; add no event or parallel telemetry channel.
- Reuse focused local tests: Resource value semantics belong in the pure Resource builder tests, supported wiring shape belongs at the shared helper/interactive selection seam, and daemon attribution belongs in the injected `beginFeatureRun` wiring test. Ordinary tests use in-memory exporters and injected daemon dependencies; no third-party calls or full Conductor run are needed.

## Prerequisites

- The accepted technical stories and confirmed Approach A are authoritative.
- Existing OTel signal-scope behavior remains unchanged: engine version is absent from metric Resources.

## Tasks

### Task 1: Distinguish resolved, unresolved, and omitted Resource identity

**Story:** Story 2 happy paths and runtime-omission negative path
**Type:** negative-path

**Steps:**
1. Write failing unit cases in `resource.test.ts` for both scoped fields: a resolved string is retained, an own property explicitly set to `undefined` exports `unresolved`, and an absent property exports `not-supplied`; assert no case throws.
2. Verify the focused Resource tests fail because the current nullish fallback collapses the latter two cases to `unknown` (RED).
3. Implement a pure own-property-aware identity normalizer in `resource.ts`; use it for branch on both signal scopes and engine version on traces only, without changing run-id or other identity defaults.
4. Run the focused Resource tests through `ai-conductor scoped-run` and verify all three outcomes pass while engine version remains absent from metric Resources (GREEN).
5. Commit with message: "Distinguish unresolved and omitted OTel identity"

**Done when:**

1. `resource.test.ts` proves resolved, `unresolved`, and `not-supplied` are distinct for both branch and engine version.
2. The existing exact metric Resource key-set assertion still excludes `conductor.engine.version`.
3. Resource construction does not throw for either explicit resolution failure or runtime omission.

**Files:**
- `src/conductor/src/engine/otel/resource.ts`
- `src/conductor/test/engine/otel/resource.test.ts`

**Dependencies:** none

### Task 2: Require identity results at every supported OTel wiring caller

**Story:** Story 1 interactive/daemon parity criterion; Story 2 successful-resolution and supported-caller omission criteria; Story 1 disabled-export negative path
**Type:** happy-path

**Steps:**
1. Add failing type-level coverage showing the shared OTel helper accepts required `branch` and `engineVersion` properties, including explicit `undefined`, while an object omitting either property is not a valid supported context; retain the disabled-export assertion (RED through the test-covering typecheck plus focused tests).
2. Define and export the narrow OTel identity start-context type in `wire.ts`, leaving the general `VisualizerStartContext` contract unchanged for non-OTel plugins.
3. Tighten `wireOtelVisualizer`, `createVisualizerStartContext`, and `buildInteractiveVisualizers` so supported interactive wiring preserves both required properties end-to-end. The existing interactive resolver results remain the supplied values.
4. Run `otel-wire.test.ts` and `integration/visualizer-selection.test.ts` through `ai-conductor scoped-run`, then run the repository's test-covering typecheck; verify valid resolved/explicit-unresolved contexts compile, omission does not, and disabled OTel still returns null without starting a visualizer (GREEN).
5. Commit with message: "Require OTel branch and engine identity inputs"

**Done when:**

1. The OTel wiring parameter type requires both properties while the shared non-OTel `VisualizerStartContext` remains optional.
2. Type-level coverage rejects omission of either property and accepts explicit `undefined` as an attempted-but-unresolved result.
3. Focused interactive wiring tests pass and disabled OTel still starts no exporter or listener.

**Files:**
- `src/conductor/src/engine/otel/wire.ts`
- `src/conductor/src/index.ts`
- `src/conductor/test/otel-wire.test.ts`
- `src/conductor/test/integration/visualizer-selection.test.ts`

**Dependencies:** Task 1

### Task 3: Supply the daemon feature branch and executing engine version

**Story:** Story 1 daemon branch, engine-version, checkout-divergence, and source-build criteria
**Type:** happy-path

**Steps:**
1. Extend `daemon-otel-wiring.test.ts` with failing assertions that the context passed for a daemon dispatch contains the injected feature worktree branch (`feat/feature-a`) and the executing source build identity (`dev`), while retaining the persisted/fallback run-id assertions (RED).
2. Pass `worktree.branch` to the shared OTel helper in `beginFeatureRun`; do not resolve branch from `projectRoot`, which may name the primary checkout instead of the dispatched feature.
3. Resolve engine version from `daemon-cli.ts`'s executing module directory using the existing never-throwing engine-version resolver, and pass the result with every daemon dispatch. Rely on the existing resolver unit cases for installed version-id variation across engine directories.
4. Run `daemon-otel-wiring.test.ts` plus the existing engine-version resolver tests through `ai-conductor scoped-run`; verify daemon context carries `feat/feature-a` and `dev`, installed engine directories still yield their distinct ids, and disabled OTel remains non-blocking (GREEN).
5. Commit with message: "Attribute daemon telemetry to its branch and engine"

**Done when:**

1. The daemon wiring test observes the exact feature worktree branch rather than a primary-checkout branch.
2. The daemon wiring test observes `dev` from source execution, and existing resolver tests prove distinct installed engine directories yield their version ids.
3. Existing daemon run-id, teardown, and disabled-OTel assertions remain green.

**Files:**
- `src/conductor/src/daemon-cli.ts`
- `src/conductor/test/daemon-otel-wiring.test.ts`

**Dependencies:** Task 2

### Task 4: Forward identity property presence through the visualizer seam

**Story:** Story 2 runtime-omission criterion
**Type:** negative-path

**Steps:**
1. Add a failing case to `otel-wire.test.ts` that wires the visualizer with enabled OTel, an in-memory span exporter, and a context omitting both `branch` and `engineVersion`, asserting the exported `conductor.run` trace Resource carries `not-supplied` for each (RED — it reports `unresolved` today).
2. Build `resourceContext` in `initializeProviders` so `branch` and `engineVersion` keys exist only when the incoming context supplies them, leaving every other property unchanged.
3. Correct the stale `ResourceContext` doc comments for `branch` and `engineVersion`, which still say "Defaults to 'unknown'" and describe no current code path.
4. Run `otel-wire.test.ts` and `resource.test.ts` through `ai-conductor scoped-run`; verify the omission case reports `not-supplied`, a supplied-but-unresolvable value still reports `unresolved`, and disabled OTel remains non-blocking (GREEN).
5. Commit with message: "Report caller omission as not-supplied at the visualizer seam"

**Done when:**

1. Wiring the visualizer with a context omitting both identity properties exports `not-supplied` for each scoped attribute.
2. A context supplying an empty or unresolvable value still exports `unresolved`, so the two outcomes stay distinct at the runtime seam.
3. The disabled-OTel no-export case and the existing supplied-value assertions remain green.
4. No `ResourceContext` doc comment claims a `'unknown'` default that no code path produces.

**Files:**
- `src/conductor/src/engine/otel/otel-visualizer.ts`
- `src/conductor/src/engine/otel/resource.ts`
- `src/conductor/test/otel-wire.test.ts`

**Dependencies:** Task 1

## Task Dependency Graph

```text
Task 1 → Task 2 → Task 3
Task 1 → Task 4
```

## Integration Points

- After Task 1: Resource export can diagnose resolved, unresolved, and omitted scoped identity without changing signal cardinality.
- After Task 2: Every supported interactive/shared OTel caller must supply both resolution results.
- After Task 3: Daemon dispatches satisfy the strict contract with their feature branch and executing engine build.
- After Task 4: The runtime visualizer seam distinguishes a caller omission from a failed resolution, so an operator can tell a wiring defect from an environment one.

## Story Coverage

| Story criterion | Coverage disposition | Task |
| --- | --- | --- |
| Daemon trace names feature worktree branch | Focused daemon wiring test asserts exact injected branch | Task 3 |
| Daemon trace names executing installed build and changes after refresh | Daemon wiring assertion plus existing engine-directory resolver unit cases | Task 3 |
| Interactive and daemon attribute parity | Shared required-context type plus interactive and daemon focused wiring tests | Tasks 2, 3 |
| Primary checkout differs from feature worktree | Daemon fixture branch assertion proves worktree branch is authoritative | Task 3 |
| Source execution reports `dev` | Daemon wiring assertion plus existing resolver unit case | Task 3 |
| Disabled OTel remains a no-op | Existing shared-helper no-export case retained under the stricter context | Task 2 |
| Attempted resolution failure reports `unresolved` without throwing | Pure Resource unit cases for both scoped fields | Task 1 |
| Successful resolution reports its value | Pure Resource unit cases plus supported wiring cases | Tasks 1, 2 |
| Supported caller omission is rejected | Test-covering typecheck of the strict OTel context | Task 2 |
| Runtime omission reports `not-supplied` without throwing | Pure Resource unit cases for the builder, plus a visualizer wiring case proving the runtime seam preserves property absence | Tasks 1, 4 |

Every criterion is diff-local: only this feature's changes to Resource normalization and the two supported OTel entry points can change these outcomes.

## Verification

- [ ] All happy-path criteria map to Tasks 1–3.
- [ ] All negative-path criteria map to Tasks 1–3 at the lowest sufficient unit or focused wiring layer.
- [ ] Every task owns scoped RED/GREEN proof and no task is a terminal aggregate-validation catch-all.
- [ ] Every task has falsifiable completion checks and an explicit dependency.
- [ ] The dependency graph is acyclic.
