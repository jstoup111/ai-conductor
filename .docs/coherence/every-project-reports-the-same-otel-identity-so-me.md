# Coherence Mapping: OTel two-layer identity (#1938)

Technical track — no `fr` rows. Outcomes staged from jstoup111/ai-conductor#1938.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1 | covered | Distinguishable by harness exports alone — Story 1's collector-free distinct-`project` criterion |
| outcome | outcome-2 | story-1 | covered | Concurrent feature runs of one project — Story 1's distinct-`feature` criterion |
| outcome | outcome-3 | story-2 | covered | Run identifiable end-to-end — Story 2 ties trace and target_info via service.instance.id |
| outcome | outcome-4 | story-1 | covered | Bounded series growth — Story 1's run-id-off-data-points negative |
| outcome | outcome-5 | story-1 | covered | Fleet totals without per-project queries — Story 1's no-`by`-clause aggregation negative |
| story | story-1 | task-3, task-4, task-5 | covered | Injection seam, run-id-off/aggregability negatives, basename end-to-end |
| story | story-2 | task-1, task-2 | covered | Instance id happy paths; never-throws negatives |
| story | story-3 | task-5 | covered | Production wiring end-to-end |
| task | task-1 | story-2 | covered | Story line cites Story 2 |
| task | task-2 | story-2 | covered | Story line cites Story 2 |
| task | task-3 | story-1 | covered | Story line cites Story 1 |
| task | task-4 | story-1 | covered | Story line cites Story 1 |
| task | task-5 | story-3 | covered | Story line cites Story 3; its assertions also ground Story 1's basename criterion and Story 2's dual-provider criterion |
| adr | adr-014-otel-observability-exporter | story-1, story-2 | covered | Amended 2026-08-26 by #1938; stories implement the amendment's two-layer identity contract |
| criterion | Story 1 happy: Given two visualizer runs constructed with different project roots, when each records a step-close metric, then their exported data points carry distinct `project` attribute values and are distinguishable without any collector configuration | task-3 | covered | "two recorder instances with different identity values produce data points with distinct `project` values" | diff-local |
| criterion | Story 1 happy: Given two visualizer runs for the same project with different feature names, when each records a step-close metric, then their exported data points carry distinct `feature` attribute values | task-3 | covered | "carries `project` and `feature` attributes with the injected values" | diff-local |
| criterion | Story 1 happy: Given a visualizer constructed with a project root path, when any metric data point is exported, then its `project` attribute is the stable project name (basename of the root), not the absolute path | task-5 | covered | "whose `project` equals the path's basename (not the absolute path)" | diff-local |
| criterion | Story 1 happy: Given a single run recording duration, retry, token, and closeout metrics, when the data points are exported, then every data point on every instrument carries the same `project` and `feature` attributes alongside its existing attributes (`step`, `kind`, `model`, `obligation`) | task-3 | covered | "every exported data point of `conductor.step.duration`, `conductor.step.retries`, `conductor.step.tokens`, and `conductor.pipeline.closeout.duration` carries `project` and `feature` attributes" | diff-local |
| criterion | Story 1 negative: Given a run recording metrics, when its data points are exported, then no data-point attribute set contains the run id (series growth per metric stays bounded as runs accumulate) | task-4 | covered | "no attribute value equals the run id and no attribute key names a run id" | diff-local |
| criterion | Story 1 negative: Given the existing pre-identity attribute expectations in the metrics test suite, when identity attributes are added, then pre-existing attributes are unchanged in name and value (additive only — no rename, no removal) | task-3 | covered | "pre-existing attribute keys and values still assert successfully" | diff-local |
| criterion | Story 1 negative: Given a consumer summing a metric across the whole fleet with no `by` clause, when data points from multiple projects are aggregated, then the total is well-defined because identity attributes only add dimensions and never split the metric into differently-named instruments | task-4 | covered | "yields the arithmetic total (instrument names identical across instances" | diff-local |
| criterion | Story 2 happy: Given a resource built with an explicit run id, when the resource attributes are inspected, then `service.instance.id` equals that run id and `conductor.run.id` still equals it (existing attribute preserved) | task-1 | covered | "explicit-runId build yields `service.instance.id` equal to the override while `conductor.run.id` still equals it" | diff-local |
| criterion | Story 2 happy: Given a run exporting both spans and metrics, when the span resource and metric resource are inspected, then both carry the same `service.instance.id`, tying the trace to the run's `target_info` | task-5 | covered | "the exported spans and metrics carry the same `service.instance.id` on their resources (one resource, both providers)" | diff-local |
| criterion | Story 2 happy: Given no runId override and a `.pipeline/conduct-session-id` file with content, when the resource is built, then `service.instance.id` equals the file's trimmed content (the conduct feature-run id, per the existing source chain) | task-1 | covered | "session-file path yields the file's trimmed content as `service.instance.id`" | diff-local |
| criterion | Story 2 negative: Given no runId override and no session-id file, when the resource is built, then a non-empty id is minted, persisted, and set as `service.instance.id` without throwing (existing never-throws contract preserved) | task-1 | covered | "minted path (no file) yields a non-empty `service.instance.id`" | diff-local |
| criterion | Story 2 negative: Given the resolved resource, when its attributes are inspected, then `service.name` is exactly the constant `ai-conductor` — project identity is never folded into the service name | task-1 | covered | "pins `service.name === 'ai-conductor'`" | diff-local |
| criterion | Story 2 negative: Given an unwritable pipeline directory, when the resource is built, then construction still succeeds with an in-process id and no exception reaches the caller | task-2 | covered | "with an unwritable pipeline directory, `buildResource` still returns a resource whose `service.instance.id` is non-empty and no exception reaches the caller" | diff-local |
| criterion | Story 3 happy: Given the production construction path (`createOtelVisualizer` driven with a resolved config and context), when metrics are recorded, then the data-point `project` derives from the supplied project root and `feature` from the supplied feature name | task-5 | covered | "driving `createOtelVisualizer` with in-memory exporters" | diff-local |
| criterion | Story 3 negative: Given a context whose feature is absent upstream and defaults to `unknown`, when metrics are recorded, then the data point carries `feature` = `unknown` verbatim (the default is passed through, never dropped so that series from such runs remain aggregable and visibly unattributed) | task-5 | covered | "the data point carries `feature` = `unknown` verbatim" | diff-local |

## Consistency pass (§4d)

Cross-layer pairs sharing a subject were checked in both directions; no static
contradiction and no oscillation found. Notable pairs examined: outcome-4 (bounded growth) vs
task-3 (identity on every data point) — compatible because injected identity is low-cardinality
and run id is excluded (task-4 pins it); outcome-5 (fleet totals) vs task-3 — compatible because
identity adds dimensions without forking instrument names (task-4 pins it); the amended adr-014
vs story-2 — the amendment's instance-id clause is exactly what story-2 asserts.
