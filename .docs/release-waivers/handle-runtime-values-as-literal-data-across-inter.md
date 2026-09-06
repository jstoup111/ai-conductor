Waives: skill symlink targets

Rationale: The release-gate classifier maps every bin/install edit to skill symlink targets, but this diff only rewrites configure_permissions and configure_hooks to use fixed interpreter source with argv and explicit failure status. No skill symlink is added, removed, retargeted, or renamed; no CLI grammar, hook wiring, or settings schema changes.
