# Track: OTel identity — per-project/per-run metric distinguishability

Track: technical

Scope boundary: Comprehensive — identity labels on metric data points, `service.instance.id`
on the resource, revisited resource semantics (service = product, instance = feature run,
project/feature = data-point dimensions), and a documented identity contract for consumers.
Excludes: cost/dispatch instruments (#1941, in flight), feature-level metrics and
provider/effort dimensions (#1934, #1940), and any collector-side configuration.

Telemetry/export infrastructure with no product-facing behavior; consumers are operators
querying metric backends. Approach A (two-layer identity) chosen over run-id-on-data-points
(unbounded cardinality) and per-project service identity (breaks fleet aggregation). Identity
attributes are injected centrally in MetricsRecorder to compose with #1941's concurrent
metrics.ts changes.
