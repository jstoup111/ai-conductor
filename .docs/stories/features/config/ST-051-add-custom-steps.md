# Story: Add Custom Steps via Project Config

**Status:** DRAFT
**Epic:** EP-002 Pluggable Step Configuration
**Skill:** (new — config system)

As a developer, I want to add project-specific steps to the SDLC flow so that my project's
unique needs are part of the automated pipeline.

## Acceptance Criteria

### Happy Path
- Given `.harness/config.yml` contains a custom step with `after: build` and a path to a
  SKILL.md, when the conductor builds the step registry, then the custom step is inserted
  after the `build` step
- Given the custom step's SKILL.md exists and has valid frontmatter, when the step executes,
  then the conductor invokes it the same way it invokes built-in steps
- Given the custom step completes, when the conductor advances, then state is tracked in
  conduct-state.json like any built-in step

### Negative Paths
- Given a custom step references a SKILL.md path that doesn't exist, when the conductor
  loads config, then it fails with: "Custom step '[name]' references missing skill:
  [path]"
- Given a custom step specifies `after: nonexistent_step`, when parsed, then the config
  is rejected with: "Custom step '[name]' references unknown step: [after]"
- Given a custom step's SKILL.md has invalid frontmatter (missing required fields), when
  loaded, then the conductor reports the validation error and stops
- Given two custom steps both specify `after: build`, when the registry is built, then they
  are inserted in the order they appear in the config file

### Done When
- [ ] Custom steps inserted at specified position (after: <step>)
- [ ] Custom step SKILL.md invoked like built-in steps
- [ ] Custom step state tracked in conduct-state.json
- [ ] Missing SKILL.md detected and reported
- [ ] Invalid insertion point detected and reported
- [ ] Multiple steps at same position ordered by config file order
