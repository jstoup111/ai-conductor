# Complexity: Enforce the documented source layer directions (#1017)

Tier: M

## Rationale

- Behavior-neutral relocation: `ConductorEventEmitter` leaves `ui/events.ts`, `engine/plugin-loader.ts`'s
  terminal subscriber/renderer wiring leaves `engine/`, the leaf helpers `execution/` borrows from
  `engine/` move down, and the ~25 type symbols `types/` borrows from `execution/`/`engine/` move into
  `types/`. No logic changes; the only new code is a structural layer-direction test.
- Test churn is bounded: a `ui/events.ts` re-export of the moved emitter (a permitted `ui → engine`
  edge) keeps the ~400 test importers untouched (operator-confirmed at tiering).
- Hazards that justify Medium over Small: moving runtime values across layers can introduce
  module-initialization cycles the type checker does not flag; `execution/` helper dependencies
  (e.g. `engine/git-guard.ts`) may transitively pull engine code; and the enforced layering rule is a
  direction-setting decision that needs an ADR and an architecture-review approval point.
- Not Large: no new layer, no runtime behavior change, no new external surface. Precedent: the
  comparable `decompose-conductor-ts-god-class-target-architectu` refactor (#1481) was tiered M.
