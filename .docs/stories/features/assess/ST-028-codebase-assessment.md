# Story: Codebase Health Assessment

**Status:** ACCEPTED
**Epic:** EP-001 Conductor Core Engine
**Skill:** assess/SKILL.md

As a developer working on an existing project, I want the assess skill to dispatch specialist
agents that evaluate codebase health across multiple dimensions so that I understand the
project's strengths and risks before making changes.

## Acceptance Criteria

### Happy Path
- Given an existing project (not new), when assess runs, then it dispatches 9 specialist
  agents (security, data integrity, dependencies, architecture, duplication, testing,
  infrastructure, observability, developer experience) in parallel batches
- Given specialists complete their reports, when the CTO orchestrator synthesizes, then it
  produces a unified assessment in `.docs/decisions/technical-assessment-YYYY-MM-DD.md`
- Given the assessment identifies risks, when the report is written, then each finding has
  a severity level and specific file:line references

### Negative Paths
- Given a specialist agent fails or times out, when the failure is detected, then the
  assessment continues with the remaining specialists — one failure doesn't block the whole
  assessment
- Given the project is new (no existing code), when assess is invoked, then it is skipped
  with a reason: "No existing codebase to assess"
- Given an assessment was already run this session, when assess is invoked again, then it
  offers to re-run or use the existing report

### Done When
- [ ] 9 specialist agents dispatched in parallel batches
- [ ] CTO orchestrator synthesizes findings into unified report
- [ ] Report saved to .docs/decisions/technical-assessment-YYYY-MM-DD.md
- [ ] Findings include severity and file:line references
- [ ] Individual specialist failures don't block the assessment
- [ ] Skipped for new projects
