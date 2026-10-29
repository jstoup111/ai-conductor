# Architecture: Single daemon feature executor (#3333)

**Last updated:** 2026-10-24
**Scope:** How `daemon-cli.ts` composes feature execution for every dispatch. There is one path:
work order → per-dispatch engine-pinned child executor → executor broker → terminal effects. The
only composition seam is the child executor's process `fork`, which tests replace with an in-memory
fork that runs the real `executor-child` runtime. Builds on
[per-dispatch engine pinning](engine-updates-reach-dispatched-features-only-afte.md).

## Components (L3)

```mermaid
graph TD
    subgraph CLI["daemon-cli.ts composition"]
        Config["engine/config.ts validateConfig<br/>known top-level keys (no executor key)"]
        WOB["createWorkOrder<br/>baseSha + enginePin + tier/track"]
        Child["createChildProcessFeatureExecutor<br/>(the only FeatureExecutor)"]
        Broker["createExecutorBroker"]
        Seam["opts.fork (optional)<br/>defaults to node fork"]
    end

    subgraph Core["engine/daemon.ts runDaemon"]
        Claim["Claim loop"]
        FE["featureExecution<br/>createWorkOrder + executor (always present)"]
        Effects["Terminal effects<br/>after claim release"]
    end

    subgraph Proc["Executor child — forked per dispatch"]
        Entry["executor-child.ts runExecutorChild"]
        Runtime["executor-child-runtime.ts<br/>createExecutorChildRuntime: createWorktree + run<br/>makeRunFeature (deferTerminalEffects)"]
    end

    TestFork["Test in-memory ForkedExecutor<br/>runs runExecutorChild over an in-memory IPC port<br/>with the same createExecutorChildRuntime"]

    Config --> CLI
    Claim --> FE
    FE --> WOB
    FE --> Child
    Child --> Seam
    Seam -->|"production: node fork dist-versions/«id»"| Entry
    Seam -.->|"tests: injected"| TestFork
    TestFork --> Entry
    Entry <-->|"IPC"| Broker
    Entry --> Runtime
    Child -->|"FeatureExecutionOutcome"| Effects
```

## Sequence: one dispatch (production and test share every step but the fork)

```mermaid
sequenceDiagram
    participant Disp as runDaemon claim loop
    participant WO as createWorkOrder
    participant CE as child executor
    participant F as fork seam
    participant EC as executor-child runtime
    participant BR as executor broker

    Disp->>WO: build WorkOrder for «slug»
    Disp->>CE: execute(order)
    CE->>F: fork(engine entry, executor-child)
    Note over F: production forks dist-versions/«id», tests return an in-memory ForkedExecutor
    F-->>CE: ForkedExecutor
    CE->>BR: attach(child)
    EC->>BR: hello, then receive WorkOrder
    EC->>EC: makeRunFeature over the order
    EC-->>CE: outcome + deferred terminal effects
    CE-->>Disp: FeatureExecutionOutcome
    Disp->>Disp: release claim, apply terminal effects
```

## Legend

- **One executor.** `daemon-cli.ts` builds exactly one `FeatureExecutor`, the child-process
  executor, and always passes `featureExecution` to `runDaemon`. No config value selects another
  execution path. The supervisor always wires `stopAll` and the broker abort into shutdown.
- **Config.** The top-level key set has no executor-selection key. A config that names one fails
  validation with the generic unknown-top-level-key error, like any other unknown key.
- **Fork seam.** The `fork` dependency of `createChildProcessFeatureExecutor`, surfaced as an
  optional daemon-cli option, is the only test boundary for feature execution. It replaces the
  former `opts.runFeature` bypass, so composition, integration, and acceptance tests run the
  production work-order, broker, and terminal-effect path. Only the OS process creation differs.
  The `executor-child` entry point and the test fork build the child's `createWorktree` and `run`
  from one factory, `createExecutorChildRuntime`, so the child composition is identical.
- **Unchanged.** The child's IPC protocol, broker services, engine pinning, executor records, and
  GC protection behave as in the per-dispatch engine pinning architecture.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-24 | Initial generation | #3333: one feature-execution path; the fork seam replaces the runFeature test bypass |
| 2026-10-24 | Plan update: the child runtime composition becomes one factory shared by the `executor-child` entry and the test fork | #3333 plan Task 1 |
