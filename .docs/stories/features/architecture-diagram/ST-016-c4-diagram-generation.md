# Story: C4 Architecture Diagram Generation

**Status:** DRAFT
**Epic:** EP-001 Conductor Core Engine
**Skill:** architecture-diagram/SKILL.md

As a developer, I want C4 architecture diagrams generated and maintained using Mermaid so
that the system's architecture is visually documented and stays current.

## Acceptance Criteria

### Happy Path
- Given the plan is complete, when the architecture-diagram skill runs, then it generates
  C4 diagrams (Context, Container, Component) as Mermaid in Markdown files
- Given diagrams already exist in `.docs/architecture/`, when the skill runs, then it updates
  existing diagrams in place — it does not create proposed-state duplicates
- Given the diagrams are generated, when they are saved, then they go to `.docs/architecture/`

### Negative Paths
- Given the feature does not change the architecture (e.g., bug fix, wording change), when
  the skill assesses, then it skips diagram generation with a reason
- Given Mermaid syntax is invalid in the generated diagram, when validation runs, then the
  error is caught and the diagram is fixed before saving

### Done When
- [ ] C4 diagrams generated as Mermaid in .docs/architecture/
- [ ] Existing diagrams updated in place (no proposed-state files)
- [ ] Diagrams reflect the planned architecture
- [ ] Skipped for Small tier features
