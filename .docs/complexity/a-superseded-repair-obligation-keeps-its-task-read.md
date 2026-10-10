# Complexity: A superseded repair obligation keeps its task reading as open (#2598)

**Issue:** #2598
**Plan stem:** `a-superseded-repair-obligation-keeps-its-task-read`

Tier: S

## Signals

| Signal | Reading |
|--------|---------|
| New models / schemas | None. The persisted `repairObligations` section (`records`, `currentByPlan`, `admissionsByPlan`) is unchanged; no migration. |
| Integrations | Four engine files that already read the same section: `repair-obligations.ts`, `task-progress.ts`, `task-seed.ts`, plus the `engine-state.json` row in `docs/reference/artifacts.md`. No provider, CLI surface, hook or config change. |
| Auth / secrets | None. |
| State machines | Clarifies one existing rule (same-authority supersession, already enforced by `RepairObligationStore.close` at `repair-obligations.ts:310-320`). It now applies in every reader of the state, so no new state or transition is added. |
| Story count | 4. Within the S ceiling of 5. |

## Rationale

**Small.** The fix extracts one pure predicate from logic `close()` already has and routes the four
readers that drifted from it through that predicate. No new architecture decision is made:
`adr-2026-09-06-reopened-task-resolution` D3 (malformed state blocks completion with a named
reason) and D4 (a task close resolves the *current* obligation) already govern the behaviour, and
D11's write-time `plan_amendment` supersession is untouched. So no ADR, diagram, conflict-check or
coherence artifact is required.

Not Medium: single concern, no schema or persistence change, no cross-spec reconciliation. The only
in-flight overlap is textual: spec `build-loop-cannot-complete-a-feature-child-by-chil` plans a
child-count edit in `task-progress.ts`. That touches a different function and needs no semantic
reconciliation.
