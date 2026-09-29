# Complexity: Automatic rebase preserves merges carrying unique content

Tier: M

Rationale: Changes the daemon's automatic rebase path in `src/conductor/src/engine/rebase.ts` by adding a read-only pre-rebase merge audit, an explicit linear replay list (merge-delta commits plus patch-identical dedupe), and a pre-mutation halt. It also extends the evidence rewrite map in `rebase-translate.ts` so each merge sha maps to its delta commit, and it has to keep repair-task boundaries (#2652) resolvable. That is several modules in a high-risk, heavily gated subsystem with an existing ADR lineage, which is too much for Small. There is no new subsystem, external interface, or schema migration, so it is not Large.
