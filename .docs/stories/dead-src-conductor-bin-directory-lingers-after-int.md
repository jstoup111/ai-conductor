**Status:** Accepted

# Stories: Dead src/conductor/bin/ directory lingers after intake-file moves into the skill (#2791)

Technical track (no PRD). Removal-shaped per `/code-removal`: criteria describe the intake filing
behavior that must survive deleting the stale `src/conductor/bin/` copy, not the copy's absence.

## Story 1: Intake filing through the bundled skill helper survives the removal

**Requirement:** Technical intent — #2791 desired outcome "Intake filing through the intake skill's bundled helper behaves exactly as it did before the removal."

As an agent or operator filing an intake issue, I want the intake skill's bundled helper to keep
working after the stale `src/conductor/bin/` copy is deleted, so that the only intake entry point
is the one that type-checks and is tested.

### Acceptance Criteria

#### Happy Path
- Given the stale `src/conductor/bin/` copy has been deleted, when the bundled `skills/intake/scripts/intake-file` helper is run from a caller repository with a title and body, then it reaches the intake filing CLI and the production gh adapter runs with the caller repository as its working directory.
- Given the stale `src/conductor/bin/` copy has been deleted, when the bundled helper is reached through a symlinked skill directory, then it resolves the harness that owns it and passes the caller directory and argument order through unchanged.

#### Negative Paths
- Given the stale `src/conductor/bin/` copy has been deleted, when the bundled helper is run without the required title and body arguments, then it prints the CLI usage and exits non-zero without reaching gh.
- Given the stale `src/conductor/bin/` copy has been deleted, when the bundled helper finds no qualifying harness root by walking up from itself or through `ai-conductor` on PATH, then it reports the walked-from helper path and the PATH result and exits non-zero.

### Done When
- [ ] The feature diff deletes `src/conductor/bin/intake-file` and changes no other file.
- [ ] `src/conductor/test/skills/intake-file-helper-entry.test.ts` and `src/conductor/test/skills/bundled-helper-resolution.test.ts` pass unchanged against the post-deletion tree.
- [ ] `test/test_lint_shell_enumeration.sh` passes unchanged, still listing `skills/intake/scripts/intake-file` in the real-tree enumeration.
