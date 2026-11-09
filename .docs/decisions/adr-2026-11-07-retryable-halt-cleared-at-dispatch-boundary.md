# ADR: A retryable HALT is cleared, and the progress baseline is stamped, at the daemon dispatch boundary

**Date:** 2026-11-07
**Status:** APPROVED
**Deciders:** operator (composer session for jstoup111/ai-conductor#3601)

<!-- Refines adr-2026-07-12-progress-aware-build-halt D2 and works within adr-2026-07-28-total-halt-classification-legacy-boundary. -->

## Context

`HALT.class` `mechanical` exists so the daemon can retry a stop without an operator (`adr-2026-07-28-total-halt-classification-legacy-boundary` D1). Three automatic paths re-dispatch a halted feature: the base-advance sweep, the episode-end sweep, and the progress-gated re-kick (`adr-2026-07-12-progress-aware-build-halt` D2). The two sweeps clear the HALT canonically (`clearMarker` in `engine/daemon-rekick.ts`: HALT is renamed to `HALT.cleared`, `HALT.class` is removed, `REKICK` is written) before the feature runs again. The progress-gated re-kick does not clear it. `pickEligible` in `engine/daemon.ts` admits the parked slug with its HALT still on disk.

On a stacked feature, `runStackPreflight` (`engine/restack/stack-preflight.ts`) refuses any dispatch that meets a live HALT without a matching resume authorization ("live HALT without resume authorization"). The daemon passes no authorization (`daemon-cli.ts`, `runDaemonRekickStackPreflight` call). So every progress re-kick of a stacked feature with a mechanical HALT is refused before any step runs.

The progress re-kick did not stop after the refusal, for two reasons:

- The baseline `TaskEvidence.lastResolvedCount` is written by the conductor at build-step exits, scoped to the active child (`countResolvedTasks(root, activeRegionChild)`). The daemon reads the live count for the whole feature (`buildProgressReKickDeps` in `daemon-cli.ts`). On any multi-child feature, live is above the stamp almost permanently.
- A refused dispatch runs no build step, so it writes no stamp at all.

The feature therefore looped once every couple of seconds until the per-run `dispatch_ceiling` (20). This was observed twice on gem_miner (2026-11-02 and 2026-11-07), from two different mechanical HALT writers.

`.pipeline/HALT.cleared` has a second job besides archiving a cleared HALT. It carries the operator's prd_audit over-scope decision, which `preparePrdWideningBeforeAudit` in `conductor.ts` harvests only when prd_audit next runs (`adr-2026-08-24-over-scope-decision-block-and-durable-refusals`; tracked as #3551). Any clear that renames a new HALT over `HALT.cleared` before that harvest destroys the operator's decision. The sweeps already carry this risk through `clearMarker`. A clear on every automatic re-dispatch would hit it routinely, for example when the resume after an over-scope clear first meets a mechanical prerequisite block.

Even with the loop removed, a mechanical HALT raised with no task progress would be re-dispatched only on a base advance. The prerequisite-blocked HALT promises "The daemon will re-dispatch the feature from an earlier reachable prerequisite", so that promise would depend on main moving.

## Options Considered

### Option A: Preflight treats a mechanical HALT as self-authorizing
- **Pros:** Smallest diff, at one call site.
- **Cons:** The HALT stays live through the whole run, so the halt record and the PR presentation keep saying "halted". It stretches "resume authorization" to cover something that is not one. It leaves the baseline loop in place for preflight refusals that write their own mechanical HALT (`haltForLiveJournalOwner`).

### Option B: Skip a dispatch that the preflight would refuse
- **Pros:** Stops the flood.
- **Cons:** It never recovers the feature, and it copies the preflight's predicate into the daemon.

### Option C: The dispatch boundary owns the retryable-HALT clear, a one-shot prompt re-dispatch, and the progress baseline (chosen)
- **Pros:** The progress and prompt paths clear before execution, as the sweeps do, without touching the over-scope decision carrier. The preflight guard and needs-human retention stay untouched. Each distinct mechanical HALT gets exactly one prompt retry, and the existing ceiling bounds the rest. The baseline gets one writer at one scope, so it means what D2 says it means.
- **Cons:** Touches `daemon.ts`, `daemon-cli.ts`, `daemon-rekick.ts`, and the conductor's stamp sites. Removing the conductor stamps changes a field's writer. Adds one per-worktree HALT-lifecycle marker, `.pipeline/HALT.rekicked`.

## Decision

We choose Option C. The parent daemon's dispatch boundary (`dispatch` in `engine/daemon.ts`, ahead of whichever `FeatureExecutor` runs the feature) becomes the single owner of how an automatic re-dispatch treats a retryable HALT.

1. **Clear before execute.** When the dispatch boundary re-dispatches a parked slug whose `.pipeline/HALT` is live and whose class resolves as not retained by `resolveHaltRetention` (`mechanical` or `legacy`), it clears that HALT before the executor runs. The clear removes `.pipeline/HALT` and `.pipeline/HALT.class`, writes the `REKICK` sentinel as `clearMarker` does, and writes the cleared body byte-for-byte to `.pipeline/HALT.rekicked`. It never reads, writes, renames over, or deletes `.pipeline/HALT.cleared`, so the over-scope decision carrier survives until prd_audit harvests it. The sweeps keep using `clearMarker`, unchanged. The stack preflight and the conductor therefore never see a live retryable HALT on an automatic path. A retained class (`needs-human`, `unclassified`, any operator-action class, or an unknown class) is never cleared here. The dispatch boundary refuses to run a slug whose live HALT is retained, and nothing else about that slug changes.
2. **One prompt re-dispatch per distinct retryable HALT.** In `pickEligible`'s parked-with-live-HALT branch, a slug is also eligible when its live HALT class is `mechanical` or `legacy` and the HALT body differs byte-for-byte from `.pipeline/HALT.rekicked`, the body this boundary last cleared. A missing or unreadable `HALT.rekicked` counts as different. `HALT.cleared` plays no part in this comparison. An identical body means this HALT already had its prompt retry. It then waits for the progress re-kick, the base-advance sweep, or the episode-end sweep, all unchanged. Prompt re-dispatches count against the same per-run `dispatch_ceiling` as progress re-kicks. A writer whose body varies on every recurrence is therefore still bounded.
3. **The dispatch boundary owns the progress baseline.** Immediately before running the executor, the dispatch boundary stamps `TaskEvidence.lastResolvedCount` with the whole-feature resolved count (`countResolvedTasks(root)` with no child scope). The conductor's build-exit stamps are removed, which leaves one writer. The progress re-kick stays eligible when the live whole-feature count exceeds that stamp. That is exactly D2's rule in `adr-2026-07-12-progress-aware-build-halt`: "most recent dispatch's ending resolved count exceeds its starting count". This decision replaces only D2's mechanism sentence (persist the count at the end of each build dispatch). D2's ceiling, its config, and its guards are unchanged. A dispatch refused before any step runs leaves the count equal to its stamp, so it never earns a progress re-kick.
4. **Everything else is preserved.** The stack preflight's live-HALT guard and resume-authorization path stay as they are, and so do needs-human retention, the operator park, the base-advance sweep's once-per-SHA bound, the episode-end sweep, and the `build_progress_halt` config (`enabled: false` still disables the progress re-kick; it does not disable decisions 1 and 2).
5. **Observability reuses the existing halt-clear append seam.** The parent dispatch boundary has no feature event emitter; that emitter is created inside the executor. So each clear in decision 1 records itself through the existing append seam that the HALT-cleared watcher uses (`appendHaltClearedRecord`, `cause: 'rekick'`). That seam appends one `halt_cleared` record to the feature's `.pipeline/audit-trail/events.jsonl` and supersedes the committed halt record (`adr-2026-08-23-committed-halt-record`). `dispatch` disposes the slug's watcher before the clear, so exactly one record is written per clear. The daemon also logs one line naming the slug and the cleared HALT class. No new event variant or telemetry channel is added. `.pipeline/HALT.rekicked` is durable state, not telemetry: it answers "which HALT body did the dispatch boundary last clear" and decision 2 reads it by name (the event-spine skill's exception C). The occurrence itself is recorded through the existing `halt_cleared` seam.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | The daemon passes no `hasMatchingResumeAuthorization` to `runStackPreflight`, so a live HALT always refuses a stacked dispatch (`daemon-cli.ts` `runDaemonRekickStackPreflight` call; `stack-preflight.ts` `runStackPreflightInner`) | verified | 95% | yes | The loop cause is different and decision 1 would not stop it | — |
| A2 | `TaskEvidence.lastResolvedCount` has exactly one reader, the progress re-kick (`readLastResolvedCount` in `buildProgressReKickDeps`) | verified | 95% | yes | Moving its writer and scope would change another consumer | — |
| A3 | The conductor stamps the baseline child-scoped (`countResolvedTasks(this.projectRoot, this.activeRegionChild)`), while the daemon reads it unscoped | verified | 90% | yes | The scope fix is unnecessary, but decision 3 still holds | — |
| A4 | For the same condition, today's mechanical HALT writers produce identical HALT bodies (e.g. the prerequisite-block text in `conductor.ts`) | inferred | 75% | yes | Recurrences look distinct and re-dispatch promptly, up to `dispatch_ceiling` per run | APPROVED by operator 2026-11-07 |
| A5 | Writing `REKICK` on the dispatch-boundary clear, as `clearMarker` does, is safe for a dispatch with no base advance: the preflight base-refresh and `resumeRebaseFirst` are no-ops or safe rebases when the base has not moved, as on the episode-end sweep | inferred | 80% | yes | Decision 1 needs a clear variant that does not write `REKICK` | APPROVED by operator 2026-11-07 |
| A6 | `dispatch` in `engine/daemon.ts` disposes the slug's HALT-cleared watcher before re-dispatching, so a clear made after that point is recorded only if the dispatch boundary appends the record itself (`disposeWatcher(item.slug)` at the start of `dispatch`; `appendHaltClearedRecord` in `engine/daemon-deps.ts`) | verified | 90% | yes | The watcher would also append, giving two `halt_cleared` records per clear | — |
| A7 | `.pipeline/HALT.cleared` is the prd_audit over-scope decision carrier, read at prd_audit entry (`preparePrdWideningBeforeAudit` in `engine/conductor.ts` lists it first among its entry paths) | verified | 90% | yes | Preserving it would be unnecessary, and decision 1 could reuse `clearMarker` | — |

## Consequences

### Positive
- A mechanical HALT on a stacked feature recovers on the next dispatch, with no operator action and no resume/refuse loop.
- One clear path for every automatic re-dispatch. The progress baseline has one writer at one scope, so the D2 rule is honest again.
- The bound is explicit: one prompt retry per distinct HALT, with `dispatch_ceiling` as the backstop.

### Negative
- Every automatic retryable re-dispatch now writes `REKICK`, so it pays a base-refresh check even when the base has not moved.
- One more marker file per worktree (`.pipeline/HALT.rekicked`). After a dispatch-boundary clear, `HALT.cleared` may still hold an older, unrelated body; making it truthful is #3551's job, not this ADR's.
- A mechanical writer whose body embeds volatile data (timestamps, counters) gets up to `dispatch_ceiling` prompt retries per daemon run, not one.
- Removing the conductor's build-exit stamps changes which component writes the field. The tests that pin those stamps move to the dispatch boundary.

### Follow-up Actions
- [ ] Wire the three new daemon dependencies (clear, fresh-HALT check, baseline stamp) in `daemon-cli.ts` where the other `pickEligible` dependencies are wired. The clear dependency calls a new `clearRetryableHaltMarker` in `engine/daemon-rekick.ts`, beside `clearMarker`, and then the existing `halt_cleared` append seam.
- [ ] Remove the conductor's `lastResolvedCount` stamp sites and the comments that justify them.
