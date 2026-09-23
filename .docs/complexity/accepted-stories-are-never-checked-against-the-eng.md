# Complexity: Accepted stories are never checked against the engine's own criterion extractor

Tier: M

## Rationale

Medium, not Small: the change is a **shared-contract** change across three engine modules, not a
localized fix.

- `src/conductor/src/engine/story-criteria.ts` gains the exported structural predicate and its
  `extractAuthoritativeStoryCriteria` parity obligation.
- `src/conductor/src/engine/artifacts.ts` changes extraction semantics (`extractAuthoritativeStoryCriteria`
  delegates to `listItems`) and rewires `GATE_ONLY_PREDICATES.stories` onto the shared predicate.
- `src/conductor/src/engine/engineer/land-spec.ts` gains a new land gate with a new refusal code.

Changing `extractAuthoritativeStoryCriteria` output ripples into every downstream consumer of the
authoritative criterion list — `acceptance_specs` disposition-only evidence matching
(`artifacts.ts:1973`), `conductor.ts:961`, and `engineer/coherence-validator.ts:440` — so existing
fixtures that assert the current line-by-line behavior must be re-baselined deliberately rather
than incidentally.

Medium, not Large: no new subsystem, no schema or persisted-state change, no consumer-visible CLI
or configuration surface, and the operator scoped out any migration of the 93 zero-extraction and
101 drifting stories files already landed on main.

Tier consequence: architecture diagram, lightweight architecture review, conflict-check, and
coherence-check are all required.
