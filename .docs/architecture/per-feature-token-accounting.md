# Architecture: Per-feature token accounting

Component/data-flow view (C4 component level) of Approach A. Solid arrows = data flow added or
newly-wired by this feature; dashed arrows = existing paths kept fed for the deferred OTel (C) work.

## Capture → attribute → persist → report

```mermaid
flowchart TD
    subgraph dispatch["Build dispatch (per feature, in its own worktree)"]
        CP["claude-provider.ts invoke()<br/>claude --print --output-format stream-json*<br/>(*change from text; prompt still on stdin)"]
        PU["parseTokenUsage()<br/>→ InvokeResult.tokenUsage: TokenUsage"]
        SR["step-runners.ts runAutonomous()<br/>NOW forwards result.tokenUsage"]
        CD["conductor.ts step_completed emit<br/>NOW includes tokenUsage + model"]
        CP --> PU --> SR --> CD
    end

    subgraph worktree[".pipeline/ (per-worktree = per-feature)"]
        EV["events.jsonl<br/>step_completed{ tokenUsage, model }"]
        DC[".pipeline/dispatch-count / task-evidence<br/>(existing retry/dispatch signals)"]
    end
    CD --> EV

    subgraph ship["SHIP phase"]
        ROLL["cost-rollup aggregator<br/>sum tokenUsage + dispatch/retry/halt counts<br/>+ unmetered{count,duration}"]
        SHIPREC[".docs/shipped/&lt;slug&gt;.md<br/>+ Cost: block (committed, per-feature)"]
        EV --> ROLL
        DC --> ROLL
        ROLL --> SHIPREC
    end

    subgraph report["Read surfaces (read-only)"]
        KPI["conduct kpi<br/>trend across .docs/shipped/*.md"]
        RETRO["retro step<br/>reads real ledger (was: estimate)"]
        REP["conduct --report Token Spend table<br/>(report-renderer aggregateTokens)"]
        DASH["daemon dashboard column"]
    end
    SHIPREC --> KPI
    SHIPREC --> RETRO
    EV --> REP
    SHIPREC --> DASH

    subgraph otel["OTel path (kept fed; consumed fully by deferred C)"]
        OT["otel metrics conductor.step.tokens<br/>recordTokens()"]
    end
    CD -.tokenUsage.-> OT
```

## Key structural decisions (detailed in architecture-review / ADRs)

1. **Per-feature attribution comes from the worktree, not an event slug.** `.pipeline/events.jsonl`
   is per-worktree; each feature builds in its own worktree, so no feature dimension needs to be
   added to the shared event bus. The rollup reads the worktree-local ledger at ship.

2. **The committed rollup lives in `.docs/shipped/<slug>.md`.** It is the canonical per-slug
   shipped record, already committed at ship and merged atomically — so the KPI trend is computable
   by reading committed files, with no new database or daemon-shared store.

3. **"Unmetered" is a first-class field, never an omission.** Sessions the engine cannot meter
   (human operator sessions; any dispatch whose usage parse fails) increment an explicit
   `unmetered{count,duration}` so a partial total is visibly partial.

4. **The emit carries tokenUsage AND model** so the same event feeds both the ship rollup and the
   existing OTel counter — the deferred OTel (C) work becomes a consumer swap, not a re-wire.
