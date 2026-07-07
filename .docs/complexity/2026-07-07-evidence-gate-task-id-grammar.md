# Complexity: evidence-gate task-id grammar unification (#417)

Tier: M

## Rationale

- Engine gate logic change: `deriveCompletion` gains an ambiguity-guarded
  `task-<id>` ≡ `<id>` trailer alias — correctness-critical, needs adversarial
  negative-path tests (collision with a literal plan-declared `task-N` id,
  empty commits, dangling shas).
- Two skill-contract edits (tdd, pipeline): single id grammar, COMMIT-step
  trailer discipline, Evidence-trailer section rewritten from "task report"
  to the engine's empty-commit form.
- Documented operator-gated recovery procedure for the two parked features
  (Evidence: satisfied-by backfill, no history rewrite).
- Single repo, no new services, integrations, auth, or state machines —
  below L. Above S because it changes a hard completion gate with known
  forgery/ambiguity hazards and spans engine + skill surfaces.
