# Complexity: Task dependency gate is a presence check; unorderable plans pass it (#1393)

Tier: M

Rationale: three bounded engine surfaces on existing seams, plus one amendment to an APPROVED ADR.
`src/conductor/src/engine/plan-dependencies.ts` gains acyclicity checking (cycle members named) on
top of its existing grammar and unknown-id violations. `engineer/land-spec.ts` applies that strict
check to every plan, not only sliced ones. The conduct `plan` gate (`GATE_ONLY_PREDICATES.plan` in
`artifacts.ts`) applies it only when the plan file is new in the feature's own diff, which needs a
merge-base resolution of the kind `adr-assumption-ledger-scope.ts` already performs. Daemon backlog
eligibility and plans already on the default branch keep the presence check (`planHasDependencyTree`).

This reverses part of `adr-2026-09-29-plan-slice-manifest` decision 4 ("unsliced plans keep today's
presence-only check"), and the scoping rule for "new plan" is a real design decision that the plan
gate's per-step verdict recomputation makes load-bearing for in-flight features. Both warrant a
lightweight architecture review. There is no new module boundary, service, CLI, schema, hook, or
settings surface. Expected stories: 3–4.
