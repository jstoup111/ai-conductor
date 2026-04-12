# Story: Migration to Project Config

**Status:** DRAFT
**Epic:** EP-002 Pluggable Step Configuration
**Skill:** (bin/migrate enhancement)

As a developer upgrading to the new conductor, I want `bin/migrate` to generate a
`.harness/config.yml` from my project's current state so that I have an explicit config
rather than relying on silent defaults.

## Acceptance Criteria

### Happy Path
- Given an existing project without `.harness/config.yml`, when `bin/migrate` runs, then it
  detects the project's tech stack, current complexity tier (if set), and any prior harness
  state to generate a config file
- Given the config is generated, when presented to the user, then they review and approve
  it before it is written to disk
- Given the user approves, when the config is saved, then `.harness/config.yml` is written
  and the project is ready for the new conductor

### Negative Paths
- Given `.harness/config.yml` already exists, when migrate runs, then it reports "Config
  already exists" and offers to regenerate (with confirmation) or skip
- Given the project has no detectable tech stack, when migrate runs, then it generates a
  minimal config with harness defaults and asks the user to customize
- Given the user rejects the generated config, when declined, then no file is written and
  the user can re-run migrate after manual adjustments

### Done When
- [ ] bin/migrate generates .harness/config.yml from project state
- [ ] Generated config presented for user approval before writing
- [ ] Existing config detected — offers regenerate or skip
- [ ] Undetectable stack produces minimal config with defaults
- [ ] User rejection prevents file write
