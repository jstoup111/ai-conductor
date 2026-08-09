# Conflict Check: Update-check config single source of truth (#1400)

**Date:** 2026-08-09
**Inventory:** all `.docs/plans/` entries not yet in `.docs/shipped/`; every `.docs/stories/` and
`.docs/decisions/` file matching the config / install / update / user-config family; all 9 open pull
requests; `git log` for every file this change touches.
**Result:** **PASS — zero blocking conflicts.** One sequencing dependency is recorded and resolved.
No degrading conflict is accepted.

## Scan method

The change touches a narrow, enumerable surface, so the scan was exhaustive over that surface rather
than sampled:

| File this change touches | Open PR touching it | Unshipped plan touching it |
|---|---|---|
| `bin/lib/harness-common.sh` | none | none |
| `bin/update` | none | none |
| `bin/install` | none | none (see resolved sequencing item) |
| `bin/conduct` | none | none |
| `src/conductor/src/cli.ts` (config verbs) | none | none |
| `src/conductor/src/engine/user-config.ts` | none | none |
| `src/conductor/src/types/config.ts` (`ConductorConfig`) | none | none |
| `src/conductor/src/engine/config.ts` (`validateConductorBlock`) | none | none |
| `test/test_harness_integrity.sh` | none | none |
| `docs/reference/configuration.md`, `docs/reference/cli.md` | none | none |

Open PRs #1407, #1403, #1402, #1396, #1395, #1384, #1382, #1168, #890 were each checked against that
list; none touches any of these files. #1382 is the bot-owned release PR and is excluded by
construction — this branch writes neither `VERSION` nor `CHANGELOG.md`.

## Sequencing: #226 will delete `bin/conduct`, which today owns the only migration

**Stories involved:** Story 2 ("Existing installs seed once and keep their update identity") and
Story 6 ("Legacy translation residue is removed") vs
[#226](https://github.com/jstoup111/ai-conductor/issues/226) — "v1.0 cutover PR: remove bin/conduct,
make conduct-ts the only CLI" (open).
**Files:** `bin/conduct:226,2847` vs `bin/lib/harness-common.sh`
**Type:** sequencing
**Severity:** non-blocking (resolved by design, not deferred)
**Confidence:** 92% — #226's title and open state are verified; its exact final scope is not.

`migrate_legacy_conductor_config` exists only in `bin/conduct`. If this change left it there and #226
landed first, the seed would vanish and every un-upgraded install would silently lose its
update-check state on the next upgrade — a worse instance of the defect being fixed.

**Resolution Options:**

1. Move the seed into `bin/lib/harness-common.sh` now, so it is independent of #226's timing.
2. Leave it in `bin/conduct` and add a note to #226 to preserve it.
3. Block this change on #226 landing first.

**Resolution:** Option 1, already encoded in `adr-2026-08-09-conductor-block-single-source-of-truth.md`
decision 6 and Story 2's Done-When. `bin/update:12-14` explicitly names `bin/update` and
`bin/lib/harness-common.sh` as the permanent homes for this logic and instructs #226 not to remove
them, so Option 1 follows the sequencing note the codebase already carries. Option 2 relies on a
future author reading a comment — the failure mode this repository's design principles reject.
Option 3 needlessly couples a bug fix to a v1.0 cutover.

## Checked and found non-conflicting

**`user-level-config-for-8-keys-is-silently-discarded` (shipped 2026-07-30).** Governs project-over-user
deep-merge precedence and validation purity in `loadMergedConfig`. It concerns how the two *config
files* merge; this change concerns which *file* the update flow writes. `conductor:` is documented as
per-user state that project configs should not override (`types/config.ts:198-200`), so the merge
contract is untouched. No overlap.

**`guard-bin-install-and-self-build-relink-against-wo` (#363, landed — `ALLOW_WORKTREE_ROOT` present
in `bin/install`).** Adds a refusal guard at the top of `install()`. This change modifies
`configure_conductor()`, which runs after that guard. Independent.

**`drop-check-harness-config-consumer-claude-md-harne` (landed — `check_harness_config` absent from
`bin/conduct`).** Unrelated function, already removed.

**`install-and-first-run-paths-give-misleading-or-mis` (#1020, shipped, CLOSED).** Produced the
`bin/install --check` drift reporting at `:264-294`. `check_installation` does not inspect the
`conductor:` block, so repointing `configure_conductor()` does not change `--check` behavior.
Extending `--check` to report update-check config state is explicitly out of scope.

**`port-self-update-flow` (shipped).** Created `bin/update` and `bin/lib/harness-common.sh` and
carries the #226 sequencing note this change honors. It is the direct predecessor of this work, not
a competitor.

**[#1026](https://github.com/jstoup111/ai-conductor/issues/1026)** (a malformed user config blocks
every project on the machine) is an open, unowned hazard that this change *narrows* rather than
worsens: `config set` validates the `conductor` block before persisting
(`adr-2026-08-09-bash-yaml-access-via-conduct-ts-config.md` decision 3), so this change cannot be the
source of such a file. The broader gap remains #1026's to close.

## Corroborating precedent, not conflict

`git log` on `bin/install` shows six recent commits establishing the exact pattern this change
extends — `8fab1d1d2` and `5d80ed5b8` moved viewer/renderer config writes and reads to
`conduct-ts config`, and `69ee7fc13` made a missing `conduct-ts` a *named prerequisite error* rather
than a silent default. That last commit is the same loud-degradation rule Story 4 requires, already
accepted in this file. `bin/install` therefore currently contains both the target pattern
(`:264,278,712,809`) and the legacy one (`:914-963`); this change finishes a migration the repository
already started, and no competing pattern exists to conflict with.

## Resource and state conflicts

- **Shared write target:** `~/.ai-conductor/config.yml` is written by `bin/install` (viewer,
  renderer) and, after this change, by the update flow (`conductor:`). Both go through
  `writeUserConfig`'s read-modify-atomic-rename, which preserves unrelated top-level keys
  (`user-config.ts:70-82`), and Story 3 asserts that preservation. No lost-update risk within a
  single process; concurrent writes from two processes are not a new exposure introduced here.
- **`CHANGELOG.md` / `VERSION`:** not written by this branch, per repository policy. No contention
  with release PR #1382.
- **No oscillation risk:** the seed is one-directional and terminal — after the rename, no code path
  can write back to the legacy file, so no pair of rules can push state back and forth.
