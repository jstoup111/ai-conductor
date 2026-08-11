# Architecture Review: Operator-Chosen Fix Comprehensiveness

**Date:** 2026-08-11
**Mode:** Medium / lightweight
**Verdict:** APPROVED

## Technical Feasibility

- **Verified, 100% confidence:** `skills/explore/SKILL.md` already owns operator clarification and approach selection, so it is the correct place to ask how comprehensive the fix should be.
- **Verified, 100% confidence:** `agents/planner.md` currently encourages specification expansion by asking the planner to identify opportunities to make a feature more useful. That instruction can conflict with an operator-selected narrow repair.
- **Verified, 100% confidence:** the change requires no runtime engine, configuration, schema, external service, or state migration. It is implementable entirely in shipped skill and persona contracts.
- **Verified, 100% confidence:** downstream DECIDE skills already compare their output to governing upstream intent. Their contracts can require preservation of the confirmed comprehensiveness boundary without introducing a new artifact type.
- **Verified, 100% confidence:** Medium-mode architecture review already says ADRs are created only for genuinely novel architectural decisions, but the general ADR trigger section can encourage ADRs for choices that do not change system structure.

No load-bearing assumptions remain unconfirmed. The operator explicitly chose mandatory questioning rather than a default scope policy and confirmed the technical track.

## Architectural Alignment

The design preserves existing phase ownership:

1. `explore` asks one explicit comprehensiveness question before approaches are finalized and records the answer with the selected approach.
2. `architecture-review`, `stories`, and `plan` treat the confirmed answer as a scope boundary.
3. A downstream step may identify a broader alternative, but it must not include that expansion without operator confirmation.
4. The planner persona stops treating usefulness expansion as an unconditional duty.
5. Architecture review creates an ADR only when the accepted solution changes system structure: a boundary, component/service decomposition, integration, state/data architecture, or foundational technology. Workflow policy, prompt wording, and ordinary implementation choices do not qualify by themselves.

No engine machinery is introduced. The behavior remains provider-agnostic because it describes an outcome and operator gate, not host-specific invocation syntax.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| The question becomes vague ceremony | Medium | Medium | Require a concrete breadth answer and explicit in/out boundaries when needed |
| Downstream steps silently reinterpret the answer | Medium | High | Add preservation and re-confirmation rules to each scope-authoring DECIDE contract |
| Every minor request incurs multiple scope prompts | Low | Medium | Ask exactly once in `explore`; later steps ask only before material expansion |
| Architecture review adds ceremonial ADRs | Medium | Medium | Make structural change a necessary condition for ADR creation |

## Wiring Surface

This feature changes prompt contracts only and introduces no new production export, runtime entry point, hook, configuration key, event, or CLI surface. Plan tasks should use `Wired-into: none (no new production surface)`.
