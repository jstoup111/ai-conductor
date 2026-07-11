# ADR 2026-07-05 — Extract the self-update/channel flow to a standalone `bin/update`

Status: APPROVED

## Context

The v1.0 cutover (#228) removes `bin/conduct` (#226). The consumer self-update /
channel flow lives entirely inside that bash CLI (`bin/conduct` 327–470):
`check_harness_update` (dispatch), `check_harness_update_tagged`,
`check_harness_update_main`, `set_update_channel`, `render_changelog_range`,
`semver_lt`, `apply_harness_update` (→ `bin/migrate` → re-exec), wired at
`--update` / `--set-channel` (2854–2855) and auto-invoked on every run (2894).
HARNESS.md 286–307 documents this as *the* update mechanism. Removing `bin/conduct`
without relocating it strips consumers' ability to update the harness at all.

Two landing spots were considered: port into the TypeScript CLI (`conduct-ts
update` / `conduct-ts channel`), or extract to a standalone `bin/update` bash
script.

## Decision

**Extract to a standalone `bin/update` bash script.** It is pure git + file +
config plumbing with no engine dependency. The operator confirmed this direction.

Command surface:

- `bin/update` — force a check now (replaces `conduct --update`).
- `bin/update --auto` — auto-check honoring `autoCheck`; silent no-op when disabled
  or nothing is available (replaces the implicit line-2894 check on every run).
- `bin/update --set-channel <tagged|main>` — flip the channel (replaces
  `conduct --set-channel`).

## Rationale

- **Bootstrap safety (decisive).** The updater must not depend on the artifact it
  updates. A consumer typically updates *because* their `conduct-ts` bundle is
  broken or stale; `conduct-ts update` could not run in that state. Bash `bin/update`
  self-heals a broken engine. This aligns with the shared-dist rebuild hazard
  already observed in the daemon.
- **Least behavioral risk.** Extraction is a near-verbatim move of proven bash;
  a TS reimplementation would re-derive git/semver/changelog/rollback logic and
  risk drift on a correctness-critical cutover blocker.
- **No new runtime.** No compile step, no engine import; the script works with a
  bare git checkout, matching the harness's "pure Markdown + bash + git" ethos.

Trade-off accepted: one more bash file to maintain, mildly counter to the
"consolidate everything on conduct-ts" v1.0 goal. Judged worth it for
bootstrap resilience.

## Consequences / resolutions

1. **Shared helpers.** The moved functions depend on `conductor_cfg_get/set`,
   `render_md`, `log/warn/ok/fail`, `HARNESS_DIR`, and `ORIGINAL_ARGS` from
   `bin/conduct`. Since `bin/conduct` is being removed, these helpers are copied
   into `bin/update` (or a small shared `bin/lib/*.sh` sourced by it). `bin/update`
   must be self-contained and pass `bash -n` + the harness integrity suite.
2. **Re-exec semantics.** `apply_harness_update` currently ends with
   `exec "$0" "${ORIGINAL_ARGS[@]}"` to re-launch the pipeline on the new version.
   `bin/update` is not the pipeline entry, so on success it **returns 0** and prints
   a "re-launch to pick up the update" message; the caller (`conduct-ts` startup,
   or the operator) proceeds on the freshly-checked-out harness. Rollback on
   `bin/migrate` failure is unchanged.
3. **Auto-check integration.** `conduct-ts` startup spawns `bin/update --auto` as a
   subprocess before booting the pipeline, preserving the "check on every run"
   behavior without importing update logic into the engine. If the spawn fails,
   it is logged and swallowed (advisory, never blocks the pipeline).
4. **Docs.** HARNESS.md 286–307 is rewritten in the same PR to describe `bin/update`
   instead of `check_harness_update()` in `bin/conduct`; README / src/conductor
   README updated per the repo's "Docs track features" rule.
5. **Migration.** Because this changes the `bin/conduct` CLI surface, the PR
   carries a `## Migration` block mapping `conduct --update` → `bin/update` and
   `conduct --set-channel X` → `bin/update --set-channel X`.
