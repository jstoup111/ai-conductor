# Complexity: Composer runs checkpoint, resume, switch provider, and hand off (#2050)

Tier: L

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | New: a committed run journal on `spec/<slug>` (current DECIDE step, per-step acceptance with operator identity and provider, operator decisions, open questions, holder); a draft-spec-PR association; an intentional provider-switch record distinct from availability fallback |
| External integrations | None new. New use of existing ones: per-checkpoint guarded push of `spec/<slug>`, draft spec PR creation at the first checkpoint, PR body refresh, and draft-to-ready at handoff |
| Auth / permission surface | Checkpoint pushes and draft-PR writes go through the same guarded publication `handoff` owns; resume by a different operator must not change the intake issue's assignees |
| State machines | A Composer run gains durable states across sessions (in progress at step N, handed off, resumed, delivered). The per-machine intake ledger must reconcile from the pushed branch so a run resumed elsewhere is not re-claimed by stale-claim recovery. A non-fast-forward push is the concurrency guard against two holders |
| Story count | ~10–12: checkpoint commit and push, journal content, draft PR at first checkpoint and body refresh, launcher continue / switch / hand-off prompt, resume by PR / branch / issue on any machine, resume with a different provider, intentional switch recorded on the event spine, concurrent-holder refusal, ledger reconciliation and no duplicate claim, worktree reuse of a checkpointed run, land and handoff over already-committed artifacts and an existing draft PR, single-provider use unchanged |
| Files touched | ~15–25: `engineer-cli.ts`, `compose-launch-host.ts`, `execution/interactive-launch.ts`, `engineer/{worktree-authoring,land-spec,handoff,spec-branch}.ts`, `engineer/intake/{stale-claim,ledger,writeback}.ts`, `types/events.ts` plus the event persister, the composer skill, and `docs/guides/multiprovider.md` |
| ADR work | ADR-008 amended at the host-session binding (the human-gated clarity loop is retained); a new ADR for the run journal and checkpoint contract |

## Rationale

The persisted journal is a new contract read across machines, operators, and providers. The run gains a
cross-session state machine that has to stay consistent with the per-machine intake ledger and with the
spec PR lifecycle. The change also amends an approved ADR. Together those make this Large, so it gets a
full architecture review, conflict-check, coherence-check, and plan-review. Operator-confirmed 2026-11-07.
