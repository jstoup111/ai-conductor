# Track: evidence-gate task-id grammar unification (#417)

Track: technical

Internal harness gate/skill correctness fix — unify the Task-trailer id grammar
(plan id vs task-N drift), enforce trailer discipline at COMMIT, align the
Evidence: trailer mechanism with the engine's empty-commit form, and add an
ambiguity-guarded task-N ≡ N alias in deriveCompletion. No user-facing product
requirements; acceptance criteria live in stories.
