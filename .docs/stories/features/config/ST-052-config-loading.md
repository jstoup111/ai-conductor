# Story: Config File Loading and Validation

**Status:** ACCEPTED
**Epic:** EP-002 Pluggable Step Configuration
**Skill:** (new — config system)

As a developer, I want the conductor to load and validate `.harness/config.yml` at startup
so that misconfigurations are caught early with clear error messages.

## Acceptance Criteria

### Happy Path
- Given `.harness/config.yml` exists and is valid YAML, when the conductor starts, then it
  parses the config and applies all settings before the first step runs
- Given the config specifies `harness_version: ">=1.0.0"`, when the installed harness version
  matches, then the config is accepted
- Given no `.harness/config.yml` exists, when the conductor starts, then it fails with:
  "No .harness/config.yml found. Run `bin/migrate` to generate one."

### Negative Paths
- Given the YAML is malformed (syntax error), when parsed, then the conductor reports the
  parse error with line number and column and stops
- Given the config specifies `harness_version: ">=2.0.0"` but the installed harness is 1.x,
  when the version check runs, then it fails with: "Config requires harness >=2.0.0 but
  installed version is 1.x.x"
- Given the config contains unknown top-level keys, when validated, then it warns about
  unrecognized keys but does not fail (forward compatibility)
- Given the config contains a recognized key with an invalid value type (e.g., `steps.disable`
  is a string instead of a list), when validated, then it fails with a type error

### Done When
- [ ] Config loaded from .harness/config.yml at conductor startup
- [ ] Harness version compatibility checked
- [ ] Missing config fails with migration instructions
- [ ] YAML parse errors reported with line numbers
- [ ] Version mismatch reported with installed vs required versions
- [ ] Unknown keys produce warnings (not failures)
- [ ] Type validation catches incorrect value types
