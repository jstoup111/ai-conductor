# Complexity: Daemon reclaim sweep deletes a worktree that holds uncommitted work

Tier: M

Rationale: The code change is small (one reclaim helper in `park-reconciliation.ts` plus tests), but it narrows the deletion authority fixed by adr-2026-07-27-ancestry-proven-park-reconciliation (D3: ancestry is the deletion authority) and adr-2026-08-01-multi-proof-park-deletion-authority. Amending those decisions needs a lightweight architecture review, which the Small tier cannot carry. Operator confirmed Medium on 2026-09-21.
