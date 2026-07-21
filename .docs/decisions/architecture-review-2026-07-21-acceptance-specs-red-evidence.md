# Architecture Review: acceptance_specs RED-evidence determinism (#741)
**Date:** 2026-07-21
**Tier:** Medium (lightweight mode — Feasibility + Alignment)
**Input reviewed:** explore track marker + ADR adr-2026-07-21-engine-owned-acceptance-red-execution
**Verdict:** APPROVED

## Feasibility
- **Stack compatibility:** No new deps. Reuses existing worktree subprocess exec (skill
  dispatch already runs commands under skip-permissions) and the existing
  `validateAcceptanceRedEvidence` validator. ✓
- **Prerequisites:** None external. A small SKILL.md change (record the run contract) and a
  step-seam self-heal in `Conductor.run`. ✓
- **Integration surface:** Two seams — (a) `skills/writing-system-tests/SKILL.md` §6 writes
  the contract; (b) `Conductor.run` acceptance_specs step path executes it on a missing
  marker. The completion predicate in `artifacts.ts` is unchanged (stays a pure read). ✓
- **Data implications:** None. One new gitignored `.pipeline/` run-evidence file
  (`acceptance-specs-run.json`); no schema, no committed artifact. ✓
- **Performance risk:** Bounded — the engine runs the feature's own acceptance specs once
  on a missing marker (the same run the skill would have done). Not inside the pure
  predicate, so no repeated execution. ✓
- **Worktree isolation:** All paths are worktree-local; the marker is written to the
  authoritative worktree-root `.pipeline/`. No shared state, no ports. Fixes (not adds) a
  cross-dir path hazard. ✓

## Alignment
- **Design Principle:** Directly realizes "deterministic where possible; never rely on
  prompt discipline for what machinery can enforce." Execution + marker become engine
  machinery; the agent retains only authoring (judgement). ✓
- **Pattern consistency:** Mirrors existing engine-native completion handling
  (`wiring_check`, `complexity`) and the existing `deriveCompletion`/self-heal seam in
  `Conductor.run` (~conductor.ts:1164). No net-new architectural pattern. ✓
- **Predicate purity:** Preserves the artifacts.ts convention that completion predicates are
  side-effect-free reads — execution is deliberately placed in the step/retry path. ✓
- **State management:** No new boolean flags; the RED contract (executed/passed/failed/
  skipped/errors) remains the single source of truth, re-validated unchanged. ✓
- **Diagram accuracy:** `.docs/architecture/sequences/acceptance-specs-red-evidence.md`
  authored for this change and reflects the planned flow. ✓

## Wiring Surface (design-time)
- `.pipeline/acceptance-specs-run.json` (new run-contract file) — **written by** the
  `/writing-system-tests` skill at spec-authoring time (SKILL.md §6); **read by** the engine
  RED self-heal in the acceptance_specs step path.
- Engine RED self-heal routine (new) — **invoked from** `Conductor.run`'s acceptance_specs
  step handling, on a completion-gate miss that names the missing/invalid RED marker, before
  the retry budget is spent (alongside the existing `deriveCompletion`/self-heal call site).
- Authoritative marker normalization — **invoked from** the same self-heal routine, ensuring
  `.pipeline/acceptance-specs-red.json` lands at the worktree root the predicate
  (`artifacts.ts` `acceptance_specs`) reads.

## Risks
| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Run contract absent (older skill / skill died pre-record) | Integration | Medium | Medium | Fail gate with explicit "run contract missing" reason + hardened forced-execution retry directive; never silently pass |
| Engine exec of recorded command misbehaves (bad cwd/command) | Technical | Low | Medium | Re-validate produced marker with existing validator; a run that selects 0 tests fails deterministically with real evidence, not "missing" |
| Recorded command drift from actual spec paths | Technical | Low | Low | `targetSpecs` in the contract cross-checked against the globbed spec files before exec |

No High-impact risks.

## ADRs Created
- `adr-2026-07-21-engine-owned-acceptance-red-execution.md` — **APPROVED** (operator
  confirmed Hybrid approach C).

## Conditions
None. Clean APPROVED.
