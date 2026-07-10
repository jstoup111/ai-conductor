# Complexity: unify-build-completion-evidence-derivation-fix-der

Tier: M

Rationale: two coupled engine subsystems (evidence-range anchor resolution in autoheal.ts;
grandfather/seed semantics in task-seed.ts + gate resolution in artifacts.ts) with
correctness-critical gate semantics and required negative-path/adversarial tests. No new
models, integrations, or auth; no new architecture. Moderate story count (~5-7). Not S
because gate semantics changes demand conflict-check + lightweight architecture review;
not L because the change is contained to the existing evidence-derivation seam.
