# Complexity: rebase-reopens-completed-repair-tasks-against-stal

Tier: M

Rationale: One engine module gains a new store-rewrite step (`rebase-translate.ts` → repair
obligations in `engine-state.json`) plus a residue-resolution rule that needs `onto`/`origHead`
ordering. Two existing modules are touched (`repair-obligations.ts` for the store helper,
`autoheal.ts` only if the fallback wording changes). Persisted-state mutation and fail-closed
invariants warrant architecture review and conflict-check, but there is no new step, schema, or
operator surface, so it is not Large.
