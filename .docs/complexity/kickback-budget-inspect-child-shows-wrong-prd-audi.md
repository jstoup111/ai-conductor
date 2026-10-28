# Complexity: kickback-budget inspect --child shows wrong prd_audit/as-built budgets (#3364)

Tier: S

Rationale:
- **Production code.** One file changes: `src/conductor/src/engine/kickback-budget-cli.ts`. Its
  `inspect` path picks a ledger for each gate. Its plan-growth view reads only the feature-wide
  budget, so its child-ledger branch is removed.
- **Docs.** One reference page changes: the `kickback-budget` section of `docs/reference/cli.md`.
- **Scope.** No new module, model, schema, event, CLI flag or state machine, and no external
  integration.
- **Architecture.** The change conforms to existing APPROVED decisions and needs no ADR:
  - `adr-2026-10-12-routed-whole-feature-repair` D10 keeps whole-feature gate lap and growth caps,
    and their raises, in the flat ledger.
  - `adr-2026-10-07-per-child-build-region` D10 keeps plan growth and repair budgets feature-wide,
    and child ledgers refuse growth, `pendingRepair` and `effectiveGrowthCap`.
  - `raise`, `reset` and daemon re-kick already route these gates this way. Only `inspect` diverges.
- **Stories.** Two are expected: a feature-wide child view, and child-scoped gates unchanged.

Per the Small tier rules, architecture-diagram, architecture-review, conflict-check,
coherence-check and plan-review are skipped.
