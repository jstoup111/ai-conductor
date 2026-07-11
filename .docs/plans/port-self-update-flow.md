# Implementation plan — port-self-update-flow

Extract the consumer self-update / channel flow from `bin/conduct` (327–470) into a
standalone, engine-independent `bin/update` bash script; re-home the auto-check onto
`conduct-ts` startup; update docs + CHANGELOG. Behavior-preserving (see stories).

Source functions to move: `render_changelog_range`, `semver_lt`,
`apply_harness_update`, `check_harness_update_tagged`, `check_harness_update_main`,
`check_harness_update`, `set_update_channel`.
Shared helpers they need: `conductor_cfg_get`, `conductor_cfg_set`, `render_md`,
`log/warn/ok/fail`, `HARNESS_DIR`, `ORIGINAL_ARGS`.

## Tasks

### T1 — Create `bin/update` skeleton + shared helpers
- Create `bin/update` with a shebang, `set -euo pipefail`-compatible guards, and
  `HARNESS_DIR` resolution (derive from the script's own path, not `bin/conduct`).
- Bring in the shared helpers. **Preferred:** factor `conductor_cfg_get/set`,
  `render_md`, and `log/warn/ok/fail` into `bin/lib/harness-common.sh` and
  `source` it from `bin/update` (and later from any residual caller).
  **Fallback:** copy the helpers inline; add a comment that #226 must not orphan
  the copy.
- `chmod +x bin/update`.

### T2 — Move the check functions verbatim
- Copy `render_changelog_range`, `semver_lt`, `apply_harness_update`,
  `check_harness_update_tagged`, `check_harness_update_main`, `check_harness_update`
  into `bin/update` unchanged except helper wiring.
- Keep the embedded `python3` heredocs (changelog render + config merge) intact.

### T3 — Adjust re-exec semantics (ADR consequence 2)
- In `apply_harness_update`, replace `exec "$0" "${ORIGINAL_ARGS[@]}"` with:
  write `currentVersion` + `lastCheckedAt`, print an "updated; re-run to pick it
  up" message, and `return 0`. Preserve the rollback-on-`bin/migrate`-failure path
  unchanged.

### T4 — Argument dispatch
- Parse args: no args → force `check_harness_update`; `--auto` → run
  `check_harness_update` only when `autoCheck != false` (else silent no-op);
  `--set-channel <c>` → `set_update_channel <c>` (move it over, keeping the
  exit-2-on-invalid behavior); `-h|--help` → usage.
- Move `set_update_channel` into `bin/update`.

### T5 — Re-home auto-check onto `conduct-ts` startup
- At `conduct-ts` startup (before the pipeline boots), spawn `bin/update --auto`
  as a subprocess; log-and-swallow any spawn/exec failure (advisory, non-blocking,
  Story 7 negative path).
- Resolve `bin/update`'s path relative to `HARNESS_DIR`.

### T6 — Documentation
- Rewrite HARNESS.md 286–307 to describe `bin/update` / `bin/update --set-channel`
  / `bin/update --auto` instead of `check_harness_update()` in `bin/conduct`.
- Update `README.md` and `src/conductor/README.md` command surface (per
  "Docs track features").

### T7 — CHANGELOG + migration block
- Add an `## [Unreleased]` entry (Added: `bin/update`; Changed: auto-check re-homed).
- Add a `## Migration` fenced ```bash block mapping `conduct --update` → `bin/update`
  and `conduct --set-channel X` → `bin/update --set-channel X` (required because the
  `bin/conduct` CLI surface changes).

### T8 — Tests + integrity
- Add a real-binary smoke test for `bin/update`: `--set-channel bogus` exits 2;
  `--set-channel main` writes the config key; `bin/update` in a non-git dir exits 0;
  `--auto` with `autoCheck=false` is a no-op. (Injected-runner argv tests alone are
  insufficient — require a real-binary smoke per harness lesson.)
- Ensure `bin/update` passes `bash -n` (integrity check 1) and the full
  `test/test_harness_integrity.sh` suite is green.

### T9 — Sequencing note for #226
- Add a comment in `bin/update` and a note in the PR body: #226 must delete the
  update block (and the duplicated helper copy, if inline) from `bin/conduct`, and
  must NOT remove `bin/update` or `bin/lib/harness-common.sh`.

## Task dependency graph

```
T1 ──▶ T2 ──▶ T3 ──▶ T4 ──▶ T8
                     │
T5 depends on T4 ────┘
T6, T7, T9 depend on T4 (command surface finalized)
T8 depends on T4 (and T5 for the --auto no-op assertion)
```

**Dependencies:** T2→T1; T3→T2; T4→T3; T5→T4; T6→T4; T7→T4; T8→T4,T5; T9→T4.

## Verification

- Behavioral diff: each moved function is byte-identical (modulo helper wiring +
  the T3 re-exec change) to its `bin/conduct` original.
- Stories 1–9 acceptance criteria pass via the T8 smoke tests + manual TTY check.
- `test/test_harness_integrity.sh` green.
- HARNESS.md / READMEs no longer reference `check_harness_update()` in `bin/conduct`.
