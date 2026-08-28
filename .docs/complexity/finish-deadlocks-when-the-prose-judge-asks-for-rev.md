# Complexity: finish-deadlocks-when-the-prose-judge-asks-for-rev

Tier: M

Rationale: one-repo engine change to the FINISH publication state machine — a new prose state
threaded through observation (`finish-publication-production.ts`), the transition selector,
the authoring/judgment effect predicates, and halt detail plumbing, with bounded-lap semantics
to prove. No new integrations, providers, auth, or persistence schemas (the existing
`.pipeline/prose-judgment.json` store is reused). Matches the intake issue's `size: M` label.
Small is wrong because the change spans a state machine with convergence guarantees; Large is
wrong because the blast radius is a single engine subsystem.
