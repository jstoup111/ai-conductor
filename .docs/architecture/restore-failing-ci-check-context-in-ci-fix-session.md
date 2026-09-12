# Sequence: Reliable CI repair dispatch

**Last updated:** 2026-09-11
**Scope:** Proposed correction to the existing daemon CI-repair flow for jstoup111/ai-conductor#2153 and the operator-approved adjacent dispatch defects.

## Diagram

```mermaid
sequenceDiagram
    participant G as GitHub
    participant S as Daemon sweep
    participant C as Check context
    participant B as Build provider selection
    participant R as Repair worktree and session
    participant V as Daemon guards and verifier
    participant E as Existing event spine

    S->>G: Read PR and check state
    G-->>S: Failed checks and eligibility evidence
    S->>S: Apply existing eligibility and retry limits
    S->>C: Prepare failing-check names and links
    C-->>S: Check context or explicit retrieval failure
    opt Retrieval failure
        S->>E: Report failure with PR attribution
    end
    S->>B: Resolve readiness using build configuration
    alt No configured candidate can start repair
        B-->>S: Unavailable with reason
        S->>E: Report readiness failure
        S->>S: Preserve repair attempt count
    else Repair can start
        B-->>R: Use build provider, model, effort and fallback policy
        S->>S: Account for the repair attempt
        S->>R: Supply CI context in isolated worktree
        R-->>V: Return committed repair attempt
        V->>V: Run preservation guards and configured verifier
        alt Guards or verification fail
            V-->>S: Unsuccessful repair
            S->>S: Retain consumed attempt without reporting green
        else Guards and verification pass
            V->>G: Publish using existing lease protection
            alt Publication fails
                G-->>S: Publication refusal
                S->>S: Retain consumed attempt without reporting green
            else Publication succeeds
                G-->>S: Verified repair published
                S->>S: Apply successful-repair bookkeeping
            end
        end
    end
```

## Legend and boundaries

All participants except GitHub and the selected provider execute within the existing engine and its isolated repair worktree. Build provider selection denotes the existing provider-aware execution policy, not a new service or independent CI-repair configuration. Readiness and actual dispatch must agree on that policy; the diagram does not prescribe a second probe implementation.

The diagram distinguishes prevention of a session from an unsuccessful session. A failed guard, failed verifier, or failed push must never be converted to a successful-repair result. Existing CI eligibility, concurrency, cooldown, and retry-limit protections remain in force.

Retrieval failures are observable and distinct from a successful empty check result. Architecture review will settle how available evidence is retained and whether a particular retrieval failure permits repair; no blind-success interpretation is allowed.

The successful-repair branch denotes daemon verification and publication, not proof that subsequent remote CI has passed. GitHub remains the authority for later remote check results.

> **Amended 2026-09-11 by #2153:** The successful-repair bookkeeping branch retains the consumed attempt. Only a later green GitHub observation resets the counter, as required by `adr-2026-07-07-ship-ci-feedback-loop` decision 3. Local verification and publication are not that observation.

## Event-spine decision

Channel: no separate channel; use existing event infrastructure for added diagnostics. Concern: occurrences (context retrieval or provider-readiness failures). Verdict: reuse or extend the ConductorEvent union and existing persistence/consumer path. Exception: none. The diagram and spec are durable design state, not occurrence telemetry.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-11 | Proposed CI-repair dispatch sequence | Expanded issue scope and operator-selected build configuration inheritance |


## Plan refinement

> **Amended 2026-09-11 by #2153:** The plan resolves the earlier conceptual diagram's open ordering: the sweep reserves before repair git work, the provider boundary owns readiness, and direct no-start proof restores count/cooldown. Required-context errors defer, optional-log failures degrade, and local publication retains the attempt. The refined sequence below governs implementation; the original diagram remains as the approved design history.

```mermaid
sequenceDiagram
    participant G as GitHub adapter
    participant S as Daemon sweep
    participant D as Repair dispatcher
    participant B as Build provider executor
    participant R as Repair worktree
    participant E as Root daemon event spine
    S->>G: Read typed PR rollup
    G-->>S: Snapshot or classified read failure
    alt Read failure or ineligible
        S->>E: Attributed failure when applicable
        S->>S: No repair attempt
    else Eligible snapshot
        S->>S: Reserve one attempt and cooldown
        S->>D: Dispatch with selected snapshot
        D->>D: Required context and bounded optional logs
        alt Required context or branch preparation fails
            D-->>S: Proven not-started
            S->>S: Restore prior count and cooldown
        else Usable context
            D->>R: Existing isolated repair worktree
            R->>B: Fresh build-configured repair execution
            B-->>R: Direct aggregated execution result
            alt Every candidate affirmatively refused before start
                R-->>S: Not-started
                S->>S: Restore prior count and cooldown
            else Attempted or unknown execution
                R->>R: Detect committed change
                opt Successful session with committed change
                    R->>R: Preservation guards then configured verifier
                    opt Both gates pass
                        R->>G: Lease-protected publication
                    end
                end
                R-->>S: Failed or noop or published
                S->>S: Retain consumed attempt
            end
        end
        D->>E: Bounded diagnostic facts
    end
    opt Later observed GitHub green
        G-->>S: Green rollup
        S->>S: Reset attempts and failure detection
    end
```

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-11 | Added governing plan refinement in this file | Make reservation, direct no-start refunds and remote-only reset explicit for the 12 implementation tasks |
