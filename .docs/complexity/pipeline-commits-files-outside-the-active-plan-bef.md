# Complexity Assessment: Plan-scope containment at the commit boundary

**Date:** 2026-08-02
**Plan stem:** `pipeline-commits-files-outside-the-active-plan-bef`

Tier: M

## Rationale

Scored against the standard conduct signals:

| Signal | Present | Note |
| --- | --- | --- |
| New models / persistence schema | partial | One additive field (`files`) on an existing `task-status.json` row; no new store |
| Third-party integrations | no | Entirely local — git plus the existing engine |
| Auth / permissions | no | — |
| State machines | no | Reuses the existing hook exemption ladder; adds no new states |
| Estimated stories | 6 | Above the Small threshold |
| Distinct engine seams touched | 4 | `task-seed.ts`, `git-hook-assets.ts`, a new containment module, `step-runners.ts` backstop |

## Why not Small

Three factors push past S:

1. **Consumer-visible breaking surface.** The change edits `hook wiring` and the embedded
   `COMMIT_MSG_HOOK` asset, which is a canonical breaking surface under the repository's
   release gate. That forces an explicit migration-versus-waiver decision, so the release
   path is not the trivial one.
2. **A new refusal can wedge live builds.** A hook that rejects commits sits on the daemon's
   critical path. Getting the exemption ladder (merge, amend, rebase replay,
   `CONDUCT_ENGINE_COMMIT=1`) and the legacy-plan fail-open wrong halts real features. This
   needs an architecture review and a negative-path story set, not a single task.
3. **Cross-gate interaction.** The new check must compose with `build_review`'s existing
   scope rubric and its `remediate` routing (#989) without double-jeopardy or contradiction.

## Why not Large

No new subsystem, no external integration, no data migration, no multi-service coordination.
Every primitive needed (`parsePlanTaskPaths`, `fileMatchesPlanPath`, the hook assets, the
per-task floor pattern) already exists and is in production use. The work is composition and
enforcement, not invention.

## Tier consequences

Per the engineer contract, M requires the full DECIDE set except the PRD (this is the
technical track): architecture diagram, lightweight architecture review with APPROVED ADRs,
stories, conflict-check, plan, and a coherence-check traceability mapping.
