# Complexity: bin/install --uninstall removes installer settings and reports preserved state (#1004)

Tier: S

## Rationale

Small. The operator narrowed issue #1004 (filed as M) to a minimal scope that stays inside one existing
function in one script, plus its documentation note and one new test:

- **One function carries the logic.** `uninstall()` in `bin/install` gains a settings-removal pass
  (python3, the same interpreter `configure_permissions`/`configure_hooks` already require), a
  rate-card link removal mirroring `sync_global_rate_card`'s ownership test, and a kept-state report.
- **Ownership needs no new list.** Hook entries are harness-owned by path (`${HARNESS_DIR}/hooks/claude/`);
  permissions reuse the existing `HARNESS_PERMISSIONS` array. Install code does not change.
- **One additive flag.** `--purge` extends the existing argument dispatch and usage text.
- **No new state, schema, config key, engine code, or subsystem.** No `conduct-ts` change.
- **Test surface is one shell test** in the existing `test/test_install_*.sh` style, running install and
  uninstall against a throwaway `HOME`.

Not M: there is no cross-component design question left. The operator already made the ownership model,
the state-directory policy, and the scope calls, so an architecture review or conflict check would have nothing to decide.

**Release surface note:** install-time hook wiring and the settings schema are unchanged, and uninstall
only runs on demand. If the self-host release gate's path classifier flags `bin/install` as a breaking
surface, a `.docs/release-waivers/` entry is the right response, not a migration block.
