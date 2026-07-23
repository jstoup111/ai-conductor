# Complexity: cheap-gate-first — wiring_check before build_review (#879)

Tier: M

Rationale: no data models, no external integrations, no auth. But this is a change to the
engine's **BUILD/SHIP step state machine** (prerequisite chain across three steps) plus a
change to the conductor's dispatch bypass, and it fans out across several coupled call
sites that all hard-code the current tail order:

- `src/conductor/src/engine/steps.ts` — `ALL_STEPS` positions + `prerequisites` for
  `build_review`, `wiring_check`, `manual_test`.
- `src/conductor/src/engine/conductor.ts` — engine-native dispatch bypass (`:3249-3253`),
  the wiring_check kickback block's explicit restage set (`:4505-4509`), and the
  rebase-origin re-open target order (`:5505-5512`).
- `src/conductor/src/engine/rebase.ts` — post-rebase tail invalidation ordering
  (`:897`, `:927`, `:935`).
- `src/conductor/src/engine/model-table-metadata.ts` + `HARNESS.md` model table
  (regenerated via `bin/generate-model-table`).
- `src/conductor/test/engine/steps.test.ts` — six order/topology assertions.

Story count: 5. Two ADR-governed invariants are in play (the build_review judgement gate
and the wiring_check gate ADRs both state the current position in their Decision sections),
so architecture-review is required to record the supersession and the wiring surface.

Per tier rules (M): architecture-diagram and conflict-check run; architecture-review runs in
Lightweight mode. Not S (multi-module state-machine change touching two APPROVED ADRs); not
L (no new subsystem, no new dependency, no data/schema implications, single-repo).
