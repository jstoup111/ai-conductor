# Complexity: Gate kickback counter resets every dispatch, so no-progress cycles never terminate

Tier: M

Issue: jstoup111/ai-conductor#984

## Rationale

Assessed against the signals conduct uses (models, integrations, auth, state machines, story count).

**Pushes toward M, not S:**

- **New durable state.** Introduces a per-feature `.pipeline/` JSON ledger with a schema, atomic
  read-modify-write, and a legacy/absent-file fallback path. New persisted state is never an S.
- **State-machine surface.** Changes the anti-ping-pong seam of the conductor's gate-driven tail,
  which is shared by `manual_test`, `build_review`, `prd_audit`, `wiring_check`, and the generic
  gate path. A regression here re-opens a class of livelock the engine already halts on.
- **Semantic change to an existing shipped guard.** Re-keying the progress witness from HEAD
  commit sha to HEAD tree hash changes when #647's D2 escalation fires. That is a behavior change
  to merged, already-reviewed machinery, so it needs an ADR and a conflict check against the
  neighbouring gate-invalidation work (#817 `gate-code-validity.ts`, ADR-2026-07-20 / -07-22).
- **Multi-site wiring.** Four existing capture/check call sites plus a new one in the
  `wiring_check` block, each needing the persisted ledger threaded through.
- **Negative-path requirement.** The issue explicitly requires that legitimately nondeterministic
  steps keep bounded retries — the limit must not collapse to zero. That is its own story and its
  own regression test.

**Holds it below L:**

- No new models, no external integrations, no auth surface, no schema migration of an existing
  artifact (the ledger is additive and absent-tolerant).
- Reuses shipped, reviewed machinery (`kickback-escalation.ts`, `gate-code-validity.ts`) rather
  than introducing a new subsystem.
- Confined to `src/conductor/src/engine/`; no CLI, hook, or `settings.json` schema change.

Independently corroborated: the intake issue carries the `size: M` label.

## Consequences for DECIDE

M tier — architecture-diagram, architecture-review (lightweight), conflict-check, and
coherence-check are all in scope. No PRD (technical track).
