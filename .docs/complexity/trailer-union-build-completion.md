# Complexity: trailer-union build completion (#859)

Tier: M

## Rationale

- No new models, integrations, auth surfaces, or external dependencies.
- Changes the semantics of a load-bearing engine gate (build completion predicate) plus the
  stall circuit breaker, unified behind one new shared resolver in `task-progress.ts` —
  behavioral change to the daemon's core build loop, not a leaf fix.
- Carries an architectural decision worth an ADR: #773's "trailers are telemetry only" is
  refined to "non-authoritative routing telemetry" (trailers route the build→build_review
  handoff; build_review keeps sole completion authority). Warrants a lightweight
  architecture review, not a full one.
- Story count small (~4–5: all-evidenced exit, no re-dispatch of resolved tasks, genuine
  stall unchanged, regression fixture, docs/contract sync).
- Estimated effort ~half day to a day (matches intake `size: M` label).

Medium ⇒ architecture-diagram + lightweight architecture-review + conflict-check required;
stories + plan as always.
