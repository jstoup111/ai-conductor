# Architecture Review: Mechanical prerequisite HALT loops the daemon in resume-and-refuse
**Date:** 2026-11-07
**Mode:** Lightweight (Medium tier): feasibility and alignment
**Inputs reviewed:** Explore output and the technical-track scope boundary (`.docs/track/mechanical-prerequisite-halt-loops-the-daemon-in-r.md`), the approved diagram (`.docs/architecture/mechanical-prerequisite-halt-loops-the-daemon-in-r.md`), source at `5418c8254f`.
**Verdict:** APPROVED

## Feasibility

- **Stack:** no new packages, services, or infrastructure. The primitives already exist: `resolveHaltRetention` (`engine/daemon-rekick.ts`), `countResolvedTasks` (`engine/task-progress.ts`), `createTaskEvidence` (`engine/task-evidence.ts`), and the `halt_cleared` event variant (`types/events.ts`). The one new function is `clearRetryableHaltMarker`, added beside `clearMarker` in `engine/daemon-rekick.ts`.
- **Prerequisites:** none. No migration, config key, or schema change. `lastResolvedCount` keeps its name, its type, and its tolerant parse.
- **Integration surface:** three modules in one container. The daemon core (`engine/daemon.ts`) gains the decision logic. The composition root (`daemon-cli.ts`) wires it. The conductor (`engine/conductor.ts`) loses its stamp sites. The executor seam stays untouched, so this is independent of #3333's move to one feature lifecycle: the dispatch boundary runs in the parent before `featureExecution.executor.execute`.
- **Data:** one durable field (`.pipeline/task-evidence.json` `lastResolvedCount`) changes writer and scope, and one per-worktree marker is added (`.pipeline/HALT.rekicked`, the last body the dispatch boundary cleared). `.pipeline/HALT.cleared` is deliberately not touched, because it also carries the operator's prd_audit over-scope decision until prd_audit harvests it (`adr-2026-08-24-over-scope-decision-block-and-durable-refusals`; verified at `preparePrdWideningBeforeAudit` in `engine/conductor.ts`). Old sidecars read as 0. On the first dispatch after upgrade, the start stamp overwrites any stale child-scoped value, so no backfill is needed.
- **Performance:** two small file reads at pick time, and one count plus one write per dispatch. Negligible.
- **Worktree isolation:** all state is per-worktree `.pipeline/`. No shared resource.

## Alignment

- **`adr-2026-07-28-total-halt-classification-legacy-boundary`:** aligned. D1 defines `mechanical` as safe for the canonical clear-and-re-kick path, and D2 maps it to that path. Decision 1 makes the progress re-kick use that same canonical clear, which closes a gap rather than adding a new class rule. D7's base-advance trigger for the sweep is unchanged. The new prompt retry is an extra trigger, alongside the progress re-kick that `adr-2026-07-12` D2 already added.
- **`adr-2026-07-12-progress-aware-build-halt` D2:** the new ADR keeps D2's eligibility rule, its ceiling, and its guards. It replaces only the mechanism sentence (stamp at build-dispatch end), because that mechanism had drifted from the rule: the stamp was child-scoped and refusals wrote none. That ADR is not amended in place. Its pre-template `## Assumptions (verify-claims)` section would fail land's ledger validator if the file joined the change set (precedent #3418). The new ADR names the clause it replaces, and the newer, more specific decision governs.
- **`adr-2026-08-23-committed-halt-record`:** supersede seams are unchanged. The dispatch boundary calls the existing append seam (`appendHaltClearedRecord`), which supersedes the record. The watcher is disposed before the clear, so the seam runs exactly once (ADR decision 5, A6).
- **Stack preflight (#3470):** the guard is kept on purpose. The fix removes the live retryable HALT before the preflight sees it, and does not weaken the preflight.
- **Event spine:** no new channel. The parent dispatch boundary has no feature emitter, so the clear records through the documented halt-clear append seam, which writes `halt_cleared` with `cause: 'rekick'` to the audit trail, as the audit-trail write-completeness story requires. `HALT.rekicked` is durable state read by name for a dispatch decision (event-spine exception C), not telemetry.
- **State modelling:** retention is still decided by `HaltDisposition` through `resolveHaltRetention`. Fail-closed handling of an unknown class is preserved. "Distinct HALT" is a byte comparison of two existing files, with no new identity type.
- **Production DI defaults:** the new dependencies follow the existing optional-dependency pattern in `RunDaemonDeps`, and production wires real filesystem implementations in `daemon-cli.ts`. No in-memory production default.

## Wiring Surface

- `clearRetryableHalt(slug)`: a new optional `RunDaemonDeps` dependency, called from `dispatch` in `engine/daemon.ts` for a resumed slug with a live retryable HALT before `runFeature`. Production wires it in `daemon-cli.ts` `runDaemonMode` to `clearRetryableHaltMarker(join(worktreeBase, slug))` (HALT body to `HALT.rekicked`, remove `HALT` and `HALT.class`, write `REKICK`; `HALT.cleared` untouched) followed by the existing `appendHaltClearedRecord(worktreePath, 'rekick')` seam in `engine/daemon-deps.ts`.
- `isFreshRetryableHalt(slug)`: a new optional `RunDaemonDeps` dependency, consulted in `pickEligible`'s parked-with-live-HALT branch and counted through the existing `dispatch_ceiling` counter. Production wires it in `daemon-cli.ts` to `readRawHaltClass` plus a byte comparison of `HALT` against `HALT.rekicked`.
- `stampDispatchBaseline(slug)`: a new optional `RunDaemonDeps` dependency, called from `dispatch` immediately before `runFeature`. Production wires it in `daemon-cli.ts` to `createTaskEvidence` plus `countResolvedTasks(worktree)`. It skips when the worktree does not exist yet (a fresh dispatch).
- Removed: the `lastResolvedCount` stamp sites in `engine/conductor.ts`, at build-step exits.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A mechanical writer with a volatile body retries promptly on every recurrence | Technical | Low | Medium | Counted against `dispatch_ceiling`, so bounded per run (ADR decision 2, A4) |
| The `REKICK` written by the dispatch-boundary clear triggers base-refresh work on a no-advance dispatch | Technical | Medium | Low | Same path the episode-end sweep already uses (A5) |
| Removing the conductor stamps breaks tests that pin them | Technical | High | Low | Move those assertions to dispatch-boundary tests in the plan |
| The dispatch-boundary clear overwrites the prd_audit over-scope decision carrier (`HALT.cleared`) | Data | Medium | High | It never touches `HALT.cleared` and archives to `HALT.rekicked` instead (ADR decisions 1, 2; Story 1) |
| A parallel spec edits the same conductor regions | Integration | Medium | Medium | Conflict-check; advisory overlap scan flagged only `conductor.ts`/`daemon-rekick.ts` spec branches |

## ADRs Created

- `adr-2026-11-07-retryable-halt-cleared-at-dispatch-boundary`: a structural change to state ownership. The progress baseline's writer moves from the conductor to the daemon dispatch boundary, and the dispatch-boundary retryable-HALT transition (HALT → HALT.rekicked, leaving the over-scope decision carrier `HALT.cleared` alone) becomes owned by that boundary on the progress and prompt paths. Reused and cited without amendment: `adr-2026-08-24-over-scope-decision-block-and-durable-refusals`, `adr-2026-07-28-total-halt-classification-legacy-boundary`, `adr-2026-07-12-progress-aware-build-halt`, `adr-2026-08-23-committed-halt-record`.
