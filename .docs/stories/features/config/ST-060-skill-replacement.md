# Story: Full Skill Replacement

**Status:** ACCEPTED
**Epic:** EP-003 Skill Override System
**Skill:** (new — config system)

As a developer, I want to replace a harness skill with my own project-local version so that
I can fundamentally change how a step behaves for my project.

## Acceptance Criteria

### Happy Path
- Given `.harness/config.yml` specifies `skills.overrides.tdd: .harness/skills/tdd/SKILL.md`,
  when the conductor invokes the tdd step, then it uses the project-local skill file
- Given the override skill exists and has valid frontmatter, when resolved, then it completely
  replaces the harness default — no merging or inheritance
- Given skill resolution runs, when a step has both a harness default and a project override,
  then the project override takes precedence

### Negative Paths
- Given an override path points to a nonexistent file, when the conductor loads skills, then
  it fails with: "Skill override for '[skill]' not found: [path]"
- Given the override SKILL.md has invalid frontmatter (missing name, description, enforcement,
  or phase), when validated, then the conductor reports the missing fields and stops
- Given an override changes the enforcement level of a gating step (e.g., stories from
  gating to advisory), when loaded, then the conductor ignores the override's enforcement
  field and enforces the hardcoded gating level — the skill content is replaced but the
  enforcement level is locked for gating steps (stories, plan, build, finish)
- Given an override changes the enforcement level of a non-gating step (e.g., retro from
  advisory to gating), when loaded, then the change is accepted — only gating steps have
  locked enforcement

> **Conflict resolution (2026-04-12):** Enforcement is locked for gating steps to prevent
> bypass via override. See .docs/conflicts/2026-04-12-pluggable-harness-stories.md, Conflict 1.

### Done When
- [ ] Project-local skill replaces harness default completely
- [ ] Resolution order: project .harness/skills/ > harness skills/
- [ ] Missing override file detected and reported
- [ ] Invalid frontmatter validated and errors reported
- [ ] Enforcement locked for gating steps (stories, plan, build, finish) — overrides cannot downgrade
- [ ] Enforcement changeable for non-gating steps
