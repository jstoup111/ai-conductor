# Story: Project Detection and Scaffolding

**Status:** ACCEPTED
**Epic:** EP-001 Conductor Core Engine
**Skill:** bootstrap/SKILL.md

As a developer onboarding to a project, I want the bootstrap skill to detect my project type,
tech stack, and scaffold the necessary directories and configuration so that the harness is
ready to use without manual setup.

## Acceptance Criteria

### Happy Path
- Given a new project without CLAUDE.md, when bootstrap runs, then it detects the project
  type (Rails, Node, Python, etc.) and tech stack from code and config files
- Given the project type is detected, when scaffolding runs, then it creates: CLAUDE.md
  (from template), `.memory/` directory, `.docs/` subdirectories (specs, stories, plans,
  conflicts, decisions, retros)
- Given tech-context exists for the detected stack, when bootstrap completes, then the
  matching tech-context files are loaded into the session
- Given the project already has CLAUDE.md and `.docs/`, when bootstrap runs, then it skips
  scaffolding and reports "Already bootstrapped"

### Negative Paths
- Given the project type cannot be detected (no recognizable framework files), when bootstrap
  runs, then it asks the user to specify the project type rather than guessing
- Given `.docs/` subdirectories partially exist (some present, some missing), when bootstrap
  runs, then it creates only the missing directories — it does not overwrite existing ones
- Given the CLAUDE.md template references HARNESS.md but HARNESS.md is not accessible, when
  bootstrap runs, then it warns about the missing reference

### Done When
- [ ] Project type and tech stack detected from code/config files
- [ ] CLAUDE.md generated from template
- [ ] .memory/ and .docs/ subdirectories created
- [ ] Tech-context loaded for detected stack
- [ ] Existing bootstrapped projects detected and skipped
- [ ] Partial scaffolding fills gaps without overwriting
