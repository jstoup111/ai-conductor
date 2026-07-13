# Complexity: rekick-resume-republish-stale-worktree-engine

Tier: S

## Rationale

A contained fix on one code path: after `resumeRebaseFirst` reports a real (non-noop)
rebase on a self-host worktree, republish the worktree engine before `conductor.run()`
executes the gate. It reuses the existing content-addressed publish (`npm run build` →
`scripts/publish-engine.mjs`, already shelled by `daemon-cli.ts:rebuildEngineFromSource`) —
no new subsystem, no new state, no new external surface. The publish is idempotent and
content-hashed, so it self-guards to a no-op when engine source is unchanged.

### Signals

| Signal | Present | Notes |
|---|---|---|
| New external models/APIs | No | Reuses `npm run build` / `publish-engine.mjs` |
| New integrations | No | — |
| Auth / permissions | No | — |
| New state machine / lifecycle | No | One added deterministic build step; no persisted state |
| Story count | ~4 | happy (engine-touching rebase → republish → fresh gate); no-op (noop / non-engine rebase → no rebuild); scope (non-self-host → untouched); negative (republish failure → fail-closed, not stale-gate) |
| Cross-module blast radius | No | One call site in the resume path (`runConductorInWorktree`) plus a small self-host-gated helper |
| Correctness / false-ship risk | Moderate, contained | Worst case is a rebuild that could have been skipped, or a build failure that must fail closed — no evidence/attribution surface touched |
| Concurrent work in same files | Low | Resume path in `daemon-cli.ts` / `daemon-rekick.ts`; the `2026-07-12-rtk-hook-preservation` halt is being handled separately and is not a code change here |

### Why not Medium

Medium would signal cross-module blast radius or a new lifecycle. This adds one gated step
that reuses an existing, already-wired build primitive; the only new logic is "did the
rebase replay engine-source commits, and is this self-host?" No ADR-worthy mechanism, no new
persisted store, no consumer-visible CLI/hook/schema change.

## Deterministic-first note

Fully deterministic — no LLM. The trigger (rebase outcome kind + self-host flag), the action
(shell an existing content-addressed publish), and the fail-closed branch are all mechanical.
Aligns with the harness "deterministic where possible" principle: the engine already knows,
at the moment the rebase replays engine commits, that its `dist` is invalid — it should
rebuild there, not rely on any prompt.

## Tier-driven DECIDE scope

- `/prd` — SKIPPED (technical track)
- `/architecture-diagram` — SKIPPED (no architectural change: an added build step reusing an
  existing component and data flow; no new component/edge in the C4 model)
- `/architecture-review` — LIGHT (S): confirm alignment with the existing self-host
  engine-publish seam and the resume-path contract; no ADR required
- `/conflict-check` — INCLUDED (verify no contradiction with the resume/rebase cluster and
  #598's daemon-engine variant)
- `/plan` — INCLUDED (small, linear task list)
