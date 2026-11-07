# Architecture: One daemon feature lifecycle, run only in the child executor (#3333)

**Last updated:** 2026-11-07
**Scope:** How the daemon runs one dispatched feature. There is one feature lifecycle, held in
`engine/daemon-feature-lifecycle.ts`, and one place it runs: the per-dispatch engine-pinned child
executor. Slice 1 moves the lifecycle that `runConductorInWorktree` holds in `daemon-cli.ts` into
that module and makes the child run it. Slice 2 removes the in-process executor and the
`executor_isolation` key. The only composition seam is the child executor's process `fork`, which
tests replace with an in-memory fork that runs the real `executor-child` runtime. Builds on
[per-dispatch engine pinning](engine-updates-reach-dispatched-features-only-afte.md).

## Components (L3), after slice 2

```mermaid
graph TD
    subgraph CLI["daemon-cli.ts composition (entry layer)"]
        Config["engine/config.ts loadMergedConfig<br/>known top-level keys (no executor key)"]
        WOB["createWorkOrder<br/>baseSha + enginePin + tier/track/sourceRef"]
        Child["createChildProcessFeatureExecutor<br/>(the only FeatureExecutor)"]
        Broker["createExecutorBroker<br/>rate limit, provider availability,<br/>live boundary, worktree lock"]
        Seam["opts.executorFork (optional)<br/>defaults to node fork"]
        Tele["dispatch + OTel telemetry<br/>kind and tier before fork,<br/>haltClass and step from outcome"]
    end

    subgraph Core["engine/daemon.ts runDaemon"]
        Claim["Claim loop"]
        FE["featureExecution<br/>createWorkOrder + executor"]
        Effects["Terminal effects<br/>after claim release"]
    end

    subgraph Proc["Executor child, forked per dispatch (engine layer)"]
        Entry["executor-child.ts runExecutorChild<br/>+ withExecutorBrokerProxies"]
        Runtime["executor-child-runtime.ts<br/>createExecutorChildRuntime:<br/>admitDispatch + createWorktree + run"]
        Deps["daemon-deps.ts makeFeatureRunnerDeps<br/>prepare, timeouts, memory setup, teardown,<br/>escalation, quarantine, setup triage"]
        Life["daemon-feature-lifecycle.ts<br/>runDaemonFeatureConductor:<br/>seed, StepRunner, AuditTrailWriter, Conductor,<br/>park check, stack preflight, REKICK rebase-first,<br/>conductor.run, Closes link"]
        Runner["daemon-runner.ts makeRunFeature<br/>(deferTerminalEffects)"]
    end

    TestFork["Test in-memory ForkedExecutor<br/>runs runExecutorChild over an in-memory IPC port<br/>with the same createExecutorChildRuntime"]

    Config --> CLI
    Claim --> FE
    FE --> WOB
    FE --> Child
    Child --> Seam
    Child --> Tele
    Seam -->|"production: node fork dist-versions/«id»"| Entry
    Seam -.->|"tests: injected"| TestFork
    TestFork --> Entry
    Entry <-->|"IPC"| Broker
    Entry --> Runtime
    Runtime --> Runner
    Runtime --> Deps
    Runner --> Deps
    Deps --> Life
    Child -->|"FeatureExecutionOutcome"| Effects
```

## Sequence: one dispatch inside the child

```mermaid
sequenceDiagram
    participant CE as child executor (supervisor)
    participant EC as executor-child runtime
    participant RF as makeRunFeature
    participant LC as runDaemonFeatureConductor
    participant BR as executor broker

    CE->>CE: classify dispatch kind and tier from root state
    CE->>EC: fork, hello, WorkOrder
    EC->>EC: admitDispatch (lease for stacked children)
    EC->>EC: loadMergedConfig, providers, managed-session context
    EC->>RF: run order with makeFeatureRunnerDeps lifecycle
    RF->>RF: prepareWorktree (memory setup, timeouts) or setup triage
    RF->>LC: runConductor(worktree, item)
    LC->>LC: seed state, AuditTrailWriter, Conductor
    LC->>LC: operator-park check (REKICK preserved)
    LC->>LC: stack preflight, then resumeRebaseFirst on REKICK
    LC->>BR: rate limit, availability, live boundary via proxies
    LC->>LC: conductor.run, then Closes «sourceRef» on the PR
    RF-->>EC: outcome + deferred terminal effects
    EC-->>CE: outcome (haltClass, step)
    CE->>CE: feature_dispatch_ended, release claim, apply effects
```

## Legend

- **One lifecycle.** `engine/daemon-feature-lifecycle.ts` holds the body of today's
  `runConductorInWorktree` and the helpers it needs from `daemon-cli.ts`. Supervisor-owned services
  reach it through an explicit context: in the child they are broker proxies. Slice 1 makes both
  adapters call it, and slice 2 deletes the in-process adapter.
- **Layering.** The lifecycle and the child runtime are engine-layer modules. Helpers they need
  that live in `daemon-cli.ts` today, such as `createWorkOrderGitRunner` and the managed-session
  context preparation, move into engine modules, so no engine module imports the entry layer.
- **One executor.** After slice 2, `daemon-cli.ts` builds exactly one `FeatureExecutor`, the
  child-process executor, and always passes `featureExecution` to `runDaemon`. No config value
  selects another execution path.
- **Config.** After slice 2, the top-level key set has no executor-selection key. A config that
  names one fails validation with the generic unknown-top-level-key error.
- **Fork seam.** The `fork` dependency of `createChildProcessFeatureExecutor`, surfaced as an
  optional daemon-cli option, is the only test boundary for feature execution. The test fork gives
  each in-memory child its own console sink, because one test process cannot hold two
  process-global console tees.
- **Telemetry.** The supervisor still owns `feature_dispatch_started` and `feature_dispatch_ended`
  (adr-2026-10-15 D4). It fills them from root state before the fork and from the outcome after it.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-24 | Initial generation | #3333: one feature-execution path; the fork seam replaces the runFeature test bypass |
| 2026-10-24 | Plan update: the child runtime composition becomes one factory shared by the `executor-child` entry and the test fork | #3333 plan Task 1 |
| 2026-11-07 | The daemon feature lifecycle moves into an engine module run by the child; two-slice delivery | #3333 scope expanded to parity by operator decision |
