Waives: hook wiring

Rationale: This is a bugfix, not a breaking change to hook wiring semantics or the settings.json
schema — the RTK hook entry format and merge algorithm (configure_hooks) are unchanged. The bug
was that `rtk init -g --auto-patch` only ran on first-time dependency bootstrap, which
`bin/install --update` skips, so updates silently dropped the operator's RTK hook entry. The fix
moves that idempotent call onto the always-run install/update path. No consumer action is
required: the very next `bin/install` or `bin/install --update` run self-heals any existing
install that lost its RTK hook entry, because the fix itself IS the re-init call landing on the
path consumers already run. Zero consumer-facing schema or CLI flag changes.
