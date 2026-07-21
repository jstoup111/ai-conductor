# Complexity: Intake-only criteria enforcement (priority + size + linking)

**Issue:** #695 — "Intake doesn't enforce priority + linking + sizing — 100/107 open issues have no size label"
**Plan stem:** `intake-only-enforcement`
**Supersedes:** PR #696 spec (`intake-criteria-enforcement`)

Tier: M

## Signals

| Signal | Reading |
|--------|---------|
| New models / schemas | None. Reuses the existing `priority:`/`size:` label vocab; adds two required form fields + one label-sync workflow. |
| Integrations | GitHub issue forms + a scoped `issues`-triggered Action; the `/intake` skill filing path; a one-shot backfill script. No new external service. |
| Auth / secrets | None beyond the default `GITHUB_TOKEN` already available to Actions (labels-only scope). |
| State machines | None. Enforcement is a stateless, at-capture stamp. No new claim/dispatch states (the directive forbids them). |
| Story count | 6 functional stories (5 positive capture/backfill paths + 1 load-bearing negative "pipeline does NOT gate" path). |
| Blast radius | Intake capture surfaces only. The claim path, daemon build/dispatch, pipeline gates, and CI are provably untouched (a story asserts byte-identical `claimUnblocked`). |

## Why M (not S, not L)

- **Not S:** touches more than one seam (issue form + a new Action + the `/intake`
  skill + a backfill script), and it reverses a competing design already captured in
  PR #696 (a claim-time gate). That reversal is a genuine architectural decision that
  must be recorded in an ADR and conflict-checked — Small would skip both, and skipping
  them is exactly what let two competing specs exist.
- **Not L:** no data model, no state machine, no new long-lived service, no migration
  (labels-only, additive form fields, no CLI / hook / settings-schema change). The
  backfill is a bounded one-shot over ~100 issues.

## Tier consequences (per engineer skill)

- `/architecture-diagram`: present (lightweight) — `.docs/architecture/intake-only-enforcement.md`.
- `/architecture-review`: lightweight, one ADR — `.docs/decisions/adr-2026-07-21-intake-only-enforcement.md` (APPROVED before land).
- `/conflict-check`: present — `.docs/conflicts/intake-only-enforcement.md` (reconciles with PR #696).
- `/prd`: skipped (technical track — acceptance criteria live in the stories).
