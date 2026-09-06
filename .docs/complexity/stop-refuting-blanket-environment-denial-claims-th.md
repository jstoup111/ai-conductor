# Complexity: Stop refuting blanket environment-denial claims (#1298)

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one self-host engine module (`environment-claim-audit.ts`), its unit spec, and the existing environment-claim integration spec. It adds a negative guard over the module's existing line detection plus two sentences of rendered explanation; it reuses the fence-derived deniable-operation set, the provider sandbox table, the refutation marker, and the candidate-safety wrapper's failure conversion without altering any of them. No new module, seam, event, metric, config key, CLI surface, hook, or schema is introduced, and no ADR is created or amended. Small-tier architecture, conflict-check, and coherence artifacts are not required.
