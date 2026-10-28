# Components: System-prompt delivery across providers (#3309)

**Last updated:** 2026-10-24
**Scope:** Proposed delivery of `InvokeOptions.systemPrompt` to the Pi adapter, a declared
per-provider system-prompt delivery capability, and the guard that refuses a provider which does
not declare it. Claude and Codex delivery mechanisms are unchanged.

Every production `LLMProvider` instance, built-in or plugin, is obtained through one lookup:
`registry.get<LLMProvider>('llm_provider', key)` in `createProviderRuntimeSet`
(`provider-runtime.ts:109`). The roughly ten engine call sites that call `provider.invoke`
directly receive that resolved instance. The guard therefore wraps the provider at resolution, so
every invoke path inherits it without editing each call site.

The capability follows the existing per-instance declaration pattern (`lifecycleCapability`,
`nativeSchemaCapability` on `LLMProvider`), which a plugin module can also declare. Plugin
manifest `capabilities` are not retained by `PluginRegistry`, so the declaration lives on the
provider object, not in `plugin.yml`.

## Diagram

```mermaid
graph TD
    subgraph Engine["Engine - callers that build a system prompt"]
        SR["step-runners buildSystemPrompt - every step dispatch, RETRY, remediate judge"]
        AL["attribution-lane verifier"]
        PE["provider-execution candidate ladder"]
        PP["project-prelude"]
    end

    subgraph Resolution["Provider resolution - single lookup"]
        REG["PluginRegistry llm_provider"]
        RTS["createProviderRuntimeSet"]
        GUARD["System-prompt delivery guard - new, wraps each resolved provider"]
        TEL["skippedCandidateSetupUnavailable - classifies refusal as system-prompt-delivery, no availability write"]
    end

    subgraph Providers["Provider adapters"]
        CL["ClaudeProvider - declares delivery, temp file + --append-system-prompt-file, unchanged"]
        CX["CodexProvider - declares delivery, stdin prepend, unchanged"]
        PI["PiProvider - declares delivery, new temp file + second --append-system-prompt"]
        PL["Plugin llm_provider - must declare, else refused"]
    end

    subgraph PiRun["Pi subprocess"]
        HF[("HARNESS.md")]
        SPF[("0600 system-prompt temp file")]
        PIC["pi -p --append-system-prompt HARNESS.md --append-system-prompt «file»"]
    end

    BUILTIN["registerBuiltInLlmProviders"] --> REG
    LOADER["plugin-loader"] --> REG
    REG --> RTS
    RTS --> GUARD
    GUARD --> CL
    GUARD --> CX
    GUARD --> PI
    GUARD -.->|"systemPrompt present and capability undeclared - named failure, not started"| PL
    GUARD -.->|"systemPromptUndeliverable result"| TEL

    SR --> GUARD
    AL --> GUARD
    PE --> GUARD
    PP --> GUARD

    PI -->|"write before spawn, verify readable regular file"| SPF
    PI --> PIC
    PIC --> HF
    PIC --> SPF
    PI -->|"dispose after run, success or failure"| SPF

    CONTRACT["Cross-provider contract test - new"] -.->|"every built-in declares delivery and delivers the text"| CL
    CONTRACT -.-> CX
    CONTRACT -.-> PI
```

## Sequence: Pi dispatch carrying a system prompt

```mermaid
sequenceDiagram
    participant E as Engine caller
    participant G as Delivery guard
    participant P as PiProvider
    participant F as Temp file
    participant C as pi CLI

    E->>G: invoke(prompt, systemPrompt)
    G->>G: systemPrompt present and provider declares delivery?
    alt capability undeclared
        G-->>E: named failure, providerInvocationSkipped, not started
    else declared
        G->>P: invoke(options)
        P->>F: write systemPrompt (mode 0600)
        P->>F: verify readable regular file
        alt file not readable
            P-->>E: named delivery failure, no spawn
        else readable
            P->>C: spawn with HARNESS.md and «file» appended, stdin = prompt
            C-->>P: JSONL result
            P->>F: dispose
            P-->>E: InvokeResult
        end
    end
```

## Legend

- **New** nodes: the delivery guard, Pi temp-file delivery, and the contract test.
- Dashed arrow from the guard: the refusal path for an undeclared provider.
- `«file»`: the per-invocation temp file path. It is passed as its own argv value, so prompt size
  never reaches the 128 KiB per-argument `E2BIG` limit.
- Pi joins repeated `--append-system-prompt` values with a blank line, in order, so HARNESS.md
  stays first and the engine prompt follows it. Stdin carries only the prompt, which keeps a
  leading `/skill` command recognized.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-24 | Initial generation | #3309: Pi drops `InvokeOptions.systemPrompt` silently |
| 2026-10-24 | Added refusal telemetry classification node | Plan update: Task 7 classifies the refusal in candidate telemetry |
