# Components + Sequence: Provider Model Policy Registry

**Last updated:** 2026-07-23
**Scope:** Provider-native step defaults, effort ordering, retry escalation,
model-unavailability fallback, and generated documentation for the built-in
Claude and Codex providers (issue #902).

## Component Diagram

```mermaid
graph LR
    subgraph composition ["Composition roots"]
        IC["index.ts<br/>inline provider selection"]
        DC["daemon-cli.ts<br/>daemon provider selection"]
    end

    subgraph plugins ["Provider plugin registry"]
        PD["await external plugin discovery<br/>before built-ins / freeze / selection"]
        PK["selected llm_provider key"]
        PI["LLMProvider instance<br/>interface unchanged"]
    end

    subgraph policy ["engine/provider-model-policy.ts"]
        PR["policy lookup<br/>built-in policies + compatibility"]
        CP["Claude policy<br/>explicit per-step table<br/>models unchanged<br/>explore / prd effort high"]
        XP["Codex policy<br/>explicit per-step table<br/>Luna / Terra / Sol"]
        LC["legacy compatibility<br/>unknown key uses Claude policy<br/>warning once"]
    end

    subgraph orchestration ["Policy-threaded orchestration"]
        CT["Conductor<br/>linear loop and retry context"]
        GR["resolveGroupMembership<br/>grouped-step resolution"]
        SR["DefaultStepRunner<br/>normal plus auxiliary dispatches"]
        AT["attribution lane<br/>fresh verifier dispatch"]
        AUX["daemon auxiliary paths<br/>setup-fix / rebase / CI-fix"]
    end

    subgraph engine ["Resolution and invocation primitives"]
        RC["resolveStepConfig<br/>user overrides then policy defaults"]
        ES["escalateAttempt<br/>policy effort and model order"]
        MA["ModelAvailability<br/>explicit config ladder or policy default"]
    end

    subgraph docs ["Generated documentation"]
        GM["generate-model-table.ts"]
        HM["HARNESS.md<br/>provider-labelled values"]
    end

    IC --> PD
    DC --> PD
    PD --> PK
    PD --> PI
    IC --> PI
    DC --> PI
    PK --> PR
    PR --> CP
    PR --> XP
    PR -.-> LC
    PR -->|one selected policy| IC
    PR -->|one selected policy| DC
    IC --> CT
    IC --> SR
    DC --> CT
    DC --> SR
    DC --> AUX
    AUX --> SR
    CT --> GR
    CT --> RC
    GR --> RC
    CT --> ES
    CT -->|attempt overrides| SR
    SR --> RC
    SR --> AT
    AT --> RC
    SR --> MA
    AT --> MA
    CP --> RC
    XP --> RC
    CP --> ES
    XP --> ES
    CP --> MA
    XP --> MA
    ES --> SR
    MA --> PI
    CP --> GM
    XP --> GM
    GM --> HM

    style PR fill:#e8f5e9,stroke:#2e7d32
    style XP fill:#e8f5e9,stroke:#2e7d32
    style LC fill:#fff3e0,stroke:#ef6c00
```

## Sequence: Resolve and invoke a Codex step

```mermaid
sequenceDiagram
    participant Root as index or daemon-cli
    participant Registry as Provider policy registry
    participant Conductor as Conductor
    participant Runner as DefaultStepRunner
    participant Resolver as resolveStepConfig
    participant Escalator as escalateAttempt
    participant Availability as ModelAvailability
    participant Codex as CodexProvider

    Root->>Registry: resolve policy for key codex
    Registry-->>Root: Codex policy
    Root->>Conductor: create with Codex policy
    Root->>Runner: create with provider instance plus Codex policy
    Conductor->>Resolver: step, phase, tier, config, Codex policy
    Resolver-->>Conductor: Codex base model, effort, retries
    Conductor->>Escalator: base config, attempt, Codex policy orders
    Escalator-->>Conductor: attempt model and effort
    Conductor->>Runner: run step with attempt overrides
    Runner->>Resolver: step, phase, tier, config, policy
    Resolver->>Resolver: apply explicit provider-native overrides first
    Resolver-->>Runner: Codex base config
    Runner->>Runner: overlay conductor attempt model and effort
    Runner->>Availability: invoke with explicit ladder or policy default
    Availability->>Codex: invoke with Codex-native model and effort
    Codex-->>Availability: success or modelUnavailable
    Availability-->>Runner: result after provider-native ladder walk
```

## Policy Shape

Each built-in policy owns:

- An explicit `Record<StepName, model>` and `Record<StepName, effort>`.
- Provider-native complexity-tier overrides.
- Its effort escalation order and model escalation order.
- Its default model-unavailability fallback ladder.

The initial Codex assignments mirror the existing per-step intent while remaining
an independent table:

- `gpt-5.6-luna`: `memory`, `worktree`, `finish`.
- `gpt-5.6-terra`: the current standard Sonnet-class steps.
- `gpt-5.6-sol`: the current Opus/Fable-class deep-reasoning and review steps.
- Complexity overrides can promote a specific Codex step to Sol without referring
  to a Claude alias.
- Both built-in policies use `high` for normal M/L `explore` and for `prd`;
  the explicit `explore.S` override remains `low`.

## Legend

- **Green** — the new built-in policy boundary and Codex policy.
- **Orange** — compatibility handling for plugin provider keys that do not yet
  have a policy contract.
- Solid arrows are production data/control flow.
- The selected provider key and policy travel separately from `LLMProvider`; no
  identity member is added to the plugin interface.
- Explicit user model, effort, and fallback-ladder overrides remain opaque,
  provider-native values and keep their existing precedence.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-24 | Added awaited plugin discovery before provider selection and compatibility-policy lookup | As-built verification after issue #902 Task 20 |
| 2026-07-23 | Added conductor/group/attribution and daemon auxiliary wiring; corrected escalation ownership | Plan-update pass for issue #902 |
| 2026-07-23 | Raised normal explore/PRD effort to high; retained explore.S low | Operator-approved effort amendment for issue #902 |
| 2026-07-23 | Initial generation | DECIDE architecture for issue #902 |
