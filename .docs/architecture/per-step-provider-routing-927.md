# Components + Sequence: Provider-Aware Step Execution

**Last updated:** 2026-07-24
**Scope:** Planned provider registration, per-step selection, provider-native
runtime state, ordered fallback, step/provider sessions, and attributed results
for issue #927.

## Component Diagram

```mermaid
graph LR
    Operator["Harness operator"]

    subgraph roots ["Composition roots"]
        Inline["Interactive entry point"]
        Daemon["Daemon entry point<br/>runtime set per feature"]
    end

    subgraph registration ["Provider registration"]
        Discovery["External provider discovery"]
        Builtins["Built-in Claude and Codex registration"]
        Registry["Frozen plugin registry<br/>all registered providers"]
    end

    subgraph routing ["Provider routing abstractions"]
        Selection["Provider selection<br/>normalize, validate, candidate order"]
        Execution["Provider execution<br/>candidate loop and classification"]
        Sessions["Provider session store<br/>fresh per step and provider"]
    end

    subgraph runtime ["Per-run provider runtimes"]
        RuntimeSet["Provider runtime set"]
        ClaudeRuntime["Claude runtime<br/>provider, policy, model cache"]
        CodexRuntime["Codex runtime<br/>provider, policy, model cache"]
        CustomRuntime["Custom runtime<br/>legacy compatibility"]
    end

    subgraph orchestration ["Conductor orchestration"]
        Conductor["Conductor<br/>step loop and preferred-policy escalation"]
        Runner["DefaultStepRunner"]
        Resolver["Split step resolver<br/>neutral and provider-native settings"]
        Auxiliary["Auxiliary paths<br/>prelude, judgment, recovery, narrative"]
        Events["Warnings, events, reports<br/>preferred and actual provider"]
    end

    Operator --> Inline
    Operator --> Daemon
    Discovery --> Registry
    Builtins --> Registry
    Inline --> Selection
    Daemon --> Selection
    Registry --> Selection
    Registry --> RuntimeSet
    Inline --> RuntimeSet
    Daemon --> RuntimeSet
    RuntimeSet --> ClaudeRuntime
    RuntimeSet --> CodexRuntime
    RuntimeSet --> CustomRuntime
    Inline --> Conductor
    Daemon --> Conductor
    Conductor --> Selection
    Conductor --> Resolver
    Conductor --> Runner
    Runner --> Execution
    Auxiliary --> Execution
    Selection --> Execution
    Resolver --> Execution
    Sessions --> Execution
    Execution --> RuntimeSet
    Execution --> Events
    Conductor --> Events

    style Registry fill:#e8f5e9,stroke:#2e7d32
    style Selection fill:#e3f2fd,stroke:#1565c0
    style Execution fill:#e3f2fd,stroke:#1565c0
    style Sessions fill:#e3f2fd,stroke:#1565c0
    style RuntimeSet fill:#f3e5f5,stroke:#6a1b9a
```

## Sequence: Explicit Provider, Model Exhaustion, and Fallback

```mermaid
sequenceDiagram
    participant Root as Interactive or daemon root
    participant Registry as Frozen plugin registry
    participant Selection as Provider selection
    participant Conductor as Conductor
    participant Sessions as Provider session store
    participant Execution as Provider execution
    participant Resolver as Split step resolver
    participant Codex as Codex runtime
    participant Claude as Claude runtime
    participant Events as Events and usage

    Root->>Registry: discover and register all providers
    Root->>Selection: validate configured order and step names
    Root->>Conductor: construct with per-run runtime set

    Conductor->>Sessions: begin judgment step
    Note over Sessions: discard every prior-step provider session
    Conductor->>Selection: candidates for explicit Codex step
    Selection-->>Conductor: Codex then configured remainder
    Conductor->>Execution: execute judgment attempt

    Execution->>Resolver: resolve Codex primary settings
    Resolver-->>Execution: Codex model, effort, ladder
    Execution->>Sessions: create Codex session for this step
    Execution->>Codex: invoke native model ladder
    Codex-->>Execution: all Codex models unavailable

    Execution->>Events: warn step, Codex, reason, next Claude
    Execution->>Resolver: resolve Claude fallback defaults
    Resolver-->>Execution: Claude native model, effort, ladder
    Execution->>Sessions: create Claude session for this step
    Execution->>Claude: invoke with Claude native defaults
    Claude-->>Execution: success and Claude usage
    Execution->>Events: record preferred Codex and actual Claude
    Execution-->>Conductor: successful attributed result

    Conductor->>Sessions: begin next build step
    Note over Sessions: discard judgment sessions
    Conductor->>Selection: candidates for unspecified build
    Selection-->>Conductor: inherited first provider
```

## Sequence: Failure Classification Boundary

```mermaid
sequenceDiagram
    participant Runner as Step runner
    participant Execution as Provider execution
    participant Preferred as Preferred runtime
    participant Recovery as Existing recovery flow
    participant Fallback as Next configured runtime

    Runner->>Execution: invoke current step attempt
    Execution->>Preferred: invoke provider
    Preferred-->>Execution: classified result

    alt Provider missing or native ladder exhausted
        Execution->>Fallback: invoke with fallback native defaults
    else Authentication, rate limit, session expiry, timeout, rejection, or ordinary failure
        Execution-->>Recovery: return unchanged classification
        Note over Execution,Fallback: candidate list does not advance
    end
```

## Planned Invariants

- The run-level scalar or ordered provider selection is normalized once; the
  first entry is inherited only when a step has no explicit provider.
- A step's explicit provider is attempted first, followed by the remaining
  run-level providers in declared order without duplicates.
- Provider-neutral settings are resolved separately from provider-native model,
  effort, escalation, and fallback-ladder settings.
- Each runtime owns its provider instance, native policy, model-availability
  cache, and deterministic run-wide-unavailability state.
- Sessions are fresh at every step boundary and isolated by provider. Only a
  retry within the same step and provider may resume.
- Authentication, rate limits, session expiry, timeouts, rejected work, and
  ordinary failures never advance the provider candidate list.
- Normal, grouped, prelude, judgment, attribution, recovery, narrative,
  interactive, and daemon paths use the same execution boundary.
- Warnings, events, usage, and reports distinguish preferred from actual
  provider.

## Diagram Impact Boundary

Issue #927 changes internal conductor components and invocation sequences. It
adds no database, datastore relationship, independently deployable container,
external user type, or new external provider integration. System-context,
container, and ERD diagrams therefore require no update.

## Legend

- **Green** marks the frozen registry containing every available integration.
- **Blue** marks the new provider-routing abstractions.
- **Purple** marks per-run provider-native runtime state.
- Solid arrows show runtime calls or construction dependencies.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-24 | Initial current-state diagram | DECIDE architecture input for issue #927 |
| 2026-07-24 | Replaced run-global flow with planned provider-aware components and sequences | Plan update for issue #927 |
