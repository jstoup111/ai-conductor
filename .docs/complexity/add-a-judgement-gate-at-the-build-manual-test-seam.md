# Complexity: build_review judgement gate at the build → manual_test seam

Tier: M

## Rationale

- **Models:** yes — a new grader dispatch (fresh one-shot session, per-step model/effort rows in
  every exhaustive config map + model table).
- **State machine:** yes — inserts a loopGate into the gate-driven tail (kickback re-opens `build`,
  self-heal counter, retry-cap HALT, `manual_test` re-gated).
- **Integrations / auth / schema:** none — single-repo engine change, no external services, no
  persistence schema changes beyond one new `.pipeline/` verdict artifact.
- **Story count:** estimated 6–8 (step registry + topology, opt-in resolver, grader dispatch +
  input isolation, predicate, kickback + cap, skill prompt, docs/model-table).

Medium: real state-machine and model involvement, but one repo, one seam, proven analogs for every
piece (manual_test kickback block, as-built verdict parse, rebase-conflict one-shot dispatch).
Not Large: no cross-repo surface, no new infrastructure, no migration.
