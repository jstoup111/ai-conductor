# Architecture Review: Daemon PR Labeling

**Date:** 2026-06-29
**Mode:** lightweight (Medium tier — feasibility + alignment)
**Stories reviewed:** all 12 in `.docs/stories/daemon-pr-labels.md` (FR-1…FR-16)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | ✓ Uses `gh` CLI — already a dependency used by handoff/intake/finish/worktree via the injected `GhRunner` (`makeProductionGh`, `execFile`). No new deps, services, or infra. |
| Prerequisites | ✓ None beyond a remote + `gh` auth, already assumed by finish/intake. Absent → graceful no-op (consistent with best-effort). |
| Integration surface | ✓ Single external boundary (GitHub via `gh`) behind one new seam `pr-labels.ts`. Three internal call sites: `Conductor.run()` build-failure hook, `daemon-runner.ts` (enroll + FR-16 clear), daemon loop (sweep). Isolated. |
| Data implications | ✓ One new file-backed per-repo registry (`.daemon/mergeable-watch.jsonl`). No DB, no migration, no schema. Self-pruning. |
| Performance risk | ⚠ Low. Sweep = one `gh pr view` per tracked PR per cadence tick. Watch list is small (only `done`, pruned on merge/close). Unmerged `done` PRs accumulate until closed — bounded but non-zero. Cadence is tied to feature/poll events, not a tight timer. |
| Worktree isolation | ✓ Registry is per-repo under `.daemon/` (existing per-repo daemon state dir). `needs-remediation` acts in the feature worktree. No cross-worktree shared-state contention. |

## Alignment

- **Single gh seam** matches the existing injected-runner convention (`GhRunner`/`makeProductionGh`) — not a new integration style. ✓
- **Best-effort/non-blocking** matches the existing advisory write-back pattern (intake FR-37: swallow + log, never throw). ✓
- **HALT-first ordering** preserved: `needs-remediation` runs *after* the HALT + state writes in
  `Conductor.run()`, so it cannot change how halt-reconciliation (ADR-013) classifies the feature
  (worktree kept, not processed, re-kickable). **Condition C1.**
- **FR-16 clear-on-success** placed at the `done` enrollment point in `daemon-runner.ts`, where
  `outcome` + `pr_url` are authoritative. ✓ Reuses the same seam.
- **Label/state namespace** distinct from `needs-manual` (intake ledger, ADR-012) and
  `engineer:handled` (intake label). No collision. ✓
- **New recurring daemon task + persisted state** is a novel architectural decision →
  **ADR-014 (DRAFT)** records it (registry vs stateless scan; cadence; seam).

## Domain Integrity
Deferred to the TDD domain reviewer per-cycle (Medium tier). Note for implementation: model
mergeability as a parsed result (`{state, mergeable, hasFailingOrPendingChecks, labels}`), not
scattered booleans; the watch entry is a small typed record. Conservative on `UNKNOWN` (omit).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Watch registry grows if `done` PRs never merge | Data | Medium | Low | Prune on MERGED/CLOSED/404 (FR-13); optional age/size cap (deferred, log drops) |
| `gh` rate limits under many PRs × frequent ticks | Integration | Low | Low | Cadence tied to feature/poll events, not a tight timer; one `gh pr view` per PR |
| Overlapping sweeps (startup + per-feature) double-act | Technical | Medium | Low | Reconciliation is idempotent — label changes only on actual state change (FR-11) |
| `mergeable: UNKNOWN` mislabels as ready | Integration | Medium | Medium | Omit on UNKNOWN/any failing/pending check; re-check next pass (FR-10/11) |
| Escalation alters HALT semantics | Technical | Low | High | Run after HALT+state writes; wrap call site so it can't throw (Condition C1) |

No High-likelihood/High-impact risk remains after mitigation.

## ADRs Created
- **ADR-014 — Daemon PR labeling: shared gh seam, tracked mergeable watch registry, best-effort
  sweep.** Status: **DRAFT** → must reach APPROVED before BUILD.

## Conditions (APPROVED WITH CONDITIONS)
- **C1 — HALT-first / non-throwing escalation.** The `needs-remediation` hook runs only after the
  HALT + state writes and is wrapped so an exception cannot prevent them or the `loop_halt` emit.
  Verified by a Conductor integration test (escalation stubbed to throw → HALT still written).
- **C2 — Idempotent reconciliation.** Re-running the sweep on an unchanged PR makes no label change;
  overlapping sweeps do not flap. Verified by test.
- **C3 — Registry self-prunes** on MERGED/CLOSED/404; a registry write failure is swallowed and the
  next sweep re-derives. Verified by test.
- **C4 — Conservative mergeability.** `UNKNOWN`/failing/pending → no `mergeable`; `needs-remediation`
  present → never `mergeable`. Verified by test.

Conditions are tracked into the plan and checked at code review; unmet at `/finish` → blocking.
