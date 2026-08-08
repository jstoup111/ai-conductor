# Complexity: bin/teardown — release worktree-provisioned resources before removal

Tier: M

## Rationale

**Not Small.** The change is not confined to one module or one behavior. It introduces a
new consumer-facing extension point with a real contract (invocation environment, bounded
timeout, absent-script no-op, best-effort-but-loud failure), wires it into three distinct
engine modules whose removal paths each have their own error handling, adds a structural
enforcement test with a reviewed exemption list, and updates four documentation pages plus
a HARNESS.md-level convention. A Small tier would skip conflict-check, the architecture
artifacts, and the coherence mapping — but the exemption list is precisely the kind of
decision that needs an ADR and a traceability row, because it deliberately leaves a known
leak (autoresolve) in place.

**Not Large.** No new data model, no external integration, no authentication surface, no
state machine, and no cross-service coordination. The runner is a single function that
mirrors an existing one (`runProjectSetup`), the namespace is a pure function of the
worktree path so no new persisted state is required, and the whole change is roughly a
day of work behind an interface that already exists.

## Signals

| Signal | Reading |
| --- | --- |
| New data models | none |
| External integrations | none |
| Authentication / authorization | none |
| State machines | none — the runner is stateless; namespace is recomputed from the path |
| Modules touched | 4 (`worktree-prepare`, `daemon-deps`, `daemon-park-cli`, `park-reconciliation`) |
| New enforcement machinery | 1 structural test with an explicit exemption list |
| Expected story count | ~6 |
| Documentation surface | `docs/reference/environment.md`, `docs/guides/running-the-daemon.md`, `docs/runbooks/worktree-and-evidence-recovery.md`, `docs/contributing/testing.md`, HARNESS.md convention |

## Consequence

Medium tier: `/architecture-diagram`, a lightweight `/architecture-review`,
`/conflict-check`, and `/coherence-check` all run. Nothing is skipped.
