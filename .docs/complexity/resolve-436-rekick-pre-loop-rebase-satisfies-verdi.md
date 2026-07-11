# Complexity: resolve-436-rekick-pre-loop-rebase-satisfies-verdi

Tier: S

Rationale: single-seam change — the REKICK resume path (daemon-rekick.ts
honorRekick) must record the rebase step's completion state exactly as the
in-loop runRebaseStep does, sharing one recording helper so the two can never
diverge (the #463 lesson applied at spec time). No new integrations, no auth,
no state machines beyond the existing conduct-state key; two stories.
