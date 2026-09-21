# Complexity: custom-steps-work-only-in-this-repo-engine-hardcod

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None — no new configuration key, no new persisted schema |
| External integrations | None new; three existing GitHub Actions workflows change their import entry point |
| Auth / permission surface | None |
| State machines | One behavior change: the FINISH freshness prerequisite widens from one reserved step name to every gating custom step that declares a `completion_artifact` |
| Story count | Estimated 5-7 (generic prerequisite; unsatisfiable gate halts by name; self-host confinement; export surface; docs; two negative paths) |
| Files touched | `conductor.ts`, `finish-publication-production.ts`, `index.ts`, a new release-actions build entry (the release modules themselves stay in place), three `.github/workflows/*.yml`, `docs/reference/configuration.md` and a guide, plus tests |
| New runtime code | Small; the bulk is relocation and removal of special cases |

## Rationale

The work removes three engine special cases for this repository's `release-disposition` step and
introduces no new mechanism, which argues against Large. It is not Small: the FINISH prerequisite
changes behavior for every repository that declares a gating custom step, the release modules move
off the package's public surface while `release-metadata.yml`, `release-pr.yml`, and `release.yml`
import them through `src/conductor/dist/index.js` today, and this repository's own release flow
must keep working through the move. Those cross-cutting surfaces warrant an architecture diagram,
a lightweight architecture review, a conflict check, and a coherence check.

Step packages, installed step identity (#2615), and PR-body customization (#2616) were split out
and do not count toward this tier.
