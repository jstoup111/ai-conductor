# Architecture Review (lightweight, Tier M) — Per-task work-happened floor

**Stem:** `per-task-work-happened-floor` · 2026-07-22 · **Verdict: APPROVED**

## Feasibility

- **Inputs exist.** `parsePlanTaskPaths` (task ids), `parsePlanTaskVerifyOnly`
  (`autoheal.ts:626`, verify-only/type markers), `listCommitsWithTrailers` +
  `canonicalTaskId` (trailer read + cross-grammar fold), `normalizeTasks` (skipped
  rows). No new parsing grammar required.
- **Composition point exists.** `runBuildReview` (`step-runners.ts:855`) already
  assembles `planPath` + `gitRunner` and returns the step output — the floor computes
  there, prepends advisory lines, writes the artifact, then dispatches the grader
  unchanged. Non-blocking wiring requires no new step and no `ALL_STEPS` change.
- **Precedent for the shape.** `overlap-scan.ts` (fail-soft advisory report) and
  `wiring-probe.ts`'s `evaluatePlanWiringDisposition` (`{satisfied, gaps, advisories}`)
  are the templates; the floor mirrors the advisory (non-blocking) half.

## Alignment / risk

- **Wedge-class avoidance (the central risk):** discharged by (a) non-blocking
  disposition, (b) trailer-OR-marker-only inputs, (c) the `93c2a3e3` evidence proving a
  blocking variant would wedge. See ADR Alt A.
- **Grader-contract integrity:** the floor stays OUT of `buildGraderPrompt`, preserving
  input-isolation and the anti-per-task-SHA rule (ADR Alt B).
- **Gate independence:** floor is advisory; it does not interact with the
  `no_task_progress` stall breaker, the `build_review` kickback loop, or `wiring_check`.
  Confirmed non-conflicting in `/conflict-check`.
- **Fail-soft:** no fabricated flags on missing/again git data.

## Conditions

- ADR `adr-2026-07-22-per-task-work-happened-floor.md` is **APPROVED** (no DRAFT).
- Plan must add the `**Verify-only:** yes` authoring note to `skills/plan/SKILL.md` so
  the marker escape hatch is discoverable.
- The no-wedge / folded-work case (`Task: 7`-only commit flags task 6 as advisory but
  does NOT block) must be an explicit acceptance test.

**APPROVED for stories → conflict-check → plan.**
