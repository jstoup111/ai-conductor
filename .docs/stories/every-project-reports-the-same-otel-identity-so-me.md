**Status:** Accepted

# Stories: OTel two-layer identity (#1938)

Technical track — criteria derive from issue #1938's desired outcomes and the approved
adr-014 amendment (2026-08-26). Source-Ref: jstoup111/ai-conductor#1938.

## Story 1: Metric data points carry project and feature identity

As an operator running the harness against a fleet of projects, I want every exported metric
data point labeled with the originating project and feature, so that two projects' (or two
concurrent features') series never merge silently.

### Acceptance Criteria

#### Happy Path
- Given two visualizer runs constructed with different project roots, when each records a step-close metric, then their exported data points carry distinct `project` attribute values and are distinguishable without any collector configuration
- Given two visualizer runs for the same project with different feature names, when each records a step-close metric, then their exported data points carry distinct `feature` attribute values
- Given a visualizer constructed with a project root path, when any metric data point is exported, then its `project` attribute is the stable project name (basename of the root), not the absolute path
- Given a single run recording duration, retry, token, and closeout metrics, when the data points are exported, then every data point on every instrument carries the same `project` and `feature` attributes alongside its existing attributes (`step`, `kind`, `model`, `obligation`)

#### Negative Paths
- Given a run recording metrics, when its data points are exported, then no data-point attribute set contains the run id (series growth per metric stays bounded as runs accumulate)
- Given the existing pre-identity attribute expectations in the metrics test suite, when identity attributes are added, then pre-existing attributes are unchanged in name and value (additive only — no rename, no removal)
- Given a consumer summing a metric across the whole fleet with no `by` clause, when data points from multiple projects are aggregated, then the total is well-defined because identity attributes only add dimensions and never split the metric into differently-named instruments

### Done When
- [ ] Metrics tests assert `project`/`feature` present with correct values on data points of all four existing instruments via `InMemoryMetricExporter`
- [ ] A two-instance test (different project roots, same in-memory exporter class) asserts distinct `project` values and basename form
- [ ] A test asserts the absence of any run-id-valued attribute key on every exported data point
- [ ] All pre-existing metrics tests pass unmodified

## Story 2: Run identity on the resource ties traces and metrics and makes target_info joinable

As an operator correlating a trace with the metrics of the same run, I want the resolved run id
exported as `service.instance.id` on the OTel Resource, so that the metric backend's
`target_info` series is joinable and a single run is identifiable end-to-end.

### Acceptance Criteria

#### Happy Path
- Given a resource built with an explicit run id, when the resource attributes are inspected, then `service.instance.id` equals that run id and `conductor.run.id` still equals it (existing attribute preserved)
- Given a run exporting both spans and metrics, when the span resource and metric resource are inspected, then both carry the same `service.instance.id`, tying the trace to the run's `target_info`
- Given no runId override and a `.pipeline/conduct-session-id` file with content, when the resource is built, then `service.instance.id` equals the file's trimmed content (the conduct feature-run id, per the existing source chain)

#### Negative Paths
- Given no runId override and no session-id file, when the resource is built, then a non-empty id is minted, persisted, and set as `service.instance.id` without throwing (existing never-throws contract preserved)
- Given the resolved resource, when its attributes are inspected, then `service.name` is exactly the constant `ai-conductor` — project identity is never folded into the service name
- Given an unwritable pipeline directory, when the resource is built, then construction still succeeds with an in-process id and no exception reaches the caller

### Done When
- [ ] Resource tests assert `service.instance.id` presence and equality with the resolved run id for override, file, and minted paths
- [ ] A test asserts `service.name === 'ai-conductor'` and unchanged `conductor.run.id`/`conductor.feature`/`conductor.project` attributes
- [ ] The unwritable-directory test passes with no throw

## Story 3: Wiring passes real identity values from the production construction site

As an operator, I want the production wiring to hand the visualizer real project and feature
values, so the exported identity is meaningful rather than a placeholder.

### Acceptance Criteria

#### Happy Path
- Given the production construction path (`createOtelVisualizer` driven with a resolved config and context), when metrics are recorded, then the data-point `project` derives from the supplied project root and `feature` from the supplied feature name

#### Negative Paths
- Given a context whose feature is absent upstream and defaults to `unknown`, when metrics are recorded, then the data point carries `feature` = `unknown` verbatim (the default is passed through, never dropped so that series from such runs remain aggregable and visibly unattributed)

### Done When
- [ ] An integration-style test drives `createOtelVisualizer` with in-memory exporters and asserts end-to-end identity attributes on exported data points
- [ ] The `unknown`-feature passthrough test passes
