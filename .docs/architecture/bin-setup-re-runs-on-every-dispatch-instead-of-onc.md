# Sequence: Marker-gated project setup and the per-dispatch lifecycle script

**Last updated:** 2026-08-26
**Scope:** How a daemon dispatch decides whether to run the project's `bin/setup` (once per
worktree provisioning, re-run only on named invalidation), and where the new optional
per-dispatch lifecycle script runs. #1930.

## Diagram

```mermaid
sequenceDiagram
    participant Runner as makeRunFeature (daemon-runner)
    participant Deps as daemon-deps
    participant Prep as prepareWorktree (worktree-prepare)
    participant Marker as setup marker («worktree»/.pipeline/)
    participant Setup as bin/setup
    participant Hook as per-dispatch script (optional)
    participant Triage as runSetupTriage

    Runner->>Deps: createWorktree(slug) — reused / attached / created
    Runner->>Prep: prepareWorktree(worktree)
    Prep->>Prep: namespace env + git hooks (unconditional, idempotent)
    Prep->>Marker: read marker (prepared-at commit + bin/setup hash)
    alt marker valid — commit basis unchanged, script hash matches
        Prep->>Prep: log "setup skipped: worktree already prepared"
    else marker absent, stale, or invalidated (re-provision / rebase / script drift)
        Prep->>Prep: log WHY setup runs (which input drifted)
        Prep->>Setup: run with CI=true + WORKTREE_NAMESPACE
        alt setup succeeds
            Setup-->>Prep: ok
            Prep->>Marker: write marker (current basis)
        else setup fails
            Setup-->>Prep: SetupFailureError (marker NOT written)
            Prep-->>Runner: throw
            Runner->>Triage: classify + route (unchanged path)
        end
    end
    Prep->>Hook: run per-dispatch script if present (every dispatch)
    Hook-->>Prep: failure handling per its own contract
    Prep-->>Runner: prepared — runConductor proceeds
```

## Legend

- **Marker** — durable per-worktree record of the last *successful* setup and the basis it was
  prepared against. A failed setup never writes it, so a kept-after-failure worktree re-runs
  setup on re-dispatch.
- **Invalidation** — re-provisioning (fresh worktree has no marker), the checkout moving
  underneath the prepared state (engine rebase / base drift), or a `bin/setup` content change.
- **Per-dispatch script** — the documented lifecycle mechanism for behavior that genuinely
  needs to run on every dispatch; `bin/setup` is no longer that vehicle.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-26 | Initial generation | DECIDE for #1930 (engineer spec) |
