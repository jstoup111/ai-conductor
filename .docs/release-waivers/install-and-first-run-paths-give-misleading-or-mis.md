Waives: skill symlink targets

Rationale: The path-based release classifier flags the `bin/install` edits as
skill symlink targets, but this change only corrects install and first-run
diagnostics and replaces PyYAML configuration reads and writes with existing
`conduct-ts config` subcommands. It does not change any consumer-visible CLI,
hook wiring, settings schema, or symlink target, so a migration block would be
empty.
