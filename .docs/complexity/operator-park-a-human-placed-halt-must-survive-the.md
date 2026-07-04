# Complexity: Operator park — human-placed park survives the re-kick sweep

Tier: M

## Rationale

- **Not S:** touches three existing subsystems (base-advance re-kick sweep in
  `daemon-rekick.ts`, dispatch/discovery eligibility in `daemon-deps.ts`/CLI wiring,
  daemon dashboard grouping/precedence), adds new CLI surface (`daemon park` /
  `daemon unpark`), and introduces a new operator-visible state (PARKED) with
  precedence semantics over HALTED. Estimated 4–6 stories.
- **Not L:** no new models/integrations/auth, no schema or cross-repo changes, no
  state machine beyond one additive marker; the durable once-per-SHA record was
  explicitly scoped out (deferred to its own issue), keeping the FR-9 guard untouched.

Medium ⇒ architecture-diagram + lightweight architecture-review + conflict-check are
required alongside PRD, stories, and plan.
