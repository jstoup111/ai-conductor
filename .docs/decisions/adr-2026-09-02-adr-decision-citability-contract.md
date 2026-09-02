# ADR: ADR Decision Citability Contract

**Date:** 2026-09-02
**Status:** APPROVED
**Deciders:** James Stoup (operator), composer DECIDE session for issue #2054

## Context

`resolveAsBuiltGoverningClause` (`src/conductor/src/engine/conductor.ts`) is the only code that
parses `## Decision` sections, via the AB-R12 regex — widened twice reactively (AB-R12 comment,
PR #2053) because `templates/adr.md.template` prescribes no decision shape. Before #2053, 15 of
286 APPROVED ADRs were uncitable and 2+ carry no `## Decision` heading; each miss surfaced as a
needs-human halt at the as-built gate blaming the citation, not the parser (issue #2054, twice
observed). adr-2026-08-30-shared-plan-task-reference-resolver decision 5 names #2054 as the
designed future adopter of the shared reference-resolver contract.

Operator constraint: backwards compatible — no narrowing of accepted shapes, no corpus
migration.

## Options Considered

### Option A: Shared decision parser as single authority + land-time citability gate
- **Pros:** one definition of "citable decision" (pattern of
  adr-2026-08-08-single-adr-approval-parser-three-rungs); fails at authoring, not validation;
  future consumers inherit it; legacy corpus untouched.
- **Cons:** parser must carry the full shape superset forever; gate needs careful diff scoping.

### Option B: One canonical decision form + migrate non-conforming ADRs
- **Pros:** simplest parser.
- **Cons:** rewrites sealed/APPROVED ADRs; violates the backwards-compatibility constraint.

### Option C: Template documentation only
- **Pros:** cheap.
- **Cons:** prompt discipline, not machinery; a fourth shape reappears (already happened twice).

## Decision

Option A, because the parser has been widened twice reactively and the repo's Design Principle
says a repeatedly violated mechanical invariant gets machinery at the point of the mistake:

1. **Single parsing authority.** A new shared module function `parseAdrDecisions(content)` in
   `src/conductor/src/engine/artifacts.ts` (beside `adrApprovalStatus`) is the only code allowed
   to interpret an ADR's `## Decision` section. It returns the ADR's citable decision id set (or
   a structural diagnostic naming the offending content). It inherits the
   adr-2026-08-08 parser hygiene rules: fenced code blocks excluded before matching,
   line-anchored matching, first declaration wins, fail-closed on unparseable content.
2. **Backwards-compatible superset.** The parser accepts at least every shape the AB-R12 regex
   accepts on 2026-09-02 (numbered list items, bolded D-headings, ATX `###`-heading decisions,
   with optional emphasis, and decisions introduced by additive amendment notes per
   adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts). A no-silent-loss corpus test
   (per the adr-2026-08-26-shared-coherence-parser-at-discovery amendment) runs both the old
   regex and the new parser over the real `.docs/decisions/` corpus and proves nothing formerly
   resolvable becomes unresolvable.
3. **Resolver adoption.** `resolveAsBuiltGoverningClause` deletes its inline decision regex and
   resolves `<stem> + <decision number>` through `parseAdrDecisions` and the
   adr-2026-08-30 shared reference-resolver contract (reference + id set → resolved id |
   diagnostic), as that ADR's decision 5 pre-authorizes.
4. **Land-time citability gate, diff-scoped.** The engineer land gate
   (`src/conductor/src/engine/engineer/land-spec.ts`, the existing 4e ADR rung per
   adr-2026-07-03-engineer-checkpoint-commits-idempotent-land) additionally rejects the spec
   when an `adr-*.md` file **added or modified in the spec's own diff** is APPROVED and
   `parseAdrDecisions` finds zero citable decisions or no `## Decision` heading, naming the
   offending file and content. ADRs not touched by the diff are never re-validated (backwards
   compatibility). The refusal is an evidentiary defect and is non-waivable
   (adr-2026-08-24-evidentiary-defects-are-not-waivable); the gate refuses only — it appends no
   tasks (adr-2026-08-22-one-owner-per-review-question). This gate lives at land only
   (adr-2026-08-23-criterion-layer-is-structural-at-land); no discovery/BUILD/SHIP consumer may
   require it.
5. **Template names the accepted forms.** `templates/adr.md.template`'s `## Decision` section
   documents the accepted citable forms (numbered list recommended) without changing the status
   vocabulary adr-2026-08-08 owns. Per adr-2026-08-13-markdown-default-inversion the template is
   load-bearing runtime source.
6. **Scoping note (reference schema).** Decision ids produced by `parseAdrDecisions` are
   transient diagnostics and resolution inputs only. This ADR introduces **no** new persisted
   finding-reference kind; adr-2026-08-18-content-anchored-finding-reference-schema's closed set
   is untouched. Any future persistence of ADR-decision references requires superseding that ADR
   with operator approval.
7. **Headingless legacy files.** APPROVED decision files with no `## Decision` heading remain
   uncitable and untouched by this change; the gate catches only new/edited ones. Correcting
   legacy files stays an operator judgement outside this feature.

## Consequences

### Positive
- Authoring a template-conforming ADR can never produce an uncitable decision; the failure moves
  from a burned validation lap to an instant land refusal naming the offender.
- Future consumers of ADR decisions call one parser instead of rediscovering corpus shapes.

### Negative
- The parser permanently carries a three-plus-shape superset instead of one canonical form.
- The legacy headingless files stay uncitable until an operator corrects them.

### Follow-up Actions
- [ ] Implement `parseAdrDecisions` + corpus no-silent-loss test
- [ ] Rewire `resolveAsBuiltGoverningClause`; delete the inline AB-R12 regex
- [ ] Add the diff-scoped land rung in `land-spec.ts`
- [ ] Update `templates/adr.md.template` decision-section guidance
