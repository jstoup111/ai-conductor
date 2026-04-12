# Story: Architecture Review and ADR Generation

**Status:** DRAFT
**Epic:** EP-001 Conductor Core Engine
**Skill:** architecture-review/SKILL.md

As a developer, I want the architecture-review skill to evaluate stories and plans for
technical feasibility and architectural alignment, producing ADRs for significant decisions.

## Acceptance Criteria

### Happy Path
- Given stories, plan, and architecture diagrams exist, when architecture-review runs, then
  it evaluates feasibility, alignment with existing architecture, and identifies risks
- Given significant architectural decisions are made, when ADRs are generated, then they
  follow the ADR template and are saved to `.docs/decisions/adr-*.md` with Status: DRAFT
- Given DRAFT ADRs are presented to the user, when the user approves them, then their status
  is changed to APPROVED
- Given Medium tier, when the review runs, then it does a lightweight review (feasibility +
  alignment only — no full ADR ceremony)

### Negative Paths
- Given DRAFT ADRs remain unapproved, when the conductor checks the gate before BUILD, then
  it BLOCKS: "DRAFT ADRs remain unapproved — [list files]"
- Given the implementation contradicts an APPROVED ADR, when detected, then the ADR must be
  superseded or the code changed — the conflict is not silently ignored
- Given architecture-review had "APPROVED WITH CONDITIONS", when finish verifies, then all
  conditions must be met — unmet conditions block completion

### Done When
- [ ] Review evaluates feasibility, alignment, and risks
- [ ] ADRs generated for significant decisions using template
- [ ] All ADRs must be APPROVED before BUILD phase
- [ ] Medium tier gets lightweight review; Large gets full review
- [ ] Skipped for Small tier
- [ ] APPROVED WITH CONDITIONS are verified at finish
