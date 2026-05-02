# Stories: Feature 3.2 — JSON-events-to-stdout Subscriber

**Design doc:** `.docs/specs/2026-05-01-wave-c-second-visualizer-and-telemetry.md`
**Wave:** C (Gap §2 — second UI plugin proving the visualizer abstraction)
**Status:** Accepted
**Complexity:** Small

---

## Story 3.2-1: Plugin manifest for json-stdout subscriber

As a harness operator, I want the json-stdout subscriber to ship with a valid plugin.yml
so that the Wave A plugin loader can discover and register it without any edits to
src/conductor/src/index.ts.

### Acceptance Criteria

#### Happy Path
- Given the plugins/json-stdout-subscriber/ directory exists with a valid plugin.yml,
  when discoverPlugins() scans the project plugins directory, then the subscriber is
  registered as `ui_renderer:json-stdout` in the plugin registry

#### Negative Paths
- Given plugin.yml has `kind: ui_subscriber` (wrong kind value), when discoverPlugins()
  reads the manifest, then it throws PluginManifestError listing the valid kind enum values

### Done When
- [ ] `plugins/json-stdout-subscriber/plugin.yml` exists with `kind: ui_renderer`,
  `name: json-stdout`, `entrypoint: ./index.ts`, `harness_version: ">=0.99.0"`
- [ ] After discoverPlugins(), `registry.get('ui_renderer', 'json-stdout')` returns
  the subscriber instance without any reference to JsonStdoutSubscriber in src/index.ts

---

## Story 3.2-2: JSON-events-to-stdout — happy path event emission

As a harness operator, I want each ConductorEvent to be serialized to a single
newline-terminated JSON line on stdout so that the output can be piped into jq or
external tools.

### Acceptance Criteria

#### Happy Path
- Given the conductor is running with `ui_renderer: json-stdout` in config,
  when a step_started event is emitted, then stdout contains exactly one JSON line
  with fields `type: "step_started"`, `step`, `index`, and `ts` (ISO 8601 timestamp)
- Given multiple events are emitted in sequence,
  when the run completes, then each event occupies exactly one line and every line is
  valid JSON (parseable by JSON.parse without throwing)

#### Negative Paths
- Given the subscriber is constructed and start() has not been called yet,
  when handle(event) is called directly, then no output is written and no error is thrown

### Done When
- [ ] `plugins/json-stdout-subscriber/index.ts` exports a class implementing UISubscriber
  (has `start()` and `stop()` methods)
- [ ] Each call to `handle(event)` writes exactly one line: `JSON.stringify({...event, ts}) + '\n'`
  to process.stdout
- [ ] The `ts` field is present on every emitted line as an ISO 8601 string

---

## Story 3.2-3: json-stdout subscriber selectable via config without editing src/index.ts

As a harness developer, I want to switch the active UI renderer by changing config
alone so that the plugin system's isolation guarantee is demonstrated.

### Acceptance Criteria

#### Happy Path
- Given `.ai-conductor/config.yml` has `ui_renderer: json-stdout`, when the conductor
  starts, then events flow through JsonStdoutSubscriber and NOT through TerminalSubscriber
- Given `.ai-conductor/config.yml` has `ui_renderer: terminal` (default), when the
  conductor starts, then events flow through TerminalSubscriber and the json-stdout
  subscriber is silent (default path regression free)

#### Negative Paths
- Given `.ai-conductor/config.yml` has `ui_renderer: json-stdout` but the plugin is
  not in any discovery directory, when the conductor starts, then it throws
  PluginNotFoundError naming `json-stdout` and listing available ui_renderer plugins

### Done When
- [ ] No reference to `JsonStdoutSubscriber` (or `json-stdout`) in `src/conductor/src/index.ts`
  (verified by grep at test runtime)
- [ ] Integration test starts the conductor with `ui_renderer: json-stdout` in config and
  asserts events appear on stdout
- [ ] Integration test restarts with `ui_renderer: terminal` and asserts no JSON lines
  appear on stdout (terminal path unaffected)

---

## Story 3.2-4: Integration test — event stream is well-formed and complete

As a harness developer, I want an integration test that starts the conductor with the
json-stdout subscriber and asserts the event stream is parseable and contains the
expected event types so that CI catches any regression.

### Acceptance Criteria

#### Happy Path
- Given the conductor runs at least one step with the json-stdout subscriber active,
  when the run completes, then captured stdout contains at least one step_started and
  one step_completed event, and every line parses as valid JSON

#### Negative Paths
- Given the json-stdout subscriber is active and a step emits a renderer_error event
  (simulated by a mock that throws), when the subscriber receives that event, then
  it still writes the renderer_error event as a JSON line and does not crash — the
  bus isolation from Wave B applies

### Done When
- [ ] `test/integration/json-stdout-subscriber.test.ts` exists and passes
- [ ] Test captures process.stdout, runs a minimal conductor sequence, parses each line,
  and asserts: every line is valid JSON, at least one `step_started` event present,
  at least one `step_completed` event present
- [ ] `test/test_harness_integrity.sh` still passes after adding the plugin directory
