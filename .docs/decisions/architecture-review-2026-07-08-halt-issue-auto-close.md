# Architecture Review: halt-monitor issue auto-close (deterministic closure sweep)
**Date:** 2026-07-08
**Mode:** lightweight (tier M, technical track — pre-stories)
**Inputs reviewed:** .docs/track/halt-monitor-filed-issues-never-auto-close-no-link.md,
.memory/decisions/2026-07-08-halt-issue-auto-close-approach.md, approved diagrams in
.docs/architecture/{,sequences/}halt-monitor-filed-issues-never-auto-close-no-link.md
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack:** pure TS in `src/conductor` + one new conduct-ts subcommand; no new
  dependencies. gh CLI already required and seamed (`pr-labels.ts:makeProductionGh`).
- **Prerequisites:** none — operator `gh` auth (existing), monitor.log format as-is.
- **Integration surface:** GitHub issues (existing seam), monitor.log (read-only),
  `.daemon/processed/` + `.docs/shipped/` (read-only), new ledger file (owned).
  Daemon, engineer, and intake code paths untouched.
- **Data:** one new operator-local JSON ledger; rebuildable, atomic writes, no
  migrations.
- **Performance/quota:** local-first design; steady-state sweep makes zero GitHub
  calls (condition C1). Runs inside the monitor's 180 s cycle without adding API
  cadence.
- **Worktree isolation:** the sweep is an operator-level tool reading the primary
  repo's state dirs and `~/.ai-conductor/`; it does not touch worktrees and cannot
  conflict across them. Tests must inject all paths + a fake gh runner and honor the
  production-spawn kill-switch convention.

## Alignment

- **Pattern consistency:** follows the established advisory write-back pattern
  (best-effort, non-fatal, idempotent marker-tagged comments — `writeback.ts`,
  `issue-ref.ts`) and the DI gh seam. No new pattern without an ADR: the one novel
  decision (automated closure authority + ledger) is captured in
  adr-2026-07-08-halt-issue-closure-sweep.
- **State ownership:** operator-local ledger beside monitor state mirrors the
  intake-ledger precedent (`~/.ai-conductor/engineer/ledger.json`). Repo-local state
  dirs remain daemon-owned and read-only to the sweep.
- **Boundaries:** monitor filing/triage unchanged; daemon ship path unchanged; #355
  (productization) and #351 (auth isolation) untouched — the sweep is a primitive
  #355 later adopts.
- **Domain integrity:** ledger entries use explicit status values (`open|closed`),
  not boolean flags; verdict parsing is total (unparseable lines skipped + surfaced,
  no throw).
- **Security:** writes restricted to issues recorded in the ledger of the configured
  harness repo; `halt-sweep:keep-open` label + reopen-inviting comment keep a human
  override on every outward action; `--dry-run` supported.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Auto-close of a class-level engine-gap issue whose exemplar slug shipped | Integration | Medium | High | Recurrence guard (ship evidence newer than newest halt), keep-open label, reopen-inviting comment; never close without ship evidence |
| GitHub quota burn from per-cycle sweeps | Integration | Low | High | Local-first; zero steady-state API calls; per-entry writes only on transitions (C1) |
| monitor.log format drift breaks parser | Technical | Low | Medium | Parser tested against real captured log lines; skip+report unparseable; ledger rebuildable |
| Ledger corruption / concurrent writes | Data | Low | Low | Atomic tmp+rename; single writer (monitor cycle is serial); rebuild command |
| False linkage: verdict slug truncated/renamed vs state dirs | Data | Low | Medium | Slug taken verbatim from verdict; resolution requires exact marker/record match, else stays open |

## ADRs Created

- `adr-2026-07-08-halt-issue-closure-sweep.md` — APPROVED by operator 2026-07-08
  (closure criterion, ledger placement, stamping, quota discipline).

## Conditions

- **C1 (quota):** steady-state sweep performs no GitHub API calls; every write is
  preceded by at most one issue-state read and only on a state transition. Verified
  in tests.
- **C2 (conservative closure):** no auto-close without ship evidence satisfying the
  recurrence guard; halt-cleared-without-ship is report-only.
- **C3 (isolation):** all paths and the gh runner injected; no test spawns real
  processes (kill-switch honored); no reads/writes outside ledger + monitor.log +
  repo state dirs + GitHub seam.

## Blocking Issues

None. The one load-bearing open assumption (closure criterion for class-level gap
issues) is resolved by ADR approval: the operator explicitly accepts close-on-ship
with the guard + label escape, or amends the ADR before approval.
