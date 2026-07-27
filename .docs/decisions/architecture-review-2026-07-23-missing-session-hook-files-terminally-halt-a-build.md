# Architecture Review: missing-session-hook-files-terminally-halt-a-build (#896)

**Date:** 2026-07-23
**Tier:** M (lightweight review)
**Verdict:** APPROVED — proceed to stories.
**Design:** `.docs/decisions/adr-2026-07-23-session-hook-repair-before-halt.md` (APPROVED)

## Feasibility

The design reuses machinery that already exists and is already exercised on every worktree
provisioning. `writeSessionHooks` (`worktree-prepare.ts:262`) and `wireSessionHookSettings`
(`worktree-prepare.ts:143`) are both idempotent by construction — the latter documents
merge-preserve semantics explicitly and `replaceSessionHookEntry` matches on matcher + command
marker so a re-run replaces rather than duplicates. Making them callable from the guard is an
export + an outcome type, not new behavior.

## Alignment

- **Design Principle (CLAUDE.md): deterministic where possible.** The repair is a pure file write
  from an in-repo constant. Nothing about it requires judgement, so nothing about it should require
  an operator. This is exactly the class of fix the principle prescribes: machinery that repairs at
  the point of the fault rather than a HALT that costs an intervention.
- **Precedent symmetry.** The adjacent branch of the same guard already does repair-then-check for
  `task-status.json` (`seedAndCheckAttributionMachinery`, `conductor.ts:668-686`). This makes the
  guard internally consistent instead of adding a novel pattern.
- **Fail-open vs fail-closed posture is preserved correctly.** `prepareWorktree`'s provisioning
  stays fail-open (a provisioning failure must never block worktree setup). The guard's use is
  outcome-aware and fail-closed on repair failure. Two callers, two postures, one primitive — the
  review flags this as the main implementation risk and requires the extraction to keep them
  independent (the shared helper must report, and let each caller decide).

## Risks and required mitigations

| # | Risk | Severity | Required mitigation |
|---|------|----------|---------------------|
| R1 | Guard returns `null` on a repair that silently failed → `writeBuildStepMarker` arms the mutation gate against a missing script → #505 Surface B becomes a no-op for the whole step | **High** | Post-repair verification MUST re-stat the three enforcement scripts on disk, not trust the repair return value. Pinned by a dedicated negative-path test (TI-3). |
| R2 | Refactor changes `prepareWorktree`'s fail-open posture, so a provisioning hiccup starts throwing and kills worktree setup | Medium | Regression test: `prepareWorktree` still completes when the hooks dir is unwritable. |
| R3 | Repair loops silently on a worktree that re-wipes every attempt, hiding a real defect | Low | Every repair emits a per-file `console.warn('[session-hooks] …')`, which the daemon captures into `daemon.log` (precedent: `[warn] [autoheal]` lines). Recurrence is greppable. |
| R4 | Adding `docs-guard.sh` to the halt-check set would widen what can terminally stop a build | Medium | Explicitly excluded from the halt-check set by the ADR; repair-only. Pinned by a test asserting a missing `docs-guard.sh` alone never produces a diagnostic. |
| R5 | Repair runs on non-build steps or when enforcement is unconfigured, adding I/O to every step | Low | The guard is already called only for `step.name === 'build' && isEnforcementConfigured(config)` (`conductor.ts:3200-3202`). No new call sites. |

## Boundary check

No change to `bin/conduct` CLI, `settings.json` schema, skill symlink targets, or hook wiring
*shape*. The hook scripts themselves are byte-identical. The self-host release gate's path-based
classifier may nonetheless flag `worktree-prepare.ts` as hook-wiring-adjacent; if it does, the
correct response is a `.docs/release-waivers/` waiver naming `hook wiring` with the rationale that
the wiring content is unchanged and only its invocation point is added — **not** an invented
migration block. Flagged for BUILD; do not fabricate a migration.

## ADR status

One ADR, APPROVED. No DRAFT ADRs outstanding.
