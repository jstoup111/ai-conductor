# Architecture Review: Phase 9.1 — Retro Signal + Engineer Memory Store

**Date:** 2026-06-25
**Mode:** Lightweight (Medium — feasibility + alignment)
**Stories reviewed:** `.docs/stories/phase-9.1-retro-signal-engineer-memory.md` (11, FR-1..FR-11)
**Verdict:** **APPROVED WITH CONDITIONS**

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | ✅ Node fs + existing `events.jsonl`/`report-renderer`/`FeatureOutcome`. No new deps. |
| Prerequisites | ✅ Builds on 9.0 signal sources; engineer dir is a user-level path (`~/.ai-conductor/`). |
| Integration surface | `daemon-runner.ts` (emission point), `report-renderer.ts` (reuse aggregation), the gate loop (daemon-conditional retro skip), a new `engineer-store` module. Contained. |
| Data implications | None (no DB). Append-only JSONL + narrative files in a user dir. |
| Performance | One small append + (for `done`) one narrative generation per feature. Negligible vs a build. |
| Concurrency | The daemon is one process + worker pool → concurrent emissions are async writes; atomic single-line `O_APPEND` append is sufficient (FR-11). |
| Worktree isolation | ✅ Store is outside any worktree; emission runs pre-teardown so context is available. |

## Alignment

- **Pattern consistency:** ✅ Reuses `report-renderer` aggregation (no parallel re-impl); engineer
  store sits beside the existing `~/.ai-conductor/` user config. New pattern (daemon-conditional
  step skip) is justified by ADR-002.
- **State management:** ✅ Outcome modeled from existing `FeatureOutcome`; `narrativeRef` optional
  (no fabricated narrative); records versioned by `runId` (no destructive overwrite).
- **Boundaries:** ✅ Emission is additive + best-effort; never mutates `FeatureOutcome` or blocks a
  ship. Manual `/conduct` runs are untouched (retro redirect is daemon-only).
- **Diagram accuracy:** ✅ `2026-06-25-phase-9.1-emission-path.md` reflects the path + the A/B fork.

## Domain Integrity

Per-cycle via the TDD domain reviewer. Note: the signal record and the engineer-store path should be
small typed values (a `EngineerSignal` type + a `resolveEngineerDir()` helper), not ad-hoc objects/strings.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Emission failure breaks a real ship | Technical | Low (by design) | **High** | Best-effort wrap (FR-10); test injects a write failure → no throw, FeatureOutcome intact |
| Concurrent appends corrupt the log | Technical | Low | Medium | Atomic single-line `O_APPEND` append (FR-11); test ≥2 concurrent emissions → N intact lines |
| Daemon retro-skip leaks into manual runs | Integration | Low | Medium | Skip gated strictly on daemon mode; test daemon vs manual divergence (FR-7) |

## ADRs Created

- **ADR-002** (`adr-002-engineer-store-and-retro-redirect.md`, **DRAFT**) — Option A (skip in-loop
  retro for daemon; emission owns the narrative) + store format/append/run-id/optional-narrativeRef.
  **Must be APPROVED before BUILD.**

## Conditions (APPROVED WITH CONDITIONS)

1. **ADR-002 APPROVED** before `/writing-system-tests`.
2. Emission is **best-effort** — a store error is logged + swallowed; `FeatureOutcome`/teardown/PR
   unaffected (closes the High-impact risk).
3. Append is **atomic per record** (one `O_APPEND` write per line) for concurrency safety.
4. The retro redirect is **daemon-only**; manual `/conduct` runs keep `.docs/retros/` (ST-024).
5. `narrativeRef` is **optional**; a retro-skipped feature still emits a valid signal.

Tracked into `/plan`, checked at code-review and `/finish`.
