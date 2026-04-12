# Story: Tier-Based Step Skipping

**Status:** DRAFT
**Epic:** EP-001 Conductor Core Engine
**Skill:** conduct/SKILL.md

As a developer, I want the conductor to automatically skip steps that aren't relevant to my
feature's complexity tier so that small features don't suffer unnecessary ceremony.

## Acceptance Criteria

### Happy Path
- Given a feature classified as Small, when the conductor runs, then it skips: conflict-check,
  architecture-diagram, architecture-review, acceptance-specs, pipeline (uses direct /tdd),
  code-review, and retro
- Given a feature classified as Medium, when the conductor runs, then it runs all steps with
  a lightweight architecture-review (feasibility + alignment only)
- Given a feature classified as Large, when the conductor runs, then all steps run fully
- Given a step is skipped due to tier, when displayed in the dashboard, then it shows the
  skip icon and is marked `skipped` in state

### Negative Paths
- Given the user overrides the assessed tier (e.g., assessed as Small, user chooses Medium),
  when the override is applied, then all subsequent skip decisions use the overridden tier
- Given the complexity tier is not set in state (missing key), when a tier-dependent step
  is reached, then the conductor blocks and requests complexity assessment first

### Done When
- [ ] Small tier skips: conflict-check, architecture-diagram, architecture-review, acceptance-specs, pipeline, code-review, retro
- [ ] Medium tier runs all steps with lightweight arch-review
- [ ] Large tier runs all steps fully
- [ ] Skipped steps show skip icon in dashboard and `skipped` in state
- [ ] User can override the assessed tier at classification time
- [ ] complexity_tier is stored in conduct-state.json
