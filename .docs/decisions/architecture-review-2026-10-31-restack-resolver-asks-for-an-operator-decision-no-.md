# Architecture Review: Restack resolver accepts an operator decision (#3478)

**Date:** 2026-10-31
**Mode:** Lightweight (Tier M): Technical Feasibility and Architectural Alignment
**Inputs reviewed:** the explore output and track marker
(`.docs/track/restack-resolver-asks-for-an-operator-decision-no-.md`), the operator-approved
diagrams (`.docs/architecture/restack-resolver-asks-for-an-operator-decision-no-.md`), #3522 as
shipped on main at `2bd1d440f8`, `adr-2026-10-25-operator-recorded-restack-conflict-resolution`, and
`adr-2026-10-10-stacked-restack-journaled-replay` decision 6
**Verdict:** APPROVED

## Feasibility

All work is on the existing TypeScript engine and uses no new package, service or infrastructure.

| Technical intent | Assessment | Basis |
|---|---|---|
| `--decision` on `stack restack-resolve` | Feasible. `dispatchStackRestackResolve` already holds the lease, reads the record, matches the live HALT, writes a compare-and-swap ref, appends an event and clears the HALT. The decision path reuses each step with a blob instead of a commit. | verified, `stack-restack-resolve-cli.ts` |
| Base-refresh conflict record | Feasible. Executor (`restack-executor.ts` `haltUnresolvedConflict`) and recovery (`restack-recovery.ts` `conflict-unresolved` branch) both call `haltRecordedRestackConflict`, which withholds the record only through its own `cause === 'feature-repair'` check. | verified, 85% (ADR A2) |
| Base-refresh tip consumption | Feasible. The two `cause === 'feature-repair'` guards around `consumeRecordedResolution` (`runRestack`, `resumePlanned`) are lifted. The rebuild already replays with an empty comparison set, which is correct for operator-authored commits. | verified |
| Decision delivery to the resolver | Feasible. `resolveRestackConflict` passes `{ ...context, environment }` to the conductor resolver, which `daemon-cli.ts` wires to `stepRunner.resolveRebaseConflict`. An optional `operatorDecision` field rides the same object. | verified, 90% (ADR A1) |
| Resolver honors the decision | A prompt contract, not machinery. The escalation path names the applied decision, so a failure is visible and the tip path remains. | unverified, 70% (ADR A3, operator-approved) |
| Data implications | One new ref family, `refs/conductor/<slug>/restack/decision/c<k>`, with compare-and-swap writes and named teardown. One additive optional journal field, `deliveredDecision`, beside #3522's `consumedResolution` and parsed the same fail-closed way, so an older journal without it reads unchanged. No other persisted-format change to existing refs, the journal or the conflict record. | verified |
| Worktree isolation | Refs live in the shared git directory per feature slug, like #3522's refs. No new port, database or path shared across features. | verified |
| Performance | One `rev-parse` and one `cat-file` per conflicted range, only when a resolver dispatch is about to happen. | inferred |

## Alignment

- **The governing ADR is reused, not duplicated.** #3522's ADR owns the operator-recorded resolution
  pattern. The new ADR (`adr-2026-10-31-operator-decision-for-stacked-restack-conflicts`) adds only
  what that ADR does not cover: a decision ref family, a resolver-input seam and a new event. Both
  on-main ADRs carry dated amendment notes pointing to it. Nothing in either ADR is rewritten.
- **Structural prerequisite met.** The design adds durable state the engine consumes (a ref family)
  and a new integration seam (operator input into the provider resolver's context). Both are
  structural, so a new ADR is warranted.
- **One clearing command per halt kind.** `--decision` joins `--tip` on `stack restack-resolve`
  instead of reopening `halt clear`. This keeps #3203's rule that an operator halt is cleared by the
  command that resolves it, and keeps that command out of daemon sessions.
- **Event spine.** Occurrences (`recorded`, `applied`, `stale`) are a new `ConductorEvent` member
  registered in `EVENT_SINKS`. The decision text is durable state in a ref, exception C, matching the
  resolution ref. No sidecar file, poller or second ledger is added.
- **State management.** `action` is a closed union. The decision blob is parsed fail-closed, as
  `parseConflictRecord` is. A malformed blob is treated as no decision and reported, never
  partially used.
- **Parity.** With no decision ref, the restack and resolver paths, the plain rebase resolver's
  prompt, N=1 features and routing-off are unchanged. The only deliberate change is the base-refresh
  conflict halt, which reverses #3522 decision 9's parity promise. That ADR is amended, and #3522's
  parity story criterion is replaced in place.
- **Scope boundary held.** The stale `HALT.cleared` body was in the original scope. It was split
  out with operator approval on 2026-10-31, because the daemon clear-watcher (`watchHaltCleared`)
  uses `HALT.cleared` existence to attribute clears, and the file is the prd_audit over-scope
  carrier. Plain rebase, CI-fix and setup resolvers stay excluded.

## Wiring Surface

| New surface | Production caller (design-time) |
|---|---|
| `--decision` flag on `stack restack-resolve` | The existing `stack restack-resolve` registration in `cli.ts`, which dispatches to `dispatchStackRestackResolve` |
| Decision blob read/write helpers in `restack-conflict-record.ts` | Written by `dispatchStackRestackResolve`; read by `runRestack` and `resumePlanned` before their `resolveRestackConflict` calls |
| `operatorDecision` on `ResolveRestackConflictOptions` / `ResolutionContext` | Set by `runRestack` and `resumePlanned`; read by `StepRunner.resolveRebaseConflict` through the `daemon-cli.ts` resolver wiring |
| `restack_decision` event member | Emitted by `dispatchStackRestackResolve` (`recorded`) and by `runRestack` / `resumePlanned` (`applied`, `stale`); persisted by `EventPersister` through `EVENT_SINKS` |
| Decision `verify` and `delete` transaction lines | `applyRestackMove` and `appliedTransactionLines`, which already carry #3522's resolution lines |
| `deliveredDecision` journal field | Written by `updateRestackChildStatus` from `runRestack` and `resumePlanned`; read by `applyRestackMove`, `appliedTransactionLines` and journal recovery |
| `restack/decision/c<k>` in `featureConductorRefNames` | The existing feature teardown in `restack-refs-cleanup.ts` |
| Base-refresh record and halt recipe | `haltRecordedRestackConflict`, already called by both restack entry points |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| The resolver ignores the decision and escalates the same question | Technical | Medium | Medium | The halt names the applied decision; the tip path remains; A3 operator-approved |
| A base-refresh range identity drifts when the default branch advances, so decisions read as stale | Technical | Low | Medium | Real-git test advancing the default between halt and rerun (A4) |
| A recorded base-refresh tip goes stale as the default branch moves | Technical | Medium | Low | The shipped `restack-resolution-stale` halt; the decision path does not depend on the parent tree |
| Reversing #3522's base-refresh parity breaks its golden tests | Integration | High | Low | The plan updates those tests and replaces the story criterion in place |
| A decision ref leaks after feature teardown | Data | Low | Low | Named teardown in `featureConductorRefNames`, covered by the existing cleanup test |

## ADRs Created

- `adr-2026-10-31-operator-decision-for-stacked-restack-conflicts` — APPROVED.
- Amended, with dated notes only: `adr-2026-10-25-operator-recorded-restack-conflict-resolution`
  (decisions 1, 2, 3, 4, 5, 8, 9) and `adr-2026-10-10-stacked-restack-journaled-replay` (decision 6).
