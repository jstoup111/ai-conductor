Waives: skill symlink targets

Rationale: This change only removes RTK ("Rust Token Killer") from bin/install — the
binary bootstrap block (brew/cargo/curl), the `rtk init -g --auto-patch` Claude Code
hook reinit that ran on every install and --update, and the `--check` report line. The
self-host release-gate classifier flags ANY edit to `bin/install` as the "skill symlink
targets" breaking surface (self-host/release-gate.ts:201 maps `bin/install` →
CANONICAL_BREAKING_SURFACES[1]), but this edit touches no skill symlinks, no
settings.json schema, no harness hook wiring, and no bin/conduct CLI. It removes an
optional third-party tool's install path; the harness neither installs nor uninstalls
RTK afterward, and no consumer-visible CLI/hook/schema behavior changes. Per
adr-2026-07-06-migration-gate-waiver, an internal-only edit flagged by the path-based
classifier is waived rather than given an empty migration block.
