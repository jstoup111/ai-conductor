# Implementation Plan: Feature 3.2 — JSON-events-to-stdout Subscriber

**Date:** 2026-05-01
**Design:** `.docs/specs/2026-05-01-wave-c-second-visualizer-and-telemetry.md`
**Stories:** `.docs/stories/wave-c-json-stdout-subscriber.md`
**Conflict check:** Skipped (Small tier)
**Worktree:** branch off main, PR to main, runs concurrently with Feature 4.1

## Summary

Ships `plugins/json-stdout-subscriber/` — a second UI plugin that proves the Wave A/B
visualizer abstraction by emitting every ConductorEvent as a newline-delimited JSON line
to stdout. Selectable via config (`ui_renderer: json-stdout`) with no edits to
`src/conductor/src/index.ts`. 10 tasks.

## Prerequisites

- Wave A plugin loader in place (`discoverPlugins`, `PluginRegistry`, `plugin-loader.ts`)
- Wave B `UISubscriber` interface available in `src/conductor/src/ui/types.ts`
- Feature 4.1's `tokenUsage` field NOT required — 3.2 and 4.1 are independent

## Tasks

### Task 1: Create plugin directory and plugin.yml manifest
**Story:** 3.2-1 (happy path — manifest discoverable by plugin loader)
**Type:** infrastructure

**Steps:**
1. Write failing test: `discoverPlugins()` with plugins dir containing only
   `json-stdout-subscriber/plugin.yml` → `registry.get('ui_renderer', 'json-stdout')`
   throws PluginLoadError (module not yet implemented)
2. Verify RED (entrypoint missing)
3. Create `plugins/json-stdout-subscriber/plugin.yml`:
   ```yaml
   kind: ui_renderer
   name: json-stdout
   entrypoint: ./index.ts
   harness_version: ">=0.99.0"
   ```
4. Verify still RED (index.ts missing — that's Task 2)
5. Commit: `feat(plugin): add json-stdout-subscriber plugin directory and manifest`

**Files:**
- `plugins/json-stdout-subscriber/plugin.yml` (new)

**Dependencies:** none

---

### Task 2: JsonStdoutSubscriber class skeleton implements UISubscriber
**Story:** 3.2-2 (infrastructure — class shape)
**Type:** infrastructure

**Steps:**
1. Write failing test: `import` of `plugins/json-stdout-subscriber/index.ts` resolves
   and exported class has `start()` and `stop()` methods
2. Verify RED (file missing)
3. Create `plugins/json-stdout-subscriber/index.ts`:
   - Class `JsonStdoutSubscriber` implementing `UISubscriber`
   - `constructor()` — no args required
   - `start(): void` — records started = true
   - `stop(): void` — records started = false
   - `handle(event): void` — stubbed (returns without writing)
4. Verify GREEN
5. Commit: `feat(plugin): JsonStdoutSubscriber skeleton implementing UISubscriber`

**Files:**
- `plugins/json-stdout-subscriber/index.ts` (new)

**Dependencies:** Task 1

---

### Task 3: handle(event) writes JSON line to stdout with ts field
**Story:** 3.2-2 (happy path — serialization)
**Type:** happy-path

**Steps:**
1. Write failing tests:
   (a) Capture process.stdout, call `handle({type:'step_started', step:'brainstorm', index:3})`
       → exactly one line written, line is valid JSON
   (b) Parsed JSON has `type`, `step`, `index`, and `ts` (ISO 8601 string)
   (c) Two `handle()` calls → two lines in captured stdout
2. Verify RED
3. Implement `handle(event: ConductorEvent): void`:
   - `const ts = new Date().toISOString()`
   - `process.stdout.write(JSON.stringify({...event, ts}) + '\n')`
4. Verify GREEN
5. Commit: `feat(plugin): JsonStdoutSubscriber handle() writes JSON line with ts field`

**Files:**
- `plugins/json-stdout-subscriber/index.ts`

**Dependencies:** Task 2

---

### Task 4: handle() before start() is a no-op (negative path)
**Story:** 3.2-2 (negative path — graceful degradation when not started)
**Type:** negative-path

**Steps:**
1. Write failing test: construct `new JsonStdoutSubscriber()` without calling `start()`,
   call `handle(event)` → stdout unchanged, no error thrown
2. Verify RED
3. Add `if (!this.started) return;` guard at top of `handle()`
4. Verify GREEN
5. Commit: `test(plugin): JsonStdoutSubscriber handle() is no-op before start()`

**Files:**
- `plugins/json-stdout-subscriber/index.ts`
- `plugins/json-stdout-subscriber/test/json-stdout-subscriber.test.ts` (new)

**Dependencies:** Task 3

---

### Task 5: Plugin loader discovers and registers json-stdout-subscriber
**Story:** 3.2-1 (happy path — discoverable via Wave A loader)
**Type:** happy-path

**Steps:**
1. Write failing integration test: call `discoverPlugins(globalDir, projectDir, registry)`
   where projectDir contains `json-stdout-subscriber/` → `registry.get('ui_renderer', 'json-stdout')`
   returns an instance of `JsonStdoutSubscriber`; `src/conductor/src/index.ts` contains no
   direct reference to `JsonStdoutSubscriber` (verified by grep)
2. Verify RED
3. No new code needed in the loader — relies on the existing Wave A discovery path.
   Confirm `loadPluginModule` validates the `UISubscriber` shape (start/stop methods)
   or accepts any export for `ui_renderer` kind
4. Verify GREEN
5. Commit: `test(plugin): json-stdout-subscriber is discoverable via Wave A plugin loader`

**Files:**
- `test/integration/json-stdout-subscriber.test.ts` (new)

**Dependencies:** Task 3

---

### Task 6: Config selection — ui_renderer: json-stdout routes events to plugin
**Story:** 3.2-3 (happy path — config drives subscriber selection)
**Type:** happy-path

**Steps:**
1. Write failing integration test: configure conductor with `ui_renderer: json-stdout`,
   emit a step_started event via the event bus → captured stdout contains a JSON line
   with `type: "step_started"`; TerminalSubscriber does NOT receive the event
2. Verify RED
3. In `src/conductor/src/index.ts`, after registry is initialized, replace hardcoded
   `TerminalSubscriber` selection with a registry lookup:
   `registry.get<UISubscriber>('ui_renderer', config?.ui_renderer ?? 'terminal')`
   (if not already done from Wave B — verify)
4. Verify GREEN
5. Commit: `feat(plugin): config-driven ui_renderer selection routes to json-stdout-subscriber`

**Files:**
- `src/conductor/src/index.ts` (may need minor update to use config.ui_renderer key)
- `test/integration/json-stdout-subscriber.test.ts`

**Dependencies:** Task 5

---

### Task 7: Missing plugin → PluginNotFoundError (negative path)
**Story:** 3.2-3 (negative path — configured plugin not in discovery directory)
**Type:** negative-path

**Steps:**
1. Write failing test: config has `ui_renderer: json-stdout` but plugin NOT in any
   discovery directory → `PluginNotFoundError` thrown with `json-stdout` in message
   and available ui_renderer names listed
2. Verify RED
3. Confirm existing Wave A registry throws `PluginNotFoundError` on missing plugin
   (no new code needed — just testing the contract)
4. Verify GREEN
5. Commit: `test(plugin): missing json-stdout plugin throws PluginNotFoundError`

**Files:**
- `test/integration/json-stdout-subscriber.test.ts`

**Dependencies:** Task 6

---

### Task 8: Terminal subscriber regression — switching back to terminal works
**Story:** 3.2-3 (happy path — default path unaffected)
**Type:** happy-path

**Steps:**
1. Write failing test: config has `ui_renderer: terminal` (explicit default), emit
   step_started → TerminalSubscriber receives event; stdout has no JSON lines
2. Verify RED
3. No code change expected — test validates the regression gate
4. Verify GREEN
5. Commit: `test(plugin): switching ui_renderer back to terminal is regression-free`

**Files:**
- `test/integration/json-stdout-subscriber.test.ts`

**Dependencies:** Task 6

---

### Task 9: renderer_error during emission does not crash subscriber (negative path)
**Story:** 3.2-4 (negative path — bus isolation from Wave B applies)
**Type:** negative-path

**Steps:**
1. Write failing test: create a mock that throws when `handle()` is called, wrap in
   try/catch at the bus dispatch level → `renderer_error` event is still written as
   a JSON line by JsonStdoutSubscriber; no uncaught exception
2. Verify RED
3. Confirm Wave B's `renderer_error` isolation is in place; if JsonStdoutSubscriber
   is not registered as a UIRenderer (Wave B shape) but as a UISubscriber (Wave A shape),
   confirm the try/catch is in the subscriber's own dispatch or the bus's error handling
4. Verify GREEN
5. Commit: `test(plugin): JsonStdoutSubscriber handles renderer_error without crashing`

**Files:**
- `test/integration/json-stdout-subscriber.test.ts`

**Dependencies:** Task 5

---

### Task 10: CHANGELOG entry and VERSION check
**Story:** N/A — PR gate
**Type:** infrastructure

**Steps:**
1. Add `CHANGELOG.md [Unreleased] > Added`:
   "Feature 3.2: json-stdout-subscriber plugin — emits ConductorEvents as newline-delimited
   JSON to stdout; selectable via `ui_renderer: json-stdout` in config"
2. Read current VERSION file — confirm it is on 0.99.x (not rolled past 99)
3. Present VERSION to user for approval (per CLAUDE.md gate: must confirm before opening PR)
4. Run `test/test_harness_integrity.sh` — baseline must pass
5. Commit: `chore: CHANGELOG entry for Feature 3.2 json-stdout-subscriber`

**Files:**
- `CHANGELOG.md`

**Dependencies:** Tasks 1–9 all passing

---

## Task Dependency Graph

```
T1 (plugin.yml) → T2 (skeleton) → T3 (handle/serialize) → T4 (no-op before start)
                                 → T5 (discovery)       → T6 (config selection) → T7 (missing plugin)
                                                                                 → T8 (terminal regression)
                                 → T9 (renderer_error)
T10 (changelog) — last
```

## Integration Points

- After Task 3: `JsonStdoutSubscriber` unit tests fully green — can validate serialization
- After Task 5: Plugin loader integration complete — can run conductor with json-stdout
- After Task 8: Full regression-free config-selection proof — all story criteria met

## Coverage Check

| Story | Criterion | Task(s) |
|-------|-----------|---------|
| 3.2-1 happy | manifest discoverable | T1, T5 |
| 3.2-1 negative | wrong kind → PluginManifestError | T1 (validates manifest schema via Wave A) |
| 3.2-2 happy | JSON line per event | T3 |
| 3.2-2 happy | ts field on every line | T3 |
| 3.2-2 negative | handle() before start() no-op | T4 |
| 3.2-3 happy | json-stdout receives events | T6 |
| 3.2-3 happy | terminal regression-free | T8 |
| 3.2-3 negative | missing plugin → PluginNotFoundError | T7 |
| 3.2-4 happy | event stream parseable, complete | T5, T3 |
| 3.2-4 negative | renderer_error no crash | T9 |

All 10 criteria covered. ✅
