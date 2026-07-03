# Components + Sequence: Model Availability Fallback Ladder

**Last updated:** 2026-07-03
**Scope:** Reactive model-unavailable detection in ClaudeProvider and the per-process
fallback ladder that degrades invocations instead of HALTing (issue jstoup111/ai-conductor#186).

## Component Diagram

```mermaid
graph TD
    subgraph config [".ai-conductor/config.yml"]
        LADDER["model_fallback_ladder<br/>default fable, opus, sonnet"]
    end

    subgraph engine ["engine/"]
        RC["resolved-config.ts<br/>resolveStepConfig - picks configured model"]
        SR["step-runners.ts<br/>invokes provider with resolved model"]
        CT["conductor.ts<br/>retry loop and HALT path"]
        MA["model-availability.ts NEW<br/>per-process cache and ladder walk"]
    end

    subgraph execution ["execution/"]
        LP["llm-provider.ts<br/>InvokeResult gains modelUnavailable flag"]
        CP["claude-provider.ts<br/>MODEL_UNAVAILABLE_RE detection"]
    end

    CLI["claude CLI subprocess"]
    LOG["daemon.log and step output<br/>loud downgrade warning"]

    LADDER --> MA
    RC --> SR
    SR --> MA
    MA --> CP
    CP --> CLI
    CP --> LP
    MA --> LOG
    SR --> CT

    style MA fill:#e8f5e9,stroke:#2e7d32
    style CP fill:#fff3e0,stroke:#ef6c00
    style LP fill:#fff3e0,stroke:#ef6c00
```

## Sequence: invocation with unavailable model

```mermaid
sequenceDiagram
    participant SR as step-runner
    participant MA as ModelAvailability
    participant CP as ClaudeProvider
    participant CLI as claude CLI

    SR->>MA: invokeWithLadder(model «fable», options)
    MA->>MA: cache lookup - «fable» not marked dead
    MA->>CP: invoke(model «fable»)
    CP->>CLI: claude --model fable ...
    CLI-->>CP: exit non-zero, model-unavailable error text
    CP-->>MA: result modelUnavailable=true
    MA->>MA: mark «fable» dead for process lifetime
    MA->>MA: next ladder model «opus»
    MA-->>SR: warn - downgrade fable to opus, reason logged
    MA->>CP: invoke(model «opus»)
    CP->>CLI: claude --model opus ...
    CLI-->>CP: exit 0
    CP-->>MA: result success
    MA-->>SR: success on «opus», same step attempt
    Note over SR: retry budget untouched by the downgrade walk
    Note over MA: ladder exhausted would return last failure to normal retry/HALT path
```

## Legend

- **Green** — new module (`model-availability.ts`).
- **Orange** — modified existing modules (detection flag threading).
- The ladder walk happens **inside one step attempt**: downgrades never consume
  the step's `max_retries` budget. Only a fully-exhausted ladder surfaces as a
  normal failure to the existing retry/HALT machinery.
- Cache is per-process (daemon or engineer CLI process); restart clears it.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-03 | Initial generation | DECIDE phase for intake #186 (engineer loop) |
