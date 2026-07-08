# Sequence: halt-issues sweep cycle

**Last updated:** 2026-07-08
**Scope:** One `conduct-ts halt-issues sweep` pass, invoked by the monitor loop each
cycle (and manually for backfill).

## Diagram

```mermaid
sequenceDiagram
  participant MON as monitor.sh cycle
  participant SW as halt-issues sweep
  participant ML as monitor.log
  participant LG as ledger issues.json
  participant ST as ship/halt state
  participant GH as GitHub issues

  MON->>SW: conduct-ts halt-issues sweep
  SW->>ML: read verdict lines
  ML-->>SW: HALT «slug» -> filed #N
  SW->>LG: upsert new entries (filed, unstamped)
  loop each unstamped entry
    SW->>GH: read issue body
    alt body lacks Halt-Slug marker
      SW->>GH: append Halt-Slug «slug» line
    end
    SW->>LG: mark stamped
  end
  loop each open ledger entry
    SW->>ST: shipped marker or shipped record or HALT cleared plus completed
    alt resolved
      SW->>GH: upsert comment resolved by «prUrl»
      SW->>GH: close issue
      SW->>LG: mark closed
    else unresolved
      SW-->>LG: leave open (retry next cycle)
    end
  end
  SW-->>MON: summary line (stamped N, closed M, skipped K)
```

## Legend

- **ship/halt state** — `.daemon/processed/«slug»`, `.docs/shipped/«slug».md`, and
  `.worktrees/«slug»/.pipeline/HALT` / `HALT.cleared` in the target repo.
- Every GitHub write is idempotent (marker-tagged comment upsert; close only if open;
  stamp only if absent), so re-runs and backfills are safe.
- A GitHub or state read failure skips that entry and leaves it for the next cycle —
  the sweep never crashes the monitor loop.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-08 | Initial generation | DECIDE phase for issue #390 (auto-close sweep) |
