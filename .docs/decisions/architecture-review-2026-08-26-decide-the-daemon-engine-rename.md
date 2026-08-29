# Architecture Review: revise the v1.0 rename — daemon stays, engineer→composer, ai-conductor CLI

**Date:** 2026-08-28
**Mode:** lightweight (Medium tier, technical track; DECIDE pass — revised spec, stories rewritten after this)
**Input:** `.docs/track/decide-the-daemon-engine-rename-before-the-v1-0-ta.md` scope boundary
(operator reversal 2026-08-28), `.docs/architecture/2026-08-26-music-vocabulary-rename-surfaces.md`
(revised, approved), amended adr-2026-08-26-music-vocabulary-player-composer-rename
**Verdict:** APPROVED

> Supersedes the 2026-08-26 review content in place: that pass reviewed the scoping-only feature
> and then the comprehensive player/composer implementation. The operator rescinded the player
> half and reversed the ADR's entrypoint clause; this review covers the surviving scope.

## Feasibility

- **`compose` verb alias:** `detectEngineerCommand` keys on `argv[2] === 'engineer'`
  (`src/conductor/src/engine/engineer-cli.ts:111-114`, verified). Accepting `compose` as
  canonical and `engineer` as warning alias is a one-boundary parser change reusing the existing
  typed dispatch. Confidence: verified.
- **Binary alias:** `bin/conduct-ts` is a bash launcher that resolves its own real path via
  `readlink -f "$0"` before locating the dist entrypoint (verified, `bin/conduct-ts:6`), so a
  second symlink name (`ai-conductor`) works unchanged; the invoked-name check for the
  deprecation warning reads `basename "$0"` *before* symlink resolution. `bin/install` already
  manages the `conduct-ts` symlink idempotently (`bin/install:1349-1365`, verified) — adding the
  `ai-conductor` symlink follows the same pattern. Confidence: verified.
- **Internal repoint:** ~10 `src/conductor/src/` files and 11 hook/skill files reference
  `conduct-ts` (grep-verified 2026-08-28). Repointing them to `ai-conductor` is mechanical; the
  deprecation warning then fires only for operator-typed `conduct-ts`. The installer must create
  the `ai-conductor` symlink before any repointed internal caller runs — ordering satisfied by
  shipping both in one PR and `bin/install` being the sole provisioning path.
- **Skill delegate:** `skills/composer/` does not exist yet (verified); `skills/engineer/` does.
  Creating `skills/composer` as canonical and reducing `skills/engineer` to a delegate is
  additive — no directory deletion, so the two-feature deletion rule does not apply. Both host
  discovery mechanisms (Claude `/composer`, Codex `$composer`) get the canonical name via the
  existing skill-installation machinery; `test/test_provider_skill_contracts.sh` and the
  HARNESS.md model table (validation checks 5/5a/5b) must gain the composer row.
- **Dropped surface:** no state migration, no config schema change, no event-spine change. The
  38-task player plan's state-resolver machinery leaves scope entirely.

## Alignment

- **Governing-ADR reuse:** the operator directed an in-place amendment of
  adr-2026-08-26-music-vocabulary-player-composer-rename rather than a new/superseding ADR
  (consistent with the prefer-amendments convention). The amendment is additive — original
  decisions preserved, reversal recorded beside them — and covers the one structural change
  (canonical entrypoint naming). No new ADR is warranted; no other ADR governs this surface.
- **Machinery-by-default:** aliases are parser/symlink machinery, warnings fire at the point of
  use, and the land/validation gates (model table, skill contracts, shellcheck) enforce the
  catalog changes mechanically.
- **Scope boundary honored:** `bin/conduct` untouched (#226), verdict vocabulary deferred
  (#1918), internal module/file names unchanged, no piecemeal renames beyond the three seams.
- **Aliases never own a second implementation:** both the verb alias and the binary alias
  forward to the same typed dispatch / dist entrypoint — no forked code paths.

## Wiring Surface

| New surface | Wired from (design-time) |
|---|---|
| `compose` CLI verb (+ `engineer` warning alias) | `detectEngineerCommand` dispatch in `src/conductor/src/index.ts` main entry |
| `ai-conductor` installed binary | `bin/install` symlink step (same block as the existing `conduct-ts` symlink) |
| `conduct-ts` deprecation warning | `bin/conduct-ts` launcher, invoked-name check on `$0` before path resolution |
| `skills/composer` (canonical skill) | existing skill installation/symlink machinery in `bin/install`; host discovery (Claude `/composer`, Codex `$composer`) |
| `skills/engineer` delegate | same discovery machinery; SKILL.md delegates to composer |
| Model-table composer row | `src/conductor/src/engine/model-table-metadata.ts` → `bin/generate-model-table` → HARNESS.md |

**Early overlap scan (advisory):** `src/conductor/src/index.ts` overlaps many open spec branches
(14+, including per-step-provider-routing-927 and self-host-phase6-wiring); `bin/install` and
HARNESS.md overlap several more. Expected for central seams; the parser change is small and
additive. Sequencing note: #226 must land after this spec so its installer cutover targets
`ai-conductor`. Advisory only — not blocking.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Internal caller still invokes `conduct-ts` after repoint, spamming deprecation warnings in daemon logs | Technical | Medium | Low | Grep-driven sweep is a plan task with a zero-remaining-references check; warning writes to stderr only |
| Operator PATH lacks `ai-conductor` until `bin/install` re-run | Integration | High | Low | `conduct-ts` alias keeps working (warn-only); release note + migration block instructs re-running install |
| Model table / skill-contract gates fail on the new composer row | Technical | Low | Low | Validation suite runs pre-commit; regenerate table in same diff |
| Rebase collision with in-flight specs touching `index.ts` | Integration | Medium | Low | Change is a small additive parser branch; standard rebase |

## ADRs Created

None. adr-2026-08-26-music-vocabulary-player-composer-rename rewritten in place (operator
direction 2026-08-28: the rescinded Player scope never reached main as code, so no amendment
trail is preserved; the filename keeps its stem for reference stability). Status remains
APPROVED pending operator approval of the rewrite in this review.

## Conditions

None.
