Waives: bin/conduct CLI, skill symlink targets

Rationale: The changed bin/conduct behavior is an internal update-identity resolution helper, with no consumer-visible CLI grammar, hook wiring, skill symlink target, or settings schema change. The bin/install edits are confined to detect_current_version/configure_conductor (release-identity detection and config seeding); no symlink creation, target, or layout logic is touched anywhere in the diff — the skill-symlink surface is flagged by the path-based classifier only.
