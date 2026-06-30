# Architecture Review: Gated rebase-conflict resolution skill

**Date:** 2026-06-29
**Mode:** Lightweight (Medium tier — feasibility + alignment)
**Stories reviewed:** `.docs/stories/rebase-resolution-skill.md` (FR-1..FR-12)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | ✅ No new deps. Reuses existing `execa` git runner, `skills/` dispatch, resolved-config. |
| Dispatch seam reachable from `runRebaseStep` | ✅ **Confirmed with precedent.** The engine-native `complexity` step already calls `this.stepRunner.assessComplexity()` (optional `StepRunner` method, `conductor.ts:189`). The resolution dispatch mirrors this exactly — a new optional `resolveRebaseConflict?()` method. **Must NOT** route through `DefaultStepRunner.run()`, which throws for `'rebase'` (`step-runners.ts:267`). |
| Prerequisites | New `skills/rebase/SKILL.md`, a `StepRunner` method, a config key, event types. All additive. |
| Integration surface | Touches `rebase.ts`, `conductor.ts` (`runRebaseStep`), `resolved-config.ts`, `events.ts`, `step-runners.ts`. Within one subsystem (the conductor engine). |
| Data implications | None (no DB; harness internal). |
| Performance risk | Dispatch only on actual `conflict_halt`, never on clean/noop — no hot-path cost. |
| Worktree isolation | Daemon-only execution against the daemon worktree; interactive stays a no-op. No shared-resource contention. |

## Alignment

- **Domain boundaries:** Resolution dispatch lives where the rebase step lives (engine), invoked via
  the runner seam — respects the engine/runner boundary rather than reaching across it.
- **Pattern consistency:** Reuses the `assessComplexity()` engine-native-step-calls-runner pattern;
  no new dispatch pattern. The amending ADR documents the one ADR-001 departure.
- **State management:** The sub-loop is a bounded, explicit state machine (attempt 1..N → guards →
  accept/HALT). No implicit boolean-flag states; termination is structural.
- **Satisfied-predicate integrity:** ADR-001's critical property (never report a stale branch
  satisfied) is preserved — `isBranchCurrent` remains the gate, unchanged. ✅
- **Anti-oscillation:** No new surface. After a code-changing resolution kicks back
  `build`/`manual_test`, the selector re-enters `rebase`, finds the branch current → `noop` →
  satisfied, no re-dispatch. The kickback is the *same* one a normal code-changing rebase emits,
  already bounded by `MAX_KICKBACKS_PER_GATE`/`MAX_GATE_SELECTIONS`. ✅
- **Guards sufficiency (any-conflict + re-verify):** FR-8 (`isBranchCurrent`) bounds "stale branch"
  and FR-9 (commit-preservation) bounds "dropped work" — the two catastrophic failure modes are
  closed *by construction*. The residual (a semantically-wrong merge that still passes tests) is the
  inherent cost of the user's chosen "trust the suite" model; mitigated, not eliminated (see Risks).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Auto-merge resolves a conflict in a way that compiles + passes tests but is semantically wrong | Technical | Medium | Medium | FR-8/FR-9 guards + build+manual_test kickback re-verify + bounded attempts (default 3) + final human PR review; `0`-cap disables entirely |
| `rebase --continue` silently drops a feature commit | Data | Low | High | FR-9 commit-preservation check (patch-id/subject set, not bare count) → reject → HALT |
| Resolver claims success but leaves HEAD mid-rebase / detached | Technical | Low | High | FR-8 `isBranchCurrent` + `rebaseStateActive` completion check → reject → HALT |
| Dispatch wired through the throwing `run('rebase')` path | Integration | Low | Medium | Condition 1: implement as a dedicated optional `StepRunner` method |

## ADRs Created

- `adr-2026-06-29-rebase-conflict-resolution-dispatch.md` — **DRAFT** — narrows ADR-001 to permit
  dispatch only on the conflict-resolution sub-path. **Must be APPROVED before BUILD** (HARD GATE).
  ADR-001 itself is left untouched until this amendment is approved.

## Conditions (APPROVED WITH CONDITIONS)

1. **Dispatch via a dedicated optional `StepRunner` method** (e.g. `resolveRebaseConflict?()`),
   mirroring `assessComplexity()`. Do not route `'rebase'` through `DefaultStepRunner.run()`.
2. **FR-9 commit-preservation** must use a patch-id / subject-set comparison (not a bare commit
   count), per the known `rebase --continue` commit-drop hazard.
3. **Dedicated config key** for the attempt cap (default 3, `0` disables). Do not overload
   `DEFAULT_STEP_RETRIES.rebase`.
4. **Residual-risk acceptance** recorded: a test-passing-but-wrong auto-merge is possible and
   accepted, mitigated by guards + kickback + PR review. (User already accepted "any conflict +
   re-verify" in brainstorm.)

These conditions are tracked into the plan and verified at code review / `/finish`.
