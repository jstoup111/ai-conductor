# Components: Tier-sized restack cascade allowance

**Last updated:** 2026-10-28
**Scope:** How the per-originating-child restack cascade allowance is resolved, enforced, recovered
and displayed, before and after sizing it by the feature's complexity tier (intake #3472). Builds
on #3475, where a restack limit belongs to the originating child in the `cascades` ref and the cap
evidence snapshots it.

## Diagram

### Before (one constant for every tier)

```mermaid
graph LR
    constant["cascade-cap.ts<br/>MAX_RESTACK_CASCADES_PER_CHILD = 3"]
    ref[("refs/conductor/«slug»/cascades<br/>counts[k], limits[k] (raises)")]
    exec["restack-executor.ts<br/>checkCascadeCap before the journal"]
    pre["stack-preflight.ts<br/>checkCascadeCap per repair child"]
    halt["cascade-cap halt<br/>originating child k reached n/3"]
    cli["kickback-budget-cli.ts<br/>raise/reset/inspect"]
    observe["daemon-observe-cli.ts<br/>(no cascade line)"]

    constant --> exec
    constant -- "result discarded" --> pre
    constant --> cli
    ref --> exec
    ref --> cli
    exec --> halt
```

### After (tier-sized, resolved at each use)

```mermaid
graph LR
    cfg[".ai-conductor/config.yml<br/>stacked_prs.max_restack_cascades:<br/>N or S/M/L map (unset stays absent)"]
    loader["config.ts loadConfig<br/>validates int or map"]
    state[("conduct-state.json<br/>complexity_tier")]
    defaults["tier default table<br/>S 3 · M 3 · L 8<br/>no tier → M"]
    allowance["restack/cascade-allowance.ts<br/>resolveRestackCascadeAllowance(config, tier)<br/>returns limit, tier, source"]
    ref2[("refs/conductor/«slug»/cascades<br/>counts[k], limits[k] (raises win)")]
    exec2["restack-executor.ts<br/>checkCascadeCap(defaultLimit)"]
    halt2["cascade-cap halt<br/>n/limit + tier, allowance, source"]
    cli2["kickback-budget-cli.ts<br/>raise/reset default + inspect cascades"]
    observe2["daemon-observe-cli.ts<br/>RESTACK CASCADES line"]

    cfg --> loader --> allowance
    defaults --> allowance
    state --> allowance
    allowance --> exec2
    allowance --> cli2
    allowance --> observe2
    ref2 -- "per-child raise overrides" --> exec2
    ref2 --> cli2
    ref2 --> observe2
    exec2 --> halt2
```

### Resolution at a feature-repair restack

```mermaid
sequenceDiagram
    participant E as restack-executor
    participant A as cascade-allowance
    participant S as conduct-state + config
    participant C as cascade-cap
    participant R as cascades ref
    E->>A: resolve for worktree
    A->>S: loadConfig(main checkout), read worktree complexity_tier (current)
    A-->>E: limit, tier, source (configured int, map entry for tier, else default, no tier → M)
    E->>C: checkCascadeCap(originating, defaultLimit)
    C->>R: read counts and limits
    alt limits[k] present (operator raise)
        R-->>C: limits[k] wins
    else no raise
        C-->>C: defaultLimit
    end
    alt counts[k] ≥ limit
        C-->>E: exhausted: child k, count, limit, raised
        E->>E: record cap evidence, halt needs-human naming child k, tier, allowance
    else clear
        C-->>E: clear
    end
```

## Legend

- Cylinders are durable state: `conduct-state.json` is the feature-wide document in the worktree's
  `.pipeline/`; the `cascades` blob ref survives worktree recreation.
- `k` is an originating child. Precedence for child k: a `limits[k]` written by an operator raise,
  then the configured integer or the map's entry for the feature's tier, then the tier default.
- A feature with no recorded tier resolves as M.
- One new pure module; no new ref, ledger field or event. The stack preflight's pre-check, whose
  result was discarded, is removed; `runRestack` is the single enforcement site.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-28 | Initial generation | Tier-sized restack cascade allowance (#3472) |
