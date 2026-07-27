# Complexity: removed-but-registered worktree 128 loop (#1022)

Tier: M

Rationale: three engine modules across two subsystems —
`src/conductor/src/engine/worktree-shared.ts` (porcelain record parsing + a new prune
reconciliation step), `src/conductor/src/engine/daemon-runner.ts` (a new durable
failure-recording branch on the pre-worktree throw path), and the existing
`park-marker.ts` auto-park surface it consumes. No data models, no external integrations,
no auth. Expected story count 5.

Above Small because the change is not confined to one module and it introduces a
**control-flow decision at the daemon dispatch boundary**: a worktree-creation failure now
writes a durable `.daemon/parked/<slug>` auto-park that gates `pickEligible`, replacing the
in-memory-only park that produced the hot spin. Choosing that surface over `.pipeline/HALT`
(unavailable — there is no worktree) is a real architectural decision affecting park
provenance and operator unpark ergonomics, so it warrants a lightweight architecture review
and an ADR.

Below Large because there is no new subsystem, no schema change, no migration, and the
blast radius is two call sites of one shared function plus one catch branch. Both
`ensureWorktree` callers (daemon and engineer) are already covered by existing test files.

Per tier rules for M: architecture-diagram and a **lightweight** architecture-review are
required, conflict-check is required, and coherence-check is required.
