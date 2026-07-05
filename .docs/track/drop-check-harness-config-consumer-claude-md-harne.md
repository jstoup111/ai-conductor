# Track: Drop check_harness_config (consumer CLAUDE.md → HARNESS.md auto-upgrade)

Track: technical

Removing an internal harness auto-upgrade mechanism (`check_harness_config` in `bin/conduct`)
and reconciling its documentation. No user-facing product behavior changes — detection of a
missing HARNESS.md reference is already provided interactively by
`hooks/claude/session-start-context.sh`. Acceptance criteria live directly in stories; no PRD.
