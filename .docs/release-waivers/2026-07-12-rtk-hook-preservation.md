Waives: skill symlink targets

Rationale: The release-gate classifier flags this PR under "skill symlink targets" because it
maps any change to `bin/install` to that surface — a classifier quirk, not a reflection of what
this diff does. No skill symlinks are touched, added, removed, or renamed by this change. The
diff is a `bin/install`-only bugfix (plus CHANGELOG.md and test/ updates, neither a breaking
surface): `rtk init -g --auto-patch` only ran on first-time dependency bootstrap, which
`bin/install --update` skips, so updates silently dropped the operator's RTK hook entry. The fix
moves that idempotent call onto the always-run install/update path and drops a stale `--check`
sub-check. No consumer-facing CLI flag, schema, or symlink-target change is involved. No consumer
action is required: the very next `bin/install` or `bin/install --update` run self-heals any
existing install that lost its RTK hook entry, because the fix itself IS the re-init call landing
on the path consumers already run.
