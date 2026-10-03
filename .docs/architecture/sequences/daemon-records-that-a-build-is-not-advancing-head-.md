# Sequence: an active-but-not-committing build attempt

**Last updated:** 2026-10-02
**Scope:** One build attempt. The provider stays active, nothing commits, and the
`active_stall_minutes` bound elapses. Two branches follow: the default `warn` action and the
opt-in `end_attempt` action. A recovery branch shows renewed movement clearing the condition.

## Diagram

```mermaid
sequenceDiagram
    participant D as Build dispatch (conductor.ts)
    participant W as BuildProgressWatcher
    participant P as Provider adapter
    participant S as Event spine

    D->>W: start(attempt, endAttempt callback)
    D->>P: invoke(build prompt, abortSignal)
    W->>S: build_progress tick (activity active-committing)
    Note over W: no HEAD or task change, step heartbeat fresh
    W->>S: build_progress heartbeat (activity active-not-committing)
    W->>S: build_no_progress at quiet_minutes (existing warning)
    alt bound elapsed and action warn
        W->>S: build_active_stall (action warn, minutes, lastCommitAt)
        Note over W: fires once per episode, attempt continues
    else bound elapsed and action end_attempt
        W->>S: build_active_stall (action end_attempt)
        W->>D: endAttempt(reason active_stall)
        D->>P: abort
        P-->>D: cancelled result, subprocess terminated
        D->>S: build_stall (reason active_stall) then existing retry or HALT path
    else HEAD or task count moves before the bound
        W->>S: build_progress (activity active-committing)
        Note over W: condition cleared, episode re-arms
    end
    D->>W: stop() in finally
```

## Legend

- `build_active_stall` is the one new event type. Every other arrow uses an existing event
  with at most one added field.
- The retry/HALT path after `build_stall` is the existing attempt-end machinery; this feature
  only supplies a new reason.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-02 | Initial generation | #2102 |
