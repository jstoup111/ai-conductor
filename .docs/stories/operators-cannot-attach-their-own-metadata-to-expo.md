**Status:** Accepted

# Stories: Operator-supplied static telemetry attributes (#2056)

Technical track — criteria derive from issue #2056's desired outcomes and the approved adr-014
amendment of 2026-09-09 (D12, D13). Source-Ref: jstoup111/ai-conductor#2056.

## Story 1: An operator declares static attributes under the existing otel block

As an operator, I want to list a bounded set of key/value attributes in `.ai-conductor/config.yml`
under `otel:`, so that my telemetry carries environment, team, or tenant dimensions without an engine
change.

### Acceptance Criteria

#### Happy Path
- Given an `otel:` block with `attributes: { deployment.environment.name: staging, team.name: platform }`, when the otel config is resolved, then the resolved config is enabled and carries exactly those two attributes with those string values
- Given an `attributes` value whose key or value has surrounding whitespace, when the otel config is resolved, then the key and value are trimmed before use
- Given an `otel:` block with sixteen valid `attributes` entries, when the otel config is resolved, then all sixteen are carried and none is reported
- Given a config whose `otel:` block includes `attributes`, when the config file is loaded, then no unknown-key warning is emitted for `attributes`

#### Negative Paths
- Given an `attributes` entry whose key contains no `.` (for example `team`), when the otel config is resolved, then that entry is absent from the resolved attributes and a warning names the key `team` and states that keys must be namespaced with a dot
- Given an `attributes` entry whose key begins with `service.`, `conductor.`, or `host.`, when the otel config is resolved, then that entry is absent from the resolved attributes and a warning names the key and the reserved prefix
- Given an `attributes` entry whose value is not a string (a number, a boolean, a list, or a `{ env: NAME }` mapping), when the otel config is resolved, then that entry is absent from the resolved attributes and a warning names the key and states that values must be literal strings
- Given an `attributes` entry whose key or value is empty or whitespace-only after trimming, when the otel config is resolved, then that entry is absent from the resolved attributes and a warning names the key (rendered as `''` when empty)
- Given an `attributes` mapping with seventeen valid entries, when the otel config is resolved, then the first sixteen in declaration order are carried and a warning names the seventeenth key and the bound of sixteen
- Given an `attributes` value that is not a mapping (a string or a list), when the otel config is resolved, then no attributes are carried, a single warning states that `otel.attributes` must be a mapping, and the resolved config is still enabled

### Done When
- [ ] `resolveOtelConfig` unit tests assert the two-entry happy path carries exactly the declared keys and values on both the `otlp` and `file` enabled variants
- [ ] A unit test asserts key and value trimming
- [ ] A unit test asserts sixteen entries are carried and the seventeenth is dropped with a warning naming its key
- [ ] Unit tests assert each refusal rule (no dot, reserved prefix, non-string value, empty key or value, non-mapping block) drops only the offending entry and names it
- [ ] A config-loader test asserts an `otel:` block containing `attributes` produces no unknown-key warning

## Story 2: An invalid attribute is reported by key and never disables telemetry or fails a run

As an operator with a typo in one attribute, I want the mistake reported by name while the rest of my
telemetry keeps flowing, so that a mislabeled dimension never costs me a run or a whole export.

### Acceptance Criteria

#### Happy Path
- Given an `attributes` mapping with one invalid and two valid entries, when an interactive run starts with the exporter enabled, then exactly one `renderer_error` event with `rendererName: otel` is emitted whose message names the invalid key, and the two valid attributes are exported
- Given an `attributes` mapping with one invalid entry, when the daemon starts its metric provider with the exporter enabled, then exactly one such `renderer_error` event is emitted on the daemon root bus and the metric provider is constructed and exporting

#### Negative Paths
- Given an `attributes` mapping in which every entry is invalid, when the otel config is resolved, then the resolved config is still enabled with an empty attribute map, and a single warning message enumerates every dropped key — never one event per key
- Given an `attributes` mapping with an invalid entry, when a run executes to completion, then the run's outcome and step results are identical to a run with no `attributes` block — no step fails, halts, or is delayed by the warning
- Given an `attributes` mapping with an invalid entry and a bus whose `renderer_error` handler throws, when the warning is emitted, then the exporter is still constructed and the run proceeds

### Done When
- [ ] An interactive wiring test drives the production construction path with one invalid and two valid attributes and asserts one `renderer_error` naming the invalid key plus the two valid keys on the exported Resource
- [ ] A daemon wiring test asserts the same warning on the daemon root bus and a constructed metric provider
- [ ] A test asserts an all-invalid mapping yields an enabled resolved config with an empty attribute map and exactly one `renderer_error` event whose message names every dropped key
- [ ] A test asserts a run with an invalid attribute produces the same step outcomes as a run without the block

## Story 3: Static attributes are exported on the trace and metric Resources over both transports

As an operator, I want my attributes present on the Resource of every exported trace and metric,
so that unified-service-tagging correlation works across signals in any backend and on the file
export.

### Acceptance Criteria

#### Happy Path
- Given valid `attributes`, when an interactive run exports a span, then the trace Resource carries every declared attribute alongside its existing feature and run identity attributes
- Given valid `attributes`, when the metric provider exports, then the metric Resource carries every declared attribute alongside exactly the existing worker-stable conductor keys (`service.name`, `service.instance.id`, `conductor.project`, `conductor.worker`, `host.name`)
- Given valid `attributes` and `exporter: file`, when a span and a metric are exported, then the OTLP-JSON lines written to the file carry the declared attributes in each signal's resource attribute list
- Given valid `attributes` and `exporter: otlp`, when a span and a metric are exported, then the exported Resource objects handed to the OTLP exporters carry the declared attributes

#### Negative Paths
- Given valid `attributes`, when the metric Resource is inspected, then it carries no attribute beyond the five conductor keys plus the declared attributes — in particular no `conductor.feature`, `conductor.branch`, or `conductor.run.id`
- Given valid `attributes`, when the trace Resource is inspected, then every pre-existing trace Resource attribute is unchanged in name and value
- Given an attribute whose key would collide with a conductor Resource key had it escaped validation, when the Resource is built from a context that carries it, then the conductor value wins and the custom value is absent
- Given `exporter: file` with a path that cannot be written, when a run with valid `attributes` executes, then the run proceeds and the failure is reported once as today — attributes introduce no new failure mode

### Done When
- [ ] `resource.test.ts` asserts the trace Resource carries the declared attributes plus its unchanged existing set
- [ ] `resource.test.ts` asserts the metric Resource's attribute key set equals exactly the five conductor keys plus the declared attributes
- [ ] A file-transport test decodes an exported span line and a metric line and asserts the declared attributes in each resource attribute list
- [ ] A test asserts a context-supplied attribute keyed `service.name` or `conductor.project` does not replace the conductor value on either Resource

## Story 4: Static attributes are exported as labels on every metric data point

As an operator querying a metric backend, I want my attributes present as data-point labels on every
instrument, so that I can filter and group by them without collector configuration.

### Acceptance Criteria

#### Happy Path
- Given valid `attributes`, when a step-close, cost-snapshot, dispatch, gate, and daemon-backlog metric are recorded, then every exported data point on every instrument carries every declared attribute alongside its existing labels
- Given valid `attributes` and a recorder bound to a feature, when a per-feature instrument records, then the data point carries the declared attributes together with `project`, `worker`, and `feature`

#### Negative Paths
- Given a declared attribute whose key equals a conductor label had it escaped validation (`project`, `worker`, `feature`, or `step`), when a data point is recorded through a recorder constructed with it, then the data point carries the conductor value for that label and the custom value is absent
- Given valid `attributes`, when data points are exported across many runs and features, then the set of distinct label combinations grows only by the dimensions that already existed — each declared attribute contributes exactly one value per worker
- Given valid `attributes`, when a data point is recorded, then every pre-existing label on that instrument is unchanged in name and value

### Done When
- [ ] Metrics tests assert the declared attributes on data points of every instrument via `InMemoryMetricExporter`, including at least one per-feature and one daemon-level instrument
- [ ] A test constructs a recorder with a custom attribute keyed `project` and asserts the exported `project` label is the conductor value
- [ ] A test asserts that two runs with the same `attributes` produce data points with identical declared-attribute values
- [ ] All pre-existing metrics tests pass unmodified

## Story 5: Exports are byte-identical when no attributes are declared

As an operator who has not opted in, I want my telemetry unchanged, so that adopting this release
alters nothing I already query.

### Acceptance Criteria

#### Happy Path
- Given an `otel:` block with no `attributes` key, when Resources are built and data points recorded, then every Resource attribute set and every data-point label set is identical to the pre-feature set
- Given an `otel:` block with `attributes: {}`, when Resources are built and data points recorded, then the output is identical to the no-key case and no warning is emitted

#### Negative Paths
- Given no `attributes` key, when the config is resolved, then the resolved config carries no attribute field at all rather than an empty or placeholder map that could reach an exporter
- Given no `attributes` key, when a run's `renderer_error` events are collected, then none of them mention attributes

### Done When
- [ ] The existing exact-attribute-set assertions on both Resources pass unmodified with no `attributes` key
- [ ] A test asserts `attributes: {}` and no key produce identical Resources and data points and zero warnings
- [ ] A test asserts the resolved config has no attribute field when the key is absent

## Story 6: Interactive and daemon-dispatched runs export the same attributes

As an operator running the daemon, I want attributes on daemon-dispatched telemetry exactly as on an
interactive run, so that a dashboard filter works regardless of how a feature was built.

### Acceptance Criteria

#### Happy Path
- Given valid `attributes` in the project's config, when the daemon constructs its long-lived metric provider, then the metric Resource and every recorded data point carry the declared attributes
- Given valid `attributes`, when the daemon dispatches a feature and its per-dispatch visualizer exports a span, then the trace Resource carries the declared attributes
- Given valid `attributes`, when an interactive run constructs its metric provider and visualizer, then the Resources and data points carry the same declared attributes as the daemon path

#### Negative Paths
- Given valid `attributes`, when the exported attribute sets of the daemon path and the interactive path are compared, then the declared attributes are present with identical values on both — a key present on one and absent on the other fails the parity assertion
- Given `attributes` declared only in the process environment (`OTEL_RESOURCE_ATTRIBUTES`) and not in config, when either path exports, then those environment values are absent from every Resource and data point

### Done When
- [ ] `daemon-otel-wiring.test.ts` asserts the declared attributes on the daemon metric Resource, a daemon data point, and a per-dispatch trace Resource
- [ ] `interactive-otel-wiring.test.ts` asserts the declared attributes on the interactive metric Resource, a data point, and the trace Resource
- [ ] A parity test asserts the declared-attribute key/value sets are equal across the two paths
- [ ] A test sets `OTEL_RESOURCE_ATTRIBUTES` and asserts its values are absent from every exported Resource and data point
