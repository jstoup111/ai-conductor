# Track: export-the-telemetry-dimensions-the-engine-already

Track: technical

Scope boundary: Only the dimensions still missing from exported telemetry on main as of 2026-09-09 — provider and fallback reason, reasoning effort, complexity tier, model on step duration and retries, and the unexported TokenUsage detail (reasoningOutput, numTurns, durationMs, costSource). Feature-as-label (#1938) and metered/unmetered dispatch classification (#1972) are already shipped and excluded. Approach A (direct plumbing): each dimension is threaded through the existing event payloads and recorder/span-manager paths; the label-versus-trace-only placement is documented in an ADR-014 amendment, not enforced by a dimension table. Spec owner is excluded entirely (privacy of "who" needs its own intake). A generic dimension table (approach B) is deferred to a separate low-priority intake.

Exporter internals with no product-facing behavior; every prior OTel feature took the technical track.
