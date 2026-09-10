# Track: Operators cannot attach their own metadata to exported telemetry

Track: technical

Scope boundary: Balanced — one operator-supplied static attribute map under the existing `otel:` block, validated once in `resolveOtelConfig` (reserved-key refusal, bounded key count, offending key named, never fails a run) and injected at the two existing seams: `buildResource` for both the trace and metric Resources, and `MetricsRecorder`'s identity attributes as metric data-point tags. Values are config-literal only — no environment or template expansion and no per-feature overrides — so every value is constant for a worker's lifetime and adds zero billed series on cardinality-priced backends. Excluded: honoring `OTEL_RESOURCE_ATTRIBUTES` (env propagation across the daemon dispatch boundary is its own surface), per-signal attribute blocks, engine-derived dimensions (#1940), collector-side rewriting, and any generic dimension table.

Exporter configuration and Resource/label plumbing with no product-facing behavior; consumers are operators querying trace and metric backends. Every prior OTel feature took the technical track. Sequenced after #1940, whose ADR-014 amendment (D10) closes the data-point label set that this feature's amendment (D12) extends.
