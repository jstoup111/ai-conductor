# Architecture Review: decide the daemon→engine rename before the v1.0 tag

**Date:** 2026-08-26
**Mode:** lightweight (Medium tier, technical track; DECIDE pass — stories do not exist yet)
**Input:** `.docs/track/decide-the-daemon-engine-rename-before-the-v1-0-ta.md` scope boundary,
`.docs/architecture/2026-08-26-music-vocabulary-rename-surfaces.md` (approved),
`.memory/decisions/music-vocabulary-rename-scope.md`, #227 + comments
**Verdict:** APPROVED

## Feasibility

The feature delivers decision + scoping artifacts only (ADR, rename-scope enumeration,
migration scoping) — no runtime code. Feasibility questions therefore attach to the *scoped*
rename, and were checked so the scope is honest:

- **Surface size verified:** 1,532 `daemon` / 422 `engineer` occurrences (src), 414 test files,
  49 docs files, 111 `.daemon/` path literals. Large but mechanical; the alias shim and
  migration block bound the operator-visible break.
- **Event spine unaffected:** `ConductorEvent` union (`src/conductor/src/ui/types.ts`) has zero
  daemon-named identifiers (grep-verified) — the persisted event schema is out of the breaking
  surface. Resolves the diagram's open question: EVENTS does not rename.
- **Precedent exists:** adr-2026-06-29-brainstorm-rename-migration shows the state-key-safe
  rename shape (migrate on load, boundary-only shim, no retroactive reshuffle).
- **Overlap scan (advisory):** `src/conductor/src/cli.ts` overlaps many open spec branches,
  notably `lock-474-s-breaking-surfaces-before-v1` (#552) — the rename feature must sequence
  with #552/#226 rather than land independently. Recorded as a scoping constraint, not a block.

## Alignment

- **Governing-ADR reuse check:** no existing ADR governs the daemon/engineer vocabulary.
  adr-2026-06-29-brainstorm-rename-migration governs a different rename (step name) and is cited
  as precedent, not amended — its decision (brainstorm→explore/prd migration) is unchanged by
  this one, so an amendment would attach unrelated content to it. A new ADR is warranted: the
  decision revises the CLI surface and durable state-path architecture (structural prerequisite
  met).
- Scope boundary honored: two renames only; repo name, entrypoints, event schema, and verdict
  vocabulary (deferred to #1918) excluded. No expansion beyond the operator-confirmed boundary.
- Consistent with the machinery-by-default principle: the alias shim and migration block are
  mechanical enforcement of the transition, not prompt discipline.

## Wiring Surface

This spec ships no production surface. The *scoped rename feature* (future work, bound to
#226) will wire:

- `conduct player …` subcommand — wired into the existing command table in
  `src/conductor/src/cli.ts` where `daemon` registers today; old name forwards via the alias shim
  at the same dispatch point (`detectDaemonCommand` seam in `engine/daemon-command.ts`).
- `conduct-ts composer …` / `/composer` skill — same dispatch seam as today's `engineer`
  commands and the `skills/` catalog symlink surface.
- Config-key aliases (e.g. `auto_restart_on_stale_engine` → player-named key) — resolved in the
  config loader, old key accepted with deprecation warning.
- `.daemon/`→ new state dir — migrated/dual-read at daemon startup (the load boundary, per the
  brainstorm-rename precedent).
- `## Migration` block — travels in the #226-major PR body per the release-gate contract.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Rename feature drifts from this scope when built later | Knowledge | Medium | Medium | ADR enumerates the exact surfaces; plan tasks reference it |
| Live `.daemon/` state (pid, grants, parked lists) breaks mid-transition | Data | Medium | Medium | Dual-read/migrate-on-load scoped as a mandatory task; precedent ADR cited |
| cli.ts collisions with #552/#226 branches | Integration | High | Low | Sequencing constraint recorded; rename lands inside the #226 major train |

## ADRs Created

- `adr-2026-08-26-music-vocabulary-player-composer-rename.md` (DRAFT → pending operator
  approval; becomes the sole authority for the vocabulary)

## Conditions

None. Verdict is APPROVED contingent only on the ADR reaching APPROVED status (lifecycle gate,
not a review condition).
