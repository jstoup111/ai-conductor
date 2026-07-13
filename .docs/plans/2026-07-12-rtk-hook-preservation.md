# Implementation Plan: RTK hook re-init on install & update

Relates-to: jstoup111/ai-conductor#608
Track: technical · Tier: S
Primary file: `bin/install` · Tests: `test/` (bash)

Minimal, operator-directed fix: run the idempotent `rtk init -g --auto-patch` whenever `rtk`
is on PATH, on both the install and `--update` paths — no longer gated on the
`~/.claude/hooks/rtk-rewrite.sh` script file. TDD: write failing bash tests first, keep `rtk`
mocked, run `test/test_harness_integrity.sh` before commit.

## Task Dependency Graph

```
T0 ─▶ T1 ─▶ T2 ─▶ T3 ─▶ T4 ─▶ T5
```

---

### T0 — Confirm edit sites
Re-read `bin/install`: `182–191` (`--check` RTK block), `494–506` (`rtk init` gate inside
`install_dependencies`), `1152–1175` (main: `configure_hooks` + `UPDATE_MODE` skip). Confirm
`rtk init` today lives only inside the `--update`-skipped `install_dependencies`.
**Dependencies:** none.

### T1 — Mocked `rtk` test fixture
Add a reusable test helper: a fake `rtk` on a temp PATH that counts `init` calls and, on
`rtk init -g --auto-patch`, writes a known RTK hook entry into `$HOME/.claude/settings.json`.
Add temp-HOME setup/teardown so no test touches the real `~/.claude`.
**Dependencies:** T0.

### T2 — RED: failing bash tests for S1–S6
`test/test_rtk_hook_reinit.sh`: lost-entry restore on install (S1), lost restore on
`--update` with no binary bootstrap (S2), existing entry survives re-init (S3), operator
custom hook preserved across install+update (S4), no-binary no-op (S5), fresh-env init (S6).
Assert on init-call count and settings-entry presence. Confirm they FAIL against current
`bin/install`.
**Dependencies:** T1.

### T3 — Move RTK re-init onto the always-run path (fixes G1 + G2)
Extract the `rtk init -g --auto-patch` invocation (currently `bin/install:494–506`) into the
always-run section of `install()` — e.g. call it right after `configure_hooks` (`~:1160`),
guarded by `|| warn` like its neighbors — so it runs in both plain and `--update` modes.
Remove the `[ -f ~/.claude/hooks/rtk-rewrite.sh ]` gate: with `rtk` on PATH, always run the
idempotent init. Leave the RTK **binary bootstrap** (`:468–492`) in `install_dependencies`
(bootstrap-only; still `--update`-skipped) so `--update` never runs brew/cargo/curl.
**Dependencies:** T2.

### T4 — Align the `--check` RTK block
In `check_installation` (`:182–191`), keep the "rtk installed?" report but stop asserting hook
health purely from the script file. Either report presence of the settings entry, or (minimal)
drop the misleading "hook initialized" claim so `--check` no longer reports a lost entry as
healthy. Keep the "rtk not installed" branch unchanged (S5).
**Dependencies:** T3.

### T5 — CHANGELOG + validation + GREEN
Add a `## [Unreleased]` → `Fixed` entry describing the install/update RTK re-init fix. Run
`test/test_harness_integrity.sh` and the new `test/test_rtk_hook_reinit.sh`; all green.

Migration note: this change touches the "hook wiring" surface, so the self-host release gate
may ask for a `## Migration` block. If it flags, add a one-line migration that runs
`rtk init -g --auto-patch` (guarded by `command -v rtk`) so existing installs self-heal on the
update that lands this fix — that is the operator-benefiting resolution and matches the fix
itself. (Confirm against the gate's actual classification during build; do not pre-invent an
empty block.)
**Dependencies:** T4.

---

## Non-negotiables carried into build

- `rtk` is **mocked** in all tests — CI must never require the real binary.
- No test touches the real `~/.claude`; every test uses a temp `$HOME`.
- `configure_hooks` merge algorithm is unchanged (only relied on for S4 preservation).
- Binary bootstrap stays bootstrap-only and `--update`-skipped; only the idempotent
  `rtk init` re-init moves to the always-run path.
- Run `test/test_harness_integrity.sh` before commit (repo policy).
