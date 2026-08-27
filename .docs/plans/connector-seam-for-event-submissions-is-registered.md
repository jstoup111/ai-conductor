# Implementation Plan: Connector Seam — Visualizer Selection Loop (#1516)

**Date:** 2026-08-26
**Stories:** .docs/stories/connector-seam-for-event-submissions-is-registered.md
**Conflict check:** Clean as of 2026-08-26

## Summary

Finish ADR-014's visualizer selection loop: registry retrieval of `kind: visualizer` plugins with
a `visualizers` config key, the built-in OTel exporter re-registered through the same seam, an
identity context on `start()`, per-plugin start isolation, and load-time shape validation. 9 tasks.

## Technical Approach

- **Seam contract.** `VisualizerPlugin.start(emitter, context)` gains a second parameter,
  `VisualizerStartContext` (exported from `src/conductor/src/types/plugin.ts`): `runId?`,
  `project?`, `branch?`, `feature?`, `engineVersion?`, `pipelineDir?` — all optional-safe; absent
  means underivable, never fabricated at the seam. No third-party implementors can exist (the kind
  was never retrievable), so the signature change is breaking on paper only.
- **Registration shape.** The registry stores visualizer **factories**, not instances:
  `(ctx: VisualizerFactoryContext) => VisualizerPlugin | null`, where the factory context carries
  the loaded `HarnessConfig`, `pipelineDir`, the start context, and the emitter for warning
  bridging. A factory returning `null` means "not enabled" — the built-in `visualizer:otel`
  factory runs `resolveOtelConfig` internally and returns `null` when disabled, preserving the
  existing gate exactly and keeping the disabled-noop path dependency-free. Installed plugins load
  as plain `VisualizerPlugin` objects; the loader wraps them in a trivial factory so the registry
  type is uniform.
- **Selection loop** in `main()` (`src/conductor/src/index.ts`, replacing the hard-wired OTel-only
  block): enabled names = the `visualizers` config list; `otel` is always attempted via its
  built-in factory (its own gate decides), and a `visualizers` entry naming `otel` is ignored with
  a one-time warning pointing at the `otel:` block. Each name resolves via
  `registry.tryGet('visualizer', name)`; missing → one warning naming the missing plugin and the
  registered visualizer names, then skip. Local pattern: mirror the `ui_renderer` selection
  (config-name → registry lookup → start; search hints: `registry.get<UISubscriber>`,
  `buildVisualizers`, `resolveOtelConfig` in `index.ts`), with the allowed variation that
  visualizers are a concurrent list, not a single selection.
- **Isolation.** `buildVisualizers` wraps each `start` in try/catch; a throw emits the existing
  sink-registered `renderer_error` event (`event-sinks.ts:79`, persist: true — no new event type,
  so no sink-registry change) naming the connector, drops it from the started list (so teardown
  never calls its `stop`), and continues. Emit-time isolation already exists (`emit()` swallows
  handler errors); stop-time isolation already exists (`stopVisualizers` per-plugin catch).
- **Shape validation.** `discoverPlugins` validates `kind: visualizer` entrypoints (function or
  object with `name`, `start`, `stop`) exactly where `llm_provider` shape is checked
  (`plugin-loader.ts:30-36` pattern); malformed → `PluginLoadError` naming the plugin and missing
  member, valid siblings unaffected (existing partial-failure policy).
- **OTel migration.** `OtelVisualizer` keeps its constructor for exporter knobs/warning hooks and
  reads identity (`runId`, `feature`, `project`, `pipelineDir`, plus new `branch`/`engineVersion`
  resource attributes) from the start context instead of constructor context. Its internal
  generate-an-id fallback (ADR-014 FR-6) is unchanged.
- **Sequencing.** Types → config/loader in parallel → wiring → OTel migration → negative-path
  proofs.

## Prerequisites

None — all changes are internal to `src/conductor`; no new dependencies.

## Tasks

### Task 1: Seam contract — VisualizerStartContext and start(emitter, context)
**Story:** Story 3 (context carrying runId, project, feature, branch, engineVersion, pipelineDir)
**Type:** infrastructure

**Steps:**
1. Write failing test: a fake `VisualizerPlugin` compiled against the new interface receives a `VisualizerStartContext` whose fields match values passed by the caller (extend `test/engine/visualizer-plugin.test.ts`).
2. Verify test fails (RED).
3. Implement: add exported `VisualizerStartContext` and `VisualizerFactoryContext` types and the two-parameter `start` signature in `src/conductor/src/types/plugin.ts`; add the `VisualizerFactory` type; update existing fakes/implementations to compile.
4. Verify test passes (GREEN); `npm run build` in `src/conductor` compiles.
5. Commit: "Add VisualizerStartContext and factory types to the visualizer seam".

**Done when:**
- The new context and factory types are exported from `src/conductor/src/types/plugin.ts` and `start` takes `(emitter, context)`
- The extended visualizer-plugin test asserts a fake observes all six context fields round-tripped
- `src/conductor` compiles with no remaining single-parameter `start` implementation

**Files likely touched:**
- src/conductor/src/types/plugin.ts — context + factory types, signature
- src/conductor/test/engine/visualizer-plugin.test.ts — context round-trip assertion

**Dependencies:** none

### Task 2: `visualizers` config key
**Story:** Story 1 (name listed in the `visualizers` config key)
**Type:** infrastructure

**Steps:**
1. Write failing test: a config file with `visualizers: [a, b]` loads to `config.visualizers === ['a','b']`; absent key loads as undefined (extend the existing config-loading test file that covers `ui_renderer`).
2. Verify RED.
3. Implement: add `visualizers?: string[]` to `HarnessConfig` in `src/conductor/src/types/config.ts` and thread it through config loading/validation beside `ui_renderer`.
4. Verify GREEN.
5. Commit: "Add visualizers config key".

**Done when:**
- `HarnessConfig` carries `visualizers?: string[]` and config loading preserves it
- The config test asserts both the present-key and absent-key loads
- A non-array `visualizers` value is rejected or normalized the same way the nearest existing list-valued key is (state which in the test)

**Files likely touched:**
- src/conductor/src/types/config.ts — key
- src/conductor/src/engine/config.ts — load/validate
- src/conductor/test/engine/config.test.ts — assertions

**Dependencies:** none

### Task 3: Load-time shape validation for visualizer entrypoints
**Story:** Story 5 (all criteria)
**Type:** negative-path

**Steps:**
1. Write failing tests in `test/engine/plugin-loader.test.ts`: (a) a `kind: visualizer` plugin whose entrypoint lacks `stop` is rejected with a `PluginLoadError` naming the plugin and the missing member and is not registered; (b) a valid visualizer in the same discovery pass registers and is retrievable; (c) a malformed visualizer does not prevent the valid one from registering.
2. Verify RED.
3. Implement: in `discoverPlugins` (`src/conductor/src/engine/plugin-loader.ts`), validate visualizer entrypoint shape (`name` string, `start`/`stop` functions on the plugin or the factory's product) mirroring the existing `llm_provider` shape check; wrap loaded plain plugins into a `VisualizerFactory`.
4. Verify GREEN.
5. Commit: "Shape-validate visualizer plugin entrypoints at load".

**Done when:**
- The loader test asserts rejection message names both the plugin and the missing member
- The valid-sibling test proves partial-failure policy is preserved
- The shape check runs inside `discoverPlugins`, not in test helpers

**Files likely touched:**
- src/conductor/src/engine/plugin-loader.ts — shape check + factory wrap
- src/conductor/test/engine/plugin-loader.test.ts — three assertions

**Dependencies:** 1

### Task 4: Register `visualizer:otel` as a built-in factory
**Story:** Story 2 (OTel retrieved from the registry as a built-in)
**Type:** happy-path

**Steps:**
1. Write failing test: after `registerBuiltins`, `registry.tryGet('visualizer','otel')` returns a factory; invoking it with a factory context whose config has `otel` disabled returns `null`; with a valid file-transport `otel` config it returns a `VisualizerPlugin` named `otel`.
2. Verify RED.
3. Implement: add the `visualizer:otel` factory to `registerBuiltins` in `src/conductor/src/engine/plugin-loader.ts`; the factory runs `resolveOtelConfig(ctx.config, ctx.pipelineDir)` and returns `null` when disabled, else constructs the OTel visualizer via the existing creation path (including the warning bridge).
4. Verify GREEN.
5. Commit: "Register the OTel exporter as the visualizer:otel built-in".

**Done when:**
- `registerBuiltins` registers `visualizer:otel` and the disabled-config invocation returns `null` without touching OTel SDK setup
- The enabled-config invocation returns a plugin named `otel`
- No `registerBuiltins` change affects the other built-in kinds (existing plugin-defaults tests pass)

**Files likely touched:**
- src/conductor/src/engine/plugin-loader.ts — builtin factory
- src/conductor/test/engine/plugin-loader.test.ts — factory assertions

**Dependencies:** 1

### Task 5: Selection loop replaces the hard-wired OTel block
**Story:** Story 1 (listed plugin started; both-connectors delivery)
**Type:** happy-path

**Steps:**
1. Write failing integration test (new `test/integration/visualizer-selection.test.ts`): register a fake visualizer factory under name `fake`, set `visualizers: ['fake']`, drive the exported selection helper, and assert the fake's `start` ran with the emitter and a context carrying the run's identity; with two fakes enabled, both receive an emitted event each subscribed to.
2. Verify RED.
3. Implement: extract a testable `selectVisualizers(registry, config, factoryCtx)` helper in `src/conductor/src/index.ts` (or a sibling module) that builds the visualizer list — configured names via `registry.tryGet` plus the `otel` built-in factory — and replace the hard-wired OTel-only block with it; construct the start/factory context from the values already computed for the old OTel path.
4. Verify GREEN; existing OTel integration tests still pass.
5. Commit: "Select visualizers from the registry in the run loop".

**Done when:**
- The selection helper exists on the production startup path and the old direct OTel construction block is gone from `main()`
- The integration test proves a registered fake listed in `visualizers` observes emitted events
- The two-connector test proves concurrent delivery
- Existing otel-exporter and otel-disabled-noop integration tests pass unchanged

**Files likely touched:**
- src/conductor/src/index.ts — selection loop, context construction
- src/conductor/test/integration/visualizer-selection.test.ts — new

**Dependencies:** 1, 2, 4

### Task 6: Warn-and-skip for missing names; warn-and-ignore for `otel` in `visualizers`
**Story:** Story 1 (named-but-missing warning); Story 2 (`otel` listed while gate disabled)
**Type:** negative-path

**Steps:**
1. Write failing tests in the selection integration test: (a) `visualizers: ['ghost']` with no such plugin → exactly one warning naming `ghost` and listing registered visualizer names; run proceeds; (b) `visualizers: ['otel']` with `otel:` absent → one warning pointing at the `otel:` block, OTel not started, run proceeds; (c) empty/absent `visualizers` with OTel disabled → zero visualizers started.
2. Verify RED.
3. Implement: warn-once bookkeeping in the selection helper, mirroring `resolveMemoryProvider`'s warn-and-fall-back shape (search hint: `tryGet` uses in `engine/config.ts`).
4. Verify GREEN.
5. Commit: "Warn and skip unresolvable visualizer selections".

**Done when:**
- The ghost-name test asserts warning content (missing name + registered names) and single emission
- The otel-listed test asserts OTel is not constructed and the warning names the `otel:` block
- The empty-selection test asserts byte-identical no-visualizer behavior

**Files likely touched:**
- src/conductor/src/index.ts — warn logic (same helper as Task 5)
- src/conductor/test/integration/visualizer-selection.test.ts — three cases

**Dependencies:** 5

### Task 7: Per-plugin start isolation in buildVisualizers
**Story:** Story 4 (throwing start; never-started stop exclusion)
**Type:** negative-path

**Steps:**
1. Write failing tests in `test/integration/visualizer-wiring.test.ts`: three fakes where the second throws in `start` → a `renderer_error` event is emitted naming the failing connector, fakes 1 and 3 are started, and the returned started-list excludes fake 2; `stopVisualizers` over that list never calls fake 2's `stop`; a fake whose `stop` rejects still lets the sibling's `stop` run (existing behavior, assert it); a fake whose event handler throws on a submission does not prevent another subscriber from receiving the event (regression assertion against existing `emit()` isolation).
2. Verify RED.
3. Implement: per-plugin try/catch in `buildVisualizers` (`src/conductor/src/index.ts:199-207` region); emit `renderer_error` (existing sink-registered type — no `EVENT_SINKS` change) and continue; return the successfully-started list for teardown.
4. Verify GREEN.
5. Commit: "Isolate visualizer start failures from the run".

**Done when:**
- The throwing-start test asserts the emitted `renderer_error`, sibling survival, and started-list exclusion
- The stop-rejection test passes against the existing `stopVisualizers` (no production change needed for it — state so in the test)
- A run whose only visualizer throws in start exits with the run's normal exit code (asserted via the selection helper path)

**Files likely touched:**
- src/conductor/src/index.ts — buildVisualizers isolation
- src/conductor/test/integration/visualizer-wiring.test.ts — assertions

**Dependencies:** 1

### Task 8: OTel reads identity from the start context
**Story:** Story 2 (flush unchanged); Story 3 (OTel resource matches prior constructor context)
**Type:** happy-path

**Steps:**
1. Write failing test in `test/engine/otel/otel-visualizer.test.ts`: started via `start(emitter, context)` with runId/feature/project/branch/engineVersion set, the OTel resource attributes carry those values; with runId absent, the existing generated-id fallback still yields a non-empty id.
2. Verify RED.
3. Implement: `OtelVisualizer.start` consumes identity from the context (constructor keeps exporter knobs and warning hook); add `branch`/`engineVersion` resource attributes; update the resource builder accordingly.
4. Verify GREEN; the full OTel test set (`otel-exporter`, `otel-observability`, `otel-warning-wiring`, `otel-disabled-noop`, `otel-step-tokens-model-attribute` acceptance) passes.
5. Commit: "Deliver run identity to the OTel visualizer through the seam".

**Done when:**
- The resource test asserts all five identity attributes from the start context
- The absent-runId test proves the ADR-014 FR-6 generated-id fallback is intact
- Every existing OTel test file passes without behavioral edits (mechanical signature updates only)

**Files likely touched:**
- src/conductor/src/engine/otel/otel-visualizer.ts — context consumption
- src/conductor/src/engine/otel/resource.ts — branch/engineVersion attributes
- src/conductor/test/engine/otel/otel-visualizer.test.ts — assertions

**Dependencies:** 1, 5

### Task 9: Absent-field context delivery and emitter independence
**Story:** Story 3 (absent field, ignored context); Story 2 (independence both directions)
**Type:** negative-path

**Steps:**
1. Write failing tests in the selection integration test: (a) with branch underivable in the factory context, a fake connector observes `branch === undefined` and start succeeds; (b) a fake connector whose `start` ignores the context entirely runs normally; (c) OTel disabled + fake enabled → fake receives events; OTel enabled (file transport) + no fake → OTel unaffected.
2. Verify RED (where behavior is new) — case (b) and (c) may already pass after Tasks 5-8; mark them as regression assertions in the test rather than forcing production edits.
3. Implement: any gap the tests expose in context construction (absent fields passed through, not defaulted).
4. Verify GREEN.
5. Commit: "Prove absent-field identity delivery and emitter independence".

**Done when:**
- The absent-branch test asserts explicit undefined delivery with a successful start
- The independence tests assert each emitter's behavior with the other disabled/absent
- No context field is fabricated in the selection helper (diff shows pass-through construction)

**Files likely touched:**
- src/conductor/src/index.ts — context pass-through fixes if exposed
- src/conductor/test/integration/visualizer-selection.test.ts — three cases

**Dependencies:** 5, 8

## Task Dependency Graph

```
Task 1 ──┬── Task 3
         ├── Task 4 ──┐
         ├── Task 7   ├── Task 5 ── Task 6
Task 2 ──┴────────────┘      │
                             ├── Task 8 ── Task 9
                             └────────────── (9 also needs 5)
```

## Integration Points

- After Task 5: a registered fake connector demonstrably receives events end-to-end.
- After Task 8: OTel runs entirely through the seam; the hard-wired path no longer exists.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a Done when block of falsifiable checks
- [ ] Dependencies are explicit and acyclic

### Task rem-prd-audit-rem-fr5-2: src/conductor/src/index.ts — make selectVisualizers the refusal point the loader comment already promises, at BOTH factory-invocation sites so the pair cannot drift: extract one helper (e.g. invokeVisualizerFactory(name, factory, context)) and use it for the configured entry at index.ts:259 and for the built-in OTel factory at index.ts:267. The helper must (a) wrap the factory call in try/catch and, on throw, warn naming the plugin and the error and skip that plugin rather than propagating into main() (index.ts:1366); (b) on a non-null product, verify name is a string and start/stop are functions, and on a defect warn with the Story 5 message shape naming the plugin AND the missing member (mirroring plugin-loader.ts:84-92 — 'missing required member: name' / 'missing required method: start' / 'missing required method: stop') and skip it; (c) leave a documented null product as the existing silent skip (S2.4, test/integration/otel-disabled-noop.test.ts). Preserve every current selectVisualizers behavior — the one-time 'otel' block warning (index.ts:239) and the one-time unregistered-name warning (index.ts:250), asserted at test/integration/visualizer-selection.test.ts:166,183. Update the loader comment at src/conductor/src/engine/plugin-loader.ts:58-70 so it names the now-real selection-time check. RED-first in test/integration/visualizer-selection.test.ts: (1) a registered factory that throws — selection warns naming the plugin, still returns the other configured visualizers, and does not throw; (2) a factory whose product lacks stop — selection warns naming the plugin and 'stop', that plugin is absent from the selected list, and a valid sibling is still selected; (3) a factory returning null remains a silent skip. Do not change plugin-loader.ts validation logic and do not invoke factories at discovery time (reverted in d78cb1fb6; pinned by test/engine/plugin-loader.test.ts:190,198,220).
**Gate:** prd-audit
**Rationale:** Implementation drift inside the approved seam, admitted by existing plan Task 3 ('Load-time shape validation for visualizer entrypoints', Story 5, all criteria), whose Implement step requires validating 'start/stop functions on the plugin OR the factory's product': src/conductor/src/engine/plugin-loader.ts:78 returns a function entrypoint unvalidated, and the compensating control its own comment names (plugin-loader.ts:58-70 — 'checked when selectVisualizers invokes the factory with the real context') does not exist, since src/conductor/src/index.ts:259 invokes factory(context) with no try/catch and no shape check on the non-null product and main() calls it unguarded at index.ts:1366. The approved architecture is unchanged (VisualizerFactory remains the registry value type, src/conductor/src/types/plugin.ts:86; invocation stays at selection time), so this is build, not architecture_review; confidence 90% (verified) from the audit's cited lines plus the plan text that admits the repair. Sibling sweep: factories are invoked at exactly two sites — the configured loop (index.ts:259) and the built-in OTel resolution (index.ts:267, otelFactory?.(context)) — a matched pair both covered by the single task below; there is no third invocation in src/. Found-and-excluded: re-invoking factories inside discoverPlugins is deliberately NOT tasked, because commit d78cb1fb6 backed that out after it broke conforming factories (a context-reading factory threw TypeError; a factory returning its documented null for a disabled config was rejected as 'missing required member: name'). No coverage is removed or relaxed: the loader's object-entrypoint checks (plugin-loader.ts:84-92) and its partial-failure policy (plugin-loader.ts:126), delivered by Task 3 and pinned by test/engine/plugin-loader.test.ts:166,190, survive this change untouched.
**Criterion:** S5.2
**Parent task:** 3
**Done when:**
- S5.2 is satisfied by this task.
