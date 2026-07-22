# Architecture Review (lightweight, Medium) — Global dispatch circuit-breaker

Scope: feasibility + alignment for issue jstoup111/ai-conductor#714. Reviewed
against the confirmed seam in `daemon.ts` / `daemon-runner.ts` / `daemon-cli.ts`.

## Feasibility — PASS

- **Seam exists and is singular.** `collectOne()` in `runDaemon` already sees
  every `{slug, outcome}` and already has an established precedent for
  outcome-time bookkeeping (`onHaltWritten`, `parked.add`, `registerWatcher`).
  Adding a counter there is a small, local change.
- **Trip action reuses shipped machinery.** `writeAutoPark` + the
  `isParked`/`isOperatorParked` dispatch gate already exist and already produce
  exactly the "park, durable, dashboard-visible, operator-recoverable" behavior
  the issue wants. No new gate, no change to `pickEligible`'s exclusion logic.
- **Purity preserved.** The trip and progress checks are injected deps
  (`tripCircuitBreaker?`, `madeForwardProgress?`), mirroring the existing DI
  pattern (`isProgressReKickEligible`, `onHaltWritten`, `rekickSweep`), so the
  pure core stays unit-testable without git/fs and the real I/O is wired in
  `daemon-cli.ts`.
- **Config pattern is copy-shaped.** `circuit_breaker` mirrors
  `build_progress_halt` (const defaults + `validate…Block` + `resolve…Block`),
  a well-trodden path in `config.ts`.

## Alignment — PASS

- **Deterministic-where-possible (repo Design Principle).** The breaker is pure
  counting + a deterministic marker write at a fixed threshold — no LLM
  judgment. It stamps/rejects at the moment of the mistake (the dispatch
  outcome), exactly the "machinery, not prompt discipline" the CLAUDE.md
  mandates.
- **Composes with, does not duplicate, existing bounds.** Verified the breaker
  sits strictly outside the escalation ladder (#188), `build_progress_halt`, and
  `progressReKickDispatchCeiling` — all of which live inside a build that
  started. The breaker is the only layer that observes a pre-build
  `createWorktree` failure (no worktree ⇒ no HALT marker ⇒ today re-dispatched
  every ~5s).
- **Persistence choice is ADR-backed.** See
  `adr-2026-07-22-dispatch-circuit-breaker-counter-persistence.md` (APPROVED):
  in-memory counter + durable park, with the cross-restart accumulation gap
  explicitly accepted and scoped out.

## Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| False-trip on a slow-but-progressing feature | Counter resets on forward progress (resolved-task-count delta), not only on `done`. Story S3 + S-neg cover this. |
| Double-write / re-trip churn once parked | On trip, leave the counter pinned at the ceiling and rely on the (now-active) `isParked` gate to stop re-dispatch; `writeAutoPark` is idempotent (`wx`) anyway. |
| Breaker masks a genuinely transient failure | Default ceiling (5) gives several attempts; `enabled:false` opt-out; operator un-park restores eligibility. |
| Interaction with `build_progress_halt` parking the same slug | Both write `.daemon/parked/<slug>`; whichever fires first wins, the other is an idempotent no-op. No conflict. |
| Counter grows unbounded in the Map | Entries are per active slug and pruned on reset/done; bounded by backlog size, same as `progressReKickCounts`. |

## Verdict

**APPROVED for stories + plan.** No blocking architectural concerns. Medium
tier: full diagram not required; the `.docs/architecture/` note plus this review
suffice.
