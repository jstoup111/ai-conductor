# ADR: The schema-owned `conductor:` block is the single source of truth for update-check state

**Date:** 2026-08-09
**Status:** APPROVED (operator, 2026-08-09)
**Deciders:** James Stoup (operator), engineer session for intake #1400
**Feature:** update-check config single source of truth (ai-conductor#1400)
**Related:** `adr-2026-08-09-legacy-json-seed-migration-rule.md`,
`adr-2026-08-09-bash-yaml-access-via-conduct-ts-config.md`,
[#226](https://github.com/jstoup111/ai-conductor/issues/226) (removes `bin/conduct`)

## Context

Issue #1400 reports that update-check state lives in two files that disagree. Discovery showed the
situation is not symmetric, which changes what "pick a source of truth" means.

**Verified in the current tree:**

| Surface | Writers | Readers |
|---|---|---|
| `~/.claude/ai-conductor.config.json` (flat camelCase) | 3 — `bin/install:930,947` (direct `python3` JSON, bypassing the accessors entirely), `bin/conduct:333,334,360,371,470`, `bin/update:114,115,141,152,271` | 2 — `bin/conduct:362,453,456`, `bin/update:143,238,259` |
| `~/.ai-conductor/config.yml` `conductor:` | 1 — `migrate_legacy_conductor_config` (`bin/conduct:226`, invoked `:2847`) | **0 in production** |

The YAML block is typed (`ConductorConfig`, `types/config.ts:202-207`), schema-validated
(`validateConductorBlock`, `engine/config.ts:1133-1166`), and documented
(`docs/reference/configuration.md:17-20`) — and **nothing reads it**. `readLegacyJson()`
(`user-config.ts:87-106`) is exported with zero production callers.

The migration that populated it runs only from `bin/conduct` and short-circuits once
`conductor.current_version` is non-empty, so it wrote once and never reconciled again. The operator's
live YAML is frozen at `2026-05-01` with `update_channel: tagged` while the live JSON says
`updateChannel: main` — a material divergence, since one tracks release tags and the other tracks
main.

So the defect is **one live source plus a decorative, validated, never-read snapshot**, not two
competing sources. Both directions therefore satisfy issue outcome #1 ("editing the documented
location changes real behavior"); the choice turns on which location should *be* the documented one.

## Options Considered

### Option A: The YAML `conductor:` block wins; the legacy JSON is demoted to a seed input

- **Pros:** Makes the already-typed, already-validated, already-documented surface real, with no
  schema design work. Moves per-user harness state out of `~/.claude/`, a Claude-Code-branded path,
  which matters because the repository is actively pursuing provider-agnosticism (Codex host parity,
  `.docs/plans/2026-07-25-first-class-codex-harness-parity-904.md`; native non-Claude session
  launching, #759). Consolidates per-user state into the one file `conduct-ts` already owns, next to
  `markdown_viewer` and `mermaid_renderer`.
- **Cons:** Touches three writers plus a TypeScript CLI surface. Naively wiring bash to YAML would
  make PyYAML load-bearing — mitigated by `adr-2026-08-09-bash-yaml-access-via-conduct-ts-config.md`.
- **Effort:** M.

### Option B: The legacy JSON wins; delete the `conductor:` block from the type, validator, and docs

- **Pros:** Cheapest by a wide margin (~S). Zero behavior change — the code is already internally
  consistent; only the schema and documentation lie. No PyYAML question arises. Removes
  `migrate_legacy_conductor_config` and `readLegacyJson` as dead weight.
- **Cons:** Permanently enshrines per-user harness state under `~/.claude/`, directly against the
  provider-agnostic direction: a Codex-only operator would carry a Claude-branded config path with no
  Claude installed. Discards a validated schema in favor of an unvalidated flat JSON blob, so
  `bin/update` keeps accepting an arbitrary `updateChannel` string with no error. Splits per-user
  config across two files by design (`markdown_viewer` in YAML, update state in JSON).
- **Effort:** S.

### Option C: Hybrid — YAML canonical, JSON mirrored, precedence documented

- **Pros:** Survives an install without PyYAML. Lowest migration risk.
- **Cons:** Keeps two files by construction, which is exactly what issue outcome #1 forbids ("there
  is no second file that silently wins"). Every future writer must remember to update both; the
  next drift is a matter of time, and the integrity check demanded by outcome #4 cannot be written
  in a form that means anything.
- **Effort:** M.

## Decision

**Option A.** The `conductor:` block in `~/.ai-conductor/config.yml` is the sole source of truth for
update-check state (`update_channel`, `auto_check`, `current_version`, `last_checked_at`).

1. **Every read and write of update-check state goes through the YAML block.** The accessors
   `conductor_cfg_get` / `conductor_cfg_set` (`bin/lib/harness-common.sh:34,53`) are repointed at the
   `conductor.<snake_case_key>` paths, keeping their existing call signatures so the ten call sites
   in `bin/update` and `bin/conduct` need no per-site edits.

2. **`bin/install` is repointed too.** It writes the legacy JSON directly at `:930` and `:947`,
   bypassing the accessors, so repointing the accessors alone would leave a third writer resurrecting
   the JSON on every install and update. `configure_conductor()` must write through the same path as
   everything else.

3. **The key names become the schema's names.** `updateChannel` → `update_channel`, `autoCheck` →
   `auto_check`, `currentVersion` → `current_version`, `lastCheckedAt` → `last_checked_at`. This
   satisfies issue outcome #3 directly.

4. **The legacy JSON is demoted, not deleted.** It becomes a read-once seed input
   (`adr-2026-08-09-legacy-json-seed-migration-rule.md`) and is thereafter never read and never
   written. It stays on disk as a backup.

5. **`readLegacyJson()` and `legacyJsonPath()` are removed** from `engine/user-config.ts` along with
   their tests. They have no production callers, and after this change the only remaining legacy
   reader is the bash seed path, which does its own translation. Leaving an exported TypeScript
   legacy reader in place is precisely the residue that lets the split reappear.

6. **`migrate_legacy_conductor_config` moves out of `bin/conduct`** into
   `bin/lib/harness-common.sh` as the new seed function. #226 will delete `bin/conduct`, and
   `bin/update:12-14` names `bin/update` and `bin/lib/harness-common.sh` as the permanent homes for
   this logic. Leaving the migration in `bin/conduct` would silently delete it at cutover.

7. **A new `test/test_harness_integrity.sh` check fails closed** if the update flow names a config
   surface the schema does not own — specifically, if any file under `bin/` other than the seed
   function references the legacy JSON path, or if `bin/update` reads or writes a `conductor` key
   absent from `validateConductorBlock`'s `allowed` set. This is issue outcome #4, and it is what
   makes the fix durable rather than a one-time cleanup.

## Consequences

- The documented surface becomes the real one. An operator editing `conductor.update_channel` in
  `~/.ai-conductor/config.yml` changes update behavior, and `validateConductorBlock`'s per-key error
  messages become meaningful instead of decorative.
- Per-user harness state consolidates into one provider-neutral file, unblocking Codex-only operators
  who should not need a `~/.claude/` directory.
- The integrity check adds a standing constraint on `bin/` authoring: the legacy path may be named in
  exactly one place.
- `bin/conduct` keeps its duplicated update block until #226, but its accessors now resolve to YAML
  through the shared library, so the two CLIs cannot diverge in the interim.
- **Release surface.** Extending the `conduct-ts` CLI is additive, but this diff touches `bin/conduct`
  and `bin/install`. The repository's path-based release-gate classifier may flag the `bin/conduct CLI`
  breaking surface. The change is a user-visible config relocation with an automatic migration, so the
  correct instrument is a real `## Migration` block in the PR body, not a waiver.

## Alternatives rejected and why

- **Option B** was rejected on provider-agnosticism, not on effort. It is genuinely cheaper and would
  close the issue, but it would have to be undone by the Codex parity work.
- **Option C** was rejected because it re-specifies the split-brain as intended behavior and makes
  outcome #4's check unwritable.
