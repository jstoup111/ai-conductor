# Components: active-but-not-committing build attempts are classified and optionally ended

**Last updated:** 2026-10-02
**Scope:** The per-attempt build-progress watcher, the build dispatch loop that owns the attempt,
and the provider adapters that must honour cancellation. It covers how one build attempt whose
provider stays active without advancing HEAD or the task count is classified on the existing
event spine and, when a project opts in, ended. Every other step, the quiet warning's
existing display fields, and the attempt-end stall breaker's rules are unchanged.

## Diagram

```mermaid
graph TD
    subgraph Config["Config (engine/config.ts · types/config.ts)"]
        BP["build_progress block<br/>poll_seconds · quiet_minutes · heartbeat_minutes · enabled<br/>NEW active_stall_minutes · NEW active_stall_action warn or end_attempt<br/>default action warn"]
    end

    subgraph Dispatch["Build dispatch loop (conductor.ts, per attempt)"]
        CTRL["Attempt AbortController<br/>owned by the dispatcher"]
        CB["endAttempt callback<br/>handed to the watcher; aborts CTRL once"]
        END["Attempt-end classification<br/>existing no_task_progress / unattributed_progress rules<br/>NEW reason active_stall when CTRL aborted by the callback"]
        RETRY["Existing retry budget and stall HALT fallback"]
    end

    subgraph Watcher["BuildProgressWatcher (per attempt)"]
        TICK["Poll tick<br/>HEAD probe · resolved/total · noEvidenceAttempts"]
        HB["Step heartbeat freshness<br/>heartbeatBelongsToDispatch"]
        CLS{"Classify activity"}
        Q["quiet<br/>no change, heartbeat stale"]
        AC["active-committing<br/>change observed"]
        ANC["active-not-committing<br/>no change, heartbeat fresh"]
        BOUND{"active-not-committing ≥ active_stall_minutes?"}
        ACT{"active_stall_action"}
    end

    subgraph Providers["Provider adapters (execution/)"]
        PE["provider-execution: forwards abortSignal (unchanged)"]
        CL["claude-provider: NEW terminate subprocess on abort"]
        CX["codex-provider: NEW terminate subprocess on abort"]
        PI["pi-provider: already honours abort"]
    end

    subgraph Spine["Event spine (unchanged channel)"]
        EV["build_progress / build_no_progress<br/>NEW activity classification field"]
        AS["NEW build_active_stall event<br/>classified condition, action taken"]
        LOG["daemon log · OTel · events.jsonl"]
    end

    BP --> TICK
    BP --> BOUND
    TICK --> CLS
    HB --> CLS
    CLS --> Q
    CLS --> AC
    CLS --> ANC
    Q --> EV
    AC --> EV
    AC -. clears condition .-> BOUND
    ANC --> EV
    ANC --> BOUND
    BOUND -- yes --> ACT
    ACT -- warn --> AS
    ACT -- end_attempt --> AS
    ACT -- end_attempt --> CB
    CB --> CTRL
    CTRL --> PE
    PE --> CL
    PE --> CX
    PE --> PI
    CTRL --> END
    END --> RETRY
    EV --> LOG
    AS --> LOG
```

## Legend

- **NEW** marks additions; everything else exists today.
- The watcher never ends a process itself. It calls the dispatcher's `endAttempt` callback, and
  the dispatcher remains the only authority over its attempt's cancellation.
- "Heartbeat fresh" means the step heartbeat belongs to this dispatch and is newer than the
  quiet threshold. It is the same check the quiet warning already uses for `lastActivityAt`.
- An observed HEAD or task change returns the attempt to active-committing and clears an armed
  condition, so a step that resumes committing is never ended.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-02 | Initial generation | #2102: act on builds that are active but not advancing HEAD |
