# Complexity: Portable feature history across bounded trace segments

Tier: L

Source: jstoup111/ai-conductor#2011, including consolidated #2009.
Scope: operator-approved bounded linked traces, cross-tool support including Datadog,
three-day feature lifetimes, and repeated-step grouping.

The work introduces a lifecycle spanning feature identity recovery, individual dispatch
identity, bounded trace segments, logical-step groups, and execution slices. Segmentation
must rotate still-running executions without falsely completing them or duplicating
outcomes/metrics. Restart recovery must carry only valid same-feature link context through
the existing event spine, with safe behavior for missing/corrupt history. Both interactive
and daemon wiring, exporter shutdown, and delayed-clock behavior need consistent semantics.

These are coupled state transitions across several production boundaries, not merely
adding resource attributes. Full architecture review, conflict-check, and coherence-check
are required. No PRD is required on the technical track.

Splitting grouping from connectivity was considered. The operator requested consolidation;
the same segment/execution model governs grouping, continuation, and navigation, so one
specification avoids competing trace structures. Export-spool implementation remains a
separate feature and is not absorbed here.
