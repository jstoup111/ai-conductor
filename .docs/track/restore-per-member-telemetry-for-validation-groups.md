# Track: Sequential and parallel step telemetry parity

Track: technical

Scope boundary: Operator approved feature parity for telemetry across sequential lifecycle steps, built-in validation-group members, and user-configured parallel-group members. Cover per-execution timing, spans, status, retry information, provider attribution, failures, and interruption. Use shared lifecycle instrumentation while retaining existing execution machinery. No Grafana changes, scheduling rewrite, new recovery policy, or instrumentation of nested BUILD tasks and auxiliary review rubrics.

Source: jstoup111/ai-conductor#2414

The operator selected approach 1 and the technical track on 2026-09-10. This is an engine observability correction; acceptance criteria belong in technical stories, without a PRD.

## Confirmed approach

Share lifecycle instrumentation through the existing ConductorEvent spine. Serial execution, built-in groups, and configured groups retain their scheduling and gate ownership. A shared execution contract and behavioral parity coverage prevent dispatch-path omissions.

The alternative of unifying the executors was rejected because it expands the change into scheduling, checkpoints, recovery, and gate coordination. A validation-only patch was rejected because the operator requested sequential/parallel parity.

## Verified context

- Current upstream main at 3ed68816813f40190b62a5462abd6c5bb5ea3c12 still emits step_started and step_completed on the serial path while its validation onMemberEvent callback does not emit member lifecycle events.
- MetricsListener requires a matching step_started before recording duration. SpanManager likewise opens spans from step_started. Group ceremony events remain otel: false.
- Grafana's Prometheus data queried on 2026-09-10 over 24 hours showed 5 dispatch series each for prd_audit and architecture_review_as_built under project=/home/james-stoup/code/ai-conductor; neither step appeared in duration-count or trace span-metric series. These are series counts, not execution counts. No dashboard or telemetry configuration was changed.
- runParallelGroupViaCore uses runGroupBranch without an onMemberEvent observer. emitExecutionEvent already tracks open executions and suppresses duplicate/late terminals, making it a relevant existing lifecycle seam.

Verify-claims: CLEAR for track and approved approach. Detailed identity and lifecycle design remains subject to architecture review.
