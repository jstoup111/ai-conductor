# ADR: The legacy JSON seeds the YAML once and wins that seed; the rename is the idempotence marker

**Date:** 2026-08-09
**Status:** APPROVED (operator, 2026-08-09)
**Deciders:** James Stoup (operator), engineer session for intake #1400
**Feature:** update-check config single source of truth (ai-conductor#1400)
**Related:** `adr-2026-08-09-conductor-block-single-source-of-truth.md` (establishes the target),
`adr-2026-08-09-bash-yaml-access-via-conduct-ts-config.md` (how the write happens)

## Context

Issue #1400's outcome #5 requires that divergent pre-existing values "resolve by an explicit
documented rule, not by whichever file is read first." The divergence is real and live on the
operator's machine:

| Key | Legacy JSON (live) | YAML `conductor:` (frozen 2026-05-01) |
|---|---|---|
| channel | `main` | `tagged` |
| version | `v0.100.0` | `v0.99.12` |
| last checked | `2026-08-09T11:29:25Z` | `2026-05-01T20:49:30Z` |

Outcome #2 constrains the rule sharply: existing installs must migrate "without losing
`currentVersion`/`lastCheckedAt` — an operator who never touches either file keeps their correct
installed-version identity, since `bin/update:133-138` treats a wrong `currentVersion` as
unverifiable and stops checking."

That is not a soft preference. `check_harness_update_tagged` reads `current_version`, and if it does
not match `^v[0-9]+\.[0-9]+\.[0-9]+$` it warns *"Installed tagged release is unverifiable"* and
returns. Because `bin/update --auto` is spawned advisory-only by `auto-update-check.ts` (which
swallows every failure), that warning is invisible in normal operation. A migration that writes a
stale or empty `current_version` therefore **silently disables update checking forever**, with no
error surfaced to anyone. This is the exact class of failure the issue was filed about.

The existing `migrate_legacy_conductor_config` (`bin/conduct:226`) is one-shot: it bails when
`conductor.current_version` is already non-empty. Under the old design — where nothing else ever
wrote the YAML — that made the block freeze permanently. Under the new design a one-shot seed is
correct; the question is what marks "already seeded" in a way that cannot misfire.

## Options Considered

### Which file wins the seed

**Option A: Legacy JSON wins the one-time seed; YAML is authoritative thereafter.**
- **Pros:** The JSON is the only file anything has written since 2026-05-01, so it is the only one
  that reflects real behavior. Satisfies outcome #2 by construction: no install loses
  `current_version` or `last_checked_at`, and no operator's channel silently flips. On the operator's
  machine, `main`/`v0.100.0` carry forward.
- **Cons:** For one moment the "legacy" file is authoritative, which reads as inconsistent with
  "the YAML is the source of truth" until you note the seed is a strictly one-time boundary.

**Option B: YAML wins outright, even when stale.**
- **Pros:** Trivially consistent with the target-state rule; no ordering subtleties.
- **Cons:** On this operator's machine it reverts the channel `main` → `tagged` and
  `current_version` → `v0.99.12`. `bin/update` then compares `v0.99.12` against the latest tag and
  either offers a spurious "update" to an already-installed release or — for any operator whose
  frozen YAML predates the block entirely — reads empty and stops checking. **Directly violates
  outcome #2.**

**Option C: Freshest `last_checked_at` breaks the tie.**
- **Pros:** Deterministic and symmetric; no file is privileged a priori.
- **Cons:** Depends on a timestamp that the frozen writer, by definition, stopped updating — so it
  is Option A with extra machinery and a silent failure mode if a clock skew or a hand-edited YAML
  timestamp ever exceeds the JSON's.

### What marks "already seeded"

**Option W: A `seeded_from_legacy` key inside the `conductor:` block.**
- **Cons:** `validateConductorBlock` rejects unknown keys, so this requires adding an internal
  migration flag to a user-facing typed schema and documenting it in
  `docs/reference/configuration.md` as a key operators must never set. Schema pollution.

**Option X: A sentinel file, e.g. `~/.ai-conductor/.legacy-seeded`.**
- **Cons:** Introduces a third state file to fix a two-file problem. The integrity check from
  outcome #4 would have to carve out an exception for it.

**Option Y: Treat a non-empty `conductor.current_version` as the marker.**
- **Cons:** This is today's mechanism and it is fragile in a new way. A fresh install with no legacy
  JSON never sets it, so the seed re-attempts on every run (harmless), but an operator who clears or
  hand-edits `current_version` to empty re-triggers a seed from a months-old JSON, silently reverting
  their channel. Reuses a mechanism whose failure mode is what filed this issue.

**Option Z: Rename the legacy JSON after a successful seed; its presence at the original path is the
marker.**
- **Pros:** No schema change, no third file, idempotent by construction — the trigger and the marker
  are the same fact, so they cannot disagree. Makes the demotion visible to an operator inspecting
  `~/.claude/`. Preserves the file as a backup rather than deleting it.
- **Cons:** Mutates a path in `~/.claude/`. Acceptable, because after this change nothing reads it.

## Decision

**Option A for precedence, Option Z for the marker.**

1. **Seed rule.** On the first run after upgrade, if `~/.claude/ai-conductor.config.json` exists at
   its original path, its four values are translated to snake_case and written into the YAML
   `conductor:` block, **overwriting any value already there**. The legacy JSON wins the seed
   because it is the only file that has been written since 2026-05-01.

2. **Marker.** On a successful seed, the legacy JSON is renamed to
   `~/.claude/ai-conductor.config.json.migrated`. Its absence at the original path is the sole
   "already seeded" signal. The seed never runs again, and the YAML is authoritative from that point
   forward. If the rename fails, the seed reports failure and does **not** claim success — a
   re-seed on the next run is idempotent and harmless, whereas a false "seeded" claim is not.

3. **Fresh installs.** With no legacy JSON present, the seed is a no-op and `bin/install` writes the
   `conductor:` block directly. No marker is needed because there is nothing to seed.

4. **Partial legacy data.** Keys absent or type-invalid in the legacy JSON are skipped individually,
   not defaulted — an absent `autoCheck` leaves `conductor.auto_check` unset so the reader's own
   default (`true`) applies, rather than baking a value the operator never chose. A legacy
   `updateChannel` that is neither `tagged` nor `main` is dropped with a warning rather than written,
   since writing it would produce a YAML file that fails merged validation and blocks every project
   on the machine (the #1026 hazard).

5. **Ordering is enforced structurally, not by convention.** The seed is invoked as a precondition at
   the top of **both** `conductor_cfg_get` and `conductor_cfg_set`, guarded by a process-scoped flag
   so it runs at most once per shell invocation. This makes it impossible for any caller to read or
   write the YAML before seeding. Relying on each entry point to call the seed first would break at
   the first new caller — and would break immediately for `bin/install`, whose `configure_conductor()`
   writes `current_version` and would otherwise have that fresh value overwritten by the older JSON
   moments later.

## Consequences

- The operator's machine carries forward `update_channel: main`, `current_version: v0.100.0`, and a
  live `last_checked_at`; the stale `tagged` / `v0.99.12` / `2026-05-01` values are discarded. This
  is the intended reading of the operator's instruction to set the user-scoped YAML to current.
- `~/.claude/ai-conductor.config.json.migrated` remains on disk indefinitely as a backup. Nothing
  reads it. It is not cleaned up by this change.
- The seed is a permanent fixture of `bin/lib/harness-common.sh`, not a transitional script, because
  an operator may upgrade from any prior version at any time.
- Because the trigger is the file's presence rather than a config value, an operator who restores the
  backup to its original path deliberately re-seeds from it. That is a usable manual recovery path
  and is documented as such.
