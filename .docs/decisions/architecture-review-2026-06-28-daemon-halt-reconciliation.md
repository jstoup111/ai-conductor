# Architecture Review: Daemon Halt-Reconciliation

**Date:** 2026-06-28
**Mode:** Lightweight (MEDIUM tier — feasibility + alignment)
**Stories reviewed:** `.docs/stories/daemon-halt-reconciliation.md` (11 FRs)
**Inputs:** PRD `2026-06-28-daemon-halt-reconciliation.md`, diagrams
`2026-06-28-daemon-halt-reconciliation.md`, resolved conflict
`2026-06-28-daemon-halt-reconciliation.md`
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | ✅ Pure TypeScript + `git` CLI + `node:fs`. No new dependencies, services, or infra. |
| Prerequisites | ✅ PR #109 (merged) provides the un-park path. No migrations/config. |
| Integration surface | ✅ Contained to `src/conductor` daemon (daemon.ts, daemon-deps.ts, daemon-backlog.ts, daemon-cli.ts). Composes with 9.0's rebase step; does not modify it. |
| Data implications | ✅ Three new file write paths only: `.daemon/last-base-sha`, per-worktree `.pipeline/HALT.cleared`, rebase-abort side effect. No schema/DB. |
| Performance risk | ✅ One `git rev-parse` per idle refresh + a `.worktrees` scan at startup. Negligible; the scan is startup-only, not per-poll. |
| Worktree isolation | ✅ `.daemon/last-base-sha` is per-project (single daemon writer). `.pipeline/HALT.cleared` is per-worktree. No cross-worktree resource contention (no new ports/DBs/queues). |

## Alignment

- **PR #109 (discovery-time HALT park):** ✅ Re-kick reuses it exactly — clearing the marker makes
  `isHalted` false and the existing un-park path re-dispatches. No new/parallel dispatch path
  (FR-8). The no-advance restart invariant is explicitly preserved (FR-5 + dedicated regression
  story).
- **Phase 9.0 / ADR-001 (rebase-on-conflict→HALT):** ✅ Complementary. Re-kick aborts the paused
  rebase (Option 1) so 9.0's rebase step runs fresh on the advanced base; 9.0's own re-park
  governs whether it re-halts. Captured in ADR-013; ADR-001 not superseded.
- **DaemonDeps injected-primitive testing seam:** ✅ SHA read, rebase-in-progress probe, and marker
  clear are injectable, matching the existing pure-core convention (`daemon.test.ts` style). The
  state machine is testable without git/network/worktree.
- **State management:** ✅ Explicit SHA comparison + per-feature last-rekick SHA guard — no boolean
  flag soup; advance detection is a value compare, loop-bound is an explicit recorded SHA.
- **Diagram accuracy:** ✅ `.docs/architecture/2026-06-28-daemon-halt-reconciliation.md` reflects the
  designed flow (startup + loop state machine, sweep detail, re-kick sequence with 9.0).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Re-dispatch over a 9.0 paused rebase corrupts the worktree | Data | Medium | **High** | Option 1: `git rebase --abort` before clear; a **failed** abort leaves the marker intact (no half-clear); FR-9 bounds churn to one attempt per SHA. Regression + isolated-repo rebase tests required (per harness rebase-test convention: `daemon:true` + isolated repo). |
| Aggressive all-halts re-kick churns on unresolved human-DECIDE gaps | Technical | Medium | Low | Operator-accepted; bounded by genuine base-SHA advance + per-feature last-rekick SHA. |
| Corrupt/half-written `.daemon/last-base-sha` triggers a phantom advance | Data | Low | Medium | FR-11: empty/garbage/unreadable treated as absent (first-run path), never a spurious differing SHA. |
| SHA resolution throws offline and crashes the poll loop | Technical | Low | Medium | FR-10: unresolved SHA = "no advance"; all reads guarded; degrade to local base. |

## ADRs Created

- **ADR-013 — Daemon Main-Advance Re-Kick of Halted Work** (`Status: DRAFT`). Documents the
  trigger model (base-SHA advance, persisted last-base-sha, downtime-advance on restart), the
  clear-the-marker mechanism (no new dispatch path), the loop bound, and the Option-1 rebase-abort
  composition with ADR-001. **Must reach APPROVED before BUILD.**

## Conditions (APPROVED WITH CONDITIONS)

1. **ADR-013 must be APPROVED** (human) before `/writing-system-tests`. (Hard gate.)
2. **Rebase-abort path must be tested in an isolated repo with `daemon:true`** — per the harness's
   documented rebase-test convention — including the failed-abort-leaves-marker-intact negative
   path. (Evaluator checks at code review; unmet at `/finish` is blocking.)
3. **A regression test must pin the PR #109 no-advance invariant** under the new code path (a plain
   restart with no base advance clears nothing and dispatches no halted feature).
