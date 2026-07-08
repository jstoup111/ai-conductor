# Components: halt-monitor issue auto-close (deterministic ledger + closure sweep)

**Last updated:** 2026-07-08
**Scope:** The new `conduct-ts halt-issues sweep` subcommand and its place between the
operator-local halt-monitor, the daemon's ship/halt state, and GitHub issues. Monitor
migration/productization is out of scope (issue #355); the monitor gains only a
one-line per-cycle hook.

## Diagram

```mermaid
graph TD
  subgraph OPERATOR["Operator-local (~/.ai-conductor/halt-monitor) — NOT in repo, #355 scope"]
    MON["monitor.sh loop<br>(existing, unchanged logic)"]
    MLOG["monitor.log<br>verdict lines<br>HALT «slug» -> filed #N"]
    LEDGER["halt-issues ledger (NEW)<br>issues.json<br>slug to issue no. + status"]
  end

  subgraph REPO["Harness repo (tracked, tested)"]
    subgraph CTS["conduct-ts CLI (src/conductor)"]
      SWEEP["halt-issues sweep (NEW)<br>orchestrates one pass"]
      PARSE["verdict parser (NEW)<br>monitor.log to ledger entries"]
      RESOLVE["resolution detector (NEW)<br>shipped or halt-cleared"]
      CLOSER["issue closer (NEW)<br>stamp + comment + close"]
      GHSEAM["pr-labels.ts gh seam (EXISTING)<br>upsertIssueComment, REST helpers"]
    end
    DAEMON["daemon (EXISTING)"]
    PROC[".daemon/processed/«slug»<br>status shipped + prUrl"]
    SHIPREC[".docs/shipped/«slug».md"]
    DLOG[".daemon/daemon.log<br>halt lines"]
    HALTM[".worktrees/«slug»/.pipeline/HALT<br>and HALT.cleared"]
  end

  GH[("GitHub issues<br>jstoup111/ai-conductor")]

  DAEMON --> DLOG
  DAEMON --> PROC
  DAEMON --> HALTM
  MON -- "greps halts, claude -p triage files issues" --> GH
  MON -- "writes RESULT lines" --> MLOG
  MON -- "one-line hook per cycle" --> SWEEP
  SWEEP --> PARSE
  PARSE -- "reads" --> MLOG
  PARSE -- "upserts" --> LEDGER
  SWEEP --> RESOLVE
  RESOLVE -- "reads" --> PROC
  RESOLVE -- "reads" --> SHIPREC
  RESOLVE -- "reads" --> HALTM
  SWEEP --> CLOSER
  CLOSER -- "uses" --> GHSEAM
  GHSEAM -- "stamp Halt-Slug, comment resolved by prUrl, close" --> GH
  CLOSER -- "marks closed" --> LEDGER
```

## Legend

- **NEW** — modules this feature adds; all inside `src/conductor` except the ledger
  file, which lives beside the monitor's existing state in
  `~/.ai-conductor/halt-monitor/`.
- **EXISTING** — untouched components the sweep reads or reuses.
- `«slug»` — placeholder for a feature slug.
- The monitor's own filing path (top edge) is unchanged: its headless triage still
  files/cites issues; the sweep runs after, deterministically, and never files.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-08 | Initial generation | DECIDE phase for issue #390 (auto-close sweep) |
