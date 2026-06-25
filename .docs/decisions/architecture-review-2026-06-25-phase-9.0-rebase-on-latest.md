# Architecture Review: Phase 9.0 — Rebase-on-Latest + Conflict→HALT

**Date:** 2026-06-25
**Mode:** Lightweight (Medium tier — feasibility + alignment)
**Stories reviewed:** `.docs/stories/phase-9.0-rebase-on-latest.md` (10 stories, FR-1…FR-10)
**Verdict:** **APPROVED WITH CONDITIONS**

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | ✅ Pure TS + `git` via `execa` (already used in `daemon-deps.ts`). No new deps. |
| Prerequisites | ✅ Builds on merged Phase 8 registry topology + existing verdict/selector/HALT. |
| Integration surface | Engine loop tail (`conductor.ts`), step registry (`steps.ts`), runner (`step-runners.ts`), `daemon-deps.ts`, event log. Contained within the conductor; no external systems. |
| Data implications | None — no schema/DB. State is `.pipeline/` markers + git refs. |
| Performance risk | Low — one fetch+rebase per feature before finish; re-verify only on code/test changes (FR-5 scoping). |
| Worktree isolation | ✅ Operates within an already-isolated per-feature worktree; idempotent `createWorktree` reuse precedent (`ST-007`). |

**Engine-native step feasibility:** Option A requires a non-dispatched step runner. Precedent
exists: `complexity` is engine-handled and explicitly not dispatched (`step-runners.ts:253`).
The `rebase` step follows the same pattern. **Feasible.**

## Alignment

- **Pattern consistency:** ✅ A new `loopGate` step is the idiomatic post-Phase-8 composition
  point (topology derived from the registry). Reuses selector + `gate-verdicts` + anti-oscillation
  rather than forking control flow. New pattern (engine-native step) is justified by ADR-001 and
  mirrors `complexity`.
- **State management:** ✅ The rebase outcome is modelled as a gate **verdict** (satisfied ⇔
  branch current), not an `is_*` boolean. Invalid "stale but satisfied" state is prevented by the
  verdict predicate. The no-op (FR-4) is the satisfied condition — no implicit flags.
- **Diagram accuracy:** ✅ `.docs/architecture/2026-06-25-phase-9.0-rebase-loop-tail.md` reflects
  the proposed insertion and the four outcome paths.
- **Safety boundaries:** ✅ never-auto-merge and never-auto-resolve-non-trivial preserved; only the
  known CHANGELOG case is auto-resolved (FR-7); all else HALTs (FR-8). No new user-input surface.

## Domain Integrity

Handled per-cycle by the TDD domain reviewer (Medium tier). One note carried forward: the
`rebase` gate predicate ("branch current with base") and the diff classifier ("changed code/test
paths") should be expressed as small typed helpers, not ad-hoc string checks, so the satisfied
condition and the invalidation trigger are each defined in one place.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Rebase not idempotent → re-invalidates each pass → false `MAX_GATE_SELECTIONS` HALT | Technical | Low (by design) | **High** | Model no-op as the satisfied verdict (FR-4); test re-entry converges without re-invalidation |
| CHANGELOG auto-resolver duplicates or drops `[Unreleased]` entries | Data | Medium | Medium | FR-7 dedup false-pos/false-neg tests; skip auto-resolve if any non-CHANGELOG file also conflicts |
| Paused-rebase worktree confuses re-invocation | Integration | Low | Medium | HALT parks it; `createWorktree` reuse (ST-007); FR-9 resume tests; re-park if rebase still in progress |
| Rebase requires network / no remote in test fixtures | Integration | Low | Low | Local-base fallback (FR-3); tests cover no-remote path |

## ADRs Created

- **ADR-001** (`adr-001-rebase-insertion-mechanism.md`, **DRAFT**) — Decision: Option A,
  `rebase` as an engine-native `loopGate` registry step. **Must be APPROVED before BUILD.**

## Conditions (APPROVED WITH CONDITIONS)

1. **ADR-001 must be APPROVED** before `/writing-system-tests` (hard conduct gate).
2. The `rebase` step's **satisfied predicate** must be "branch is current with the discovered
   base" — a genuinely stale branch must never report satisfied (closes the High-impact risk).
3. The **invalidation trigger** must be scoped to **code/test path changes** (FR-5 resolution),
   so a CHANGELOG-only/docs-only change does not force re-verification.
4. The CHANGELOG auto-resolver applies **only** when CHANGELOG is the *sole* conflict; any mixed
   conflict takes the HALT path (FR-7/FR-8).

These conditions are tracked into `/plan` and checked at code-review and `/finish`.
