# Components: Monitor guided sessions — choose provider, model, and effort

**Last updated:** 2026-10-06
**Scope:** Proposed change for jstoup111/ai-conductor#2985; Medium tier. Adds guided-session
provider/model/effort selection to the existing foreground monitor command, and collapses the
monitor's private interactive launch table into the provider catalog's existing interactive-launch
descriptor, which compose/engineer already use. No new service, process, persistence, or spine
channel. Build provider/model/effort resolution is untouched.

## Diagram — components

```mermaid
graph TD
    Operator[Operator] --> MonitorCmd[Monitor command: conduct monitor]
    Operator -.->|per-run overrides| MonitorCmd

    subgraph Config[Existing merged project config]
        BuildSel[Build provider selection, unchanged]
        TriageCfg[NEW guided-session block: provider, model, effort]
        ConfigValidate[Config-load validation: provider known, effort in harness vocabulary]
    end

    MonitorCmd --> Resolver[NEW guided-session resolver, pure]
    TriageCfg --> ConfigValidate
    ConfigValidate --> Resolver
    BuildSel -->|fallback when no triage provider| Resolver

    subgraph Catalog[Existing provider catalog]
        Descriptor[Built-in provider descriptor]
        Policy[Per-provider model policy: explore-step model and effort = stated default]
        Launch[interactiveLaunch descriptor EXTENDED: argv for prompt, model, effort; env overlay; accepted efforts]
        ModelCat[Optional authoritative model catalog, Pi only today]
    end

    Resolver -->|provider known?| Descriptor
    Resolver -->|defaults when unset| Policy
    Resolver -->|effort accepted? capability present?| Launch
    Resolver -->|model in catalog, when one exists| ModelCat

    Resolver -->|refusal: value + provider named, exit non-zero, queue untouched| MonitorCmd
    Resolver -->|resolved selection + source of each value| LaunchOut[Launch output: provider, model, effort, source]
    LaunchOut --> Session[Guided session module]
    Session --> Seam[Interactive launch seam: builds invocation FROM catalog descriptor]
    Launch --> Seam
    Seam --> Proc[Operator-owned provider CLI process, inherited stdio]

    Retired[RETIRED: monitor-private launch table] -.-x Seam

    Composer[Existing compose / engineer interactive launcher] --> Launch
```

## Diagram — guided launch sequence

```mermaid
sequenceDiagram
    participant Op as Operator
    participant Mon as Monitor command
    participant Res as Guided-session resolver
    participant Cat as Provider catalog
    participant Ses as Guided session
    participant Seam as Interactive launch seam
    participant CLI as Provider CLI

    Op->>Mon: run monitor (optional per-run provider / model / effort)
    Mon->>Res: config block + build provider selection + overrides
    Res->>Cat: descriptor for resolved provider
    alt not built-in
        Res-->>Mon: refuse, naming provider
    else no interactiveLaunch capability (Pi)
        Res-->>Mon: refuse, naming provider and missing capability
    else
        Res->>Cat: stated default model / effort when unset
        Res->>Cat: accepted efforts, model catalog if any
        alt effort not accepted or model malformed / not in catalog
            Res-->>Mon: refuse, naming value and provider
        else valid
            Res-->>Mon: selection + source of each value
        end
    end
    Mon->>Op: print provider, model, effort, and source
    Mon->>Ses: open session for queue head with selection
    Ses->>Seam: launch request: provider, prompt, model, effort, cwd
    Seam->>Cat: interactiveLaunch argv + env overlay
    Seam->>CLI: spawn, inherited stdio
    CLI-->>Ses: exit code
    Ses-->>Mon: return to queue
```

## Legend

- **NEW**: introduced by this change. **EXTENDED**: an existing element that gains fields.
  **RETIRED**: removed by this change.
- The resolver applies the precedence per-run override > guided-session config > build provider
  selection + harness-stated default. A per-run provider override without model/effort overrides
  resets model and effort to that provider's defaults (PRD FR-6).
- Every refusal happens before any process is spawned, and leaves the monitor queue and halt state
  unchanged.
- The interactive launch seam continues to bypass the non-interactive build adapters, so a guided
  session never carries the daemon-session marker.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-06 | Initial generation | DECIDE for #2985 (approach B: catalog-owned interactive model/effort) |
| 2026-10-06 | Plan update: resolver is `engine/monitor/selection.ts`; config block is top-level `monitor`; seam lives in `execution/interactive-launch.ts` | Plan monitor-guided-sessions-no-way-to-choose-provider- |
