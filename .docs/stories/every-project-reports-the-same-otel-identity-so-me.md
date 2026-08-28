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
- Given a visualizer constructed with a project root path and no `otel.project_name` configured, when any metric data point is exported, then its `project` attribute is the stable project name (basename of the root), not the absolute path
- Given a single run recording duration, retry, token, and closeout metrics, when the data points are exported, then every data point on every instrument carries the same `project` and `feature` attributes alongside its existing attributes (`step`, `kind`, `model`, `obligation`)
- Given two project roots that share a directory name and a distinct non-blank `otel.project_name` configured for each, when each records a step-close metric, then their exported data points carry those configured values as `project` and are therefore distinguishable

#### Negative Paths
- Given a run recording metrics, when its exported label path is inspected, then neither a data-point attribute nor the Resource identity attribute `service.instance.id` contains the run id (backend series growth stays bounded as runs accumulate)
- Given a config with no `otel.project_name` key, or one whose value is blank or whitespace-only, when a metric data point is exported, then its `project` attribute falls back to the basename of the project root and the run proceeds without error
- Given a config whose `otel.project_name` is set to a non-blank value, when the exported Resource is inspected, then `service.name` is still exactly `ai-conductor` and `conductor.project` is still the absolute project root — the override changes only the data-point attribute
- Given the existing pre-identity attribute expectations in the metrics test suite, when identity attributes are added, then pre-existing attributes are unchanged in name and value (additive only — no rename, no removal)
- Given a consumer summing a metric across the whole fleet with no `by` clause, when data points from multiple projects are aggregated, then the total is well-defined because identity attributes only add dimensions and never split the metric into differently-named instruments

### Done When
- [ ] Metrics tests assert `project`/`feature` present with correct values on data points of all four existing instruments via `InMemoryMetricExporter`
- [ ] A two-instance test (different project roots, same in-memory exporter class) asserts distinct `project` values and basename form
- [ ] A test asserts the absence of any run-id-valued attribute key on every exported data point
- [ ] All pre-existing metrics tests pass unmodified
- [ ] A test drives the production construction path with a configured `otel.project_name` and asserts it is the exported data-point `project` value
- [ ] A test asserts absent, blank, and whitespace-only `otel.project_name` each fall back to the basename with no error raised
- [ ] A test asserts a configured `otel.project_name` leaves `service.name` and the Resource `conductor.project` unchanged

## Story 2: Resource identity keys target_info per feature and keeps the run id off the label path

As an operator correlating a feature's traces with its metrics, I want `service.instance.id` to be
the feature's stable `<project>/<feature>` identity rather than the run id, so that `target_info` is
joinable per feature and no new metric series is minted per run.

### Acceptance Criteria

#### Happy Path
- Given a resource built for a project and a feature, when the resource attributes are inspected, then `service.instance.id` equals the project and feature joined by a slash, using the same resolved project name the data-point seam uses, and `conductor.run.id` still carries the resolved run id
- Given a run exporting both spans and metrics, when the span resource and the metric resource are inspected, then both carry the same `service.instance.id`, so the feature's traces and its `target_info` row share one key
- Given a non-blank `otel.project_name` configured, when the resource is built, then the project half of `service.instance.id` is that configured value and equals the data-point `project` attribute exactly
- Given no runId override and a `.pipeline/conduct-session-id` file with content, when the resource is built, then `conductor.run.id` equals the file's trimmed content and that value appears nowhere in `service.instance.id`

#### Negative Paths
- Given a resource built for any run, when its exported attributes are inspected, then no value on the label path — data-point attribute or `service.instance.id` — contains the run id (backend series growth stays bounded as runs accumulate)
- Given an absent project name or an absent feature, when the resource is built, then the missing half of `service.instance.id` is `unknown` and construction does not throw (the never-fails contract is preserved)
- Given the resolved resource, when its attributes are inspected, then `service.name` is exactly the constant `ai-conductor` — project identity is never folded into the service name nor into the backend's derived `job` label
- Given an unwritable pipeline directory, when the resource is built, then construction still succeeds and no exception reaches the caller

### Done When
- [ ] Resource tests assert `service.instance.id` equals the composed project-and-feature value for the configured-name, basename, and absent-value paths
- [ ] A test asserts the resolved run id appears in no Resource identity attribute and in no data-point attribute
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
