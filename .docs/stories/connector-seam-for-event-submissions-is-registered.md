**Status:** Accepted

# Stories: Connector Seam — Visualizer Selection Loop (#1516)

Technical track (no PRD). Source: amended ADR-014 (2026-08-26 note) and
`architecture-review-2026-08-26-connector-seam-visualizer-selection.md`.

## Story 1: Installed visualizer plugin receives event submissions

As a plugin author, I want a connector installed under the plugin directories to be started by the
run loop so that it receives event submissions without editing the harness.

### Acceptance Criteria

#### Happy Path
- Given a valid `kind: visualizer` plugin installed in the project plugin directory and its name listed in the `visualizers` config key, when a run starts, then the plugin's `start` is invoked and its subscribed handlers receive the run's events
- Given the same plugin installed in the global plugin directory only, when a run starts, then it is selected identically (project install shadows global, matching existing discovery precedence)
- Given two connectors both enabled, when a run emits events, then both receive every event type each subscribed to

#### Negative Paths
- Given a `visualizers` entry naming a plugin that is not registered, when a run starts, then exactly one warning is logged naming the missing plugin and the registered visualizer names, that entry is skipped, and the run proceeds with the remaining connectors
- Given an empty or absent `visualizers` key and OTel disabled, when a run starts, then no connector is started and run behavior is byte-identical to today
- Given a connector enabled in config, when the run ends, then its `stop` is awaited before the process exits, and a `stop` rejection is warned and swallowed without failing teardown

### Done When
- [ ] An integration test installs a fake visualizer plugin, lists it in `visualizers`, runs the loop, and asserts its handlers observed emitted events
- [ ] A test asserts the named-but-missing warning fires exactly once, names the missing plugin, and the run completes
- [ ] `registry.get`/`tryGet` retrieval of `'visualizer'` exists on the production startup path (not test-only)

## Story 2: Built-in OTel exporter rides the same seam with unchanged operator behavior

As an operator, I want the OTel exporter to keep working exactly as configured today so that
finishing the seam changes nothing I observe.

### Acceptance Criteria

#### Happy Path
- Given an enabled `otel:` config block, when a run starts, then the OTel visualizer is retrieved from the registry as a built-in (registered alongside the other built-ins) and started through the same selection path as installed connectors
- Given an enabled `otel:` block and no `visualizers` key, when a run starts, then OTel runs — its enablement is governed solely by the `otel:` gate, not by membership in `visualizers`
- Given a run with OTel enabled, when the run ends normally, then spans and metrics are flushed at stop exactly as before

#### Negative Paths
- Given an absent or invalid `otel:` block, when a run starts, then the OTel visualizer is not started and no OTel dependency is exercised (existing disabled-noop behavior preserved)
- Given OTel disabled and an installed connector enabled, when a run starts, then the connector still receives events (disabling one emitter leaves others unaffected)
- Given OTel enabled and an installed connector disabled or absent, when a run starts, then OTel behavior is unaffected by the other connector's state
- Given a `visualizers` entry naming `otel` while the `otel:` block is absent or disabled, when a run starts, then the entry is ignored with a one-time warning pointing at the `otel:` block, OTel is not started, and the run proceeds

### Done When
- [ ] Existing OTel integration tests (`otel-exporter`, `otel-observability`, `otel-disabled-noop`, `otel-warning-wiring`) pass unchanged in observable behavior
- [ ] The hard-wired OTel-only construction block in the run loop is replaced by registry retrieval; no direct `new`/factory call bypasses the selection path
- [ ] A test proves each emitter/connector's enablement is independent of the other's

## Story 3: Connectors receive run identity with their submissions

As a connector author, I want run identity delivered with the seam so that I can attribute every
submission without re-deriving it from the filesystem.

### Acceptance Criteria

#### Happy Path
- Given any started connector, when its `start` is invoked, then it receives a context carrying runId, project, feature, branch, engineVersion, and pipelineDir alongside the emitter
- Given the OTel visualizer started through the seam, when it builds its resource attributes, then the identity values match those previously supplied via its private constructor context

#### Negative Paths
- Given a run where a context field cannot be derived (e.g. no git branch available), when connectors start, then the field is delivered as explicitly absent (not a fabricated value) and start still succeeds
- Given a connector that ignores the context parameter, when it is started, then it runs normally (context is additive; no connector is required to consume it)

### Done When
- [ ] The seam's start signature carries the identity context and its type is exported from the plugin types module
- [ ] A test asserts a fake connector observes runId, project, feature, branch, engineVersion, and pipelineDir values matching the run's actual identity
- [ ] A test covers the absent-field case without a start failure

## Story 4: A failing connector never fails or stalls the run

As an operator, I want a broken connector isolated so that telemetry problems cannot cost me a
build.

### Acceptance Criteria

#### Happy Path
- Given three enabled connectors where the second throws synchronously in `start`, when a run starts, then an error event naming the failing connector is emitted, the first and third connectors run normally, and the run completes
- Given a connector whose event handler throws on a submission, when events are emitted, then the run continues and other subscribers still receive the event (existing emitter isolation preserved)

#### Negative Paths
- Given a connector that throws in `start`, when the run later ends, then teardown does not invoke `stop` on the never-started connector and does not fail
- Given a connector whose `stop` rejects at teardown, when the run ends, then the rejection is warned and swallowed and every other connector's `stop` still runs

### Done When
- [ ] A test asserts a throwing `start` produces an emitted error event, does not propagate, and leaves sibling connectors started
- [ ] A test asserts run exit code is unaffected by a connector start failure
- [ ] The start loop's per-plugin isolation exists in the production `buildVisualizers` path, not in a test harness wrapper

## Story 5: Malformed visualizer plugins are refused at load with a clear message

As a plugin author, I want a malformed connector rejected at load time so that my mistake surfaces
immediately instead of as silence at runtime.

### Acceptance Criteria

#### Happy Path
- Given an installed `kind: visualizer` plugin whose entrypoint exports a conforming shape, when plugins are discovered, then it registers and is retrievable by name

#### Negative Paths
- Given an installed `kind: visualizer` plugin whose entrypoint lacks the required start/stop shape, when plugins are discovered, then discovery reports a load error naming the plugin and the missing member, and the plugin is not registered
- Given one malformed visualizer plugin and one valid one, when plugins are discovered, then the valid plugin still registers and runs (partial-failure policy preserved)

### Done When
- [ ] A loader test asserts a shape-invalid visualizer entrypoint is rejected with a message naming the plugin and defect
- [ ] A loader test asserts a valid visualizer registers under the same discovery pass
- [ ] The shape check runs in the production discovery path, mirroring the existing provider shape check
