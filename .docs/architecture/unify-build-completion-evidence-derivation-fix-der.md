# Components: Unified Build-Completion Evidence Derivation (#456 + #463)

**Last updated:** 2026-07-10
**Scope:** The evidence-derivation seam — anchor resolution in `deriveCompletion`
(autoheal.ts), the build completion gate and auto-heal hook (artifacts.ts /
conductor.ts), the post-rebase pre-verify (rebase.ts), and the task-seed
migration-grandfather path (task-seed.ts) with the `.pipeline/task-evidence.json`
sidecar.

## Diagram

```mermaid
graph TD
    subgraph Callers["Completion verdict callers (must always agree)"]
        GATE["Build completion gate<br/>artifacts.ts checkStepCompletion"]
        HEAL["Build auto-heal hook<br/>conductor.ts"]
        PREV["Post-rebase pre-verify<br/>rebase.ts applyRebaseVerdicts"]
    end

    subgraph Derivation["Single evidence derivation (shared predicate)"]
        DC["deriveCompletion«root, planPath»<br/>autoheal.ts"]
        ANCHOR["Anchor resolution<br/>NEW: explicit anchor else<br/>merge-base origin/«default»..HEAD<br/>else fail-safe empty range"]
        RANGE["getEvidenceRange<br/>commits in «anchor»..HEAD"]
        CORR["Path corroboration<br/>trailer paths vs plan paths"]
    end

    subgraph State["Durable engine state"]
        SIDE[("task-evidence.json<br/>evidenceStamps + grandfather")]
        STATUS[("task-status.json<br/>row cache, never trusted alone")]
    end

    SEED["seedTaskStatus first seed<br/>task-seed.ts<br/>NEW: no blind grandfather of<br/>terminal rows without evidence"]

    GATE --> DC
    HEAL --> DC
    PREV --> GATE
    DC --> ANCHOR
    ANCHOR --> RANGE
    RANGE --> CORR
    CORR -->|"stamp verified evidence"| SIDE
    DC -->|"applyDerivedCompletion<br/>demote unstamped rows"| STATUS
    SEED -.->|"OLD HOLE: sidecar absent means<br/>forged completed rows grandfathered"| SIDE
    GATE -->|"resolve task = stamp<br/>or corroborated grandfather"| SIDE
```

## Legend

- **Callers** — the three places a task-completion verdict is computed. Bug #463 is the
  guarantee that these can never disagree: they all flow through the same derivation with
  the same anchor.
- **Anchor resolution** — bug #456: the old no-anchor fallback resolved to the repo genesis
  commit (`git log --reverse HEAD | head -1`), making the evidence range span the entire
  history; the fix resolves the branch base via `merge-base` against the derived origin
  default branch (mirroring `listCommits`), with a fail-closed empty range (nothing
  completes, anomaly logged) when no base is derivable — never the whole history.
- **NEW / OLD HOLE** annotations — the two behavior changes this feature makes; everything
  else is the existing seam.
- `«…»` — placeholder for a variable value.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-10 | Initial generation | DECIDE phase for #456 + #463 spec |
```

# Sequence: corrected completion verdict across build → rebase → pre-verify

```mermaid
sequenceDiagram
    participant Agent as Build agent
    participant Gate as Build gate
    participant DC as deriveCompletion
    participant Git as git history
    participant Side as task-evidence.json

    Agent->>Gate: step build finished
    Gate->>DC: derive(root, plan) no explicit anchor
    DC->>Git: merge-base origin/«default» HEAD
    Git-->>DC: branch base «base»
    DC->>Git: log «base»..HEAD with trailers
    Git-->>DC: only this feature's commits
    DC->>Side: stamp tasks with corroborated evidence
    DC-->>Gate: per-task completion map
    Gate-->>Agent: pass only if every plan task has real evidence
    Note over Gate,Side: forged status rows without stamps never count
    Agent->>Gate: finish-time rebase pulls new main commits
    Gate->>DC: pre-verify build (same predicate, same anchor rule)
    DC-->>Gate: same verdict basis as the build gate
    Note over Gate: verdicts cannot diverge - no halt/rekick loop
```
