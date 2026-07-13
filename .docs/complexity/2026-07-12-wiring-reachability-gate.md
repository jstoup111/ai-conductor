# Complexity: Wiring reachability gate (green-but-unwired guard)

Tier: L

## Rationale

- **New gating engine step** (`wiring_check`) with completion predicate, verdict/kickback wiring,
  and selector integration — modeled on `build_review`/`acceptance_specs` but a new gate class.
- **New engine-parsed plan grammar** (`Wired-into:` lines beside `Files:`/`Dependencies:`), with
  inheritance/waiver forms and deterministic round-trip — same risk class as the task-id grammar
  (#417) and path-corroboration (#424/#426) work, both of which needed follow-up fixes.
- **First import-graph tooling in the repo** — diff-scoped orphan-export detection rooted at four
  production entry points; no ts-prune/knip precedent exists to extend.
- **Cross-skill contract changes** — architecture-review (entry-point decision in APPROVED output)
  and plan (derive/author contract lines, Small-tier fallback origin).
- **Waiver mechanism** — declared-inert with resolvable follow-up ref; fail-closed negative paths.
- Heavy negative-path surface: undeclared primitives, wrong-call-site declarations, inert-without-ref,
  test-only callers, kickback-cap interaction — each needs adversarial specs.

Story count expected >8 across engine gate, plan grammar, backstop tooling, and two skill contracts.
