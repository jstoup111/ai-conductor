# Components: Tier-derived remediation lap caps

**Last updated:** 2026-10-25
**Scope:** How the `prd_audit` and `architecture_review_as_built` remediation lap allowance is
resolved and consumed, before and after making it derive from the feature's complexity tier
(intake #2413).

## Diagram

### Before (flat integer, materialized at load)

```mermaid
graph LR
    cfgfile[".ai-conductor/config.yml<br/>max_remediation_laps: N"]
    loader["config.ts loadConfig<br/>(materializes default 1)"]
    resolver["remediation-caps.ts<br/>remediationLapCapForGate(gate, config)"]
    ledger[("kickback-ledger.json<br/>gates.«gate».effectiveLapCap")]
    runcache["conductor.ts run()<br/>prdAuditRemediationLapCap<br/>(cached once, before the loop)"]
    enforce["conductor.ts enforcement<br/>planRemediation, settlement halt,<br/>validation-join round cap"]
    view["kickback-budget-view.ts<br/>consumed/limit line"]
    cli["kickback-budget-cli.ts inspect"]
    observe["daemon-observe-cli.ts"]

    cfgfile --> loader --> resolver
    resolver --> runcache --> enforce
    resolver --> enforce
    ledger -- "raise overrides" --> enforce
    enforce --> view
    resolver --> cli --> view
    resolver --> observe --> view
```

### After (tier-aware, resolved at each use)

```mermaid
graph LR
    cfgfile2[".ai-conductor/config.yml<br/>max_remediation_laps: N or S/M/L map<br/>(unset leaves the key absent)"]
    loader2["config.ts loadConfig<br/>(validates int or map;<br/>no materialized default)"]
    defaults["tier default table<br/>S 2 · M 3 · L 4<br/>no tier → M"]
    resolver2["remediation-caps.ts<br/>resolveRemediationLapAllowance(gate, config, tier)<br/>returns limit, tier, source"]
    state[("conduct-state.json<br/>complexity_tier")]
    ledger2[("kickback-ledger.json<br/>gates.«gate».effectiveLapCap")]
    enforce2["conductor.ts enforcement<br/>(resolves lazily with state.complexity_tier)"]
    view2["kickback-budget-view.ts<br/>consumed/limit + tier + allowance"]
    cli2["kickback-budget-cli.ts inspect<br/>(reads tier from worktree state)"]
    observe2["daemon-observe-cli.ts<br/>(feature.tier)"]

    cfgfile2 --> loader2 --> resolver2
    defaults --> resolver2
    state --> enforce2
    state --> cli2
    resolver2 --> enforce2
    ledger2 -- "raise still overrides" --> enforce2
    enforce2 --> view2
    resolver2 --> cli2 --> view2
    resolver2 --> observe2 --> view2
```

### Resolution at a lap-cap check

```mermaid
sequenceDiagram
    participant C as conductor.ts
    participant S as conduct-state
    participant L as kickback ledger
    participant R as resolveRemediationLapAllowance
    participant V as kickback-budget-view
    C->>S: read complexity_tier (current, not cached)
    C->>L: read gates.«gate».effectiveLapCap
    alt operator raise present
        L-->>C: effectiveLapCap wins
    else no raise
        C->>R: (gate, config, tier)
        R-->>C: configured int, or map entry for tier, else default for tier (no tier → M)
    end
    C->>V: render consumed/limit naming tier and allowance
```

## Legend

- Cylinders are persisted per-feature state under the worktree's `.pipeline/`.
- `«gate»` is `prd_audit` or `architecture_review_as_built`.
- Precedence is operator raise > configured integer or the map's entry for the tier > tier
  default. A feature with no recorded tier resolves as M.
- No new module, state file, or ledger field is introduced; the resolver signature widens and
  its callers pass the tier.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-25 | Initial generation | Tier-derived remediation lap caps (#2413) |
| 2026-10-25 | Plan update: name the resolver `resolveRemediationLapAllowance` and its `{ limit, tier, source }` result | `/plan` Technical Approach |
