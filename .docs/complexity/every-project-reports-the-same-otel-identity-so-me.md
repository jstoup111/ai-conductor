# Complexity: OTel identity — per-project/per-run metric distinguishability

Tier: M

Rationale: single subsystem (src/conductor/src/engine/otel/) with no new integrations, auth, or
state machines — but comprehensive scope: resource semantics revision (service.instance.id),
data-point identity injection across all instruments, a consumer-facing identity contract doc,
and a known textual race with the in-flight #1941 metrics change that warrants conflict-check
and coherence-check rather than the S-tier skip. Issue is labeled size: S; the operator-chosen
comprehensive scope raises it to M.
