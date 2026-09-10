# Implementation Plan: Operator-supplied static telemetry attributes (#2056)

**Date:** 2026-09-09
**Stories:** .docs/stories/operators-cannot-attach-their-own-metadata-to-expo.md
**Conflict check:** Clean as of 2026-09-09

## Summary

Adds one static, validated `otel.attributes` map that rides every exported signal — trace Resource,
metric Resource, and every metric data point — in interactive and daemon runs, in 11 tasks.

## Technical Approach

Per adr-014 D12/D13 (amended 2026-09-09) and the approved architecture diagram:

- **One resolution path.** `OtelConfig` (`src/conductor/src/types/config.ts`) gains
  `attributes?: Record<string, string>`. `resolveOtelConfig` (`src/conductor/src/engine/otel/otel-config.ts`)
  validates it once and carries `attributes: Record<string, string>` plus
  `attributeWarnings: string[]` on both enabled variants of `ResolvedOtelConfig`. Validation is a
  pure function over the raw mapping: a key is kept only if, after trimming, it is non-empty, contains
  at least one `.`, and does not start with `service.`, `conductor.`, or `host.`; a value is kept only
  if it is a string that is non-empty after trimming; entries beyond the sixteenth in declaration
  order are dropped; a non-mapping block yields an empty map and one warning. Every dropped entry
  pushes one warning string naming the key (rendered `''` when empty). Nothing here ever returns
  `enabled: false` — the `headers` precedent disables the exporter on a bad credential reference;
  `attributes` deliberately does not (D12). Pattern to follow: `project_name`/`worker_name`
  resolution in the same function (trim once, carry on the resolved object, thread to the three
  construction sites); allowed variation is the per-entry validation and warning list.
- **Two injection seams, both existing.** `ResourceContext` (`resource.ts`) gains
  `attributes?: Record<string, string>`; `buildResource` spreads it first and the conductor keys
  after it, for both signals. `MetricsRecorder` (`metrics.ts`) gains a custom-attribute input and
  `withIdentity` becomes `{ ...custom, ...attrs, ...identityAttrs }` so per-point attributes and
  conductor identity both win over a custom key. `forFeature` carries the custom map forward.
- **Three construction sites, no new one.** `wireDaemonOtel` and `wireInteractiveOtelMetrics`
  (`wire.ts`) pass `resolved.attributes` into `buildResource` and `MetricsRecorder`;
  `OtelVisualizer` reads `config.attributes` in its constructor beside `projectNameOverride` and
  passes it into `resourceContext` in `initializeProviders`. Warnings are rendered as exactly one
  `renderer_error` (`rendererName: 'otel'`) per construction site whose message enumerates every
  dropped key — through `ctx.onWarning` in the visualizer and the `events.emit({ type:
  'renderer_error' ... })` shape already used in `wire.ts` for the meter paths.
- **Config surface bookkeeping.** `CONFIG_CONSUMER_KEY_SETS.otel` (`src/conductor/src/engine/config.ts`)
  gains `'attributes'` and the consumer registry fixture gains `'otel.attributes': consumer(OTEL_CONFIG)`
  so the registry-totality test stays green (adr-2026-08-26 D4).
- **Sequencing.** Tasks 1–5 are independent leaves (config resolution, allowlist, Resource seam,
  recorder seam). Task 6 wires the interactive path and owns its boundary proof; Task 7 wires the
  daemon path on top of Task 6's `wire.ts` changes; Tasks 8–10 are boundary-level proofs for the
  file transport, the invalid-entry run behavior, and daemon/interactive parity.
- **Rebase note.** #1940 widens `withIdentity` call sites with `effort`/`provider`/`tier` labels and
  amends adr-014 at the same insertion point. Both are one-directional: keep #1940's labels in the
  `attrs` position and this feature's map in the leading position; renumber D12/D13 only if #1940
  is abandoned.

## Prerequisites

None — every touched module exists on main; no new dependency.

## Tasks

### Task 1: Resolve a valid attributes map once on the otel config
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in the otel-config test file: an `otel:` block with `attributes: { deployment.environment.name: ' staging ', team.name: platform }` resolves enabled (both `otlp` and `file` variants) with `attributes` equal to the trimmed two-entry map; sixteen valid entries are all carried; an absent `attributes` key or `attributes: {}` leaves the exporter enabled.
2. Verify tests fail (RED).
3. Implement: add the optional `attributes` field to `OtelConfig`; in `resolveOtelConfig` parse the mapping, trim keys and values, and carry `attributes` and `attributeWarnings` on both enabled variants only when the key is present — following the `project_name` pattern (trim once, carry on the resolved object).
4. Verify tests pass (GREEN), all pre-existing otel-config tests unmodified.
5. Commit: "Resolve otel.attributes once on the otel config".

**Done when:**
- The otel-config test asserts a resolved enabled config carries exactly the declared keys and trimmed string values on both the otlp and file variants.
- A test asserts sixteen valid entries are carried in declaration order with zero warnings.
- All pre-existing otel-config tests pass unmodified.

**Files:**
- src/conductor/src/types/config.ts — optional `attributes` on `OtelConfig`
- src/conductor/src/engine/otel/otel-config.ts — parse, trim, carry `attributes`/`attributeWarnings`
- src/conductor/test/engine/otel/otel-config.test.ts — happy-path resolution tests

**Dependencies:** none

### Task 2: Refuse invalid attribute entries by key without disabling the exporter
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests: a key without a dot (`team`) is dropped and the warning names `team` and says keys must be namespaced; keys beginning `service.`, `conductor.`, `host.` are dropped and the warning names the key and the prefix; a number, boolean, list, and `{ env: NAME }` value are each dropped with a warning naming the key and requiring a literal string; an empty or whitespace-only key or value is dropped with the key rendered `''` when empty; a seventeen-entry map carries the first sixteen and warns naming the seventeenth key and the bound; a string or list `attributes` block yields an empty map and a single warning that `otel.attributes` must be a mapping — and in every case the resolved config is still `enabled: true`.
2. Verify tests fail (RED).
3. Implement the per-entry rules in `resolveOtelConfig` as a pure validation over the raw mapping, pushing one warning string per dropped entry into `attributeWarnings`.
4. Verify tests pass (GREEN).
5. Commit: "Refuse invalid otel.attributes entries by key".

**Done when:**
- For each refusal rule (no dot, reserved prefix, non-string value including an env-reference mapping, empty key or value, seventeenth entry, non-mapping block) a test asserts `resolveOtelConfig` drops only the offending entry and pushes one warning string naming that key, and that the remaining valid entries are carried.
- A test asserts the resolved config remains `enabled: true` under every refusal rule, including an all-invalid map that yields an empty attributes object.
- The warning for an empty key renders the key as `''`, asserted by the empty-key test.

**Files:**
- src/conductor/src/engine/otel/otel-config.ts — refusal rules and warning list
- src/conductor/test/engine/otel/otel-config.test.ts — one test per refusal rule

**Dependencies:** Task 1

### Task 3: Accept the attributes key in the config allowlist and consumer registry
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing test: extend the config-consumer-registry test so the registry-totality assertion covers `otel.attributes`, and add a config test asserting that a config file whose `otel:` block includes `attributes` loads with zero warnings mentioning `attributes`.
2. Verify tests fail (RED) — the totality test fails because the allowlist names a key with no consumer declaration.
3. Implement: add `'attributes'` to `CONFIG_CONSUMER_KEY_SETS.otel` and `'otel.attributes': consumer(OTEL_CONFIG)` to the registry fixture beside the other nested otel keys.
4. Verify tests pass (GREEN).
5. Commit: "Register otel.attributes as an accepted config key with a consumer".

**Done when:**
- The registry-totality test passes with a consumer declaration for the attributes key, and fails when that declaration is removed.
- A config-loading test asserts a config with `otel.attributes` produces no warning whose text contains `attributes`.

**Files:**
- src/conductor/src/engine/config.ts — `'attributes'` in `CONFIG_CONSUMER_KEY_SETS.otel`
- src/conductor/test/engine/config-consumer-registry.ts — `'otel.attributes'` consumer declaration
- src/conductor/test/engine/config-consumer-registry.test.ts — totality coverage
- src/conductor/test/engine/config.test.ts — no-warning load test

**Dependencies:** none

### Task 4: Custom attributes on both Resources, conductor keys written last
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in the resource test file: with `attributes` in the context, the trace Resource carries every declared attribute plus its unchanged existing set; the metric Resource's key set equals exactly `service.name`, `service.instance.id`, `conductor.project`, `conductor.worker`, `host.name` plus the declared keys — and none of `conductor.feature`, `conductor.branch`, `conductor.run.id`; a context attribute keyed `service.name` or `conductor.project` does not replace the conductor value on either Resource; with no `attributes` in the context both Resources are deep-equal to today's.
2. Verify tests fail (RED).
3. Implement: add `attributes?: Record<string, string>` to `ResourceContext`; in `buildResource` spread it before the conductor attribute literal for both signals so conductor keys are written after the custom map.
4. Verify tests pass (GREEN), all pre-existing resource tests unmodified.
5. Commit: "Carry operator attributes on the trace and metric Resources".

**Done when:**
- The resource test asserts the metric Resource key set equals exactly the five conductor keys plus the declared keys, so an added feature-scoped or run-varying key fails it.
- A test asserts the trace Resource carries the declared keys and every pre-existing trace attribute unchanged in name and value.
- A test asserts that in `buildResource` conductor keys are written after the custom map: a context attribute keyed `service.name` or `conductor.project` leaves the conductor value in place on both Resources.
- A test asserts both Resources are deep-equal to the pre-feature Resources when the context carries no attributes, and all pre-existing resource tests pass unmodified.

**Files:**
- src/conductor/src/engine/otel/resource.ts — `ResourceContext.attributes`, merge order
- src/conductor/test/engine/otel/resource.test.ts — both-signal, collision, and no-attributes tests

**Dependencies:** none

### Task 5: Custom attributes on every metric data point at the identity seam
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in the metrics test file: a recorder constructed with custom attributes exports them on data points of every instrument (step duration, retries, dispatches, feature cost, gate verdicts, daemon backlog at minimum) alongside the existing labels; a feature-bound recorder (`forFeature`) exports the custom attributes with `project`, `worker`, `feature`; a custom attribute keyed `project`, `worker`, `feature`, or `step` does not replace the conductor or per-point value; two recorders with the same custom map export identical custom values; with no custom map every data point's label set is unchanged.
2. Verify tests fail (RED).
3. Implement: give `MetricsRecorder` an optional custom-attribute record, make `withIdentity` return `{ ...custom, ...attrs, ...identityAttrs }`, and have `forFeature` pass the custom map through.
4. Verify tests pass (GREEN), all pre-existing metrics tests unmodified.
5. Commit: "Merge operator attributes onto every metric data point".

**Done when:**
- The metrics test asserts the declared keys on data points of at least six instruments including one per-feature and one daemon-level instrument, via `InMemoryMetricExporter`.
- A test asserts that in `withIdentity` identity attributes and per-point attributes are written after the custom map: a custom key `project` or `step` never replaces the conductor or per-point value on an exported data point.
- A test asserts two recorders with the same custom map export identical custom values, and that a recorder with no custom map exports label sets identical to today's.
- All pre-existing metrics tests pass unmodified.

**Files:**
- src/conductor/src/engine/otel/metrics.ts — custom-attribute input, `withIdentity` merge order, `forFeature`
- src/conductor/test/engine/otel/metrics.test.ts — per-instrument, collision, and no-map tests

**Dependencies:** none

### Task 6: Interactive path exports attributes and reports dropped keys once
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests in the interactive wiring and visualizer tests, driving the production construction path (`createOtelVisualizer` + `wireInteractiveOtelMetrics` through the helper the interactive entry point uses) with one invalid and two valid attributes: the trace Resource, the metric Resource, and a recorded data point carry the two valid keys; exactly one `renderer_error` event with `rendererName: 'otel'` is emitted and its message names the invalid key.
2. Verify tests fail (RED).
3. Implement: `OtelVisualizer` reads `config.attributes` and `config.attributeWarnings` in its constructor beside `projectNameOverride`, passes the map into `resourceContext` in `initializeProviders` and into `MetricsRecorder`, and emits one `onWarning` call enumerating every warning when the list is non-empty; `wireInteractiveOtelMetrics` passes `resolved.attributes` into `buildResource` and `MetricsRecorder`.
4. Verify tests pass (GREEN).
5. Commit: "Wire operator attributes through the interactive OTel path".

**Done when:**
- An interactive wiring test drives the production construction path and asserts the declared keys on the trace Resource, the metric Resource, and an exported data point.
- The same test asserts exactly one renderer_error event whose message names every dropped key, emitted through the visualizer's `onWarning` bridge.
- A visualizer test asserts the constructor reads attributes from the resolved config and that no second Resource construction site is introduced (the metric and trace Resources are built from the one `resourceContext`).

**Files:**
- src/conductor/src/engine/otel/otel-visualizer.ts — read `config.attributes`/`attributeWarnings`, thread into `resourceContext` and `MetricsRecorder`, single warning
- src/conductor/src/engine/otel/wire.ts — `wireInteractiveOtelMetrics` threads `resolved.attributes`
- src/conductor/test/interactive-otel-wiring.test.ts — boundary proof
- src/conductor/test/engine/otel/otel-visualizer.test.ts — constructor and single-warning tests

**Dependencies:** Task 1, Task 2, Task 4, Task 5

### Task 7: Daemon path exports attributes on the daemon meter and per-dispatch traces
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests in the daemon wiring test, driving `wireDaemonOtel` and a feature dispatch's visualizer with one invalid and two valid attributes: the daemon metric Resource and a recorded daemon data point carry the two valid keys; the per-dispatch trace Resource carries them; the daemon root bus receives exactly one `renderer_error` naming the invalid key when the meter is constructed.
2. Verify tests fail (RED).
3. Implement: `wireDaemonOtel` passes `resolved.attributes` into `buildResource` and the `MetricsRecorder` identity, and emits one `renderer_error` on `context.rootEvents` enumerating `resolved.attributeWarnings` when non-empty (the same event shape `warnOnceMetricExporter` uses).
4. Verify tests pass (GREEN).
5. Commit: "Wire operator attributes through the daemon OTel path".

**Done when:**
- The daemon wiring test asserts the declared keys on the daemon metric Resource, an exported daemon data point, and a per-dispatch trace Resource.
- The same test asserts the daemon root bus receives exactly one renderer_error naming every dropped key at meter construction, and that the meter provider is constructed and exporting.

**Files:**
- src/conductor/src/engine/otel/wire.ts — `wireDaemonOtel` threads `resolved.attributes` and emits the warning
- src/conductor/test/daemon-otel-wiring.test.ts — boundary proof

**Dependencies:** Task 6

### Task 8: File and OTLP transports carry attributes on both signals
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in the OTel exporter integration test: with `exporter: file` and valid attributes, decode one exported span line and one metric line and assert the declared attributes appear in each line's resource attribute list; with `exporter: otlp` and injected in-memory exporters, assert the Resource objects handed to the span and metric exporters carry the declared attributes; with `exporter: file` pointed at an unwritable path and valid attributes, the run completes and exactly one export-failure warning is emitted as today.
2. Verify tests fail (RED) where the file path is not yet threaded; the unwritable-path test is a regression guard and may pass immediately — record that in the test's description.
3. Implement any missing threading found by the RED step (expected none beyond Tasks 4–7).
4. Verify tests pass (GREEN).
5. Commit: "Prove operator attributes reach both OTel transports".

**Done when:**
- An integration test decodes the file transport's OTLP-JSON and asserts the declared attributes in the resource attribute list of both the span line and the metric line.
- A test asserts the OTLP transport's exported span and metric Resources carry the declared attributes.
- A test asserts an unwritable file path with valid attributes yields exactly one export-failure warning and a completed run, unchanged from today.

**Files:**
- src/conductor/test/integration/otel-exporter.test.ts — transport-level assertions

**Dependencies:** Task 6

### Task 9: An invalid attribute never changes a run's outcome or disables the exporter
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests: an all-invalid map resolves enabled with an empty attributes object and the visualizer emits exactly one `renderer_error` whose message names every dropped key; a run driven through the interactive wiring with one invalid attribute produces step outcomes identical to a run with no `attributes` block; a bus whose `renderer_error` handler throws still yields a constructed exporter and a completed run.
2. Verify tests fail (RED).
3. Implement: ensure the warning emission in the visualizer and `wire.ts` is wrapped so a throwing handler cannot escape (the existing `onWarning` bridge already swallows through `events.emit(...).catch`), and that no warning is emitted when the list is empty.
4. Verify tests pass (GREEN).
5. Commit: "Keep runs and exporters unaffected by invalid otel.attributes".

**Done when:**
- A test asserts an all-invalid map yields an enabled resolved config with an empty attributes object and exactly one renderer_error event whose message names every dropped key.
- A test asserts a run with one invalid attribute produces step outcomes identical to a run with no attributes block, and that a throwing renderer_error handler still yields a constructed exporter and a completed run.

**Files:**
- src/conductor/src/engine/otel/otel-visualizer.ts — guarded, conditional warning emission
- src/conductor/src/engine/otel/wire.ts — guarded, conditional warning emission
- src/conductor/test/engine/otel/otel-config.test.ts — all-invalid resolution
- src/conductor/test/interactive-otel-wiring.test.ts — run-outcome and throwing-handler tests

**Dependencies:** Task 6

### Task 10: Daemon and interactive attribute sets are equal; the environment detector stays unread
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing tests: a parity test constructs the daemon path and the interactive path with the same config and asserts the declared-attribute key/value sets are equal on the metric Resource, a data point, and the trace Resource of each — a key present on one side and absent on the other fails; a test sets `OTEL_RESOURCE_ATTRIBUTES` in the process environment with no `attributes` block and asserts those values are absent from every exported Resource and data point on both paths.
2. Verify tests fail (RED) if any path diverges; the environment test is a regression guard and may pass immediately — record that in its description.
3. Implement any divergence the parity test exposes (expected none beyond Tasks 6–7).
4. Verify tests pass (GREEN).
5. Commit: "Assert daemon/interactive attribute parity and an unread environment detector".

**Done when:**
- A parity assertion compares the declared-attribute key/value sets of the daemon and interactive paths on the metric Resource, a data point, and the trace Resource, and fails on any one-sided key.
- A test asserts values set only in `OTEL_RESOURCE_ATTRIBUTES` are absent from every exported Resource and data point on both paths.

**Files:**
- src/conductor/test/daemon-otel-wiring.test.ts — parity and environment tests
- src/conductor/test/interactive-otel-wiring.test.ts — parity fixture

**Dependencies:** Task 7

### Task 11: Exports are byte-identical when no attributes are declared
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests: with no `attributes` key the resolved config has no `attributes` property; `attributes: {}` resolves to the same object as the absent case with zero warnings; both Resources and every instrument's data-point label set are deep-equal to the pre-feature fixtures captured in the resource and metrics tests; a run driven through the interactive wiring with no `attributes` block emits zero `renderer_error` events whose message mentions attributes.
2. Verify tests fail (RED) where any default path leaks an empty map or a warning; the deep-equal fixtures are regression guards and may pass immediately — record that in each test's description.
3. Implement any leak the RED step exposes (expected none beyond Tasks 1–9: the resolved object omits the field when absent, and every seam treats an absent map as an empty spread).
4. Verify tests pass (GREEN).
5. Commit: "Guard byte-identical OTel exports when otel.attributes is absent".

**Done when:**
- A test asserts the resolved config has no `attributes` property when the key is absent, and that `attributes: {}` yields the same resolved object as the absent case with zero warnings.
- Tests assert both Resources and every instrument's data-point label set are deep-equal to the pre-feature fixtures when no attributes are declared.
- A test asserts a run with no attributes block emits zero renderer_error events whose message mentions attributes.

**Files:**
- src/conductor/test/engine/otel/otel-config.test.ts — absent and empty-map resolution
- src/conductor/test/engine/otel/resource.test.ts — Resource deep-equal fixtures
- src/conductor/test/engine/otel/metrics.test.ts — data-point deep-equal fixtures
- src/conductor/test/interactive-otel-wiring.test.ts — zero-warning run

**Dependencies:** Task 6

## Task Dependency Graph

```
Task 1 ─┬─▶ Task 2 ─┐
        │           ├─▶ Task 6 ─┬─▶ Task 7 ─▶ Task 10
Task 4 ─┤           │           ├─▶ Task 8
Task 5 ─┘           │           └─▶ Task 9
Task 3 (independent)
```

## Integration Points

- After Task 5: config resolution, Resource seam, and recorder seam are each unit-proven in isolation.
- After Task 6: an interactive run exports attributes end-to-end; the first production boundary proof.
- After Task 7: daemon meter and per-dispatch traces carry attributes; both entry points wired.
- After Task 11: parity, environment-detector, and no-attributes guards close the boundary set.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-014-otel-observability-exporter#D1 | no-change | none | The exporter remains a bus listener; this feature subscribes to no event and modifies no emission site |
| adr-014-otel-observability-exporter#D2 | no-change | none | Packaging as the `visualizer:otel` plugin is untouched; the map rides the existing `otel:` gate |
| adr-014-otel-observability-exporter#D3 | existing | none | The shared visualizer wiring helper already serves both entry points (`wire.ts`, `otel-visualizer.ts`); this feature threads a value through it |
| adr-014-otel-observability-exporter#D4 | no-change | none | Validation runs once at config resolution and injection is a spread at existing seams; no I/O, awaiting, or per-event iteration is added to any bus handler |
| adr-014-otel-observability-exporter#D5 | task | task-2, task-9 | "the resolved config remains `enabled: true` under every refusal rule" |
| adr-014-otel-observability-exporter#D6 | existing | none | `attributes` joins the existing `otel:` block under Decision 6's config-selected surface, exactly as `project_name` and `worker_name` did |
| adr-014-otel-observability-exporter#D7 | no-change | none | The daemon-owned single `MeterProvider` and event-fed `MetricsListener` are unchanged; the map is passed at construction |
| adr-014-otel-observability-exporter#D8 | task | task-4 | "the metric Resource key set equals exactly the five conductor keys plus the declared keys" |
| adr-014-otel-observability-exporter#D9 | no-change | none | No new event type, ledger, or channel; daemon-level signals are untouched |
| adr-014-otel-observability-exporter#D12 | task | task-1, task-2, task-3 | "drops only the offending entry and pushes one warning string naming that key" |
| adr-014-otel-observability-exporter#D13 | task | task-4, task-5, task-6, task-7 | "conductor keys are written after the custom map" |

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an `otel:` block with `attributes: { deployment.environment.name: staging, team.name: platform }`, when the otel config is resolved, then the resolved config is enabled and carries exactly those two attributes with those string values | 1 | "carries exactly the declared keys and trimmed string values" | diff-local |
| Story 1 happy: Given an `attributes` value whose key or value has surrounding whitespace, when the otel config is resolved, then the key and value are trimmed before use | 1 | "carries exactly the declared keys and trimmed string values" | diff-local |
| Story 1 happy: Given an `otel:` block with sixteen valid `attributes` entries, when the otel config is resolved, then all sixteen are carried and none is reported | 1 | "carries exactly the declared keys and trimmed string values" | diff-local |
| Story 1 happy: Given a config whose `otel:` block includes `attributes`, when the config file is loaded, then no unknown-key warning is emitted for `attributes` | 3 | "registry-totality test passes with a consumer declaration for the attributes key" | diff-local |
| Story 1 negative: Given an `attributes` entry whose key contains no `.` (for example `team`), when the otel config is resolved, then that entry is absent from the resolved attributes and a warning names the key `team` and states that keys must be namespaced with a dot | 2 | "drops only the offending entry and pushes one warning string naming that key" | diff-local |
| Story 1 negative: Given an `attributes` entry whose key begins with `service.`, `conductor.`, or `host.`, when the otel config is resolved, then that entry is absent from the resolved attributes and a warning names the key and the reserved prefix | 2 | "drops only the offending entry and pushes one warning string naming that key" | diff-local |
| Story 1 negative: Given an `attributes` entry whose value is not a string (a number, a boolean, a list, or a `{ env: NAME }` mapping), when the otel config is resolved, then that entry is absent from the resolved attributes and a warning names the key and states that values must be literal strings | 2 | "drops only the offending entry and pushes one warning string naming that key" | diff-local |
| Story 1 negative: Given an `attributes` entry whose key or value is empty or whitespace-only after trimming, when the otel config is resolved, then that entry is absent from the resolved attributes and a warning names the key (rendered as `''` when empty) | 2 | "drops only the offending entry and pushes one warning string naming that key" | diff-local |
| Story 1 negative: Given an `attributes` mapping with seventeen valid entries, when the otel config is resolved, then the first sixteen in declaration order are carried and a warning names the seventeenth key and the bound of sixteen | 2 | "drops only the offending entry and pushes one warning string naming that key" | diff-local |
| Story 1 negative: Given an `attributes` value that is not a mapping (a string or a list), when the otel config is resolved, then no attributes are carried, a single warning states that `otel.attributes` must be a mapping, and the resolved config is still enabled | 2 | "drops only the offending entry and pushes one warning string naming that key" | diff-local |
| Story 2 happy: Given an `attributes` mapping with one invalid and two valid entries, when an interactive run starts with the exporter enabled, then exactly one `renderer_error` event with `rendererName: otel` is emitted whose message names the invalid key, and the two valid attributes are exported | 6 | "exactly one renderer_error event whose message names every dropped key" | diff-local |
| Story 2 happy: Given an `attributes` mapping with one invalid entry, when the daemon starts its metric provider with the exporter enabled, then exactly one such `renderer_error` event is emitted on the daemon root bus and the metric provider is constructed and exporting | 7 | "the daemon root bus receives exactly one renderer_error naming every dropped key" | diff-local |
| Story 2 negative: Given an `attributes` mapping in which every entry is invalid, when the otel config is resolved, then the resolved config is still enabled with an empty attribute map, and a single warning message enumerates every dropped key — never one event per key | 9 | "an all-invalid map yields an enabled resolved config with an empty attributes object" | diff-local |
| Story 2 negative: Given an `attributes` mapping with an invalid entry, when a run executes to completion, then the run's outcome and step results are identical to a run with no `attributes` block — no step fails, halts, or is delayed by the warning | 9 | "step outcomes identical to a run with no attributes block" | diff-local |
| Story 2 negative: Given an `attributes` mapping with an invalid entry and a bus whose `renderer_error` handler throws, when the warning is emitted, then the exporter is still constructed and the run proceeds | 9 | "a throwing renderer_error handler still yields a constructed exporter and a completed run" | diff-local |
| Story 3 happy: Given valid `attributes`, when an interactive run exports a span, then the trace Resource carries every declared attribute alongside its existing feature and run identity attributes | 4 | "the trace Resource carries the declared keys and every pre-existing trace attribute unchanged" | diff-local |
| Story 3 happy: Given valid `attributes`, when the metric provider exports, then the metric Resource carries every declared attribute alongside exactly the existing worker-stable conductor keys (`service.name`, `service.instance.id`, `conductor.project`, `conductor.worker`, `host.name`) | 4 | "the metric Resource key set equals exactly the five conductor keys plus the declared keys" | diff-local |
| Story 3 happy: Given valid `attributes` and `exporter: file`, when a span and a metric are exported, then the OTLP-JSON lines written to the file carry the declared attributes in each signal's resource attribute list | 8 | "resource attribute list of both the span line and the metric line" | diff-local |
| Story 3 happy: Given valid `attributes` and `exporter: otlp`, when a span and a metric are exported, then the exported Resource objects handed to the OTLP exporters carry the declared attributes | 8 | "exported span and metric Resources carry the declared attributes" | diff-local |
| Story 3 negative: Given valid `attributes`, when the metric Resource is inspected, then it carries no attribute beyond the five conductor keys plus the declared attributes — in particular no `conductor.feature`, `conductor.branch`, or `conductor.run.id` | 4 | "the metric Resource key set equals exactly the five conductor keys plus the declared keys" | diff-local |
| Story 3 negative: Given valid `attributes`, when the trace Resource is inspected, then every pre-existing trace Resource attribute is unchanged in name and value | 4 | "every pre-existing trace attribute unchanged in name and value" | diff-local |
| Story 3 negative: Given an attribute whose key would collide with a conductor Resource key had it escaped validation, when the Resource is built from a context that carries it, then the conductor value wins and the custom value is absent | 4 | "conductor keys are written after the custom map" | diff-local |
| Story 3 negative: Given `exporter: file` with a path that cannot be written, when a run with valid `attributes` executes, then the run proceeds and the failure is reported once as today — attributes introduce no new failure mode | 8 | "exactly one export-failure warning and a completed run" | diff-local |
| Story 4 happy: Given valid `attributes`, when a step-close, cost-snapshot, dispatch, gate, and daemon-backlog metric are recorded, then every exported data point on every instrument carries every declared attribute alongside its existing labels | 5 | "the declared keys on data points of at least six instruments" | diff-local |
| Story 4 happy: Given valid `attributes` and a recorder bound to a feature, when a per-feature instrument records, then the data point carries the declared attributes together with `project`, `worker`, and `feature` | 5 | "one per-feature and one daemon-level instrument" | diff-local |
| Story 4 negative: Given a declared attribute whose key equals a conductor label had it escaped validation (`project`, `worker`, `feature`, or `step`), when a data point is recorded through a recorder constructed with it, then the data point carries the conductor value for that label and the custom value is absent | 5 | "identity attributes and per-point attributes are written after the custom map" | diff-local |
| Story 4 negative: Given valid `attributes`, when data points are exported across many runs and features, then the set of distinct label combinations grows only by the dimensions that already existed — each declared attribute contributes exactly one value per worker | 5 | "two recorders with the same custom map export identical custom values" | diff-local |
| Story 4 negative: Given valid `attributes`, when a data point is recorded, then every pre-existing label on that instrument is unchanged in name and value | 5 | "a recorder with no custom map exports label sets identical to today's" | diff-local |
| Story 5 happy: Given an `otel:` block with no `attributes` key, when Resources are built and data points recorded, then every Resource attribute set and every data-point label set is identical to the pre-feature set | 11 | "deep-equal to the pre-feature fixtures when no attributes are declared" | diff-local |
| Story 5 happy: Given an `otel:` block with `attributes: {}`, when Resources are built and data points recorded, then the output is identical to the no-key case and no warning is emitted | 11 | "has no `attributes` property when the key is absent" | diff-local |
| Story 5 negative: Given no `attributes` key, when the config is resolved, then the resolved config carries no attribute field at all rather than an empty or placeholder map that could reach an exporter | 11 | "has no `attributes` property when the key is absent" | diff-local |
| Story 5 negative: Given no `attributes` key, when a run's `renderer_error` events are collected, then none of them mention attributes | 11 | "zero renderer_error events whose message mentions attributes" | diff-local |
| Story 6 happy: Given valid `attributes` in the project's config, when the daemon constructs its long-lived metric provider, then the metric Resource and every recorded data point carry the declared attributes | 7 | "the daemon root bus receives exactly one renderer_error naming every dropped key" | diff-local |
| Story 6 happy: Given valid `attributes`, when the daemon dispatches a feature and its per-dispatch visualizer exports a span, then the trace Resource carries the declared attributes | 7 | "a per-dispatch trace Resource" | diff-local |
| Story 6 happy: Given valid `attributes`, when an interactive run constructs its metric provider and visualizer, then the Resources and data points carry the same declared attributes as the daemon path | 6 | "the declared keys on the trace Resource, the metric Resource, and an exported data point" | diff-local |
| Story 6 negative: Given valid `attributes`, when the exported attribute sets of the daemon path and the interactive path are compared, then the declared attributes are present with identical values on both — a key present on one and absent on the other fails the parity assertion | 10 | "parity assertion compares the declared-attribute key/value sets" | diff-local |
| Story 6 negative: Given `attributes` declared only in the process environment (`OTEL_RESOURCE_ATTRIBUTES`) and not in config, when either path exports, then those environment values are absent from every Resource and data point | 10 | "absent from every exported Resource and data point on both paths" | diff-local |

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic
