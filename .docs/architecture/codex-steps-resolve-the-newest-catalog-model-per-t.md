# Components + Sequence: Codex Tier Model Resolution

**Last updated:** 2026-10-25
**Scope:** How the built-in Codex model policy's pinned ids become per-tier floors that each
provider-dispatching process upgrades, once, to the newest model of the same tier listed by the
Codex CLI's own catalog (`codex debug models`). Also covers the Claude self-host token-liveness
probe moving to the `haiku` alias.

## Component Diagram

```mermaid
graph LR
    subgraph boot ["Provider-dispatching boot paths"]
        IC["index.ts<br/>inline run boot"]
        DC["daemon-cli.ts<br/>daemon boot"]
        EX["executor-child-runtime.ts<br/>per-feature executor boot"]
    end

    subgraph catalog ["execution/provider-catalog.ts"]
        CD["Codex descriptor<br/>tier catalog: debug models + JSON parse<br/>(separate from modelCatalog)"]
    end

    subgraph tiers ["Codex tier resolution"]
        TP["tier catalog probe<br/>once per process, 5 s timeout"]
        TR["tier resolver<br/>floor gpt-«ver»-«tier» to newest listed,<br/>API-supported, same tier, higher version"]
    end

    subgraph policy ["engine/provider-model-policy*.ts"]
        XP["Codex policy<br/>floor ids gpt-5.6-luna / terra / sol,<br/>escalation adds gpt-6-astra on top"]
        MAT["process policy registry<br/>materialized Codex policy, frozen"]
    end

    subgraph consumers ["Dispatch consumers (unchanged contracts)"]
        RC["resolveStepConfig"]
        ES["escalateAttempt"]
        MA["ModelAvailability ladder"]
        CO["cost attribution"]
    end

    subgraph floorusers ["Non-dispatching readers keep floors"]
        MON["monitor guided-session defaults"]
        GM["generate-model-table / HARNESS.md"]
        RCR["rate-card refresh ids"]
    end

    LOG["daemon.log warning<br/>probe failed / resolved id unpriced"]
    EV["existing dispatch, retry and cost events<br/>model field = resolved id"]
    TL["self-host token-liveness<br/>--model haiku"]

    IC --> TP
    DC --> TP
    EX --> TP
    TP --> CD
    TP -->|listing or failure| TR
    XP -->|floor ids| TR
    TR -->|floor to resolved id map| MAT
    MAT --> RC
    MAT --> ES
    MAT --> MA
    MAT --> CO
    XP --> MON
    XP --> GM
    XP --> RCR
    TR -.->|probe failed| LOG
    MAT -.->|resolved id missing from rate card| LOG
    RC --> EV
    CO --> EV

    style TP fill:#e8f5e9,stroke:#2e7d32
    style TR fill:#e8f5e9,stroke:#2e7d32
    style MAT fill:#e8f5e9,stroke:#2e7d32
    style CD fill:#e8f5e9,stroke:#2e7d32
    style floorusers fill:#fff3e0,stroke:#ef6c00
    style TL fill:#e3f2fd,stroke:#1565c0
```

## Sequence: Dispatching boot upgrades Codex floors

```mermaid
sequenceDiagram
    participant BT as dispatching boot
    participant TP as tier catalog probe
    participant CLI as codex CLI
    participant TR as tier resolver
    participant PR as process policy registry
    participant SR as step runner

    BT->>TP: after provider discovery finds Codex installed
    TP->>CLI: codex debug models
    alt listing parses
        CLI-->>TP: gpt-6.1-sol, gpt-6-astra, gpt-6-sol, gpt-6-luna, gpt-5.6-*
        TP->>TR: listed and API-supported slugs
        TR->>TR: per floor pick the highest same-tier version above it
        Note over TR: gpt-5.6-sol to gpt-6.1-sol, gpt-5.6-luna to gpt-6-luna,<br/>gpt-5.6-terra stays, gpt-6-astra stays
    else timeout, non-zero exit, or unparseable
        CLI-->>TP: failure
        TP-->>BT: warn - Codex tier catalog unavailable, floor ids in use
    end
    TR->>PR: install materialized Codex policy
    PR->>PR: warn once per resolved id absent from the rate card
    BT->>SR: dispatch with the registry policy
    SR->>CLI: codex exec --model gpt-6.1-sol
    Note over SR: dispatch and cost events carry the resolved id
```

## Legend

- **Green** — new resolution machinery.
- **Orange** — readers that never probe (adr-2026-09-24 D8 non-dispatching paths, and monitor
  launch, which is out of scope) keep the floor ids, today's behavior.
- **Blue** — the Claude token-liveness probe moves from `claude-haiku-4-5-20251001` to the
  version-free `haiku` alias the Claude CLI resolves itself.
- A policy id is a floor only when it parses as `gpt-«version»-«tier»`; anything else stays
  opaque. A floor is replaced only by a strictly newer version of the same tier, so terra stays
  `gpt-5.6-terra` until a newer terra is listed, and no tier is ever substituted for another.
- Resolution is per process, like the `ModelAvailability` dead-model cache; a restart re-probes.
  No file, sidecar, or new event type is added: the resolved id travels in the model fields that
  existing dispatch, retry, and cost events already carry.
- Operator-configured provider-native ids (`llm_providers.codex.*`, step `model`, explicit
  ladders) stay opaque and keep their existing precedence over policy defaults.
- The reactive fallback ladder walks resolved ids, so `sol to terra to luna` degrades from the
  newest sol.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-25 | Initial generation | DECIDE architecture for Codex tier model resolution |
