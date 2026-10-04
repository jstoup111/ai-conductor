# Complexity: over-scope-accept-stranded-rebase-fence-re-halts-b

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None |
| External integrations | None |
| Auth / permission surface | Operator-decision authority path (HALT.cleared harvest) — reused, not changed |
| State machines | Resume routing across the rebase publication fence (existing lifecycle state) |
| Story count | ~4 (resume through fresh unsatisfied re-judgement; finish fence intact + integrity blockers; decision-naming halt; truthful prd_audit verdict reason) |
| Files touched | `gate-code-validity.ts`, `conductor.ts` resume path, prd_audit verdict/reason rendering, tests |
| New runtime code | Modest — fence classification split plus halt rendering |

## Rationale

Operator-confirmed Medium. The change narrows a safety fence on one path (resume) while keeping it
whole on another (finish), so correctness rests on proving both sides plus the negative paths
(refused/absent decisions still halt; genuine rebase integrity faults still halt). Multiple engine
seams and a safety-relevant invariant put it above Small; no new entities or integrations keep it
below Large.
