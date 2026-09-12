# Sequence: Provider setup failures preserve configured fallback

**Last updated:** 2026-09-11
**Scope:** Shared candidate execution for ordinary and self-host callers; approach A, pending operator diagram review.

> **Amended 2026-09-11 by #1285:** The operator approved this diagram and Medium complexity in the composer session. The flow is accepted for architecture review.

## Diagram

```mermaid
sequenceDiagram
    participant Caller as Step or auxiliary caller
    participant Executor as Shared provider executor
    participant Setup as Candidate setup and safety
    participant Provider as Selected provider adapter
    participant Events as Existing event spine
    Caller->>Executor: Execute configured candidate order
    loop Candidates until a terminal result
        Executor->>Setup: Resolve native settings and prepare candidate
        alt Explicitly classified candidate unavailable
            Setup-->>Executor: Unavailable with reason
            Executor->>Setup: Complete candidate cleanup
            Executor->>Events: Record skipped candidate and fallback reason
            Note over Caller,Executor: Advance within this attempt, without a dispatch retry
        else Authentication or required-safety refusal
            Setup-->>Executor: Preserve existing blocking disposition
            Executor-->>Caller: Return to existing recovery authority
        else Candidate ready
            Setup-->>Executor: Prepared invocation context
            Executor->>Provider: Invoke with candidate-native settings
            Provider-->>Executor: Classified result
            Executor->>Setup: Complete candidate cleanup
            Executor->>Events: Record actual candidate result
            Note over Executor,Provider: Existing result policy determines fallback or terminal return
        end
    end
    Executor-->>Caller: Success, retained failure, or explicit exhaustion
```

## Legend

The loop ends on success or any result whose existing policy forbids fallback. Only an explicit candidate-unavailability classification advances after setup failure; arbitrary thrown exceptions are not converted into availability. Required safety remains authoritative for every candidate. Cleanup failure prevents advancing when safe release cannot be established. Self-host preparation is one caller-specific setup path, not the scope of the shared contract.

Skip and result diagnostics use the existing `provider_attempt` and fallback-warning paths through `ConductorEventEmitter`; this feature adds no sidecar log or alternate event schema. Exact classification and cleanup ownership are resolved in architecture review after this diagram is accepted.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-11 | Initial scoped sequence | Show approach A and preserved recovery boundaries for issue #1285 |
