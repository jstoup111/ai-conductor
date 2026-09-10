# Coherence Mapping: Operator-supplied static telemetry attributes (#2056)

Technical track — no `fr` rows. Outcomes staged from jstoup111/ai-conductor#2056. ADR pool: the one
non-deleted ADR in this change set, `adr-014-otel-observability-exporter` (amended D12/D13).

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1 | covered | Bounded custom metadata without engine code — Story 1's `otel.attributes` map with the sixteen-entry bound |
| outcome | outcome-2 | story-3, story-4, story-6 | covered | Both signals (Story 3 Resources, Story 4 data points), both transports (Story 3 file/OTLP), both entry points (Story 6) |
| outcome | outcome-3 | story-5 | covered | Unchanged telemetry with no metadata — Story 5's absent-key and `{}` deep-equal criteria |
| outcome | outcome-4 | story-1, story-2 | covered | Story 1 names the offending key per refusal rule; Story 2 keeps the exporter enabled and the run outcome identical |
| outcome | outcome-5 | story-3, story-4 | covered | Conductor-owned keys win on both Resources (Story 3) and on every data point (Story 4) |
| outcome | outcome-6 | story-1, story-4 | covered | Growth bound is the observable refusal of non-literal values (Story 1) plus Story 4's one-value-per-worker criterion; the documentation half is an architecture-review condition, not a story |
| story | story-1 | task-1, task-2, task-3 | covered | Resolution happy path, refusal rules, allowlist and registry |
| story | story-2 | task-9 | covered | Invalid entry never changes run outcome or disables the exporter; Tasks 6 and 7 ground its two happy paths through their Story 6 wiring |
| story | story-3 | task-4, task-8 | covered | Both Resources with merge order; both transports |
| story | story-4 | task-5 | covered | Every data point via the identity seam; collision and growth negatives |
| story | story-5 | task-11 | covered | Byte-identical exports when no attributes are declared |
| story | story-6 | task-6, task-7, task-10 | covered | Interactive wiring, daemon wiring, parity and environment guard |
| task | task-1 | story-1 | covered | Story line cites Story 1 |
| task | task-2 | story-1 | covered | Story line cites Story 1 |
| task | task-3 | story-1 | covered | Story line cites Story 1; infrastructure task delivering Story 1's allowlist criterion |
| task | task-4 | story-3 | covered | Story line cites Story 3 |
| task | task-5 | story-4 | covered | Story line cites Story 4 |
| task | task-6 | story-6 | covered | Story line cites Story 6; its single-warning assertion also grounds Story 2's interactive happy path |
| task | task-7 | story-6 | covered | Story line cites Story 6; its root-bus warning assertion also grounds Story 2's daemon happy path |
| task | task-8 | story-3 | covered | Story line cites Story 3 |
| task | task-9 | story-2 | covered | Story line cites Story 2 |
| task | task-10 | story-6 | covered | Story line cites Story 6 |
| task | task-11 | story-5 | covered | Story line cites Story 5 |
| adr | adr-014-otel-observability-exporter | story-1, story-3, story-4 | covered | Amended 2026-09-09 by #2056 (D12, D13). D12 → Tasks 1–3 (Story 1); D13 → Tasks 4–7 (Stories 3, 4, 6). D1–D4, D7, D9 no-change: no emission site, plugin packaging, bus handler, daemon meter, or event type is touched. D5 task: Task 2's enabled-under-every-refusal assertion and Task 9's completed-run assertion. D6 existing: `attributes` joins the existing `otel:` block. D8 task: Task 4's exact five-key metric Resource assertion |
| criterion | Story 1 happy: Given an `otel:` block with `attributes: { deployment.environment.name: staging, team.name: platform }`, when the otel config is resolved, then the resolved config is enabled and carries exactly those two attributes with those string values | task-1 | covered | "carries exactly the declared keys and trimmed string values" | diff-local |
| criterion | Story 1 happy: Given an `attributes` value whose key or value has surrounding whitespace, when the otel config is resolved, then the key and value are trimmed before use | task-1 | covered | "carries exactly the declared keys and trimmed string values" | diff-local |
| criterion | Story 1 happy: Given an `otel:` block with sixteen valid `attributes` entries, when the otel config is resolved, then all sixteen are carried and none is reported | task-1 | covered | "carries exactly the declared keys and trimmed string values" | diff-local |
| criterion | Story 1 happy: Given a config whose `otel:` block includes `attributes`, when the config file is loaded, then no unknown-key warning is emitted for `attributes` | task-3 | covered | "registry-totality test passes with a consumer declaration for the attributes key" | diff-local |
| criterion | Story 1 negative: Given an `attributes` entry whose key contains no `.` (for example `team`), when the otel config is resolved, then that entry is absent from the resolved attributes and a warning names the key `team` and states that keys must be namespaced with a dot | task-2 | covered | "drops only the offending entry and pushes one warning string naming that key" | diff-local |
| criterion | Story 1 negative: Given an `attributes` entry whose key begins with `service.`, `conductor.`, or `host.`, when the otel config is resolved, then that entry is absent from the resolved attributes and a warning names the key and the reserved prefix | task-2 | covered | "drops only the offending entry and pushes one warning string naming that key" | diff-local |
| criterion | Story 1 negative: Given an `attributes` entry whose value is not a string (a number, a boolean, a list, or a `{ env: NAME }` mapping), when the otel config is resolved, then that entry is absent from the resolved attributes and a warning names the key and states that values must be literal strings | task-2 | covered | "drops only the offending entry and pushes one warning string naming that key" | diff-local |
| criterion | Story 1 negative: Given an `attributes` entry whose key or value is empty or whitespace-only after trimming, when the otel config is resolved, then that entry is absent from the resolved attributes and a warning names the key (rendered as `''` when empty) | task-2 | covered | "drops only the offending entry and pushes one warning string naming that key" | diff-local |
| criterion | Story 1 negative: Given an `attributes` mapping with seventeen valid entries, when the otel config is resolved, then the first sixteen in declaration order are carried and a warning names the seventeenth key and the bound of sixteen | task-2 | covered | "drops only the offending entry and pushes one warning string naming that key" | diff-local |
| criterion | Story 1 negative: Given an `attributes` value that is not a mapping (a string or a list), when the otel config is resolved, then no attributes are carried, a single warning states that `otel.attributes` must be a mapping, and the resolved config is still enabled | task-2 | covered | "drops only the offending entry and pushes one warning string naming that key" | diff-local |
| criterion | Story 2 happy: Given an `attributes` mapping with one invalid and two valid entries, when an interactive run starts with the exporter enabled, then exactly one `renderer_error` event with `rendererName: otel` is emitted whose message names the invalid key, and the two valid attributes are exported | task-6 | covered | "exactly one renderer_error event whose message names every dropped key" | diff-local |
| criterion | Story 2 happy: Given an `attributes` mapping with one invalid entry, when the daemon starts its metric provider with the exporter enabled, then exactly one such `renderer_error` event is emitted on the daemon root bus and the metric provider is constructed and exporting | task-7 | covered | "the daemon root bus receives exactly one renderer_error naming every dropped key" | diff-local |
| criterion | Story 2 negative: Given an `attributes` mapping in which every entry is invalid, when the otel config is resolved, then the resolved config is still enabled with an empty attribute map, and a single warning message enumerates every dropped key — never one event per key | task-9 | covered | "an all-invalid map yields an enabled resolved config with an empty attributes object" | diff-local |
| criterion | Story 2 negative: Given an `attributes` mapping with an invalid entry, when a run executes to completion, then the run's outcome and step results are identical to a run with no `attributes` block — no step fails, halts, or is delayed by the warning | task-9 | covered | "step outcomes identical to a run with no attributes block" | diff-local |
| criterion | Story 2 negative: Given an `attributes` mapping with an invalid entry and a bus whose `renderer_error` handler throws, when the warning is emitted, then the exporter is still constructed and the run proceeds | task-9 | covered | "a throwing renderer_error handler still yields a constructed exporter and a completed run" | diff-local |
| criterion | Story 3 happy: Given valid `attributes`, when an interactive run exports a span, then the trace Resource carries every declared attribute alongside its existing feature and run identity attributes | task-4 | covered | "the trace Resource carries the declared keys and every pre-existing trace attribute unchanged" | diff-local |
| criterion | Story 3 happy: Given valid `attributes`, when the metric provider exports, then the metric Resource carries every declared attribute alongside exactly the existing worker-stable conductor keys (`service.name`, `service.instance.id`, `conductor.project`, `conductor.worker`, `host.name`) | task-4 | covered | "the metric Resource key set equals exactly the five conductor keys plus the declared keys" | diff-local |
| criterion | Story 3 happy: Given valid `attributes` and `exporter: file`, when a span and a metric are exported, then the OTLP-JSON lines written to the file carry the declared attributes in each signal's resource attribute list | task-8 | covered | "resource attribute list of both the span line and the metric line" | diff-local |
| criterion | Story 3 happy: Given valid `attributes` and `exporter: otlp`, when a span and a metric are exported, then the exported Resource objects handed to the OTLP exporters carry the declared attributes | task-8 | covered | "exported span and metric Resources carry the declared attributes" | diff-local |
| criterion | Story 3 negative: Given valid `attributes`, when the metric Resource is inspected, then it carries no attribute beyond the five conductor keys plus the declared attributes — in particular no `conductor.feature`, `conductor.branch`, or `conductor.run.id` | task-4 | covered | "the metric Resource key set equals exactly the five conductor keys plus the declared keys" | diff-local |
| criterion | Story 3 negative: Given valid `attributes`, when the trace Resource is inspected, then every pre-existing trace Resource attribute is unchanged in name and value | task-4 | covered | "every pre-existing trace attribute unchanged in name and value" | diff-local |
| criterion | Story 3 negative: Given an attribute whose key would collide with a conductor Resource key had it escaped validation, when the Resource is built from a context that carries it, then the conductor value wins and the custom value is absent | task-4 | covered | "conductor keys are written after the custom map" | diff-local |
| criterion | Story 3 negative: Given `exporter: file` with a path that cannot be written, when a run with valid `attributes` executes, then the run proceeds and the failure is reported once as today — attributes introduce no new failure mode | task-8 | covered | "exactly one export-failure warning and a completed run" | diff-local |
| criterion | Story 4 happy: Given valid `attributes`, when a step-close, cost-snapshot, dispatch, gate, and daemon-backlog metric are recorded, then every exported data point on every instrument carries every declared attribute alongside its existing labels | task-5 | covered | "the declared keys on data points of at least six instruments" | diff-local |
| criterion | Story 4 happy: Given valid `attributes` and a recorder bound to a feature, when a per-feature instrument records, then the data point carries the declared attributes together with `project`, `worker`, and `feature` | task-5 | covered | "one per-feature and one daemon-level instrument" | diff-local |
| criterion | Story 4 negative: Given a declared attribute whose key equals a conductor label had it escaped validation (`project`, `worker`, `feature`, or `step`), when a data point is recorded through a recorder constructed with it, then the data point carries the conductor value for that label and the custom value is absent | task-5 | covered | "identity attributes and per-point attributes are written after the custom map" | diff-local |
| criterion | Story 4 negative: Given valid `attributes`, when data points are exported across many runs and features, then the set of distinct label combinations grows only by the dimensions that already existed — each declared attribute contributes exactly one value per worker | task-5 | covered | "two recorders with the same custom map export identical custom values" | diff-local |
| criterion | Story 4 negative: Given valid `attributes`, when a data point is recorded, then every pre-existing label on that instrument is unchanged in name and value | task-5 | covered | "a recorder with no custom map exports label sets identical to today's" | diff-local |
| criterion | Story 5 happy: Given an `otel:` block with no `attributes` key, when Resources are built and data points recorded, then every Resource attribute set and every data-point label set is identical to the pre-feature set | task-11 | covered | "deep-equal to the pre-feature fixtures when no attributes are declared" | diff-local |
| criterion | Story 5 happy: Given an `otel:` block with `attributes: {}`, when Resources are built and data points recorded, then the output is identical to the no-key case and no warning is emitted | task-11 | covered | "has no `attributes` property when the key is absent" | diff-local |
| criterion | Story 5 negative: Given no `attributes` key, when the config is resolved, then the resolved config carries no attribute field at all rather than an empty or placeholder map that could reach an exporter | task-11 | covered | "has no `attributes` property when the key is absent" | diff-local |
| criterion | Story 5 negative: Given no `attributes` key, when a run's `renderer_error` events are collected, then none of them mention attributes | task-11 | covered | "zero renderer_error events whose message mentions attributes" | diff-local |
| criterion | Story 6 happy: Given valid `attributes` in the project's config, when the daemon constructs its long-lived metric provider, then the metric Resource and every recorded data point carry the declared attributes | task-7 | covered | "the daemon root bus receives exactly one renderer_error naming every dropped key" | diff-local |
| criterion | Story 6 happy: Given valid `attributes`, when the daemon dispatches a feature and its per-dispatch visualizer exports a span, then the trace Resource carries the declared attributes | task-7 | covered | "a per-dispatch trace Resource" | diff-local |
| criterion | Story 6 happy: Given valid `attributes`, when an interactive run constructs its metric provider and visualizer, then the Resources and data points carry the same declared attributes as the daemon path | task-6 | covered | "the declared keys on the trace Resource, the metric Resource, and an exported data point" | diff-local |
| criterion | Story 6 negative: Given valid `attributes`, when the exported attribute sets of the daemon path and the interactive path are compared, then the declared attributes are present with identical values on both — a key present on one and absent on the other fails the parity assertion | task-10 | covered | "parity assertion compares the declared-attribute key/value sets" | diff-local |
| criterion | Story 6 negative: Given `attributes` declared only in the process environment (`OTEL_RESOURCE_ATTRIBUTES`) and not in config, when either path exports, then those environment values are absent from every Resource and data point | task-10 | covered | "absent from every exported Resource and data point on both paths" | diff-local |
## Consistency pass (§4d)

Cross-layer pairs checked in both directions. The one pair sharing a subject across layers with any
tension is outcome-4 ("does not fail or slow a conductor run") against Task 6/7's new `renderer_error`
emission on the same startup path: the event is emitted once, before any step runs, through the
existing bounded warning bridge, and Task 9 asserts step outcomes identical to a run with no
attributes block — satisfying outcome-4 fully leaves Tasks 6/7 intact and vice versa. Story 5's
preserved-behavior promise was swept against every new side effect: Tasks 6, 7, and 9 condition the
warning on a non-empty warning list, and Tasks 4, 5, and 11 assert deep-equal Resources and label
sets when the map is absent, so no unconditional effect reaches the no-attributes path. No
contradiction or oscillation found.

## Achievability pass (§4g)

Every criterion row's quote names a mechanism (`resolveOtelConfig`'s per-entry refusal and warning
list, `buildResource`'s merge order, `withIdentity`'s merge order, the `onWarning`/`renderer_error`
bridge at each construction site, the file transport's OTLP-JSON resource attribute list, the parity
fixture) rather than restating the Then-clause. Constraint sweep against adr-014: D8's exact metric
Resource key set is preserved by Task 4's assertion of exactly five conductor keys plus the declared
keys; D4's no-I/O bus rule is untouched because validation runs at config resolution and injection is
a spread. Closed sets: the only closed set introduced is the refusal-rule vocabulary, and each of
Story 1's six negative scenarios maps to one named rule in Task 2. Input boundary: Story 1's rules
operate on the raw YAML mapping, and Task 1/2 own that boundary directly; Task 3 owns the allowlist
boundary that lets the key reach resolution. No `CANNOT-DELIVER` findings.
