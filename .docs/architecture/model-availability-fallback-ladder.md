# Components + Sequence: Provider-Aware Model Availability Fallback

**Last updated:** 2026-07-23
**Scope:** Reactive model-unavailable detection in the selected provider and the
per-process provider-native fallback ladder that degrades invocations instead of
HALTing (issues #186 and #902).

## Component Diagram

```mermaid
graph TD
    subgraph config [".ai-conductor/config.yml"]
        LADDER["model_fallback_ladder<br/>optional provider-native override"]
    end

    subgraph engine ["engine/"]
        PP["provider-model-policy.ts<br/>provider default ladder"]
        RC["resolved-config.ts<br/>resolve provider-native model"]
        SR["step-runners.ts<br/>invoke selected provider"]
        CT["conductor.ts<br/>retry loop and HALT path"]
        MA["model-availability.ts<br/>per-process cache and ladder walk"]
    end

    subgraph execution ["execution/"]
        LP["llm-provider.ts<br/>InvokeResult modelUnavailable flag"]
        SP["ClaudeProvider or CodexProvider<br/>provider-specific error detection"]
    end

    CLI["selected provider CLI subprocess"]
    LOG["daemon.log and step output<br/>loud downgrade warning"]

    LADDER --> MA
    PP --> MA
    RC --> SR
    SR --> MA
    MA --> SP
    SP --> CLI
    SP --> LP
    MA --> LOG
    SR --> CT

    style PP fill:#e8f5e9,stroke:#2e7d32
    style MA fill:#e8f5e9,stroke:#2e7d32
    style SP fill:#fff3e0,stroke:#ef6c00
```

## Sequence: Codex invocation with unavailable model

```mermaid
sequenceDiagram
    participant SR as step-runner
    participant MA as ModelAvailability
    participant SP as CodexProvider
    participant CLI as codex CLI

    SR->>MA: invokeWithLadder(model «gpt-5.6-sol», options)
    MA->>MA: cache lookup - Sol not marked dead
    MA->>SP: invoke(model «gpt-5.6-sol»)
    SP->>CLI: codex --model gpt-5.6-sol
    CLI-->>SP: exit non-zero, model-unavailable error
    SP-->>MA: result modelUnavailable=true
    MA->>MA: mark Sol dead for process lifetime
    MA->>MA: next policy model «gpt-5.6-terra»
    MA-->>SR: warn - downgrade Sol to Terra
    MA->>SP: invoke(model «gpt-5.6-terra»)
    SP->>CLI: codex --model gpt-5.6-terra
    CLI-->>SP: exit 0
    SP-->>MA: result success
    MA-->>SR: success on Terra, same step attempt
    Note over SR: retry budget untouched by the downgrade walk
    Note over MA: ladder exhaustion returns the last failure to normal retry and HALT
```

## Legend

- **Green** — provider policy and availability modules.
- **Orange** — provider-specific detection behind the unchanged invocation interface.
- The ladder walk happens inside one step attempt; downgrades never consume the
  step's `max_retries` budget.
- An explicit `model_fallback_ladder` remains an opaque provider-native override.
  Without it, Claude defaults to `fable → opus → sonnet` and Codex defaults to
  `gpt-5.6-sol → gpt-5.6-terra → gpt-5.6-luna`.
- Cache lifetime remains per process; restart clears it.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-03 | Initial generation | DECIDE phase for intake #186 |
| 2026-07-23 | Made the default ladder provider-native | DECIDE architecture for issue #902 |
