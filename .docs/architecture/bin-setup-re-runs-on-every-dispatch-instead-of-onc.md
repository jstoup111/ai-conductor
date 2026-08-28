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
    participant Marker as setup marker («worktree»/.daemon/setup-ok.json)
    participant Setup as bin/setup
    participant Events as project_setup event spine
    participant Hook as per-dispatch script (optional)
    participant Triage as runSetupTriage

    Runner->>Deps: createWorktree(slug) — reused / attached / created
    Runner->>Prep: prepareWorktree(worktree)
    Prep->>Prep: namespace env + git hooks (unconditional, idempotent)
    alt bin/setup absent
        Prep->>Events: project_setup {ran:false, reason:no-script}
        Events-->>Runner: persist + render "setup skipped (no-script)"
    else bin/setup present
        Prep->>Marker: read marker (base SHA + bin/setup hash)
        alt marker valid — base unchanged, script hash matches
            Prep->>Events: project_setup {ran:false, reason:marker-valid}
            Events-->>Runner: persist + render "setup skipped (marker-valid)"
        else marker absent, stale, or invalidated (re-provision / rebase / script drift)
            Prep->>Events: project_setup {ran:true, reason:evidence-derived}
            Events-->>Runner: persist + render "setup ran (reason)"
        Prep->>Setup: run with CI=true + WORKTREE_NAMESPACE
        alt setup succeeds
            Setup-->>Prep: ok
            Prep->>Marker: write marker (current base + script hash; HEAD provenance)
        else setup fails
            Setup-->>Prep: SetupFailureError (marker NOT written)
            Prep-->>Runner: throw
            Runner->>Triage: classify + route (unchanged path)
        end
        end
    end
    Prep->>Hook: run per-dispatch script if present (every dispatch)
    Hook-->>Prep: failure handling per its own contract
    Prep-->>Runner: prepared — runConductor proceeds
```

## Legend

- **Marker** — durable per-worktree record of the last *successful* setup and the basis it was
  prepared against. A failed setup never writes it, so a kept-after-failure worktree re-runs
  setup on re-dispatch. It lives at `«worktree»/.daemon/setup-ok.json`.
- **Invalidation** — re-provisioning (fresh worktree has no marker), the checkout moving
  underneath the prepared state (engine rebase / base drift), or a `bin/setup` content change.
- **Setup decision reporting** — every decision emits the `project_setup` event, which persists
  and renders the daemon log line. A project without `bin/setup` emits the closed `no-script`
  reason; it does not write a marker or emit a parallel raw log line.
- **Per-dispatch script** — the documented lifecycle mechanism for behavior that genuinely
  needs to run on every dispatch; `bin/setup` is no longer that vehicle.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-26 | Initial generation | DECIDE for #1930 (engineer spec) |
| 2026-08-28 | Correct marker location and model `project_setup` reporting, including the scriptless branch | As-built remediation AB-4.2 following the ADR's `no-script` amendment |
