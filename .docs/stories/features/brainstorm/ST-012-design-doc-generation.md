# Story: Design Document Generation

**Status:** DRAFT
**Epic:** EP-001 Conductor Core Engine
**Skill:** brainstorm/SKILL.md

As a developer starting a feature, I want the brainstorm skill to explore my intent, ask
clarifying questions, and produce a design document so that I have alignment on what to
build before implementation begins.

## Acceptance Criteria

### Happy Path
- Given a feature description, when brainstorm runs, then it explores project context first
  (code, routes, models, existing stories, memory) before asking questions
- Given context is loaded, when brainstorm asks questions, then it asks one at a time (not
  batched), each building on the previous answer
- Given enough context is gathered, when approaches are proposed, then 2-3 approaches are
  presented with trade-offs, pros/cons, and a recommendation
- Given the user selects an approach, when the design doc is written, then it uses the
  design-doc template and includes: Problem, Solution, Scope (In/Out), Key Decisions,
  Open Questions
- Given the design doc is written, when saved, then it goes to `.docs/specs/YYYY-MM-DD-<topic>.md`

### Negative Paths
- Given prior design docs exist for the same feature, when a new one is written, then existing
  docs are archived by prepending `SUPERSEDED-` to their filename
- Given the design significantly exceeds the user's request (scope creep), when the scope
  check runs, then it surfaces the expansion explicitly and asks for confirmation
- Given the user does not approve the design doc, when asked for approval, then the brainstorm
  continues — it does NOT proceed to stories

### Done When
- [ ] Project context explored before asking questions (max 2 Explore agents)
- [ ] Questions asked one at a time, building on prior answers
- [ ] 2-3 approaches presented with trade-offs and recommendation
- [ ] Design doc saved to .docs/specs/ with all required sections
- [ ] Scope check catches and surfaces scope expansion
- [ ] Prior design docs for same feature are SUPERSEDED
- [ ] User must explicitly approve before proceeding
