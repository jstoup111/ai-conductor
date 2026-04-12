# Story: Complexity Assessment

**Status:** DRAFT
**Epic:** EP-001 Conductor Core Engine
**Skill:** conduct/SKILL.md

As a developer, I want the conductor to classify my feature's complexity after brainstorm
so that the flow adapts its ceremony level to match the feature's scope.

## Acceptance Criteria

### Happy Path
- Given a design doc is approved, when complexity assessment runs, then it evaluates signals:
  models/tables, external integrations, auth/authz, state machines, estimated stories
- Given the majority of signals indicate Small, when the assessment completes, then it
  proposes "Complexity: SMALL" and asks the user to accept or override
- Given the user accepts the assessment, when confirmed, then `complexity_tier` is stored
  in conduct-state.json as "S", "M", or "L"
- Given the user overrides (e.g., assessed Small, user chooses Medium), when the override
  is applied, then the overridden tier is stored and all downstream skip decisions use it

### Negative Paths
- Given signal counts are tied between tiers, when the assessment runs, then it breaks
  the tie toward the higher tier (conservative)
- Given the design doc has insufficient information to assess signals, when the assessment
  runs, then it asks the user clarifying questions rather than guessing

### Done When
- [ ] Assessment evaluates: models/tables, integrations, auth, state machines, story count
- [ ] Majority-of-signals determines tier; ties break toward higher tier
- [ ] User can accept or override the assessed tier
- [ ] complexity_tier stored in conduct-state.json
- [ ] Downstream step skipping uses the stored tier
