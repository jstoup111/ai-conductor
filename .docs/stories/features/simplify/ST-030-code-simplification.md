# Story: Code Simplification Review

**Status:** ACCEPTED
**Epic:** EP-001 Conductor Core Engine
**Skill:** simplify/SKILL.md

As a developer, I want the simplify skill to review changed code for duplication, complexity,
and over-engineering at batch boundaries so that code quality stays high as the feature grows.

## Acceptance Criteria

### Happy Path
- Given code changes exist from the current batch, when simplify runs, then it analyzes
  for: code reuse opportunities, unnecessary complexity, over-engineering, and duplication
- Given issues are found, when the review completes, then each finding has a specific
  location (file:line) and a concrete suggestion for simplification
- Given the review passes clean, when the gate is checked, then the next batch proceeds

### Negative Paths
- Given the simplify review finds blocking issues, when the gate is checked, then the next
  batch is blocked until issues are resolved
- Given a suggested simplification would change behavior (not just structure), when proposed,
  then it is flagged as a behavioral change requiring test verification — not applied blindly

### Done When
- [ ] Changed code analyzed for reuse, complexity, over-engineering, duplication
- [ ] Findings include file:line and concrete suggestions
- [ ] Blocking issues gate the next batch
- [ ] Behavioral changes flagged separately from structural simplifications
